// AP's recap as background: parsing, how long a game waits for it, and what it may (not) verify.
// The recap texts here are short synthetic stand-ins — no AP text is stored in the repo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apRecap, recapDeadline, sameHero, RECAP_FULL } from '../src/recap.js';
import { analyzeGame } from '../src/game.js';
import { gameBrief } from '../src/writer/brief.js';
import { verifyDraft } from '../src/writer/verify.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const names = new Map(json(join(DIR, '..', 'config', 'names.he.json')).players.map((p) => [p.id, p]));
const IL = (iso) => Date.parse(iso); // ISO with +02:00 = Israel winter time

const FAKE = 'ATLANTA (AP) — Jalen Johnson had 30 points in his return after missing 87 games, and the Hawks won for the third straight time. '.repeat(4);

test('apRecap: only a Recap with a body; HTML and entities stripped', () => {
  assert.equal(apRecap({ article: { type: 'Preview', story: FAKE } }), null);
  assert.equal(apRecap({}), null);
  const r = apRecap({ article: { type: 'Recap', source: 'AP', headline: 'Johnson scores 30 in his return', story: `<p>${FAKE}</p><p>&ldquo;We needed this,&rdquo; he said.</p>` } });
  assert.equal(r.source, 'AP');
  assert.ok(!/<p>|&ldquo;/.test(r.text));
  assert.ok(r.text.includes('"We needed this," he said.'));
  assert.ok(r.chars < RECAP_FULL); // a first take: worth waiting for the full one
});

test('recapDeadline: night games wait until 05:30 Israel time; later ones at most 30 minutes', () => {
  assert.equal(recapDeadline(IL('2026-11-10T03:40:00+02:00')), IL('2026-11-10T05:30:00+02:00'));
  assert.equal(recapDeadline(IL('2026-11-10T05:20:00+02:00')), IL('2026-11-10T05:50:00+02:00'));
  assert.equal(recapDeadline(IL('2026-11-10T06:40:00+02:00')), IL('2026-11-10T07:10:00+02:00'));
  assert.equal(recapDeadline(IL('2026-11-09T22:15:00+02:00')), IL('2026-11-09T22:45:00+02:00'));
});

test('sameHero: our protagonist vs. AP\'s headline', () => {
  assert.equal(sameHero({ headline: 'Stephen Curry scores 41 as Warriors win' }, 'Stephen Curry'), true);
  assert.equal(sameHero({ headline: 'Booker scores 24, Suns outlast Rockets' }, 'Kevin Durant'), false);
  assert.equal(sameHero({ headline: 'Trey Murphy III leads Pelicans' }, 'Trey Murphy III'), true);
  assert.equal(sameHero(null, 'X Y'), null);
});

test('verify: AP verifies context (a number, a streak) but never a stat line', () => {
  const f = analyzeGame(json(join(DIR, '401909939.json')), { names, context: json(join(DIR, 'extra', 'ctx-401909939.json')) });
  const plain = gameBrief(f);
  const withAp = { ...plain, ap_recap: { headline: 'x', text: FAKE } };
  const ctxSentence = { paragraphs: ["ג'יילן ג'ונסון חזר אחרי 87 משחקים שהחמיץ."] };
  const codes = (b, d) => verifyDraft(d, b, [], null).issues.filter((i) => i.severity === 'block').map((i) => i.code);
  assert.ok(codes(plain, ctxSentence).includes('number')); // without AP: an unknown number
  assert.ok(!codes(withAp, ctxSentence).includes('number')); // AP says he missed 12 games
  const stat = { paragraphs: ["ג'יילן ג'ונסון קלע 87 נקודות."] };
  assert.ok(codes(withAp, stat).includes('number')); // a stat: box score only, even if AP has the number
  const streak = { paragraphs: ['אטלנטה רשמה ניצחון שלישי ברציפות.'] };
  if (!plain.verified.streak) {
    assert.ok(codes(plain, streak).includes('unverified-streak'));
    assert.ok(!codes(withAp, streak).includes('unverified-streak'));
  }
});

test('the brief carries AP\'s recap only when there is one', () => {
  const s = json(join(DIR, '401909939.json'));
  const f = analyzeGame(s, { names, context: json(join(DIR, 'extra', 'ctx-401909939.json')) });
  assert.equal(gameBrief(f).ap_recap, undefined);
  f.apRecap = apRecap({ article: { type: 'Recap', headline: 'H', story: FAKE } });
  assert.equal(gameBrief(f).ap_recap.headline, 'H');
});
