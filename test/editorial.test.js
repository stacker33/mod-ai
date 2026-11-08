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

test('6. Avdija vs SA: top scorer is not a good game; last season\'s playoff series is verified context', async () => {
  const { playerBrief } = await import('../src/writer/brief.js');
  const f = game('401909944', [avdija]);
  const pb = playerBrief(f, f.tracks[0]);
  assert.equal(pb.performance.verdict, 'quiet_in_rout');
  assert.deepEqual(pb.performance.reasons_he, ['הקלע המוביל של קבוצתו', '5 מ-13 מהשדה', 'מדד פלוס מינוס 19-', '24 דקות בלבד במשחק שהוכרע מוקדם']);
  const rematch = f.contextFacts.find((x) => x.type === 'PLAYOFF_REMATCH');
  assert.equal(rematch.fact_he, 'זה היה המפגש הראשון בין הקבוצות מאז שסן אנטוניו הדיחה את פורטלנד בסיבוב הראשון של הפלייאוף בעונה שעברה (1:4 בסדרה)');
  assert.equal(pb.target_words, undefined); // set by the pipeline for the Israeli format (250-350)
});

test('review in code: records already in the score line are removed; a team named twice / a wrong length go back to the writer', async () => {
  const { tidy } = await import('../src/writer/verify.js');
  const b = gameBrief(game('401909942'));
  const d = tidy({ paragraphs: ['גולדן סטייט (3:7) ניצחה את אורלנדו (7:2) בהארכה.', 'x'] }, b);
  assert.equal(d.paragraphs[0], 'גולדן סטייט ניצחה את אורלנדו בהארכה.');
  const twice = { paragraphs: ['גולדן סטייט ניצחה בהארכה, וגולדן סטייט עלתה למאזן 3:7.', 'סטף קרי קלע 41 נקודות.'] };
  const codes = verifyDraft(twice, b, [], null).issues.map((i) => i.code);
  assert.ok(codes.includes('team-twice'));
  assert.ok(codes.includes('too-short'));
});

test('review in code: a comeback that is not the angle, and the separation in a rout, must be told', () => {
  const okc = gameBrief(game('401909941'));
  assert.ok(okc.must_tell.some((x) => x.fact_he === okc.story.turn_he[0]));
  const lal = gameBrief(analyzeGame(json(join(DIR, '401909294.json')), { names, context: json(join(DIR, 'extra', 'ctx-401909294.json')) }));
  assert.ok(lal.must_tell.some((x) => x.fact_he === 'הלייקרס חזרו מפיגור 16'));
});

test('records: both teams in the Israeli brief; a correct opponent record passes, a wrong one is corrected (not deleted)', async () => {
  const { playerBrief } = await import('../src/writer/brief.js');
  const { autoFix } = await import('../src/writer/verify.js');
  const f = game('401909944', [avdija]);
  const pb = playerBrief(f, f.tracks[0]);
  assert.equal(pb.records['סן אנטוניו'].after_verb, 'עלתה למאזן 2:8');
  assert.equal(pb.at_half_he, 'במחצית הוא עמד על 10 נקודות, 3 ריבאונדים ואסיסט אחד');
  const d = { headline: 'דני אבדיה בהפסד', subheadline: 'x', paragraphs: ['וומבניאמה בלט עם 29 נקודות, וסן אנטוניו עלתה למאזן 2:8.', 'פורטלנד (5:4) ירדה, ופורטלנד ירדה למאזן 6:3.'] };
  const r = verifyDraft(d, pb, [], null);
  assert.ok(!r.issues.some((i) => /record/.test(i.code) && /סן אנטוניו/.test(i.fix?.sentence || '')));
  const fixed = autoFix(d, r.issues, pb);
  assert.ok(fixed.paragraphs[0].includes('סן אנטוניו עלתה למאזן 2:8')); // kept
  assert.match(fixed.paragraphs[1], /פורטלנד \(3:6\) ירדה, ופורטלנד ירדה למאזן 3:6/); // corrected, not dropped
});

test('a fallback model gets the story skeleton; local AI tests are fenced to 08:00-10:00 Israel time', async () => {
  const src = readFileSync(join(DIR, '..', 'src', 'pipeline.js'), 'utf8');
  assert.match(src, /fallbackHint: skeletonHint\(mode, brief\)/);
  const { writeItem } = await import('../src/pipeline.js');
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  if (h < 8 || h >= 10) await assert.rejects(() => writeItem({ env: {}, dict: [], ai: {} }, 'game', {}, { players: { home: [], away: [] } }), /08:00-10:00/);
});
