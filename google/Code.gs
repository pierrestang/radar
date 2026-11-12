/**
 * Radar → Google Agenda (Google Apps Script, gratuit, dans le compte de l'utilisateur).
 * Toutes les minutes, lit google.json dans le Gist secret de Radar et met à jour l'agenda « Radar »
 * (création, modification, suppression, couleur de la rubrique). Aucun point d'accès public.
 * SOURCE : lien « raw » de google.json (remplacé à l'installation, jamais commité).
 */
const SOURCE = '__RADAR_SOURCE__';
const CAL_NAME = 'Radar';

function props_() { return PropertiesService.getScriptProperties(); }

function getCalendar_() {
  const p = props_();
  const id = p.getProperty('CAL_ID');
  let cal = id && CalendarApp.getCalendarById(id);
  if (!cal) {
    cal = CalendarApp.createCalendar(CAL_NAME, { color: CalendarApp.Color.GREEN, timeZone: 'Europe/Paris' });
    p.setProperty('CAL_ID', cal.getId());
  }
  return cal;
}

/** À lancer une fois depuis l'éditeur : crée l'agenda, installe le déclencheur et fait une première synchro. */
function setup() {
  getCalendar_();
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('pull').timeBased().everyMinutes(1).create();
  props_().deleteProperty('BUILT');
  Logger.log(JSON.stringify(pull()));
}

/** Lancé chaque minute par le déclencheur. */
/** Lit google.json : API GitHub d'abord (toujours à jour), sinon lien raw (cache de 5 min). */
function fetchBody_() {
  const m = SOURCE.match(/gist\.githubusercontent\.com\/[^/]+\/([0-9a-f]+)\//);
  if (m) {
    const api = UrlFetchApp.fetch('https://api.github.com/gists/' + m[1], { muteHttpExceptions: true, headers: { Accept: 'application/vnd.github+json' } });
    if (api.getResponseCode() === 200) {
      const f = JSON.parse(api.getContentText()).files['google.json'];
      if (f && !f.truncated) return JSON.parse(f.content);
    }
  }
  const res = UrlFetchApp.fetch(SOURCE, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode());
  return JSON.parse(res.getContentText());
}

function pull() {
  const body = fetchBody_();
  const last = props_().getProperty('BUILT');
  if (last && body.built <= last) return { unchanged: true };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { busy: true };
  try { return apply_(body); } finally { lock.releaseLock(); }
}

function day_(k) { const a = k.split('-').map(Number); return new Date(a[0], a[1] - 1, a[2]); }
function hash_(x) {
  const raw = JSON.stringify([x.title, x.start, x.end, x.allDay, x.location || '', x.notes || '', x.color || '']);
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw, Utilities.Charset.UTF_8));
}

function apply_(body) {
  const cal = getCalendar_();
  const from = new Date(Date.now() - 60 * 864e5), to = new Date(Date.now() + 800 * 864e5);
  const existing = {};
  cal.getEvents(from, to).forEach(function (ev) {
    const u = ev.getTag('radarUid');
    if (!u) return;
    if (existing[u]) ev.deleteEvent(); else existing[u] = ev;
  });
  let created = 0, updated = 0, deleted = 0;
  const want = {};
  (body.events || []).forEach(function (x) {
    want[x.uid] = true;
    const h = hash_(x);
    const cur = existing[x.uid];
    if (cur && cur.getTag('radarHash') === h) return;
    if (cur) { cur.deleteEvent(); updated++; } else { created++; }
    const opts = { location: x.location || '', description: x.notes || '' };
    const ev = x.allDay
      ? cal.createAllDayEvent(x.title, day_(x.start), day_(x.end), opts)
      : cal.createEvent(x.title, new Date(x.start), new Date(x.end), opts);
    ev.setTag('radarUid', x.uid);
    ev.setTag('radarHash', h);
    if (x.color) ev.setColor(String(x.color));
  });
  Object.keys(existing).forEach(function (u) { if (!want[u]) { existing[u].deleteEvent(); deleted++; } });
  props_().setProperty('BUILT', body.built);
  return { created: created, updated: updated, deleted: deleted, total: (body.events || []).length };
}
