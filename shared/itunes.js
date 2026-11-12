// Radar — sorties musicales des artistes suivis, via l'API iTunes Search d'Apple (gratuite, sans clé).
// Aucun calendrier des sorties rap n'existe ; l'API connaît les albums, EP et singles, précommandes comprises.
import { WINDOW_PAST_DAYS } from './ics.js';

export const MUSIC_SOURCE_ID = 'itunes';
const API = 'https://itunes.apple.com';

/** Recherche d'artistes (pour l'ajout dans l'app), avec de quoi distinguer les homonymes :
 *  pochette et titre de la dernière sortie, nombre de sorties. Rap d'abord, puis les plus prolifiques. */
export async function searchArtists(fetchFn, term) {
  const r = await fetchFn(`${API}/search?term=${encodeURIComponent(term)}&entity=musicArtist&country=FR&limit=15`);
  if (!r.ok) throw new Error(`iTunes ${r.status}`);
  const list = ((await r.json()).results || []).map((a) => ({ id: a.artistId, name: a.artistName, genre: a.primaryGenreName || '', count: 0, latest: null }));
  if (list.length) {
    try {
      const l = await fetchFn(`${API}/lookup?id=${list.map((a) => a.id).join(',')}&entity=album&country=FR&limit=200`);
      const by = new Map(list.map((a) => [a.id, a]));
      for (const c of (l.ok ? (await l.json()).results : []) || []) {
        const a = c.wrapperType === 'collection' && by.get(c.artistId);
        if (!a) continue;
        a.count++;
        if (!a.latest || (c.releaseDate || '') > a.latest.date) {
          a.latest = { name: cleanName(c.collectionName || ''), date: c.releaseDate || '', art: (c.artworkUrl100 || '').replace('100x100bb', '120x120bb') };
        }
      }
    } catch { /* sans détails : la liste reste utilisable */ }
  }
  const rap = (a) => (/rap|hip/i.test(a.genre) ? 0 : 1);
  return list.sort((x, y) => rap(x) - rap(y) || y.count - x.count);
}

const kindOf = (name) => (/\s-\s*Single$/i.test(name) ? 'single' : /\s-\s*EP$/i.test(name) ? 'EP' : 'album');
const cleanName = (name) => name.replace(/\s-\s*(Single|EP)$/i, '').trim();

/** Sorties d'un artiste dans la fenêtre de Radar, au format des événements de Radar (journée entière, date de France). */
export async function artistReleases(fetchFn, artist, { now = Date.now() } = {}) {
  const r = await fetchFn(`${API}/lookup?id=${artist.id}&entity=album&country=FR&limit=200`);
  if (!r.ok) throw new Error(`iTunes ${r.status}`);
  const j = await r.json();
  const from = now - WINDOW_PAST_DAYS * 864e5;
  const seen = new Set();
  const out = [];
  for (const c of j.results || []) {
    if (c.wrapperType !== 'collection' || !c.releaseDate) continue;
    const ms = Date.parse(c.releaseDate);
    if (!(ms >= from)) continue;
    // date de sortie en France (Apple publie minuit heure locale, exprimé en UTC)
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
    const name = cleanName(c.collectionName);
    const key = `${name.toLowerCase()}|${day}`;
    if (seen.has(key)) continue; // versions explicite / clean
    seen.add(key);
    const kind = kindOf(c.collectionName);
    const next = new Date(Date.parse(day + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
    out.push({
      uid: `itunes-${c.collectionId}`,
      artistId: artist.id,
      title: `${c.artistName} — ${name}${kind === 'album' ? '' : ` (${kind})`}`,
      start: day, end: next, allDay: true,
      notes: [kind === 'album' ? 'Album' : kind === 'EP' ? 'EP' : 'Single', c.trackCount ? `${c.trackCount} titre${c.trackCount > 1 ? 's' : ''}` : null, ms > now ? 'Précommande' : null].filter(Boolean).join(' · '),
      url: c.collectionViewUrl,
      platform: 'Apple Music',
    });
  }
  return out;
}

/** Toutes les sorties des artistes suivis (config.artists), triées. */
export async function musicReleases(fetchFn, artists, opts) {
  const all = [];
  const errors = [];
  for (const a of artists || []) {
    try { all.push(...(await artistReleases(fetchFn, a, opts))); } catch (e) { errors.push(`${a.name} : ${e.message}`); }
  }
  all.sort((x, y) => x.start.localeCompare(y.start));
  return { events: all, error: errors.length ? errors.join(' ; ') : null };
}
