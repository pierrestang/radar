// Synchro Radar : récupère chaque flux .ics, met à jour remote.json et radar.ics dans le Gist.
// Usage : GIST_TOKEN=… node scripts/sync.mjs            (GIST_ID facultatif)
//         node scripts/sync.mjs --dry <fichier.ics>      (test local d'un flux, sans réseau)
import ICAL from 'ical.js';
import { readFileSync } from 'node:fs';
import { parseICS, buildICS, normalizeUrl, emptyConfig, emptyRemote } from '../shared/ics.js';
import { findGist, readGist, writeGist } from '../shared/gist.js';

const dry = process.argv.indexOf('--dry');
if (dry > -1) {
  const { calName, events } = parseICS(readFileSync(process.argv[dry + 1], 'utf8'), ICAL);
  console.log(`${calName || '(sans nom)'} : ${events.length} événements`);
  for (const e of events.slice(0, 15)) console.log(' ', e.allDay ? e.start : e.start.slice(0, 16), '|', e.title);
  process.exit(0);
}

const token = process.env.GIST_TOKEN;
if (!token) { console.error('GIST_TOKEN manquant (secret du dépôt).'); process.exit(1); }
const id = process.env.GIST_ID || (await findGist(token));
if (!id) { console.log('Aucun Gist Radar pour l’instant : ouvre l’app une première fois pour le créer.'); process.exit(0); }

const data = await readGist(token, id);
const config = data.config || emptyConfig();
const remote = data.remote || emptyRemote();
const next = { version: 1, updatedAt: new Date().toISOString(), sources: {} };

let ok = 0, ko = 0;
for (const src of config.sources || []) {
  const prev = remote.sources?.[src.id];
  try {
    const res = await fetch(normalizeUrl(src.url), {
      headers: { 'User-Agent': 'Radar-calendar-sync/1.0', Accept: 'text/calendar, */*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Ce lien ne renvoie pas un calendrier .ics');
    const { calName, events } = parseICS(text, ICAL);
    next.sources[src.id] = { fetchedAt: new Date().toISOString(), calName, error: null, events };
    ok++;
    // Journal volontairement sans titres d'événements : les logs d'un dépôt public sont publics.
    console.log(`✓ source ${src.id} : ${events.length} événements`);
  } catch (err) {
    // On garde les derniers événements connus si le flux est momentanément indisponible.
    next.sources[src.id] = { ...(prev || { events: [] }), error: String(err.message || err), failedAt: new Date().toISOString() };
    ko++;
    console.log(`✗ source ${src.id} : ${err.message || err}`);
  }
}

// Relire la config juste avant d'écrire, au cas où elle aurait changé pendant la synchro.
const fresh = (await readGist(token, id)).config || config;
await writeGist(token, id, { 'remote.json': next, 'radar.ics': buildICS(fresh, next) });
console.log(`Terminé : ${ok} flux à jour, ${ko} en erreur.`);
