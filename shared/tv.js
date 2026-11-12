// Radar — chaînes de diffusion des matchs en France, d'après footao.tv (programme TV foot).
// Aucun calendrier ne donne le diffuseur : la synchro lit quelques pages de footao.tv toutes les 6 h,
// puis rattache chaque chaîne au match correspondant (même heure à ±20 min et au moins une équipe en commun).
import { wallToUtc } from './ics.js';
import { frTitle } from './translate.js';

export const TV_PAGES = [
  '',
  'ligue-1-programme-tv-chaine-match-diffusion',
  'ligue-des-champions-programme-tv-chaine-match-diffusion',
  'ligue-europa-programme-tv-chaine-match-diffusion',
  'programme-tv-equipe-de-france-chaine-match-diffusion',
  'om-programme-tv-chaine-match-diffusion-ce-soir',
  'psg-programme-tv-chaine-match-diffusion-ce-soir',
].map((p) => `https://www.footao.tv/${p}`);
export const TV_REFRESH_MS = 6 * 3600e3;

const unescape = (s) => s.replace(/&amp;/g, '&').replace(/&#0?39;|&apos;|&rsquo;|’/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');

/** Nom de chaîne lisible à partir du texte du logo (« match Ligue 1+ add. 5 foot programme soir » → « Ligue 1+ »). */
export function channelName(alt) {
  let c = unescape(alt).replace(/^match\s+/i, '').replace(/\s+foot programme soir$/i, '').trim();
  c = c.replace(/\s+add\.\s*\d+$/i, '').replace(/^(Canal\+) Live \d+$/i, '$1').replace(/^beIN SPORTS (MAX )?\d+$/i, 'beIN Sports');
  return c;
}

/** Extrait les matchs d'une page footao.tv : [{ start (ISO UTC), teams, channels }]. */
export function parseFootao(html) {
  const out = [];
  for (const block of html.split('itemtype="https://schema.org/SportsEvent">').slice(1)) {
    const b = block.slice(0, 1500);
    const d = b.match(/itemprop="startDate" content="(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/);
    const n = b.match(/itemprop="name">([^<]+)<\/span>/);
    if (!d || !n) continue;
    const head = b.split('itemprop="url"')[0];
    const channels = [...new Set([...head.matchAll(/<img [^>]*alt="([^"]+)"/g)].map((m) => channelName(m[1])).filter(Boolean))];
    if (!channels.length) continue;
    const [, y, mo, da, h, mi] = d.map(Number);
    out.push({ start: new Date(wallToUtc(y, mo, da, h, mi, 0, 'Europe/Paris')).toISOString(), teams: unescape(n[1]), channels });
  }
  return out;
}

const STOP = new Set(['fc', 'cf', 'sc', 'ac', 'as', 'rc', 'ol', 'om', 'osc', 'afc', 'ssc', 'us', 'vs', 'v', 'de', 'du', 'la', 'le', 'les', 'el', 'real', 'club', 'stade', 'sporting', 'olympique', 'united', 'city', 'football']);
function tokens(s) {
  return new Set(String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')
    .split(' ').filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t)));
}

/** Ajoute `tv` (chaîne(s) en France) aux matchs reconnus. `items` : résultat fusionné de parseFootao. */
export function annotateTv(events, items) {
  if (!items || !items.length) return 0;
  const prepared = items.map((it) => ({ ...it, ms: Date.parse(it.start), tok: tokens(it.teams) }));
  let n = 0;
  for (const ev of events) {
    if (ev.allDay) continue;
    const ms = Date.parse(ev.start);
    const tok = new Set([...tokens(ev.title), ...tokens(frTitle(ev.title))]);
    let best = null, bestScore = 0;
    for (const it of prepared) {
      if (Math.abs(it.ms - ms) > 20 * 6e4) continue;
      let score = 0;
      for (const t of it.tok) if (tok.has(t)) score++;
      if (score > bestScore) { best = it; bestScore = score; }
    }
    if (best) { ev.tv = best.channels.join(', '); n++; } else delete ev.tv;
  }
  return n;
}
