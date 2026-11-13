// Synchro Radar : récupère chaque flux .ics, met à jour remote.json et radar.ics dans le Gist.
// Usage : GIST_TOKEN=… node scripts/sync.mjs            (GIST_ID facultatif)
//         node scripts/sync.mjs --dry <fichier.ics>      (test local d'un flux, sans réseau)
import ICAL from 'ical.js';
import { readFileSync } from 'node:fs';
import { parseICS, buildICS, normalizeUrl, emptyConfig, emptyRemote, googlePayload } from '../shared/ics.js';
import { findGist, readGist, writeGist } from '../shared/gist.js';
import { TV_PAGES, TV_REFRESH_MS, parseFootao, annotateTv } from '../shared/tv.js';
import { MUSIC_SOURCE_ID, musicReleases } from '../shared/itunes.js';
import { SUGGESTIONS, SUGGESTIONS_REFRESH_MS, TRENDING_REFRESH_MS, previewEvents } from '../shared/suggestions.js';
import { trendingFilms, trendingSeries, footballPicks } from './trending.mjs';

const UA = { 'User-Agent': 'Radar-calendar-sync/1.0' };

const dry = process.argv.indexOf('--dry');
if (dry > -1) {
  const { calName, events } = parseICS(readFileSync(process.argv[dry + 1], 'utf8'), ICAL);
  console.log(`${calName || '(sans nom)'} : ${events.length} événements`);
  for (const e of events.slice(0, 15)) console.log(' ', e.allDay ? e.start : e.start.slice(0, 16), '|', e.title);
  process.exit(0);
}

const token = process.env.GIST_TOKEN;
if (!token) { console.log('::notice::GIST_TOKEN pas encore configuré (gh secret set GIST_TOKEN) : synchro ignorée.'); process.exit(0); }
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

// Sorties musicales des artistes suivis (API iTunes, sans clé).
if ((config.artists || []).length) {
  const prev = remote.sources?.[MUSIC_SOURCE_ID];
  const r = await musicReleases((u) => fetch(u, { headers: UA, signal: AbortSignal.timeout(20000) }), config.artists);
  if (r.events.length || !prev) next.sources[MUSIC_SOURCE_ID] = { fetchedAt: new Date().toISOString(), calName: 'Sorties musique', error: r.error, events: r.events };
  else next.sources[MUSIC_SOURCE_ID] = { ...prev, error: r.error, failedAt: new Date().toISOString() };
  console.log(`${r.error ? '✗' : '✓'} sorties musique : ${r.events.length} sorties (${config.artists.length} artistes)`);
}

// Chaînes de diffusion des matchs (footao.tv) : relues toutes les 6 h seulement, puis rattachées aux matchs.
next.tv = remote.tv || null;
if (!next.tv || Date.now() - Date.parse(next.tv.fetchedAt || 0) > TV_REFRESH_MS) {
  const items = [];
  for (const url of TV_PAGES) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
      if (res.ok) items.push(...parseFootao(await res.text()));
    } catch { /* page indisponible : on garde le reste */ }
    await new Promise((r) => setTimeout(r, 1500)); // une page à la fois, sans insister
  }
  const seen = new Set();
  const uniq = items.filter((it) => { const k = it.start + it.teams; if (seen.has(k)) return false; seen.add(k); return true; });
  if (uniq.length) next.tv = { fetchedAt: new Date().toISOString(), items: uniq };
  console.log(`📺 chaînes : ${uniq.length} matchs relevés`);
}
if (next.tv) {
  let n = 0;
  for (const s of Object.values(next.sources)) n += annotateTv(s.events || [], next.tv.items);
  console.log(`📺 ${n} matchs avec leur chaîne`);
}

// Suggestions de l'onglet Sources : aperçu des calendriers (toutes les 6 h) et sélections « à ne pas manquer ».
next.suggestions = remote.suggestions || null;
const sugg = next.suggestions ? { ...next.suggestions, picks: { ...(next.suggestions.picks || {}) } } : { feeds: {}, picks: {} };
const suggUrls = SUGGESTIONS.flatMap((g) => g.items.map((it) => it.url));
const suggStale = !next.suggestions || Date.now() - Date.parse(next.suggestions.fetchedAt || 0) > SUGGESTIONS_REFRESH_MS
  || !sugg.picks.football || suggUrls.some((u) => !sugg.feeds?.[u]); // liste de calendriers modifiée
if (suggStale) {
  const feeds = {}, club = [];
  let n = 0;
  for (const g of SUGGESTIONS) for (const it of g.items) {
    try {
      const res = await fetch(it.url, { headers: { ...UA, Accept: 'text/calendar, */*' }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const p = parseICS(await res.text(), ICAL);
      feeds[it.url] = { fetchedAt: new Date().toISOString(), events: previewEvents(p.events) };
      if (g.picks === 'football') club.push({ teamName: (p.calName || '').replace(/\s*-\s*Fixtures$/i, ''), events: p.events, star: it.star });
      if (g.picks === 'films') sugg.filmFeed = p.events;
      n++;
    } catch (err) { if (sugg.feeds?.[it.url]) feeds[it.url] = sugg.feeds[it.url]; console.log(`✗ suggestion : ${err.message || err}`); }
    await new Promise((r) => setTimeout(r, 300));
  }
  sugg.feeds = feeds; sugg.fetchedAt = new Date().toISOString();
  if (club.length) sugg.picks.football = footballPicks(club).map(({ uid, title, start, end, allDay, location, url }) => ({ uid, title, start, end, allDay, location, url }));
  console.log(`💡 suggestions : ${n} calendriers relus, ${sugg.picks.football?.length || 0} affiches`);
}
if (!sugg.trendingAt || Date.now() - Date.parse(sugg.trendingAt) > TRENDING_REFRESH_MS) {
  try {
    if (!sugg.filmFeed) {
      const it = SUGGESTIONS.find((g) => g.picks === 'films').items[0];
      const res = await fetch(it.url, { headers: { ...UA, Accept: 'text/calendar, */*' }, signal: AbortSignal.timeout(30000) });
      if (res.ok) sugg.filmFeed = parseICS(await res.text(), ICAL).events;
    }
    if (sugg.filmFeed) sugg.picks.films = await trendingFilms(sugg.filmFeed);
    sugg.picks.series = await trendingSeries();
    sugg.trendingAt = new Date().toISOString();
    console.log(`🎬 plus attendus : ${sugg.picks.films?.length || 0} films, ${sugg.picks.series?.length || 0} séries`);
  } catch (err) { console.log(`✗ plus attendus : ${err.message || err}`); }
}
delete sugg.filmFeed;
next.suggestions = sugg;

// Relire la config juste avant d'écrire, au cas où elle aurait changé pendant la synchro.
const fresh = (await readGist(token, id)).config || config;
await writeGist(token, id, { 'remote.json': next, 'radar.ics': buildICS(fresh, next), 'google.json': googlePayload(fresh, next) });
console.log(`Terminé : ${ok} flux à jour, ${ko} en erreur.`);

