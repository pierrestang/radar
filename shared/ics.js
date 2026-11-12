// Radar — cœur partagé entre l'app (navigateur) et la synchro (GitHub Actions / Node).
// Aucune dépendance : ical.js est injecté par l'appelant.
import { frenchify, cleanNotes } from './translate.js';

export const DEFAULT_TZ = 'Europe/Paris';
export const WINDOW_PAST_DAYS = 30;
export const WINDOW_FUTURE_DAYS = 730;
const MAX_PER_SOURCE = 3000;
const MAX_OCCURRENCES = 400;

// Fuseaux Windows courants rencontrés dans des flux Outlook/Exchange.
const WINDOWS_TZ = {
  'Romance Standard Time': 'Europe/Paris',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'China Standard Time': 'Asia/Shanghai',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'UTC': 'UTC',
};

export function normalizeUrl(url) {
  let u = String(url || '').trim();
  if (/^webcals?:\/\//i.test(u)) u = u.replace(/^webcals?:\/\//i, 'https://');
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

function ianaFor(tzid) {
  if (!tzid) return null;
  const clean = String(tzid).replace(/^\/+/, '').replace(/^"|"$/g, '');
  if (WINDOWS_TZ[clean]) return WINDOWS_TZ[clean];
  try { new Intl.DateTimeFormat('en-US', { timeZone: clean }); return clean; } catch { return null; }
}

function tzOffsetMs(utcMs, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - utcMs;
}

/** Convertit une heure murale (dans le fuseau tz) en instant UTC (ms). */
export function wallToUtc(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let ms = guess - tzOffsetMs(guess, tz);
  ms = guess - tzOffsetMs(ms, tz);
  return ms;
}

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (t) => `${t.year}-${pad(t.month)}-${pad(t.day)}`;

function timeToValue(t, tzHint) {
  if (t.isDate) return { allDay: true, value: dateKey(t) };
  const zone = t.zone && t.zone.tzid;
  if (zone === 'UTC' || (zone && zone !== 'floating')) {
    return { allDay: false, value: t.toJSDate().toISOString() };
  }
  const tz = ianaFor(tzHint) || DEFAULT_TZ;
  const ms = wallToUtc(t.year, t.month, t.day, t.hour, t.minute, t.second, tz);
  return { allDay: false, value: new Date(ms).toISOString() };
}

function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function startMs(ev) {
  if (ev.allDay) { const [y, m, d] = ev.start.split('-').map(Number); return Date.UTC(y, m - 1, d); }
  return Date.parse(ev.start);
}
export { startMs };

/**
 * Lit un flux iCalendar et renvoie des événements normalisés (récurrences dépliées)
 * dans la fenêtre [aujourd'hui - 30 j, aujourd'hui + 2 ans].
 */
export function parseICS(text, ICAL, { now = Date.now() } = {}) {
  const root = new ICAL.Component(ICAL.parse(text));
  const calName = root.getFirstPropertyValue('x-wr-calname') || null;
  for (const vtz of root.getAllSubcomponents('vtimezone')) {
    try {
      const tz = new ICAL.Timezone(vtz);
      if (tz.tzid && !ICAL.TimezoneService.has(tz.tzid)) ICAL.TimezoneService.register(tz.tzid, tz);
    } catch { /* fuseau illisible : on retombera sur Intl */ }
  }
  const winStart = now - WINDOW_PAST_DAYS * 864e5;
  const winEnd = now + WINDOW_FUTURE_DAYS * 864e5;

  const vevents = root.getAllSubcomponents('vevent');
  const masters = new Map();
  const exceptions = [];
  for (const ve of vevents) {
    if (ve.hasProperty('recurrence-id')) exceptions.push(ve); else masters.set(ve.getFirstPropertyValue('uid') || Math.random().toString(36), ve);
  }

  const out = [];
  const push = (ve, uid, startT, endT, tzHint, instanceKey) => {
    const status = String(ve.getFirstPropertyValue('status') || '').toUpperCase();
    if (status === 'CANCELLED') return;
    const s = timeToValue(startT, tzHint);
    let e = endT ? timeToValue(endT, tzHint) : null;
    if (!e) e = s.allDay ? { allDay: true, value: addDays(s.value, 1) } : { allDay: false, value: s.value };
    const ev = {
      uid: instanceKey ? `${uid}_${instanceKey}` : uid,
      title: String(ve.getFirstPropertyValue('summary') || 'Sans titre').trim(),
      start: s.value,
      end: e.value,
      allDay: s.allDay,
    };
    const loc = ve.getFirstPropertyValue('location'); if (loc) ev.location = String(loc).trim();
    const desc = ve.getFirstPropertyValue('description'); if (desc) ev.notes = String(desc).trim().slice(0, 2000);
    const url = ve.getFirstPropertyValue('url'); if (url) ev.url = String(url);
    // plateforme annoncée dans la description (flux de séries : « Airs on Netflix »)
    const air = desc && String(desc).match(/(?:^|\n)\s*Airs on ([^\n]+)/i);
    if (air) ev.platform = air[1].trim().replace(/\.$/, '');
    const ms = startMs(ev);
    if (ms < winStart || ms > winEnd) return;
    out.push(ev);
  };

  for (const [uid, ve] of masters) {
    try {
      const event = new ICAL.Event(ve);
      for (const ex of exceptions) if (ex.getFirstPropertyValue('uid') === uid) event.relateException(ex);
      const tzHint = ve.getFirstProperty('dtstart')?.getParameter('tzid');
      if (!event.startDate) continue;
      if (event.isRecurring()) {
        const it = event.iterator();
        let next, n = 0;
        while ((next = it.next()) && n < MAX_OCCURRENCES) {
          const det = event.getOccurrenceDetails(next);
          const probe = timeToValue(det.startDate, tzHint);
          const ms = startMs({ allDay: probe.allDay, start: probe.value });
          if (ms > winEnd) break;
          if (ms < winStart) continue;
          n++;
          push(det.item.component, uid, det.startDate, det.endDate, tzHint, probe.value.replace(/[^0-9]/g, '').slice(0, 14));
        }
      } else {
        push(ve, uid, event.startDate, event.endDate, tzHint, null);
      }
    } catch (err) { /* un événement cassé ne doit pas bloquer le flux */ }
    if (out.length >= MAX_PER_SOURCE) break;
  }
  out.sort((a, b) => startMs(a) - startMs(b));
  return { calName, events: out };
}

/* ---------- Génération du calendrier fusionné ---------- */

function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const chunks = [];
  let cur = '', curLen = 0, limit = 75;
  for (const ch of line) {
    const l = enc.encode(ch).length;
    if (curLen + l > limit) { chunks.push(cur); cur = ''; curLen = 0; limit = 74; }
    cur += ch; curLen += l;
  }
  chunks.push(cur);
  return chunks.join('\r\n ');
}

const icsDate = (key) => key.replace(/-/g, '');
const icsUtc = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Fusionne événements manuels + flux distants et renvoie le texte .ics complet. */
export function buildICS(config, remote, { now = Date.now() } = {}) {
  const events = mergedEvents(config, remote);
  const stamp = icsUtc(new Date(now).toISOString());
  const L = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Radar//Agenda fusionné//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(config.calendarName || 'Radar')}`, `X-WR-TIMEZONE:${DEFAULT_TZ}`,
    'X-WR-CALDESC:Agenda fusionné par Radar', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
  ];
  for (const ev of events) {
    L.push('BEGIN:VEVENT');
    L.push(`UID:${ev.icsUid}`);
    L.push(`DTSTAMP:${stamp}`);
    if (ev.allDay) {
      L.push(`DTSTART;VALUE=DATE:${icsDate(ev.start)}`);
      L.push(`DTEND;VALUE=DATE:${icsDate(ev.end && ev.end > ev.start ? ev.end : addDays(ev.start, 1))}`);
    } else {
      L.push(`DTSTART:${icsUtc(ev.start)}`);
      L.push(`DTEND:${icsUtc(ev.end && Date.parse(ev.end) > Date.parse(ev.start) ? ev.end : new Date(Date.parse(ev.start) + 36e5).toISOString())}`);
    }
    L.push(`SUMMARY:${esc(ev.title)}`);
    if (ev.location) L.push(`LOCATION:${esc(ev.location)}`);
    const desc = fullNotes(ev);
    if (desc) L.push(`DESCRIPTION:${esc(desc)}`);
    if (ev.url) L.push(`URL:${esc(ev.url).replace(/\\([,;])/g, '$1')}`);
    if (ev.categoryName) L.push(`CATEGORIES:${esc(ev.categoryName)}`);
    L.push('TRANSP:TRANSPARENT');
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

/** Liste unique, triée, dédoublonnée de tous les événements à afficher / publier. */
export function mergedEvents(config, remote) {
  const out = [];
  const seen = new Set();
  const hidden = new Set(config.hidden || []);
  const cats = new Map(categoriesOf(config).map((c) => [c.id, c]));
  const overrides = config.eventCategories || {};
  const withCategory = (ev, fallback) => {
    const id = Object.prototype.hasOwnProperty.call(overrides, ev.icsUid) ? overrides[ev.icsUid] : fallback;
    const cat = id && cats.get(id);
    ev.category = cat ? cat.id : null; ev.categoryName = cat ? cat.name : null; ev.color = cat ? cat.color : null;
    return ev;
  };
  const keyOf = (e) => `${e.title.toLowerCase().replace(/\s+/g, ' ').trim()}|${e.start.slice(0, 16)}`;
  for (const m of config.manual || []) {
    const ev = withCategory({ ...m, origin: m.origin || 'manual', sourceId: null, sourceName: null, icsUid: `${m.id}@radar` }, m.category);
    seen.add(keyOf(ev)); out.push(ev);
  }
  const sources = [...(config.sources || [])];
  // sorties musicales des artistes suivis : une source virtuelle alimentée par la synchro (API iTunes)
  if ((config.artists || []).length) sources.push({ id: 'itunes', name: 'Sorties musique', category: config.musicCategory || 'musique' });
  for (const src of sources) {
    if (src.enabled === false) continue;
    const list = (remote && remote.sources && remote.sources[src.id] && remote.sources[src.id].events) || [];
    for (const e of list) {
      const base = src.translate === false ? { ...e, notes: e.notes ? cleanNotes(e.notes) || undefined : undefined } : frenchify(e);
      const ev = { ...base, origin: 'feed', sourceId: src.id, sourceName: src.name, icsUid: `${e.uid}@radar-${src.id}` };
      withCategory(ev, src.category);
      if (hidden.has(ev.icsUid)) continue;
      const k = keyOf(ev);
      if (seen.has(k)) continue;
      seen.add(k); out.push(ev);
    }
  }
  out.sort((a, b) => startMs(a) - startMs(b) || a.title.localeCompare(b.title));
  return out;
}

export const DEFAULT_CATEGORIES = [
  { id: 'sport', name: 'Sport', color: '#2F6FEB' },
  { id: 'jeux', name: 'Jeux vidéo', color: '#9333EA' },
  { id: 'film', name: 'Film', color: '#E0573B' },
  { id: 'serie', name: 'Série', color: '#DB2777' },
  { id: 'video', name: 'Vidéo', color: '#CA8A04' },
];
export function categoriesOf(config) {
  return Array.isArray(config.categories) ? config.categories : DEFAULT_CATEGORIES;
}

/** Notes complètes d'un événement : où le voir (chaîne ou plateforme), puis les notes. */
export function fullNotes(ev) {
  const where = ev.tv ? `📺 ${ev.tv}` : ev.platform ? `▶️ ${ev.platform}` : '';
  return [where, ev.notes].filter(Boolean).join('\n\n');
}

export function emptyConfig() {
  return { version: 1, calendarName: 'Radar', sources: [], manual: [], hidden: [], categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })), eventCategories: {} };
}
export function emptyRemote() {
  return { version: 1, updatedAt: null, sources: {} };
}

/* ---------- Envoi vers Google Agenda (Apps Script) ---------- */

// Couleurs d'événement Google Agenda (identifiants 1 à 11).
const GOOGLE_COLORS = {
  1: '#7986CB', 2: '#33B679', 3: '#8E24AA', 4: '#E67C73', 5: '#F6BF26', 6: '#F4511E',
  7: '#039BE5', 8: '#616161', 9: '#3F51B5', 10: '#0B8043', 11: '#D50000',
};
function rgb(hex) { const h = hex.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); }
/** Couleur Google la plus proche d'une couleur de rubrique. */
export function googleColorId(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return null;
  const [r, g, b] = rgb(hex);
  let best = null, bestD = Infinity;
  for (const [id, h] of Object.entries(GOOGLE_COLORS)) {
    const [r2, g2, b2] = rgb(h);
    const rm = (r + r2) / 2; // distance « redmean », proche de la perception
    const d = (2 + rm / 256) * (r - r2) ** 2 + 4 * (g - g2) ** 2 + (2 + (255 - rm) / 256) * (b - b2) ** 2;
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

export function googlePayload(config, remote, { now = Date.now() } = {}) {
  const events = mergedEvents(config, remote).map((ev) => {
    let end = ev.end;
    if (ev.allDay) { if (!end || end <= ev.start) end = addDays(ev.start, 1); }
    else if (!end || Date.parse(end) <= Date.parse(ev.start)) end = new Date(Date.parse(ev.start) + 36e5).toISOString();
    const x = { uid: ev.icsUid, title: ev.title, start: ev.start, end, allDay: !!ev.allDay };
    if (ev.location) x.location = ev.location;
    const n = fullNotes(ev); if (n) x.notes = n;
    const c = googleColorId(ev.color);
    if (c) x.color = c;
    return x;
  });
  return { built: new Date(now).toISOString(), events };
}
