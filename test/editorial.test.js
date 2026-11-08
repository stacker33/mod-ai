// Editorial regression set: the night of 2026-11-07 (ESPN data saved with each game). The cases come from an
// editor's review of what the bot wrote; they are editorial expectations, checked against the data here —
// not facts taken from the review. Angle selection is tested separately from factual accuracy.

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
const avdija = { id: '4683021', name: 'Deni Avdija', he: 'דני אבדיה', team: 'POR', track: 'full' };
const wolf = { id: '5107173', name: 'Danny Wolf', he: 'דני וולף', team: 'BKN', track: 'short' };
const game = (id, israelis = []) => analyzeGame(json(join(DIR, `${id}.json`)), { names, israelis, context: json(join(DIR, 'extra', `ctx-${id}.json`)) });
const ALL = ['401909938', '401909939', '401909940', '401909941', '401909942', '401909943', '401909944'];

test('1. ORL @ GS: overtime and Curry\'s 41 lead, not the 7-game streak; no "missed" shot the team recovered from', () => {
  const f = game('401909942');
  assert.equal(f.story.main.type, 'BIG_SCORING');
  const st = gameBrief(f).story;
  assert.equal(st.theme, 'DRAMA');
  assert.equal(st.protagonist.name_he, 'סטף קרי');
  // Carter missed twice, Orlando rebounded and Cain tied it: not a missed chance
  assert.ok(!f.notable.some((m) => m.type === 'MISSED_WINNER' && m.side === 'away'));
});

test('2. NY @ CLE: the Knicks\' run, not Towns\' season high of 29 (previous 27)', () => {
  const f = game('401909940');
  assert.notEqual(f.story.main.type, 'SEASON_HIGH');
  assert.ok(['H2H_STREAK', 'WIN_STREAK'].includes(f.story.main.type), f.story.main.type);
  assert.equal(gameBrief(f).story.protagonist.name_he, "ג'יילן ברונסון");
});

test('3. DEN vs IND: Mexico City and Jokic, never Nembhard\'s 9 points below his average', () => {
  const f = game('401909938');
  assert.equal(f.story.main.type, 'SPECIAL_VENUE');
  const st = gameBrief(f).story;
  assert.equal(st.angle_he, 'דנבר ניצחה את אינדיאנה במשחק שנערך במקסיקו סיטי');
  assert.equal(st.protagonist.name_he, "ניקולה יוקיץ'");
  // a below-average night is a supporting detail, never the main angle
  assert.ok(f.story.ranked.filter((c) => c.type === 'STAR_HELD').every((c) => c.support));
});

test('4. HOU @ PHX: Booker\'s closing sequence and Durant against his former team, not "decided by 3"', () => {
  const f = game('401909943');
  assert.notEqual(f.story.main.type, 'CLOSE_FINISH');
  const st = gameBrief(f).story;
  assert.equal(st.theme, 'DRAMA');
  assert.ok(st.protagonist.what_made_it_he.includes('דווין בוקר קלע 9 מתוך 10 הנקודות האחרונות של פיניקס'));
  assert.ok(st.turn_he.some((x) => /קווין דוראנט החטיא שלשה שהייתה יכולה לשלוח להארכה/.test(x)));
  assert.ok(st.color_he.some((x) => /קווין דוראנט, ששיחק 3 עונות בפיניקס/.test(x)));
});

test('5. WSH @ OKC: a 39-point rout leads, with SGA and when it was decided', () => {
  const f = game('401909941');
  assert.equal(f.story.main.type, 'BLOWOUT');
  const st = gameBrief(f).story;
  assert.equal(st.theme, 'DOMINANCE');
  assert.equal(st.protagonist.name_he, "שיי גילג'ס-אלכסנדר");
  assert.ok(st.turn_he.length >= 1); // the separation (half-time gap / the cold night that let it happen)
});

test('7. BKN @ ATL: Atlanta\'s comeback from 17, with the man of the last quarter as its hero', () => {
  const f = game('401909939', [wolf]);
  assert.equal(f.story.main.type, 'COMEBACK');
  assert.equal(gameBrief(f).story.protagonist.name_he, "ג'יילן ג'ונסון");
});

test('every game of the night: a story-type main angle, and a clean template recap', () => {
  for (const id of ALL) {
    const f = game(id);
    assert.ok(!f.story.main.support || f.story.main.type === 'TOP_PERFORMER', `${id}: ${f.story.main.type}`);
    const b = gameBrief(f);
    assert.equal(verifyDraft(templateDraft('game', b), b, [], null).blocking, 0, id);
  }
  void avdija;
});
