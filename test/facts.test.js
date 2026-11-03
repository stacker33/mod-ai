import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFacts, clockSec } from '../src/facts.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const load = (id) => JSON.parse(readFileSync(join(DIR, `${id}.json`), 'utf8'));

test('clock parsing', () => {
  assert.equal(clockSec('11:36'), 696);
  assert.equal(clockSec('1.8'), 1.8);
  assert.equal(clockSec('0.0'), 0);
});

test('every fixture passes its own consistency checks', () => {
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
    const f = buildFacts(JSON.parse(readFileSync(join(DIR, file), 'utf8')));
    assert.ok(f.ok, `${file}: ${JSON.stringify(f.checks.filter((c) => c.severity !== 'ok'))}`);
    assert.ok(f.checks.every((c) => c.severity === 'ok' || c.severity === 'info'), `${file} has warnings`);
  }
});

test('TOR @ LAL 2026-11-01: known facts', () => {
  const f = buildFacts(load('401909906'));
  assert.equal(f.teams.home.abbr, 'LAL');
  assert.equal(f.teams.home.score, 131);
  assert.equal(f.teams.away.score, 125);
  assert.deepEqual(f.teams.away.periods, [23, 31, 28, 43]);
  assert.equal(f.result.winner, 'home');
  assert.equal(f.result.margin, 6);
  assert.equal(f.flow.largestLead.home.pts, 26);
  const luka = f.players.home.find((p) => p.name === 'Luka Doncic');
  assert.equal(luka.pts, 45);
  assert.equal(luka.reb, 15);
  assert.deepEqual(luka.ft, [13, 13]);
  assert.ok(luka.flags.includes('40+ points'));
  assert.equal(f.candidates[0].type, 'BIG_SCORING');
  assert.ok(!f.clutch.winningBasket.late, 'Lakers led from the first quarter — no game-winner');
  assert.ok(f.research.some((r) => r.includes('Luka Doncic')));
});

test('first-quarter deficit is not a comeback story', () => {
  const f = buildFacts(load('401909905')); // GS trailed by 11 in Q1, won by 12
  assert.equal(f.flow.largestLead.away.pts, 11);
  assert.ok(!f.candidates.some((c) => c.type === 'COMEBACK'));
});

test('a game that is not final is marked not ok', () => {
  const s = load('401909906');
  s.header.competitions[0].status.type = { state: 'in', completed: false, detail: '4th 2:00' };
  const f = buildFacts(s);
  assert.equal(f.ok, false);
});

test('a box score that does not add up is marked not ok', () => {
  const s = load('401909906');
  s.header.competitions[0].competitors.find((c) => c.homeAway === 'home').score = '133';
  assert.equal(buildFacts(s).ok, false);
});

test('Israeli players are picked up from the box score', () => {
  const f = buildFacts(load('401909906'), { israelis: [{ name: 'Luka Doncic', track: 'full' }] }); // stand-in name to exercise the path
  assert.equal(f.israelis.length, 1);
  assert.equal(f.candidates[0].type, 'ISRAELI_ANGLE');
});

test('MIN @ CLE 2026-10-26 (OT): corrupt ESPN per-play scores do not change the story', () => {
  // ESPN's play feed ends 125-124 with a fake Edwards buzzer-beater; the box score says CLE won 127-125.
  const f = buildFacts(load('401909869'));
  assert.ok(f.ok);
  assert.ok(f.flow.quality.reportedMismatches > 0, 'fixture should still contain the corrupt feed');
  assert.deepEqual(f.flow.finalScore, { home: 127, away: 125 });
  assert.equal(f.result.winner, 'home');
  assert.equal(f.clutch.overtimes, 1);
  assert.equal(f.clutch.tyingShotToOT.player, 'James Harden');
  assert.equal(f.clutch.winningBasket.player, 'Donovan Mitchell');
  assert.equal(f.clutch.winningBasket.periodName, 'OT1');
  assert.ok(!f.candidates.some((c) => c.type === 'BUZZER_BEATER' || c.type === 'GAME_WINNER'));
});

// ---------- Israeli player track ----------
import { analyzeGame } from '../src/game.js';
import { parseGamelog } from '../src/gamelog.js';

const AUX = join(DIR, 'extra');
const avdija = { id: '4683021', name: 'Deni Avdija', he: 'דני אבדיה', team: 'POR', track: 'full' };
const avdijaHistory = () => readdirSync(join(AUX, 'gamelog')).filter((f) => f.startsWith('4683021-'))
  .flatMap((f) => parseGamelog(JSON.parse(readFileSync(join(AUX, 'gamelog', f), 'utf8'))))
  .filter((r, i, a) => a.findIndex((x) => x.eventId === r.eventId && x.type === r.type) === i);

test('Avdija @ LAL 2026-10-27: his track matches what Sport5 reported', () => {
  const f = analyzeGame(load('401909880'), {
    israelis: [avdija],
    histories: new Map([[avdija.id, avdijaHistory()]]),
    schedules: new Map([['POR', JSON.parse(readFileSync(join(AUX, 'schedule-POR.json'), 'utf8'))]]),
  });
  const t = f.tracks[0];
  assert.ok(t.ok && t.pbpOk, JSON.stringify(t.pbpCheck));
  assert.equal(t.line.pts, 23);
  assert.equal(t.line.ast, 9);
  assert.deepEqual(t.line.fg, [8, 15]);
  // "Reaves drew his fourth foul before halftime"
  assert.deepEqual(t.fouls.fourth, { periodName: 'Q2', clock: '2:16', beforeHalf: true });
  // "43.1 seconds left, Deni drew the defense and kicked out to Lillard, who made it 135:129"
  const kick = t.clutch.find((c) => c.clock === '43.1');
  assert.equal(kick.kind, 'assist');
  assert.equal(kick.partner, 'Damian Lillard');
  assert.deepEqual(kick.score, { home: 129, away: 135 });
  // history only sees games played before this one
  assert.equal(t.history.gamesBeforeThisSeason, 2);
  assert.equal(t.history.previousGame.opp, 'SAC');
  assert.equal(t.history.records.pts.careerHigh.value, 43);
  // "the next opponent is Memphis, between Thursday and Friday"
  assert.equal(t.team.context.next.opp, 'MEM');
  assert.equal(t.team.context.next.israel.time, '04:00');
  assert.equal(t.team.context.next.israel.weekday, 'שישי');
  assert.deepEqual(t.team.context.streak, { kind: 'W', length: 3 });
  // color layer: Morant's late flopping technical
  assert.ok(f.color.events.some((e) => e.kind === 'flopping technical' && e.player === 'Ja Morant' && e.clutch));
});

test('an Israeli whose team did not play gets no track; one not in the box score is flagged', () => {
  const f = analyzeGame(load('401909906'), { israelis: [avdija, { id: 'x', name: 'Nobody', team: 'LAL', track: 'short' }] });
  assert.equal(f.tracks.length, 1);
  assert.equal(f.tracks[0].inBoxScore, false);
});
