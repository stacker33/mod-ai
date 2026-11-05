// The morning comparison with the Sport5 editor's article. The "Sport5" text here is written for the test
// in Sport5's format (no Sport5 text is stored in the repo).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeGame } from '../src/game.js';
import { sport5Title, parseSport5, compareNight } from '../src/compare.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const dict = JSON.parse(readFileSync(join(DIR, '..', 'config', 'names.he.json'), 'utf8')).players;
const names = new Map(dict.map((p) => [p.id, p]));

const ARTICLE = `5.11 סגירה NBA
כל התוצאות:
יוסטון - מינסוטה 117:107
05.11.26 - 07:45
יוסטון (2:7) - מינסוטה (3:6) 117:107
מינסוטה ניצחה ביוסטון בלי אנתוני אדוורדס הפצוע. איו דוסומו קלע 21 נקודות ולאמלו בול הוסיף 20.
אלפרן שנגון רשם טריפל דאבל של 17 נקודות, 12 ריבאונדים ו-10 אסיסטים, אבל קלע 5 מ-15. יוסטון הפסידה 35:23 את הרבע המכריע.
צפו>>
05.11.26 - 07:40
כדורגל עולמי`;

test('Sport5 title of a US night, and its blocks', () => {
  assert.equal(sport5Title('20261104'), '5.11 סגירה NBA');
  assert.equal(sport5Title('20261130'), '1.12 סגירה NBA');
  const b = parseSport5(ARTICLE);
  assert.equal(b.length, 1);
  assert.equal(b[0].scorePair, '117:107');
  assert.ok(!b[0].text.includes('צפו>>') && !b[0].text.includes('כדורגל'));
});

test('comparison: what the editor used that we had, what we had and left out, what we never had', () => {
  const f = analyzeGame(JSON.parse(readFileSync(join(DIR, '401909930.json'), 'utf8')), { names }); // MIN @ HOU
  const ours = 'מינסוטה ניצחה ביוסטון. איו דוסומו קלע 21 נקודות ולאמלו בול הוסיף 20. קווין דוראנט קלע 21 בהפסד.';
  const r = compareNight(ARTICLE, [{ gameId: f.gameId, scorePair: '117:107', text: ours, facts: f }], dict);
  assert.equal(r.games, 1);
  const row = r.rows[0];
  // names: Dosunmu and Ball named by both; Sengun (and Edwards, if in the dictionary) only by the editor
  assert.ok(row.names.missed.includes('אלפרן שנגון'));
  assert.ok(row.names.covered >= 2);
  // numbers: 21 and 20 covered; Sengun's 17 / 12 / 10, 5 of 15 and 35:23 were all in our data -> a selection gap
  assert.ok(row.numbers.missedInOurData.includes('35:23'));
  assert.ok(row.numbers.missedInOurData.includes('17'));
  assert.ok(r.missedInOurData >= 5);
  assert.equal(row.angle.same, false); // the editor opened with the team, we did too; no player lead to compare
});
