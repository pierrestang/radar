import { startMs } from './ics.js';

// Calendriers gratuits vérifiés (recherche du 12/11/2026). La synchro en lit les prochains événements
// (remote.suggestions) pour que l'app propose des événements précis, et pas seulement des catalogues.

const club = (name, slug, star = false) => ({ name, url: `https://matchcalendar.football/team/${slug}/${slug}.ics`, site: `https://matchcalendar.football/team/${slug}/`, star });

// picks : sélection calculée par la synchro (remote.suggestions.picks[clé]) ; items : calendriers complets à suivre.
export const SUGGESTIONS = [
  // Foot : affiches entre ces clubs (France, Italie, Allemagne, Espagne, Angleterre) + tous les matchs de l'Inter Miami.
  { group: 'Football', cat: 'sport', picks: 'football', label: 'Les grandes affiches', credit: 'matchcalendar.football', items: [
    club('PSG', 'paris-saint-germain'),
    club('OM', 'marseille'),
    club('Inter Milan', 'inter'),
    club('Juventus', 'juventus'),
    club('AC Milan', 'milan'),
    club('Bayern Munich', 'bayern-munchen'),
    club('Dortmund', 'borussia-dortmund'),
    club('Real Madrid', 'real-madrid'),
    club('Atlético Madrid', 'atletico-madrid'),
    club('FC Barcelone', 'barcelona'),
    club('Arsenal', 'arsenal'),
    club('Chelsea', 'chelsea'),
    club('Liverpool', 'liverpool'),
    club('Manchester City', 'manchester-city'),
    club('Inter Miami', 'inter-miami', true),
  ] },
  // Séries : premières de saison les plus attendues (TVmaze + vues Wikipédia), une entrée par saison.
  { group: 'Séries', cat: 'serie', picks: 'series', label: 'Les plus attendues', credit: 'TVmaze · Wikipédia', items: [] },
  // Films : grosses sorties classées par attente (vues Wikipédia), date française si connue (Wikidata).
  { group: 'Films', cat: 'film', picks: 'films', label: 'Les plus attendus', credit: 'Wikidata · Wikipédia', items: [
    { name: 'Grosses sorties cinéma', url: 'https://www.smartcalendars.ai/cal/1d98bae7fac4944084f941ee1e715ec74b994c71e7c596ec01b38b61d37a9067.ics', site: 'https://www.smartcalendars.ai/' },
  ] },
];

export const SUGGESTIONS_REFRESH_MS = 6 * 3600e3;
export const TRENDING_REFRESH_MS = 24 * 3600e3;
export const PREVIEW_COUNT = 15;

/** Prochains événements d'un flux suggéré, allégés pour remote.json. */
export function previewEvents(events, { now = Date.now(), count = PREVIEW_COUNT } = {}) {
  const today = new Date(now).toISOString().slice(0, 10);
  return events
    .filter((e) => (e.allDay ? (e.end || e.start) > today : Date.parse(e.end || e.start) > now))
    .sort((a, b) => startMs(a) - startMs(b))
    .slice(0, count)
    .map(({ uid, title, start, end, allDay, location, url, notes }) => ({ uid, title, start, end, allDay, location, url, notes: notes ? String(notes).slice(0, 400) : undefined }));
}
