// Round 3 regression tests (editor review of the 2026-11-02 rewrite): score perspective, free-throw
// terminology, deterministic play labels, quarter scores, story hierarchy, structure, context gates, runs,
// chronology. Real games from that night.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeGame } from '../src/game.js';
import { gameBrief, playerBrief } from '../src/writer/brief.js';
import { verifyDraft, autoFix } from '../src/writer/verify.js';
import { formatScore, formatRecord } from '../src/writer/he.js';
import { classifyPlay, shotType } from '../src/pbp.js';
import { NICK_HE } from '../src/teams.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const names = new Map(json(join(DIR, '..', 'config', 'names.he.json')).players.map((p) => [p.id, p]));
const game = (id, opts = {}) => analyzeGame(json(join(DIR, `${id}.json`)), { names, ...opts });
const ctx = (f) => {
  const alias = (t) => [t.he, t.heShort, ...(NICK_HE[t.abbr] || [])].filter(Boolean);
  return { teams: { home: alias(f.teams.home), away: alias(f.teams.away) }, players: [], winner: f.result.winner, loser: f.result.loser };
};
const check = (f, draft, brief = gameBrief(f)) => verifyDraft(draft, brief, [], ctx(f));
const one = (f, text, brief) => check(f, { paragraphs: [text] }, brief);
const codes = (r) => r.issues.map((i) => i.code);

// ---------- A. score perspective ----------
test('A. a game state follows the sentence subject: "הקליפרס הובילו 78:62", never 62:78 (TOR @ LAC)', () => {
  assert.equal(formatScore({ home: 78, away: 62 }, 'home'), '78:62');
  assert.equal(formatScore({ home: 78, away: 62 }, 'away'), '62:78');
  assert.equal(formatScore({ home: 78, away: 62 }, 'home', 'final'), '62:78'); // final result keeps "ניצחון 62:78"
  const f = game('401909920'); // Clippers' largest lead: 78-62 in the third quarter
  const b = gameBrief(f);
  const lead = b.largest_lead.find((x) => x.team_he === 'הקליפרס');
  assert.equal(lead.score_by_subject['הקליפרס'], '78:62');
  assert.equal(lead.score_by_subject['טורונטו'], '62:78');
  const bad = one(f, 'הקליפרס הובילו 62:78 ברבע השלישי.');
  const fix = bad.issues.find((i) => i.code === 'score-order');
  assert.ok(fix);
  assert.equal(autoFix({ headline: 'טורונטו חזרה מפיגור 16', paragraphs: ['הקליפרס הובילו 62:78 ברבע השלישי.'] }, bad.issues).paragraphs[0], 'הקליפרס הובילו 78:62 ברבע השלישי.');
  assert.ok(!codes(one(f, 'הקליפרס הובילו 78:62 ברבע השלישי.')).includes('score-order'));
  // checkpoints too
  assert.equal(b.after_three_clause, 'הקליפרס הובילו אחרי שלושה רבעים 91:78');
});

// ---------- B. free-throw terminology ----------
test('B. a game decided at the line is never "a basket" (NO @ MEM, Fears 2 FTs with 7.3s left)', () => {
  assert.equal(shotType('Free Throw - 2 of 2', 'x makes free throw 2 of 2', 1), 'free-throw');
  assert.equal(shotType('Jump Shot', 'x makes 25-foot three point jumper', 3), 'three');
  assert.equal(shotType('Running Dunk Shot', '', 2), 'dunk');
  const f = game('401909914');
  const b = gameBrief(f);
  const wb = b.final_minutes.winning_basket;
  assert.equal(wb.shot, 'free-throw');
  assert.ok(wb.free_throws);
  assert.equal(wb.action_he, "ג'רמייה פירז קלע שתי זריקות עונשין");
  assert.ok(b.secondary_angles.some((a) => a.fact_he === "ג'רמייה פירז הכריע את המשחק מהקו בשניות האחרונות"));
  for (const bad of ["ג'רמייה פירז קלע את סל הניצחון מהקו.", 'פירז קלע סל מהקו בשניות האחרונות.']) assert.ok(codes(one(f, bad)).includes('terminology'), bad);
  for (const ok of ["ג'רמייה פירז הכריע את המשחק מהקו.", "ג'רמייה פירז קלע שתי זריקות עונשין ודייק מהקו."]) assert.ok(!codes(one(f, ok)).includes('terminology'), ok);
});

// ---------- C / D. deterministic play labels ----------
test('C. tying: 122:124 + 2 ties it; 121:124 + 2 only cuts', () => {
  assert.equal(classifyPlay({ home: 122, away: 124 }, { home: 124, away: 124 }, 'home'), 'tying');
  assert.equal(classifyPlay({ home: 121, away: 124 }, { home: 123, away: 124 }, 'home'), 'cuts');
});
test('D. go-ahead: 110:110 + 3 is go-ahead; 106:110 + 3 only cuts; leading + 2 extends', () => {
  assert.equal(classifyPlay({ home: 110, away: 110 }, { home: 113, away: 110 }, 'home'), 'go-ahead');
  assert.equal(classifyPlay({ home: 106, away: 110 }, { home: 109, away: 110 }, 'home'), 'cuts');
  assert.equal(classifyPlay({ home: 112, away: 110 }, { home: 114, away: 110 }, 'home'), 'extends');
  // the brief carries the label; the and-one is one play
  const late = gameBrief(game('401909914')).final_minutes.last_two_minutes;
  // Jerome's tying layup + the foul shot (133:133 -> 134:133) = ONE go-ahead play, not a tie and a free throw
  const jerome = late.filter((p) => p.player_he === "טיי ג'רום");
  assert.equal(jerome.length, 1);
  assert.ok(/ועוד זריקת עונשין/.test(jerome[0].action_he));
  assert.equal(jerome[0].label_he, 'העלה ליתרון');
});

// ---------- E. quarter score ----------
test('E. "טורונטו ניצחה את הרבע האחרון 47:27" — those exact points, subject first', () => {
  const f = game('401909920');
  assert.ok(gameBrief(f).quarters.some((q) => q.clause === 'טורונטו ניצחה את הרבע האחרון 47:27'));
  assert.ok(codes(one(f, 'טורונטו ניצחה את הרבע האחרון 27:47.')).includes('quarter-order'));
  assert.ok(codes(one(f, 'טורונטו ניצחה את הרבע האחרון 45:27.')).includes('semantic'));
  assert.ok(!codes(one(f, 'טורונטו ניצחה את הרבע האחרון 47:27.')).includes('semantic'));
});

// ---------- F / G. story hierarchy ----------
test('F. a 6-0 team losing in overtime: first loss leads, not a 25-point night', () => {
  const f = game('401909914');
  assert.equal(f.story.main.type, 'FIRST_LOSS');
  const rank = (t) => f.story.ranked.findIndex((c) => c.type === t);
  for (const t of ['GAME_WINNER', 'OVERTIME', 'TOP_PERFORMER']) assert.ok(rank('FIRST_LOSS') < rank(t) || rank(t) < 0, t);
});
test('G. a 0-6 team winning: first win leads, above the leading scorer (SAC @ DAL)', () => {
  const f = game('401909913');
  assert.equal(f.story.main.type, 'FIRST_WIN');
  assert.equal(gameBrief(f).main_angle.fact_he, 'סקרמנטו רשמה ניצחון ראשון העונה, אחרי 6 הפסדים בפתיחת העונה');
  assert.ok(f.story.ranked.findIndex((c) => c.type === 'TOP_PERFORMER') > 0);
});

// ---------- H. structure ----------
test('H. structure: 2 paragraphs; the headline carries the main angle or the code puts it there', () => {
  const f = game('401909909'); // Indiana with six players
  const b = gameBrief(f);
  assert.equal(b.max_paragraphs, 2);
  const weak = { headline: 'ניקיל אלכסנדר-ווקר קלע 34 נקודות', deck: 'אטלנטה ניצחה באינדיאנה', paragraphs: ['א.', 'ב.', 'ג.'] };
  const r = check(f, weak, b);
  assert.ok(codes(r).includes('angle'));
  const fixed = autoFix(weak, r.issues, b);
  assert.equal(fixed.headline, 'אינדיאנה שיחקה עם שישה שחקנים בלבד');
  assert.equal(fixed.paragraphs.length, 2);
  // the scorer in the sub-headline under the right headline is fine
  const good = { headline: 'אינדיאנה שיחקה עם שישה שחקנים בלבד ונפלה בסיום', deck: 'ניקיל אלכסנדר-ווקר קלע 34 נקודות', paragraphs: ['א.'] };
  assert.ok(!codes(check(f, good, b)).includes('angle'));
  // the brief no longer hands over an early "decisive basket" with its clock
  assert.equal(b.final_minutes.winning_basket, null);
});

// ---------- I. context gates ----------
test('I. unverified career high / season high / streak / standings / history never pass', () => {
  const f = game('401909909'); // no context fetched -> nothing verified
  const b = gameBrief(f);
  assert.deepEqual(b.verified, { season_high: false, career_high: false, streak: false, standings: false, historical: false });
  for (const [s, c] of [
    ['ניקיל אלכסנדר-ווקר קלע שיא קריירה.', 'unverified-career_high'],
    ['ניקיל אלכסנדר-ווקר קלע שיא עונה.', 'unverified-season_high'],
    ['אטלנטה רשמה ניצחון שלישי ברציפות.', 'unverified-streak'],
    ['אטלנטה עלתה למקום השישי בטבלה.', 'unverified-standings'],
    ['זה הניצחון הגדול ביותר בהיסטוריה של אטלנטה.', 'unverified-historical'],
  ]) assert.ok(codes(one(f, s)).includes(c), s);
});

// ---------- J. runs ----------
test('J. runs: only reproducible, single-period runs reach the writer; any stated run must be computed', () => {
  const f = game('401909910'); // the Knicks' 19-4 run spans two quarters
  const b = gameBrief(f);
  assert.ok(f.flow.spurts.some((r) => r.start_period !== r.end_period));
  assert.ok(b.runs.every((r) => !/בין/.test(r.clause_he)));
  assert.ok(!f.story.ranked.some((c) => c.type === 'MAJOR_RUN' && c.run.start_period !== c.run.end_period));
  assert.ok(codes(one(f, 'הניקס רשמו ריצת 2:30.')).includes('run'));
});

// ---------- K. chronology and game-state claims ----------
test('K. a halftime state is never the result of the second half; second-half / comeback claims match the score', () => {
  const f = game('401909909'); // Atlanta led 68-56 at half, Indiana won the second half 48-40
  assert.ok(codes(one(f, 'אטלנטה השתלטה במחצית השנייה ונכנסה להפסקה ביתרון 68:56.')).includes('chronology'));
  assert.ok(!codes(one(f, 'אטלנטה נכנסה להפסקה ביתרון 68:56, ואינדיאנה צימקה במחצית השנייה.')).includes('chronology'));
  assert.ok(codes(one(f, 'אטלנטה השתלטה על המשחק במחצית השנייה.')).includes('semantic'));
  const t = game('401909920'); // Toronto trailed by 16 at most; the Clippers' largest lead was 16
  assert.ok(!codes(one(t, 'טורונטו חזרה מפיגור 16.')).includes('semantic'));
  assert.ok(codes(one(t, 'טורונטו חזרה מפיגור 20.')).includes('semantic'));
  assert.ok(codes(one(t, 'הקליפרס השלימו את המהפך.')).includes('semantic'));
  assert.ok(codes(one(t, 'הקליפרס ברחו ליתרון שיא של 20.')).includes('semantic'));
  assert.ok(!codes(one(t, 'הקליפרס ברחו ליתרון שיא של 16.')).includes('semantic'));
});

// ---------- record convention kept ----------
test('records unchanged: (W:L) after a team name, L:W after "ירדה למאזן"', () => {
  assert.equal(formatRecord(6, 1, 'standalone'), '6:1');
  assert.equal(formatRecord(6, 1, 'relative'), '1:6');
  const b = gameBrief(game('401909914'));
  assert.ok(b.heading.includes('ממפיס (6:1)'));
  assert.equal(b.records['ממפיס'].after_verb, 'ירדה למאזן 1:6');
});

// ---------- one piece per game, every Israeli who played inside it (editor, 2026-11-04) ----------
test('Israelis: one piece per game; every one who played is in it; one who did not play changes nothing', () => {
  const avdija = { id: '4683021', name: 'Deni Avdija', he: 'דני אבדיה', team: 'POR', track: 'full' };
  const stand = { id: '6606', name: 'Damian Lillard', he: 'דמיאן לילארד', team: 'POR', track: 'short' }; // stand-in for Wolf
  const dnp = { id: '4066399', name: 'Micah Potter', he: 'מייקה פוטר', team: 'POR', track: 'short' }; // did not play
  // short-track only: the normal recap must carry him (and the code adds his line if the writer forgets)
  const f1 = game('401909918', { israelis: [stand, dnp] });
  const b1 = gameBrief(f1);
  assert.deepEqual(b1.israelis_featured.map((x) => x.player_he), ['דמיאן לילארד']);
  const d = { headline: 'פורטלנד חזרה מפיגור 14', paragraphs: ['פורטלנד ניצחה בדנבר.'] };
  const r = check(f1, d, b1);
  assert.ok(codes(r).includes('israeli-missing'));
  assert.ok(autoFix(d, r.issues, b1).paragraphs[0].includes(b1.israelis_featured[0].sentence_he));
  // full track + another Israeli in the same game: one article, the other one inside it
  const f2 = game('401909918', { israelis: [avdija, stand] });
  const t = f2.tracks.find((x) => x.player.id === avdija.id);
  const pb = playerBrief(f2, t);
  assert.deepEqual(pb.other_israelis.map((x) => x.player_he), ['דמיאן לילארד']);
  assert.equal(pb.game.israelis_featured, undefined);
  // nobody played: nothing featured
  assert.equal(gameBrief(game('401909918', { israelis: [dnp] })).israelis_featured, undefined);
});
