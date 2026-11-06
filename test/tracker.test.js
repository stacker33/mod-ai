// Israeli tracker: season averages over the games he played, the last 5 TEAM games with "didn't play",
// the minutes trend counting missed games as 0, the next game, and only milestones that are close.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackPlayer, milestonesOf } from '../src/tracker.js';

const p = { id: '1', name: 'Test Player', he: 'שחקן בדיקה', team: 'POR', track: 'full' };
const ev = (id, day, state, won, home = true) => ({ id, date: `2026-11-0${day}T02:00Z`, state, teams: [{ abbr: 'POR', home, winner: won, score: state === 'post' ? (won ? 110 : 90) : NaN }, { abbr: 'LAL', home: !home, winner: !won, score: state === 'post' ? 100 : NaN }] });
const schedule = { season: 2027, events: [ev('a', 1, 'post', true), ev('b', 2, 'post', false, false), ev('c', 3, 'post', true), ev('d', 4, 'post', true), ev('e', 5, 'post', false), ev('f', 6, 'post', true), ev('g', 8, 'pre', false, false)] };
const row = (eventId, min, pts, season = '2026-27') => ({ eventId, season, type: 'regular', date: '2026-11-01T02:00Z', opp: 'LAL', min, pts, reb: 5, ast: 3, fg: [8, 16], tp: [2, 5], ft: [2, 2] });
// played a, b, c, e, f; missed d; plus last season's games for the career totals (4,990 points)
const rows = [...Array.from({ length: 98 }, (_, i) => row(`old${i}`, 30, i < 97 ? 50 : 70, '2025-26')), row('a', 30, 20), row('b', 32, 30), row('c', 34, 10), row('e', 20, 15), row('f', 18, 25)];

test('tracker card: averages over games played, a missed game shows in the last 5 and counts as 0 minutes', () => {
  const t = trackPlayer(p, rows, schedule, new Date('2026-11-07T00:00Z'));
  assert.equal(t.season, '2026-27');
  assert.equal(t.avg.gp, 5);
  assert.equal(t.avg.teamGp, 6);
  assert.equal(t.avg.pts, 20);
  assert.equal(t.last5.length, 5);
  assert.equal(t.last5[0].eventId, 'f'); // newest first
  assert.equal(t.last5.find((g) => g.eventId === 'd').played, false);
  assert.equal(t.last5.find((g) => g.eventId === 'b').score_he, '100:90'); // Sport5 order: his team's score last (lost 90-100)
  assert.deepEqual(t.minutes, [30, 32, 34, 0, 20, 18]);
  assert.equal(t.trend.last5, 20.8); // the missed game pulls the last 5 down
  assert.equal(t.trend.dir, 'flat'); // 20.8 vs 22.3 for the season: under 3 minutes apart
});

test('tracker: the next game, the season high, and a milestone only when it is close', () => {
  const t = trackPlayer(p, rows, schedule, new Date('2026-11-07T00:00Z'));
  assert.equal(t.next.eventId, 'g');
  assert.equal(t.next.home, false);
  assert.equal(t.seasonHigh.pts, 30);
  // career: 97*50 + 70 + 100 = 5,020 regular-season points -> 6,000 is far; 103 games -> 200 is far
  assert.equal(t.career.pts, 5020);
  assert.deepEqual(t.milestones, []);
  // 4,980 points at 20 a game -> 20 to 5,000, within reach next game
  const m = milestonesOf({ pts: 4980, reb: 100, ast: 100, tpm: 10, gp: 198 }, { pts: 20, reb: 5, ast: 3, tpm: 2 });
  assert.equal(m[0].stat, 'pts');
  assert.match(m[0].text_he, /^20 נקודות עד 5,000 נקודות בקריירה$/);
  assert.ok(m.some((x) => x.stat === 'gp' && x.target === 200));
  assert.ok(!m.some((x) => x.stat === 'reb')); // 150 rebounds away at 5 a game: not close
});
