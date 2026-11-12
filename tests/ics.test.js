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
