// Replay regression set #3: what the Sport5 editor knew coming into 2026-11-06 that a box score does not
// show — the NBA Cup, a star missing, a star held down (and how rare it is for him), a former team from any
// part of a career, and a player's previous game. ESPN data saved with each game (fixtures/extra/ctx-*).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeGame } from '../src/game.js';
import { gameBrief } from '../src/writer/brief.js';
import { verifyDraft } from '../src/writer/verify.js';
import { templateDraft } from '../src/pipeline.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const names = new Map(json(join(DIR, '..', 'config', 'names.he.json')).players.map((p) => [p.id, p]));
const game = (id) => analyzeGame(json(join(DIR, `${id}.json`)), { names, context: json(join(DIR, 'extra', `ctx-${id}.json`)) });
const fact = (f, type) => f.contextFacts.filter((x) => x.type === type);

test('NBA Cup: both records in the score line, Sport5 order (season, then Cup)', () => {
  const b = gameBrief(game('401909289'));
  assert.ok(b.heading.startsWith('קליבלנד (4:5, 0:1) - פילדלפיה (2:8, 1:1)'), b.heading);
  assert.equal(b.cup_game, true);
  assert.equal(b.records['פילדלפיה'].cup_he, '(1:1 בגביע)');
  assert.ok(gameBrief(game('401909292')).heading.startsWith('מילווקי (8:1, 1:0) - טורונטו (4:5, 1:1)'));
});

test('PHI @ CLE: LeBron back in Cleveland in a 76ers jersey, held to 8 — his 10th single-digit game', () => {
  const f = game('401909289');
  assert.equal(f.story.main.type, 'RETURN_TO_FORMER_TEAM');
  assert.match(f.story.main.fact_he, /^לברון ג'יימס חזר לקליבלנד, הקבוצה שבה שיחק 11 עונות, לראשונה במדי פילדלפיה/);
  const held = fact(f, 'STAR_HELD').find((x) => /לברון/.test(x.fact_he));
  assert.match(held.fact_he, /נעצר על 8 נקודות \(3 מ-12 מהשדה\).*פעם עשירית בקריירה שלו בחד ספרתי/);
  // the hero's story carries it
  const st = gameBrief(f).story;
  assert.equal(st.protagonist.name_he, "לברון ג'יימס");
  assert.ok(st.protagonist.what_made_it_he.some((x) => /פעם עשירית/.test(x)));
  assert.ok(fact(f, 'STAR_HELD').some((x) => /ג'ואל אמביד נעצר על 6 נקודות \(0 מ-9 מהשדה\)/.test(x.fact_he)));
});

test('previous games: Wembanyama 48 hours after his 52 (a career high); SGA after two straight 40s', () => {
  assert.ok(fact(game('401909295'), 'RECENT_FORM').some((x) => x.fact_he === '48 שעות אחרי שויקטור וומבניאמה קלע 52 נקודות נגד דאלאס, שיא הקריירה שלו, הוא סיים הפעם עם 30'));
  assert.ok(fact(game('401909291'), 'RECENT_FORM').some((x) => /שיי גילג'ס-אלכסנדר הגיע אחרי שני משחקים רצופים עם 40 נקודות ומעלה, וסיים הפעם עם 28/.test(x.fact_he)));
});

test('TOR @ MIL: a star missing (injury report + his season average), and it goes into the story', () => {
  const f = game('401909292');
  const abs = fact(f, 'STAR_ABSENT');
  assert.equal(abs[0].fact_he, 'טורונטו שיחקה בלי קוואי לנארד (27.1 נקודות בממוצע העונה) וניצחה');
  assert.ok(gameBrief(f).story.color_he.includes(abs[0].fact_he));
});

test('every game of the set still writes a clean template recap', () => {
  for (const id of ['401909289', '401909291', '401909292', '401909295']) {
    const b = gameBrief(game(id));
    assert.equal(verifyDraft(templateDraft('game', b), b, [], null).blocking, 0, id);
  }
});

test('team shooting, rookies, a first road loss and the deficit erased reach the story', () => {
  const phi = gameBrief(game('401909289')).story;
  assert.ok(phi.turn_he.includes('פילדלפיה קלעה רק 10 מ-40 משלוש'));
  assert.ok(phi.color_he.includes('פילדלפיה ספגה הפסד חוץ ראשון העונה'));
  assert.ok(phi.color_he.some((x) => /^הרוקי מריו הזוניה/.test(x)));
  const tor = gameBrief(game('401909292')).story;
  assert.ok(tor.color_he.some((x) => /^הרוקי בריידן בריס רשם 21 נקודות, 11 ריבאונדים ו-6 אסיסטים/.test(x)));
  const lal = gameBrief(analyzeGame(json(join(DIR, '401909294.json')), { names, context: json(join(DIR, 'extra', 'ctx-401909294.json')) })).story;
  assert.equal(lal.turn_he[0], 'הלייקרס חזרו מפיגור 16');
  assert.ok(lal.color_he.includes('פורטלנד ספגה הפסד חוץ ראשון העונה'));
});
