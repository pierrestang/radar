import { test } from 'node:test';
import assert from 'node:assert/strict';
import ICAL from 'ical.js';
import { parseICS, buildICS, mergedEvents, normalizeUrl, wallToUtc } from '../shared/ics.js';

const NOW = Date.UTC(2026, 10, 12);
const cal = (body) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Test\r\n${body}\r\nEND:VCALENDAR\r\n`;

test('heure Europe/Paris sans VTIMEZONE', () => {
  const { events } = parseICS(cal('BEGIN:VEVENT\nUID:a\nDTSTART;TZID=Europe/Paris:20261120T210000\nSUMMARY:Match\nEND:VEVENT'), ICAL, { now: NOW });
  assert.equal(events[0].start, '2026-11-20T20:00:00.000Z');
});

test('VTIMEZONE fourni (New York, heure d’été)', () => {
  const vtz = `BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:DAYLIGHT
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
DTSTART:20070311T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
DTSTART:20071104T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE`;
  const { events } = parseICS(cal(`${vtz}\nBEGIN:VEVENT\nUID:b\nDTSTART;TZID=America/New_York:20270615T193000\nSUMMARY:NBA\nEND:VEVENT`), ICAL, { now: NOW });
  assert.equal(events[0].start, '2027-06-15T23:30:00.000Z');
});

test('récurrence + exception + annulation', () => {
  const { events } = parseICS(cal(`BEGIN:VEVENT
UID:r
DTSTART:20261201T170000Z
DTEND:20261201T180000Z
RRULE:FREQ=WEEKLY;COUNT=3
SUMMARY:Hebdo
END:VEVENT
BEGIN:VEVENT
UID:r
RECURRENCE-ID:20261208T170000Z
DTSTART:20261208T190000Z
DTEND:20261208T200000Z
SUMMARY:Hebdo décalé
END:VEVENT
BEGIN:VEVENT
UID:x
DTSTART:20261203T170000Z
STATUS:CANCELLED
SUMMARY:Annulé
END:VEVENT`), ICAL, { now: NOW });
  assert.deepEqual(events.map((e) => e.title), ['Hebdo', 'Hebdo décalé', 'Hebdo']);
  assert.equal(new Set(events.map((e) => e.uid)).size, 3);
});

test('journée entière, fenêtre temporelle', () => {
  const { events } = parseICS(cal('BEGIN:VEVENT\nUID:n\nDTSTART;VALUE=DATE:20261225\nSUMMARY:Noël\nEND:VEVENT\nBEGIN:VEVENT\nUID:old\nDTSTART;VALUE=DATE:20200101\nSUMMARY:Vieux\nEND:VEVENT'), ICAL, { now: NOW });
  assert.equal(events.length, 1);
  assert.deepEqual([events[0].allDay, events[0].start, events[0].end], [true, '2026-12-25', '2026-12-26']);
});

test('fusion : doublons retirés, sources masquées ignorées, .ics valide', () => {
  const cfg = {
    sources: [{ id: 's1', name: 'Foot', url: 'x' }, { id: 's2', name: 'Off', url: 'y', enabled: false }],
    manual: [{ id: 'm1', title: 'PSG – OM', start: '2026-11-20T20:00:00.000Z', end: '2026-11-20T22:00:00.000Z', allDay: false }],
  };
  const remote = { sources: {
    s1: { events: [{ uid: 'a', title: 'psg – om', start: '2026-11-20T20:00:00.000Z', end: '2026-11-20T22:00:00.000Z', allDay: false }, { uid: 'b', title: 'Lens – Lille', start: '2026-11-22T16:00:00.000Z', allDay: false }] },
    s2: { events: [{ uid: 'c', title: 'Caché', start: '2026-11-23T16:00:00.000Z', allDay: false }] },
  } };
  assert.equal(mergedEvents(cfg, remote).length, 2);
  const ics = buildICS(cfg, remote, { now: NOW });
  const back = parseICS(ics, ICAL, { now: NOW });
  assert.equal(back.calName, 'Radar');
  assert.equal(back.events.length, 2);
  assert.ok(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75));
});

test('liens webcal et heure murale', () => {
  assert.equal(normalizeUrl('webcal://sync2cal.com/x.ics'), 'https://sync2cal.com/x.ics');
  assert.equal(new Date(wallToUtc(2026, 3, 29, 2, 30, 0, 'Europe/Paris')).toISOString(), '2026-03-29T01:30:00.000Z');
});

import { frTitle, frNotes, frLocation, frenchify } from '../shared/translate.js';
test('traduction des matchs en français', () => {
  assert.equal(frTitle('Italy v France'), 'Italie VS France');
  assert.equal(frTitle('France v Türkiye'), 'France VS Turquie');
  assert.equal(frTitle('Austria 0-1 France (FT)'), 'Autriche 0-1 France (terminé)');
  assert.equal(frTitle('Stade Brestois 29 2-0 Marseille (FT)'), 'Stade Brestois 29 2-0 Marseille (terminé)');
  assert.equal(frTitle('Paris Saint Germain v Marseille'), 'Paris Saint-Germain VS Marseille');
  assert.equal(frTitle('Concert de Justice'), 'Concert de Justice');
  assert.equal(frenchify({ title: 'x', notes: 'UEFA Nations League - League A - 5\nReferee: Istvan Kovacs' }).notes, 'Ligue des nations · Ligue A · Journée 5');
  assert.equal(frenchify({ title: 'x', notes: 'Referee: Clement Turpin' }).notes, undefined);
  assert.equal(frNotes('UEFA Europa League - League Stage - 2\nHalf-time 0-1'), 'Ligue Europa · Phase de ligue · Journée 2\nMi-temps : 0-1');
  assert.equal(frNotes('Ligue 1 - Round 12'), 'Ligue 1 · Journée 12');
  assert.equal(frLocation('Decathlon Arena - Stade Pierre-Mauroy, Villeneuve d&apos;Ascq'), 'Decathlon Arena - Stade Pierre-Mauroy');
  assert.equal(frLocation('San Siro/Giuseppe Meazza, Milan'), 'San Siro/Giuseppe Meazza');
  assert.equal(frLocation('Wembley Stadium, London'), 'Wembley Stadium');
});

test('rubriques : défaut du calendrier, exception par événement, pas de source dans le .ics', () => {
  const cfg = {
    sources: [{ id: 's1', name: 'OM', url: 'x', category: 'sport' }],
    manual: [{ id: 'm1', title: 'Dune 3', start: '2026-12-16', end: '2026-12-17', allDay: true, category: 'film' }],
    eventCategories: { 'b@radar-s1': 'video' },
  };
  const remote = { sources: { s1: { events: [
    { uid: 'a', title: 'Marseille v Lens', start: '2026-11-22T19:45:00.000Z', allDay: false },
    { uid: 'b', title: 'Making-of', start: '2026-11-23T19:45:00.000Z', allDay: false },
  ] } } };
  const evs = mergedEvents(cfg, remote);
  assert.deepEqual(evs.map((e) => e.categoryName), ['Sport', 'Vidéo', 'Film']);
  const ics = buildICS(cfg, remote, { now: NOW });
  assert.ok(!ics.includes('via OM') && !ics.includes('CATEGORIES:OM'));
  assert.ok(ics.includes('CATEGORIES:Sport') && ics.includes('CATEGORIES:Film'));
});

import { parseFootao, annotateTv, channelName } from '../shared/tv.js';
import { artistReleases } from '../shared/itunes.js';
test('chaînes de diffusion (footao.tv) rattachées aux matchs', () => {
  const html = `<div itemtype="https://schema.org/SportsEvent"><time itemprop="startDate" content="2026-11-12T20:45"></time>
    <img src="x" alt="match TF1 foot programme soir"><span itemprop="name">Italie · France</span><a itemprop="url" href="#">x</a></div>
    <div itemtype="https://schema.org/SportsEvent"><time itemprop="startDate" content="2026-11-22T20:45"></time>
    <img src="x" alt="match Ligue 1+ add. 5 foot programme soir"><span itemprop="name">Marseille OM · Le Mans</span><a itemprop="url" href="#">x</a></div>`;
  const items = parseFootao(html);
  assert.deepEqual(items.map((i) => [i.start, i.channels[0]]), [['2026-11-12T19:45:00.000Z', 'TF1'], ['2026-11-22T19:45:00.000Z', 'Ligue 1+']]);
  const evs = [
    { title: 'Italy v France', start: '2026-11-12T19:45:00.000Z', allDay: false },
    { title: 'Marseille v Le Mans', start: '2026-11-22T19:45:00.000Z', allDay: false },
    { title: 'Lyon v Nice', start: '2026-11-22T19:45:00.000Z', allDay: false },
  ];
  assert.equal(annotateTv(evs, items), 2);
  assert.deepEqual(evs.map((e) => e.tv), ['TF1', 'Ligue 1+', undefined]);
  assert.equal(channelName('match beIN SPORTS MAX 4 foot programme soir'), 'beIN Sports');
});

test('plateforme des séries extraite de « Airs on … »', () => {
  const { events } = parseICS(cal('BEGIN:VEVENT\nUID:s\nDTSTART:20261120T080000Z\nSUMMARY:The Devil\'s Plan: S3E5\nDESCRIPTION:Episode 5\\n\\nAirs on Netflix\\n\\nPowered by TVmaze\nEND:VEVENT'), ICAL, { now: NOW });
  assert.equal(events[0].platform, 'Netflix');
  const merged = mergedEvents({ sources: [{ id: 's1', name: 'N', url: 'x' }] }, { sources: { s1: { events } } });
  assert.equal(merged[0].notes, 'Episode 5');
});

test('sorties musicales (iTunes) : dates de France, doublons retirés', async () => {
  const fake = async () => ({ ok: true, json: async () => ({ results: [
    { wrapperType: 'artist', artistName: 'SDM' },
    { wrapperType: 'collection', collectionId: 1, artistName: 'SDM', collectionName: 'IN INFINITUM', releaseDate: '2026-11-12T23:00:00Z', trackCount: 18, collectionViewUrl: 'https://music.apple.com/x' },
    { wrapperType: 'collection', collectionId: 2, artistName: 'SDM', collectionName: 'IN INFINITUM', releaseDate: '2026-11-12T23:00:00Z' },
    { wrapperType: 'collection', collectionId: 3, artistName: 'SDM', collectionName: 'Vieux son - Single', releaseDate: '2020-01-01T08:00:00Z' },
  ] }) });
  const evs = await artistReleases(fake, { id: 1, name: 'SDM' }, { now: NOW });
  assert.equal(evs.length, 1);
  assert.deepEqual([evs[0].title, evs[0].start, evs[0].end, evs[0].platform], ['SDM — IN INFINITUM', '2026-11-13', '2026-11-14', 'Apple Music']);
});
