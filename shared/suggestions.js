import { startMs } from './ics.js';

// Calendriers gratuits vérifiés (recherche du 12/11/2026). La synchro en lit les prochains événements
// (remote.suggestions) pour que l'app propose des événements précis, et pas seulement des catalogues.

export const SUGGESTIONS = [
  { group: 'Football', cat: 'sport', items: [
    { name: 'OM', url: 'https://matchcalendar.football/team/marseille/marseille.ics', site: 'https://matchcalendar.football/team/marseille/' },
    { name: 'Ligue des champions', url: 'https://matchcalendar.football/competition/champions-league/champions-league.ics', site: 'https://matchcalendar.football/competition/champions-league/' },
    { name: 'Équipe de France', url: 'https://matchcalendar.football/team/france/france.ics', site: 'https://matchcalendar.football/team/france/' },
    { name: 'Real Madrid', url: 'https://matchcalendar.football/team/real-madrid/real-madrid.ics', site: 'https://matchcalendar.football/team/real-madrid/' },
  ] },
  { group: 'Séries', cat: 'serie', items: [
    { name: 'Netflix', url: 'https://www.smartcalendars.ai/cal/4fc097ff8c48803f38c6272953b5c349e4669652cc4686e154ecc61a7b7d968f.ics', site: 'https://www.smartcalendars.ai/' },
    { name: 'Prime Video', url: 'https://www.smartcalendars.ai/cal/a1d170b8827c245b4bf4391c83e3551a797f91537c3d9a0f291efbd6bdde4d29.ics', site: 'https://www.smartcalendars.ai/' },
    { name: 'Disney+', url: 'https://www.smartcalendars.ai/cal/53757181785a61d01d52b99de46f6e975311dd558adf00e3828a01756c08a1b5.ics', site: 'https://www.smartcalendars.ai/' },
    { name: 'Apple TV+', url: 'https://www.smartcalendars.ai/cal/e93ddfee3629f75f5eec91218b5b42027335911a7d42b820b8d5c82ad1081bdf.ics', site: 'https://www.smartcalendars.ai/' },
  ] },
  { group: 'Films', cat: 'film', items: [
    { name: 'Films les plus attendus', url: 'https://www.smartcalendars.ai/cal/1d98bae7fac4944084f941ee1e715ec74b994c71e7c596ec01b38b61d37a9067.ics', site: 'https://www.smartcalendars.ai/' },
  ] },
];

export const SUGGESTIONS_REFRESH_MS = 6 * 3600e3;
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
