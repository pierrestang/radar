// Radar — sorties musicales des artistes suivis, via l'API iTunes Search d'Apple (gratuite, sans clé).
// Aucun calendrier des sorties rap n'existe ; l'API connaît les albums, EP et singles, précommandes comprises.
import { WINDOW_PAST_DAYS } from './ics.js';

export const MUSIC_SOURCE_ID = 'itunes';
const API = 'https://itunes.apple.com';

/** Recherche d'artistes (pour l'ajout dans l'app). */
export async function searchArtists(fetchFn, term) {
  const r = await fetchFn(`${API}/search?term=${encodeURIComponent(term)}&entity=musicArtist&country=FR&limit=15`);
  if (!r.ok) throw new Error(`iTunes ${r.status}`);
  const j = await r.json();
  const list = (j.results || []).map((a) => ({ id: a.artistId, name: a.artistName, genre: a.primaryGenreName || '' }));
  // homonymes fréquents : le rap et le hip-hop d'abord (stable pour le reste)
  const rap = (a) => (/rap|hip/i.test(a.genre) ? 0 : 1);
  return list.map((a, i) => [a, i]).sort((x, y) => rap(x[0]) - rap(y[0]) || x[1] - y[1]).map(([a]) => a);
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
