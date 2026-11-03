import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gameBrief } from '../src/writer/brief.js';
import { verifyDraft } from '../src/writer/verify.js';
import { fullLineHe, recordHe, pair } from '../src/writer/he.js';
import { NICK_HE } from '../src/teams.js';

const AUX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'extra');
const facts = (id) => JSON.parse(readFileSync(join(AUX, `facts-${id}.json`), 'utf8'));
const ctx = (f) => {
  const alias = (t) => [t.he, t.heShort, ...(NICK_HE[t.abbr] || [])];
  return { teams: { home: alias(f.teams.home), away: alias(f.teams.away) }, players: [], winner: f.result.winner, loser: f.result.loser };
};
const errs = (id, text) => { const f = facts(id); return verifyDraft(text, gameBrief(f), [], ctx(f)).errors; };

test('Sport5 number formats', () => {
  assert.equal(pair(136, 129), '129:136'); // subject's score last
  assert.equal(recordHe('3-0'), '(0:3)'); // losses:wins
  assert.equal(fullLineHe({ pts: 23, fg: [8, 15], tp: [4, 7], ft: [3, 7], reb: 4, ast: 9, to: 3, stl: 1, blk: 0, plusMinus: 8, min: 33 }),
    '23 נקודות (8 מ-15 מהשדה, 4 מ-7 משלוש, 3 מ-7 מהעונשין), 4 ריבאונדים, 9 אסיסטים (3 איבודים), חטיפה ומדד פלוס מינוס 8+ ב-33 דקות');
});

test('score written from the wrong team is caught (real model mistake, BKN @ BOS)', () => {
  assert.equal(errs('401909877', 'ברוקלין כבר הובילה 124:119 כשנותרו פחות משתי דקות לסיום.').length, 1);
  assert.deepEqual(errs('401909877', 'ברוקלין כבר הובילה 119:124 כשנותרו פחות משתי דקות לסיום.'), []);
  assert.deepEqual(errs('401909877', 'בדרך לניצחון 124:125 של בוסטון על ברוקלין.'), []);
});

test('a verb that contradicts the score is caught (real model mistake, DET @ NY)', () => {
  assert.equal(errs('401909878', 'ניו יורק פיגרה במחצית 50:51.').length, 1); // NY led 51-50
  assert.deepEqual(errs('401909878', 'ניו יורק הובילה במחצית 50:51.'), []);
  assert.deepEqual(errs('401909878', 'דטרויט פיגרה במחצית 51:50.'), []);
});

test('invented numbers, unknown pairs and English names are caught', () => {
  const e = errs('401909877', 'טייטום קלע 44 נקודות ו-Tatum חגג 130:120.');
  assert.ok(e.some((x) => x.includes('44')));
  assert.ok(e.some((x) => x.includes('130:120')));
  assert.ok(e.some((x) => x.includes('Tatum')));
});

test('foreign letters slipped into Hebrew are caught (real flash-lite output)', () => {
  assert.ok(errs('401909877', 'ודאנקן רובינסון סπέל עם 12 נקודות.').some((x) => x.includes('אותיות זרות')));
});
