// « Les plus attendus » pour l'onglet Sources : films et séries classés par vues Wikipédia (30 derniers jours,
// fr + en), titres et dates de sortie françaises via Wikidata ; affiches de foot entre les clubs suivis.
// Exécuté par la synchro (Node), une fois par jour. Sources gratuites sans clé : Wikidata (CC0), Wikimedia
// Pageviews, TVmaze (CC BY-SA), smartcalendars.ai (sélection des grosses sorties US d'après Wikidata).
import { startMs } from '../shared/ics.js';

const UA = { 'User-Agent': 'Radar-calendar-sync/1.0' };
const DAY = 864e5;
const HORIZON_DAYS = 400;   // jusqu'à ~13 mois devant
const PICKS = 10;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(url, opts = {}, tries = 4) {
  const res = await fetch(url, { ...opts, headers: { ...UA, Accept: 'application/json', ...(opts.headers || {}) }, signal: AbortSignal.timeout(60000) });
  if (res.status === 429 && tries > 1) { // trop de requêtes : on patiente comme demandé
    await sleep(Math.min(60, Number(res.headers.get('retry-after')) || 10) * 1000);
    return json(url, opts, tries - 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

/** Vues des 30 derniers jours d'articles Wikipédia, par paquets de 50 (API MediaWiki, prop=pageviews). */
async function viewsMany(lang, titles) {
  const out = {};
  const list = [...new Set(titles.filter(Boolean))];
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    try {
      const j = await json(`https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&prop=pageviews&pvipdays=30&redirects=1&titles=${encodeURIComponent(chunk.join('|'))}`);
      const back = {}; // titre final → titre demandé (normalisations, redirections)
      for (const n of [...(j.query?.normalized || []), ...(j.query?.redirects || [])]) back[n.to] = back[n.from] || n.from;
      for (const pg of j.query?.pages || []) {
        const v = Object.values(pg.pageviews || {}).reduce((s, x) => s + (x || 0), 0);
        out[back[pg.title] || pg.title] = v;
      }
    } catch { /* paquet indisponible : 0 vue */ }
    await sleep(300);
  }
  return out;
}
/** Score d'attente : vues fr (x2) + vues en. */
async function scoreAll(cands) {
  const fr = await viewsMany('fr', cands.map((c) => c.frwiki));
  const en = await viewsMany('en', cands.map((c) => c.enwiki));
  for (const c of cands) c.score = (fr[c.frwiki] || 0) * 2 + (en[c.enwiki] || 0);
}

/** Entités Wikidata (libellés, articles, dates) par paquets de 50. */
async function entities(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const j = await json(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels|sitelinks|claims&languages=fr|en&sitefilter=frwiki|enwiki&ids=${ids.slice(i, i + 50).join('|')}`);
    Object.assign(out, j.entities || {});
  }
  return out;
}
/** Date de sortie en France (P577 qualifiée « lieu : France »), sinon null. */
function frenchRelease(ent) {
  for (const c of ent?.claims?.P577 || []) {
    const places = (c.qualifiers?.P291 || []).map((q) => q.datavalue?.value?.id);
    const t = c.mainsnak?.datavalue?.value?.time;
    if (places.includes('Q142') && t && c.mainsnak.datavalue.value.precision >= 11) return t.slice(1, 11);
  }
  return null;
}
/** Les mieux classés, étalés dans le temps : à partir de J+7, trois au plus par mois. */
function spread(cands, { now = Date.now(), n = PICKS, perMonth = 3 } = {}) {
  const from = new Date(now + 7 * DAY).toISOString().slice(0, 10);
  const months = {}, out = [];
  for (const c of [...cands].sort((a, b) => b.score - a.score)) {
    if (c.start < from || !c.score) continue;
    const m = c.start.slice(0, 7);
    if ((months[m] || 0) >= perMonth) continue;
    months[m] = (months[m] || 0) + 1;
    out.push(c);
    if (out.length >= n) break;
  }
  return out;
}
// Plateformes et chaînes dont les séries sont attendues en France (hors émissions, jeunesse, réseaux US généralistes).
const PREMIUM = /^(Netflix|HBO|HBO Max|Max|Disney\+|Apple TV\+?|Prime Video|Amazon Prime Video|Paramount\+|Canal\+|Hulu|Peacock|FX|AMC|AMC\+|Showtime|STARZ|BBC One|BBC iPlayer|Crunchyroll)$/i;
const plusDay = (k) => new Date(Date.parse(k) + DAY).toISOString().slice(0, 10);

/** Films : grosses sorties (flux smartcalendars) classées par attente, date française si connue. */
export async function trendingFilms(feedEvents, { now = Date.now() } = {}) {
  const today = new Date(now).toISOString().slice(0, 10), max = new Date(now + HORIZON_DAYS * DAY).toISOString().slice(0, 10);
  const byQ = {};
  for (const e of feedEvents) {
    const q = /wikidata\.org\/wiki\/(Q\d+)/.exec(e.url || '')?.[1];
    if (!q || /\[CANCELLED\]/i.test(e.title)) continue;
    if (!byQ[q] || e.start < byQ[q].start) byQ[q] = e; // première date annoncée
  }
  const ents = await entities(Object.keys(byQ));
  const cands = [];
  for (const [q, e] of Object.entries(byQ)) {
    const ent = ents[q];
    const fr = frenchRelease(ent);
    const start = fr && fr >= today ? fr : e.start;
    if (start < today || start > max) continue;
    cands.push({
      q, start, fr: !!(fr && fr >= today),
      title: ent?.labels?.fr?.value || e.title.replace(/\s*\(\d{4}\)\s*$/, ''),
      frwiki: ent?.sitelinks?.frwiki?.title, enwiki: ent?.sitelinks?.enwiki?.title,
    });
  }
  await scoreAll(cands);
  return spread(cands, { now }).map((c) => ({
    uid: `film-${c.q}`, title: c.title, start: c.start, end: plusDay(c.start), allDay: true,
    notes: c.fr ? 'Sortie au cinéma en France' : 'Sortie aux États-Unis (date française pas encore connue)',
    url: c.frwiki ? `https://fr.wikipedia.org/wiki/${encodeURIComponent(c.frwiki.replace(/ /g, '_'))}` : `https://www.wikidata.org/wiki/${c.q}`,
    score: c.score,
  })).sort((a, b) => a.start.localeCompare(b.start));
}

/** Séries : premières de saison à venir (TVmaze) classées par attente. */
export async function trendingSeries({ now = Date.now() } = {}) {
  const today = new Date(now).toISOString().slice(0, 10), max = new Date(now + HORIZON_DAYS * DAY).toISOString().slice(0, 10);
  const all = await json('https://api.tvmaze.com/schedule/full');
  const seen = new Set();
  const prem = [];
  for (const ep of all) {
    const sh = ep._embedded?.show;
    if (!sh || ep.number !== 1 || !ep.airdate || ep.airdate <= today || ep.airdate > max) continue;
    if ((sh.weight || 0) < 90 || !sh.externals?.imdb) continue;
    if (!PREMIUM.test((sh.webChannel || sh.network)?.name || '')) continue;
    if (/^(News|Talk Show|Game Show|Sports)$/i.test(sh.type || '')) continue;
    const k = `${sh.id}-${ep.season}`;
    if (seen.has(k)) continue;
    seen.add(k);
    prem.push({ ep, sh });
  }
  // articles Wikipédia via l'identifiant IMDb (SPARQL)
  const imdb = [...new Set(prem.map((p) => p.sh.externals.imdb))];
  const wiki = {};
  for (let i = 0; i < imdb.length; i += 80) {
    const q = `SELECT ?imdb ?fr ?en ?lab WHERE { VALUES ?imdb { ${imdb.slice(i, i + 80).map((x) => `"${x}"`).join(' ')} } ?item wdt:P345 ?imdb.
      OPTIONAL { ?f schema:about ?item; schema:isPartOf <https://fr.wikipedia.org/>; schema:name ?fr. }
      OPTIONAL { ?e schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?en. }
      OPTIONAL { ?item rdfs:label ?lab. FILTER(LANG(?lab) = "fr") } }`;
    try {
      const j = await json(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, { headers: { Accept: 'application/sparql-results+json' } });
      for (const b of j.results.bindings) wiki[b.imdb.value] = { frwiki: b.fr?.value, enwiki: b.en?.value, label: b.lab?.value };
    } catch { /* Wikidata momentanément indisponible : classement sur les seuls articles trouvés */ }
  }
  const cands = prem.map(({ ep, sh }) => ({ ep, sh, ...(wiki[sh.externals.imdb] || {}) })).filter((c) => c.frwiki || c.enwiki);
  for (const c of cands) c.start = c.ep.airdate;
  await scoreAll(cands);
  return spread(cands, { now }).map(({ ep, sh, label, frwiki, score: s }) => {
    const where = (sh.webChannel || sh.network)?.name;
    return {
      uid: `serie-${sh.id}-s${ep.season}`,
      title: `${label || sh.name} — saison ${ep.season}`,
      start: ep.airdate, end: plusDay(ep.airdate), allDay: true,
      platform: where || undefined,
      notes: ep.season === 1 ? 'Nouvelle série' : `Retour de la série (saison ${ep.season})`,
      url: frwiki ? `https://fr.wikipedia.org/wiki/${encodeURIComponent(frwiki.replace(/ /g, '_'))}` : sh.url,
      score: s,
    };
  }).sort((a, b) => a.start.localeCompare(b.start));
}

/** Foot : affiches entre deux clubs suivis (+ les matchs des clubs « vedettes »), espacées dans le temps. */
export function footballPicks(feeds, { now = Date.now(), count = PICKS, minGapDays = 4 } = {}) {
  const names = feeds.map((f) => f.teamName).filter(Boolean);
  const has = (title, n) => new RegExp(`(^|\\s)${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'i').test(title);
  const seen = new Set(), cands = [];
  for (const f of feeds) for (const e of f.events) {
    if (startMs(e) <= now) continue;
    const k = `${e.title}|${e.start}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const n = names.filter((x) => has(e.title, x)).length;
    if (n >= 2 || f.star) cands.push(e);
  }
  cands.sort((a, b) => startMs(a) - startMs(b));
  const out = [];
  for (const e of cands) {
    if (out.length && startMs(e) - startMs(out[out.length - 1]) < minGapDays * DAY) continue;
    out.push(e);
    if (out.length >= count) break;
  }
  return out;
}
