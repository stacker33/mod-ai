// Round 2 regression tests (2026-11-03 batch): entity, narrative vs scoreboard, impossible basketball,
// runs from the play-by-play, broken Hebrew, record convention, story hierarchy with verified context,
// length. All on real games from that night (fixtures stripped of ESPN article text).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeGame } from '../src/game.js';
import { normPlays, validateRun } from '../src/facts.js';
import { gameBrief } from '../src/writer/brief.js';
import { verifyDraft, autoFix } from '../src/writer/verify.js';
import { formatRecord, recordForms } from '../src/writer/he.js';
import { NICK_HE } from '../src/teams.js';
import { h2hStreak, playerContext, buildContext } from '../src/context.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const EXTRA = join(DIR, 'extra');
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const dict = json(join(DIR, '..', 'config', 'names.he.json')).players;
const names = new Map(dict.map((p) => [p.id, p]));
const raw = (id) => json(join(DIR, `${id}.json`));
const sched = (t) => json(join(EXTRA, `schedule-${t}.json`));
const game = (id, opts = {}) => analyzeGame(raw(id), { names, ...opts });
const ctx = (f) => {
  const alias = (t) => [t.he, t.heShort, ...(NICK_HE[t.abbr] || [])].filter(Boolean);
  return { teams: { home: alias(f.teams.home), away: alias(f.teams.away) }, players: [], winner: f.result.winner, loser: f.result.loser };
};
const check = (f, draft, brief = gameBrief(f)) => verifyDraft(draft, brief, [], ctx(f));
const codes = (r) => r.issues.map((i) => i.code);
const one = (f, text) => check(f, { paragraphs: [text] });

// ---------- A. subject / entity ----------
test('A. a team record is never attached to a player as subject (ATL @ IND)', () => {
  const f = game('401909909');
  const bad = { headline: 'כ', deck: 'ד', paragraphs: ['ניקיל אלכסנדר-ווקר הצטיין עם 34 נקודות ועלתה למאזן 4:4.'] };
  const r = check(f, bad);
  assert.ok(codes(r).includes('entity'));
  const fixed = autoFix(bad, r.issues);
  assert.equal(fixed.paragraphs[0], 'ניקיל אלכסנדר-ווקר הצטיין עם 34 נקודות, ואטלנטה עלתה למאזן 4:4.');
  assert.ok(!codes(check(f, fixed)).includes('entity'));
  // already right: the team is the subject of its own clause
  assert.ok(!codes(one(f, 'ניקיל אלכסנדר-ווקר הצטיין עם 34 נקודות, ואטלנטה עלתה למאזן 4:4.')).includes('entity'));
  assert.ok(!codes(one(f, 'אטלנטה ניצחה עם 34 נקודות של ניקיל אלכסנדר-ווקר ועלתה למאזן 4:4.')).includes('entity'));
  // the brief hands the writer the sentence with the team as subject
  assert.equal(gameBrief(f).records['אטלנטה'].sentence_he, 'אטלנטה עלתה למאזן 4:4');
});

// ---------- B. narrative vs the halftime score ----------
test('B. "turned it around before halftime" is impossible when Denver led 66:58 at the break (POR @ DEN)', () => {
  const f = game('401909918');
  assert.deepEqual(f.result.halftime, { home: 66, away: 58 });
  for (const s of ['פורטלנד הפכה את התוצאה עוד לפני ההפסקה.', 'פורטלנד השלימה את המהפך לפני המחצית.']) {
    const r = one(f, s);
    assert.ok(codes(r).includes('narrative'), s);
  }
  // Portland was down 14 in the second quarter and 8 at the half: the conservative fix is "cut the deficit"
  const d = { headline: 'כ', paragraphs: ['פורטלנד הפכה את התוצאה עוד לפני ההפסקה.'] };
  assert.equal(autoFix(d, check(f, d).issues).paragraphs[0], 'פורטלנד צימקה את הפער עוד לפני ההפסקה.');
  // the true statements pass
  assert.ok(!codes(one(f, 'דנבר נכנסה להפסקה ביתרון.')).includes('narrative'));
  assert.ok(codes(one(f, 'פורטלנד נכנסה להפסקה ביתרון.')).includes('narrative'));
  // took the lead in the first half: Portland never led before the break?
  const ledH1 = f.flow.periodLead.filter((p) => p.period <= 2).some((p) => p.awayLed);
  assert.equal(codes(one(f, 'פורטלנד עברה ליתרון עוד לפני ההפסקה.')).includes('narrative'), !ledH1);
});

// ---------- C. impossible basketball terms ----------
test('C. semantic contradictions: mid-range three, free throw from deep, double-double that is not', () => {
  const f = game('401909918');
  assert.ok(codes(one(f, 'מארי קלע שלשה מחצי מרחק.')).includes('semantic'));
  assert.ok(codes(one(f, 'מארי קלע זריקת עונשין מחוץ לקשת.')).includes('semantic'));
  assert.ok(!codes(one(f, 'מארי קלע שלשה מהפינה.')).includes('semantic'));
  // Murray 35/5/6: not a double-double
  assert.ok(codes(one(f, "ג'מאל מארי רשם דאבל-דאבל.")).includes('semantic'));
  // a quarter "won" by the team that scored less in it
  const q = f.teams.home.periods.findIndex((h, i) => h < f.teams.away.periods[i]); // a quarter Denver lost
  const word = ['ראשון', 'שני', 'שלישי', 'רביעי'][q];
  assert.ok(codes(one(f, `דנבר ניצחה את הרבע ה${word}.`)).includes('semantic'));
  // buzzer baskets: Denver really scored at the buzzer to end the first quarter — and at no other time
  assert.deepEqual(gameBrief(f)._check.buzzer_periods, [1]);
  assert.ok(!codes(one(f, 'טרבון בראון קלע עם הבאזר בסיום הרבע הראשון.')).includes('semantic'));
  assert.ok(codes(one(f, 'טרבון בראון קלע עם הבאזר בסיום הרבע השלישי.')).includes('semantic'));
  // double-double: the player named next to the term — Clingan (17/18) did, Murray (35/5/6) did not
  assert.ok(!codes(one(f, "ג'מאל מארי קלע 35 נקודות, ודונובן קלינגן רשם דאבל-דאבל.")).includes('semantic'));
  assert.ok(!codes(one(f, "פורטלנד קיבלה 28 נקודות מאבדיה ודאבל-דאבל של 17 נקודות ו-18 ריבאונדים מדונובן קלינגן.")).includes('semantic'));
});

// ---------- D. game-tying ----------
test('D. a basket called tying must leave the score equal', () => {
  const f = game('401909918'); // Portland tied it 87:87 early in the fourth
  assert.ok(f.flow.moments.some((m) => m.after.home === 87 && m.after.away === 87));
  assert.ok(codes(one(f, 'פורטלנד השוותה ל-85:87.')).includes('semantic'));
  assert.ok(!codes(one(f, 'פורטלנד השוותה ל-87:87.')).includes('semantic'));
});

// ---------- E. go-ahead ----------
test('E. a basket called go-ahead must turn a tie or deficit into a lead (scores subject-first)', () => {
  const f = game('401909918'); // Denver went from 87:87 to 89:87
  assert.ok(!codes(one(f, "ג'מאל מארי העלה את דנבר ליתרון 89:87.")).includes('semantic'));
  // Portland was behind after that basket: "took the lead 87:89" is false
  assert.ok(codes(one(f, 'פורטלנד עלתה ליתרון 87:89.')).includes('semantic'));
  // lead-cutting: still behind afterwards
  assert.ok(!codes(one(f, 'פורטלנד צימקה ל-87:89.')).includes('semantic'));
  assert.ok(codes(one(f, 'דנבר צימקה ל-89:87.')).includes('semantic'));
});

// ---------- F. runs from the play-by-play ----------
test('F. the 19:0 Detroit run is computed from the play-by-play and reproducible (DET @ CHA)', () => {
  const s = raw('401909908');
  const f = game('401909908');
  const run = f.flow.spurts.find((r) => r.points_for === 19 && r.points_against === 0);
  assert.ok(run, 'the 19-0 run is found');
  assert.equal(f.teams[run.side].abbr, 'DET');
  for (const k of ['start_period', 'start_clock', 'end_period', 'end_clock', 'score_before', 'score_after']) assert.ok(run[k] !== undefined, k);
  assert.equal(run.score_after[run.side] - run.score_before[run.side], 19);
  // the same object is re-derived from the plays; a tampered one is not
  const homeId = s.header.competitions[0].competitors.find((c) => c.homeAway === 'home').team.id;
  const plays = normPlays(s.plays, new Map(), homeId);
  assert.ok(validateRun(plays, run));
  assert.ok(!validateRun(plays, { ...run, points_for: 21 }));
  // in words, without clocks
  const b = gameBrief(f);
  assert.ok(b.runs.some((r) => r.clause_he === 'דטרויט סגרה את הרבע השלישי בריצת 0:19'));
  assert.ok(!JSON.stringify(b.runs).includes('לסיומו'));
  // the validator: reversed run fixed, invented run dropped
  const rev = one(f, 'דטרויט רשמה ריצת 19:0.');
  assert.equal(rev.issues.find((i) => i.code === 'run')?.fix.to, 'ריצת 0:19');
  assert.equal(one(f, 'דטרויט רשמה ריצת 0:25.').issues.find((i) => i.code === 'run')?.fix.type, 'drop');
});

// ---------- G. Hebrew fluency belongs to the writing layer ----------
test('G. random Hebrew typos are not code rules (editor, round 3); translated idioms stay a style note', () => {
  const f = game('401909915');
  for (const t of ['מינסוטה ניצחה אחרי האארכה.', 'מינסוטה ניצחה ניצחה בבית.']) {
    assert.equal(check(f, { paragraphs: [t] }).blocking, 0, t);
  }
  const r = one(f, 'ומשם הזאבים לא הסתכלו אחורה.');
  assert.ok(codes(r).includes('banned'));
  assert.equal(r.blocking, 0);
});

// ---------- H. record convention (kept from round 1) ----------
test('H. record convention: (W:L) after a team name, L:W after "עלתה/ירדה למאזן"', () => {
  assert.equal(formatRecord(6, 1, 'standalone'), '6:1');
  assert.equal(formatRecord(6, 1, 'relative'), '1:6');
  assert.equal(formatRecord(1, 6, 'standalone'), '1:6');
  assert.equal(formatRecord(1, 6, 'relative'), '6:1');
  const r = recordForms('6-1', true);
  assert.equal(r.in_parentheses, '(6:1)');
  assert.equal(r.phrase, 'עלתה למאזן 1:6');
  assert.equal(recordForms('6-1', true, false).phrase, 'עלו למאזן 1:6'); // plural team name
  const f = game('401909908'); // Detroit 6-1
  const b = gameBrief(f);
  assert.ok(b.heading.includes('דטרויט (6:1)'));
  assert.equal(b.records['דטרויט'].after_verb, 'עלתה למאזן 1:6');
  assert.ok(codes(one(f, 'דטרויט עלתה למאזן 6:1.')).includes('record-relative'));
});

// ---------- I. story hierarchy with verified context ----------
const withSchedules = (id, teams, extra = {}) => {
  const s = raw(id);
  const schedules = {};
  for (const c of s.header.competitions[0].competitors) if (teams.includes(c.team.abbreviation)) schedules[c.team.id] = sched(c.team.abbreviation);
  return game(id, { context: { schedules, ...extra } });
};

test('I. verified team / history context outranks an ordinary scoring leader', () => {
  // Spurs: 5th straight win (ESPN schedule) beats a first-quarter 18-2 run
  const sa = withSchedules('401909917', ['SA', 'UTAH']);
  assert.equal(sa.story.main.type, 'WIN_STREAK');
  assert.equal(sa.story.main.fact_he, 'סן אנטוניו רשמה ניצחון חמישי ברציפות');
  assert.ok(sa.story.ranked.findIndex((c) => c.type === 'MAJOR_RUN') > 0);
  // Houston ended Boston's 5-game streak: above Sengun's line
  const hou = withSchedules('401909916', ['HOU', 'BOS']);
  assert.equal(hou.story.main.type, 'STREAK_ENDED');
  assert.equal(hou.story.main.fact_he, 'יוסטון קטעה לבוסטון רצף של 5 ניצחונות');
  // Knicks over Brooklyn for the 15th straight time, from the schedules of five seasons
  const s = raw('401909910');
  const [ny, bkn] = ['NY', 'BKN'].map((a) => s.header.competitions[0].competitors.find((c) => c.team.abbreviation === a).team.id);
  const h = h2hStreak([sched('NY'), ...json(join(EXTRA, 'h2h-NY.json'))], ny, bkn, '401909910', s.header.competitions[0].date);
  assert.deepEqual(h, { n: 15, exact: true });
  const nyg = game('401909910', { context: { h2h: { [ny]: { opp: bkn, ...h } } } });
  assert.equal(nyg.story.main.fact_he, 'הניקס ניצחו את ברוקלין בפעם ה-15 ברציפות');
  assert.equal(nyg.story.ranked.at(-1).category, 'G'); // the plain scoring leader is last
  // Indiana with six players: exceptional circumstances (F) above the 34-point scorer (G)
  const ind = game('401909909');
  assert.equal(ind.story.main.type, 'SHORT_ROSTER');
  assert.equal(gameBrief(ind).main_angle.fact_he, 'אינדיאנה שיחקה עם שישה שחקנים בלבד');
});

test('I. context is never inferred from the box score; streak language needs a verified fact', () => {
  const bare = game('401909917'); // no schedules -> no streak facts at all
  assert.equal(bare.contextFacts.length, 0);
  assert.ok(!bare.story.ranked.some((c) => c.category === 'D'));
  assert.ok(codes(one(bare, 'סן אנטוניו רשמה ניצחון חמישי ברציפות.')).includes('unverified-streak'));
  const sa = withSchedules('401909917', ['SA', 'UTAH']);
  assert.ok(!codes(one(sa, 'סן אנטוניו רשמה ניצחון חמישי ברציפות.')).some((c) => c.startsWith('unverified')));
  assert.ok(codes(one(sa, 'סן אנטוניו רשמה ניצחון שישי ברציפות.')).includes('unverified-streak'));
  assert.ok(codes(one(sa, 'זה הניצחון הגדול ביותר בהיסטוריה של סן אנטוניו.')).includes('unverified-historical'));
  // every context fact carries its source
  for (const c of sa.contextFacts) assert.ok(c.verified && c.source, c.type);
  // season high / scoring streak only from a game log
  const log = [10, 31, 33, 35, 38].map((pts, i) => ({ type: 'regular', season: '2026-27', eventId: `e${i}`, date: `2026-10-2${i}T00:00Z`, pts }));
  const ctxP = playerContext(log, { pts: 42 }, 'x', '2026-11-02T00:00Z');
  assert.ok(ctxP.some((m) => m.type === 'SEASON_HIGH' && m.value === 42));
  assert.ok(ctxP.some((m) => m.type === 'SCORING_STREAK' && m.games === 5 && m.min === 31));
  assert.deepEqual(buildContext(bare, {}), []);
});

// ---------- J. length ----------
test('J. recap length: 2 paragraphs normally, 3 when an Israeli played', () => {
  const f = game('401909917');
  const b = gameBrief(f);
  assert.equal(b.max_paragraphs, 2);
  const d = { headline: 'כ', deck: 'ד', paragraphs: ['א.', 'ב.', 'ג.', 'ד.', 'ה.'] };
  assert.equal(autoFix(d, check(f, d, b).issues).paragraphs.length, 2);
  const por = game('401909918', { israelis: [{ id: '4683021', name: 'Deni Avdija', track: 'full', team: 'POR' }] });
  assert.equal(gameBrief(por).max_paragraphs, 3);
});

// ---------- more deterministic event checks ----------
test('"the final seconds" only when the decision came in them; otherwise "בדקות הסיום"', () => {
  const f = game('401909920'); // Toronto took the lead for good with minutes left, not seconds
  assert.ok(!f.clutch.winningBasket?.late);
  const d = { headline: 'כ', paragraphs: ['טורונטו השלימה את המהפך בשניות האחרונות.'] };
  const r = check(f, d);
  assert.ok(codes(r).includes('timing'));
  assert.equal(autoFix(d, r.issues).paragraphs[0], 'טורונטו השלימה את המהפך בדקות הסיום.');
});

test('a dropped headline falls back to the code-written angle; repetition is noted', () => {
  const f = game('401909909');
  const b = gameBrief(f);
  const d = { headline: 'סן אנטוניו רשמה ניצחון חמישי ברציפות', deck: 'ד', paragraphs: ['אטלנטה ניצחה.'] };
  const fixed = autoFix(d, check(f, d, b).issues, b);
  assert.equal(fixed.headline, b.main_angle.fact_he);
  const rep = check(f, { headline: 'ניצחון 121:117', deck: 'אטלנטה ניצחה 121:117', paragraphs: ['אטלנטה ניצחה 121:117 באינדיאנה.'] }, b);
  assert.ok(codes(rep).includes('repetition') || codes(rep).includes('pair'));
});

// ---------- editor round 3: score once, one piece per game ----------
test('the final score is not repeated: block text never (score line above), article only in the headline', () => {
  const f = game('401909920'); // Toronto won 125-118
  const d = { headline: 'טורונטו חזרה מפיגור 16 לניצחון 118:125 על הקליפרס', deck: 'ד', paragraphs: ['טורונטו חזרה מפיגור 16 בדרך לניצחון 118:125 בלוס אנג׳לס.'] };
  const r = check(f, d);
  assert.equal(r.issues.filter((i) => i.code === 'score-repeat').length, 2);
  const fixed = autoFix(d, r.issues);
  assert.equal(fixed.headline, 'טורונטו חזרה מפיגור 16 לניצחון על הקליפרס');
  assert.equal(fixed.paragraphs[0], 'טורונטו חזרה מפיגור 16 בדרך לניצחון בלוס אנג׳לס.');
  // an article: the headline keeps it, the body loses it
  const art = { ...gameBrief(f), final_score_in: 'headline' };
  const ra = check(f, d, art);
  assert.equal(ra.issues.filter((i) => i.code === 'score-repeat').length, 1);
  assert.equal(autoFix(d, ra.issues).headline, d.headline);
});
