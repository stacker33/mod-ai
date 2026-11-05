// Replay regression set #1: the night of 2026-11-04 (14 games), against what the Sport5 editor wrote the
// next morning. These tests pin the editorial facts the system must FIND (deterministic, no model):
// the details the editor used and our data has, the story picks, and that the plain template recap (used
// when the model quota is out) is clean. Fixtures are ESPN JSON stripped of ESPN's own article text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeGame } from '../src/game.js';
import { gameBrief, playerBrief } from '../src/writer/brief.js';
import { verifyDraft } from '../src/writer/verify.js';
import { templateDraft } from '../src/pipeline.js';
import { NICK_HE } from '../src/teams.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const names = new Map(json(join(DIR, '..', 'config', 'names.he.json')).players.map((p) => [p.id, p]));
const game = (id, opts = {}) => analyzeGame(json(join(DIR, `${id}.json`)), { names, ...opts });
const ctx = (f) => {
  const alias = (t) => [t.he, t.heShort, ...(NICK_HE[t.abbr] || [])].filter(Boolean);
  return { teams: { home: alias(f.teams.home), away: alias(f.teams.away) }, players: [], winner: f.result.winner, loser: f.result.loser };
};

test('DAL @ SA: the editor\'s details are found — Kyrie\'s missed winner, Wemby\'s 29 at the half, decided at the line', () => {
  const f = game('401909933');
  const b = gameBrief(f);
  assert.ok(b.details.some((d) => /קיירי אירווינג החטיא .* להכריע את המשחק/.test(d)), b.details.join(' | '));
  assert.ok(b.details.some((d) => /וומבניאמה קלע 29 נקודות כבר במחצית הראשונה/.test(d)));
  assert.ok(b.final_minutes.winning_basket.free_throws); // "קלע את הנקודה המכריעה מקו העונשין"
  assert.ok(b.heading.includes('סן אנטוניו (2:6)')); // Sport5: "סן אנטוניו (2:6) - דאלאס (4:4) 111:112"
});

test('MIN @ HOU: Houston lost the last quarter 35:23 (exactly Sport5\'s string); Sengun\'s triple-double was on 5 of 15', () => {
  const f = game('401909930');
  const b = gameBrief(f);
  assert.ok(b.details.some((d) => d.includes('הפסידה 35:23 את הרבע האחרון')), b.details.join(' | '));
  assert.ok(b.details.some((d) => d.includes('קלע רק 5 מ-15 מהשדה')));
  // the loser's triple-double on 33% shooting is no longer the story of the game
  assert.notEqual(f.story.main.type, 'TRIPLE_DOUBLE');
  // Kuminga's flagrant (2nd quarter) is relevant color now, not only in the clutch
  assert.ok(b.color.some((c) => /פלגרנטית/.test(c.what_he) && c.players_he.some((p) => /קומינגה/.test(p))));
});

test('MIA @ LAC: overtime in the score line; the missed winners at the end of regulation / OT are found', () => {
  const f = game('401909935');
  const b = gameBrief(f);
  assert.ok(b.heading.endsWith('117:116 בהארכה'));
  assert.ok(b.details.some((d) => /החטיא .* (בסיום הזמן החוקי|בסיום ההארכה)/.test(d)), b.details.join(' | '));
});

test('LAL @ SAC: Doncic, not Sharp\'s 3 points, is the story; Sharp still gets his own article', () => {
  const sharp = { id: '5106058', name: 'Emanuel Sharp', he: 'עמנואל שארפ', team: 'SAC', track: 'full' };
  const f = game('401909934', { israelis: [sharp] });
  assert.notEqual(f.story.main.type, 'ISRAELI_ANGLE');
  assert.ok(f.tracks.some((t) => t.played));
  const pb = playerBrief(f, f.tracks[0]);
  assert.ok(!/1 ריבאונדים|\(0 איבודים\)/.test(pb.line_full_he), pb.line_full_he); // number agreement
});

test('the plain template recap (no model left) passes every check on every game of the night', () => {
  for (const id of ['401909930', '401909933', '401909934', '401909935']) {
    const f = game(id);
    const b = gameBrief(f);
    const d = templateDraft('game', b);
    const r = verifyDraft(d, b, [], ctx(f));
    assert.equal(r.blocking, 0, `${id}: ${r.errors.join(' | ')}`);
    assert.ok(d.paragraphs[0].startsWith(b.main_angle.fact_he), id);
  }
});
