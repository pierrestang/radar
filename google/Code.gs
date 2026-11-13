/**
 * Radar → Google Agenda (Google Apps Script, gratuit, dans le compte de l'utilisateur).
 * Toutes les minutes, lit google.json dans le Gist secret de Radar et met à jour l'agenda « Radar »
 * (création, modification, suppression, couleur de la rubrique). Aucun point d'accès public.
 * Couleur exacte (24 couleurs de Google) via les étiquettes d'agenda (API Calendar, eventLabelId) ;
 * repli sur les 11 couleurs historiques (setColor) si l'API refuse.
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
  let labelled = 0, labelError = null;
  try { labelled = applyLabels_(cal, body.events || [], from, to); } catch (e) { labelError = String(e && e.message || e).slice(0, 300); }
  props_().setProperty('BUILT', body.built);
  return { created: created, updated: updated, deleted: deleted, labelled: labelled, labelError: labelError, total: (body.events || []).length };
}

/* ---------- Étiquettes (couleur exacte de la rubrique) ---------- */

const API_ = 'https://www.googleapis.com/calendar/v3/calendars/';
function api_(method, url, payload) {
  const o = { method: method, muteHttpExceptions: true, contentType: 'application/json', headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } };
  if (payload) o.payload = JSON.stringify(payload);
  const res = UrlFetchApp.fetch(url, o);
  if (res.getResponseCode() >= 300) throw new Error(method + ' ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText() || '{}');
}

/** Une étiquette par couleur (créée au besoin), puis chaque événement reçoit celle de sa rubrique. */
function applyLabels_(cal, events, from, to) {
  const wanted = {};
  events.forEach(function (x) { if (x.hex) wanted[x.uid] = x; });
  if (!Object.keys(wanted).length) return 0;
  const calUrl = API_ + encodeURIComponent(cal.getId());
  const info = api_('get', calUrl);
  const labels = ((info.labelProperties || {}).eventLabels || []).slice();
  const byHex = {};
  labels.forEach(function (l) { if (l.backgroundColor) byHex[l.backgroundColor.toUpperCase()] = l.id; });
  let changed = false;
  Object.keys(wanted).forEach(function (u) {
    const x = wanted[u];
    if (byHex[x.hex]) return;
    const l = { id: Utilities.getUuid(), backgroundColor: x.hex.toLowerCase() };
    if (x.label) l.name = String(x.label).slice(0, 50);
    labels.push(l); byHex[x.hex] = l.id; changed = true;
  });
  if (changed) api_('patch', calUrl, { labelProperties: { eventLabels: labels } });
  const reqs = [], evs = [];
  cal.getEvents(from, to).forEach(function (ev) {
    const x = wanted[ev.getTag('radarUid')];
    if (!x) return;
    const id = byHex[x.hex];
    if (ev.getTag('radarLabel') === id) return;
    reqs.push({
      url: calUrl + '/events/' + encodeURIComponent(ev.getId().split('@')[0]) + '?eventLabelVersion=1',
      method: 'patch', muteHttpExceptions: true, contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, payload: JSON.stringify({ eventLabelId: id }),
    });
    evs.push([ev, id]);
  });
  let n = 0, err = null;
  for (let i = 0; i < reqs.length; i += 50) {
    UrlFetchApp.fetchAll(reqs.slice(i, i + 50)).forEach(function (res, k) {
      if (res.getResponseCode() < 300) { evs[i + k][0].setTag('radarLabel', evs[i + k][1]); n++; }
      else if (!err) err = 'PATCH ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200);
    });
  }
  if (err) throw new Error(err + ' (' + n + ' étiquetés)');
  return n;
}

/** À lancer depuis l'éditeur pour tester les étiquettes sans attendre une modification. */
function testLabels() {
  props_().deleteProperty('BUILT');
  Logger.log(JSON.stringify(pull()));
}
