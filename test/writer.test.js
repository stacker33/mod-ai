import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeGame } from '../src/game.js';
import { gameBrief, playerBrief } from '../src/writer/brief.js';
import { verifyDraft, autoFix } from '../src/writer/verify.js';
import { fullLineHe, formatRecord, recordForms, pair, partialPair } from '../src/writer/he.js';
import { foulRole } from '../src/pbp.js';
import { itemMessage, heldAlert } from '../src/notify.js';
import { NICK_HE, heTeam } from '../src/teams.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const EXTRA = join(DIR, 'extra');
const oldFacts = (id) => JSON.parse(readFileSync(join(EXTRA, `facts-${id}.json`), 'utf8'));
const game = (id) => analyzeGame(JSON.parse(readFileSync(join(DIR, `${id}.json`), 'utf8')));
const ctx = (f) => {
  const alias = (t) => [t.he, t.heShort, ...(NICK_HE[t.abbr] || [])].filter(Boolean);
  return { teams: { home: alias(f.teams.home), away: alias(f.teams.away) }, players: [], winner: f.result.winner, loser: f.result.loser };
};
const check = (f, draft, brief = gameBrief(f)) => verifyDraft(draft, brief, [], ctx(f));
// the angle check is a style note that fires on any one-line test draft of the Memphis game; tests opt in
const codes = (r, withAngle = false) => r.issues.map((i) => i.code).filter((c) => withAngle || c !== 'angle');

test('Sport5 number formats', () => {
  assert.equal(pair(136, 129), '129:136'); // final result: subject's score last
  assert.equal(partialPair(47, 27), '47:27'); // partial score: subject's score first
  assert.equal(fullLineHe({ pts: 23, fg: [8, 15], tp: [4, 7], ft: [3, 7], reb: 4, ast: 9, to: 3, stl: 1, blk: 0, plusMinus: 8, min: 33 }),
    '23 נקודות (8 מ-15 מהשדה, 4 מ-7 משלוש, 3 מ-7 מהעונשין), 4 ריבאונדים, 9 אסיסטים (3 איבודים), חטיפה ומדד פלוס מינוס 8+ ב-33 דקות');
});

// ---------- C. records depend on context ----------
test('C. formatRecord: standalone = wins:losses, relative = losses:wins', () => {
  assert.equal(formatRecord(6, 1, 'standalone'), '6:1');
  assert.equal(formatRecord(6, 1, 'relative'), '1:6');
  assert.equal(formatRecord(1, 6, 'standalone'), '1:6');
  assert.equal(formatRecord(1, 6, 'relative'), '6:1');
  assert.equal(formatRecord(5, 1, 'relative'), '1:5');
  assert.throws(() => formatRecord(5, 1));
  assert.deepEqual(recordForms('6-1', true), { wins: 6, losses: 1, standalone: '6:1', relative: '1:6', in_parentheses: '(6:1)', phrase: 'עלתה למאזן 1:6' });
  assert.equal(recordForms('1-6', false).phrase, 'ירדה למאזן 6:1');
});

test('C. records in the draft are checked in their own context and fixed only in that context', () => {
  const f = game('401909914'); // Memphis ends 6-1, New Orleans 3-4
  const b = gameBrief(f);
  assert.match(b.heading, /ממפיס \(6:1\)/);
  assert.equal(b.records['ממפיס'].after_verb, 'ירדה למאזן 1:6');
  assert.deepEqual(codes(check(f, { paragraphs: ['ממפיס ירדה למאזן 1:6.'] })), []);
  const rel = check(f, { paragraphs: ['ממפיס ירדה למאזן 6:1.'] });
  assert.deepEqual(codes(rel), ['record-relative']);
  assert.equal(autoFix({ paragraphs: ['ממפיס ירדה למאזן 6:1.'] }, rel.issues).paragraphs[0], 'ממפיס ירדה למאזן 1:6.');
  const par = check(f, { paragraphs: ['ממפיס (1:6) הפסידה.'] });
  assert.ok(codes(par).includes('record-standalone'));
  assert.equal(autoFix({ paragraphs: ['ממפיס (1:6) הפסידה.'] }, par.issues).paragraphs[0], 'ממפיס (6:1) הפסידה.');
  assert.deepEqual(codes(check(f, { paragraphs: ['ממפיס (6:1) הפסידה.'] })), []);
});

// ---------- A. quarter direction ----------
test('A. Toronto won the 4th quarter 47-27: written 47:27, never 27:47', () => {
  const f = game('401909920');
  const b = gameBrief(f);
  const q4 = b.quarters[3];
  assert.equal(q4.clause, `${heTeam('TOR')} ניצחה את הרבע האחרון 47:27`);
  const bad = check(f, { paragraphs: [`טורונטו ניצחה את הרבע האחרון 27:47.`] });
  assert.ok(codes(bad).includes('quarter-order'), JSON.stringify(bad.issues));
  assert.equal(autoFix({ paragraphs: ['טורונטו ניצחה את הרבע האחרון 27:47.'] }, bad.issues).paragraphs[0], 'טורונטו ניצחה את הרבע האחרון 47:27.');
  assert.deepEqual(codes(check(f, { paragraphs: [`${q4.clause}.`] })), []);
});

// ---------- B. technical foul vs technical free throw ----------
test('B. the technical free-throw shooter is not charged with the technical', () => {
  assert.deepEqual(foulRole('Free Throw - Technical', 'Trey Murphy III makes technical free throw').charged, []);
  assert.deepEqual(foulRole('Technical Foul', 'Isaiah Stewart technical foul').charged, [0]);
  assert.deepEqual(foulRole('Double Technical Foul', 'Double technical foul: A and B').charged, [0, 1]);
  const f = game('401909914');
  const techs = f.color.events.filter((e) => /technical/.test(e.kind));
  assert.deepEqual(techs.flatMap((e) => e.players), ['Isaiah Stewart']);
  // an ordinary third-quarter technical is not story material
  assert.ok(techs.every((e) => !e.relevant));
  assert.ok(!gameBrief(f).color.some((c) => /טכנית/.test(c.what_he)));
});

// ---------- D. unverified milestones ----------
test('D. no season high without verified history', () => {
  const f = game('401909914');
  const brief = gameBrief(f);
  assert.equal(brief.verified.season_high, false);
  const top = f.players.away.filter((p) => p.played).sort((a, b) => b.pts - a.pts)[0];
  const draft = { paragraphs: [`הוא קלע ${top.pts} נקודות, שיא עונה. ניו אורלינס ניצחה.`] };
  const r = check(f, draft, brief);
  assert.ok(codes(r).includes('unverified-season_high'));
  assert.equal(autoFix(draft, r.issues).paragraphs[0], 'ניו אורלינס ניצחה.');
  // with verified history the same words pass
  assert.ok(!codes(check(f, draft, { ...brief, verified: { ...brief.verified, season_high: true } })).includes('unverified-season_high'));
  // standings language is never verified today
  assert.ok(codes(check(f, { paragraphs: ['ניו אורלינס עלתה למקום השישי בטבלה.'] })).includes('unverified-standings'));
});

// ---------- E. no QA text in public output ----------
test('E. nothing internal leaks into the published text', () => {
  const it = { mode: 'game', heading: 'ממפיס (6:1) - ניו אורלינס (3:4) 135:134', draft: { headline: 'כותרת', deck: 'דק', paragraphs: ['פסקה.'] }, check: { ok: true, issues: [], errors: [], toApprove: ['x'] }, held: false };
  const msg = itemMessage(it);
  for (const bad of ['✅', 'נבדק', 'אומת', 'http', 'לעורך', '✏️', '—']) assert.ok(!msg.includes(bad), `${bad} leaked`);
  assert.equal(itemMessage({ ...it, held: true }), null);
  assert.match(heldAlert(it), /לא פורסמה/);
  const f = game('401909914');
  assert.ok(codes(check(f, { paragraphs: ['ממפיס הפסידה. ✅ נבדק מול הנתונים.'] })).includes('leak'));
});

// ---------- F. length ----------
test('F. a standard recap has at most 2 body paragraphs', () => {
  const f = game('401909920'); // not a featured game
  const b = gameBrief(f);
  assert.equal(b.max_paragraphs, 2);
  const draft = { headline: 'כ', deck: 'ד', paragraphs: ['א.', 'ב.', 'ג.'] };
  const r = check(f, draft, b);
  assert.ok(codes(r).includes('length'));
  assert.equal(autoFix(draft, r.issues).paragraphs.length, 2);
  // round 2: every standard recap is 2 paragraphs, featured or not (3 only when an Israeli played — test J)
  assert.equal(gameBrief(game('401909914')).max_paragraphs, 2);
});

// ---------- G. story hierarchy ----------
test('G. an unbeaten team losing in overtime: the first loss is the story', () => {
  const f = game('401909914'); // Memphis 6-0 lost 135-134 in OT
  assert.equal(f.candidates[0].type, 'FIRST_LOSS');
  const rank = (t) => f.candidates.findIndex((c) => c.type === t);
  assert.ok(rank('FIRST_LOSS') < rank('OVERTIME'));
  assert.ok(rank('FIRST_LOSS') < rank('GAME_WINNER'));
  const b = gameBrief(f);
  assert.match(b.main_angle.fact_he, /ממפיס ספגה הפסד ראשון העונה, אחרי 6 ניצחונות/);
  assert.ok(codes(check(f, { headline: 'מותחן בהארכה', paragraphs: ['ניו אורלינס ניצחה.'] }, b), true).includes('angle'));
  assert.ok(!codes(check(f, { headline: 'הפסד ראשון לממפיס', paragraphs: ['ניו אורלינס ניצחה.'] }, b), true).includes('angle'));
});

test('redundant and translated phrasing is flagged', () => {
  const f = game('401909914');
  assert.ok(codes(check(f, { paragraphs: ['ניו אורלינס רשמה ניצחון שני רצוף ברציפות.'] })).includes('redundant'));
  assert.ok(codes(check(f, { paragraphs: ['הוא תיפקד היטב מהספסל.'] })).includes('banned'));
});

// ---------- earlier real mistakes stay caught ----------
test('score written from the wrong team is caught (BKN @ BOS)', () => {
  const f = oldFacts('401909877');
  // round 3 (editor): a game state is written from the sentence subject — its score FIRST
  assert.ok(codes(check(f, { paragraphs: ['ברוקלין כבר הובילה 119:124 כשנותרו פחות משתי דקות לסיום.'] })).includes('score-order'));
  assert.deepEqual(codes(check(f, { paragraphs: ['ברוקלין כבר הובילה 124:119 כשנותרו פחות משתי דקות לסיום.'] })), []);
  // round 2: the final score belongs in the headline only (article) — that is where its order is checked
  const art = { ...gameBrief(f), final_score_in: 'headline' };
  assert.deepEqual(codes(check(f, { headline: 'בדרך לניצחון 124:125 של בוסטון על ברוקלין.' }, art)), []);
});

test('halftime is a partial score: subject first, and the verb must fit (DET @ NY, NY led 51-50)', () => {
  const f = oldFacts('401909878');
  assert.equal(gameBrief(f).halftime_clause, 'הניקס הובילו במחצית 51:50'); // plural nickname, plural verb
  assert.deepEqual(codes(check(f, { paragraphs: ['ניו יורק הובילה במחצית 51:50.'] })), []);
  assert.ok(codes(check(f, { paragraphs: ['ניו יורק פיגרה במחצית 51:50.'] })).includes('verb-score'));
  assert.ok(codes(check(f, { paragraphs: ['ניו יורק הובילה במחצית 50:51.'] })).includes('score-order'));
});

test('invented numbers, unknown pairs, English names and foreign letters are caught', () => {
  const f = oldFacts('401909877');
  const r = check(f, { paragraphs: ['טייטום קלע 44 נקודות ו-Tatum חגג 130:120.', 'ודאנקן רובינסון סπέל עם 12 נקודות.'] });
  for (const c of ['number', 'pair', 'latin', 'foreign']) assert.ok(codes(r).includes(c), c);
});

test('player brief: streaks written in full, milestones only when verified', () => {
  const f = game('401909914');
  const t = { player: { he: 'x', name: 'x', track: 'full' }, team: { he: 'ממפיס', record: '6-1', score: 134, context: { streak: { kind: 'L', length: 1 }, next: null } }, opp: { he: 'ניו אורלינס', score: 135 }, won: false, side: 'home', home: true, line: { pts: 28, fg: [9, 18], tp: [2, 5], ft: [8, 9], reb: 4, ast: 5, to: 2, stl: 0, blk: 0, plusMinus: -1, min: 38 }, byPeriod: [], halves: {}, assistsTo: [], clutch: [], leadPlays: [], leadAssists: [], fouls: {}, milestones: [], teammates: [], opponents: [] };
  const b = playerBrief(f, t);
  assert.equal(b.verified.season_high, false);
  assert.equal(b.team_streak_he, null); // a one-game streak is not a streak
  assert.equal(b.team_record.after_verb, 'ירדה למאזן 1:6');
});

test('compound sentences: each score is judged by its own clause (real flash-lite output, NO @ MEM)', () => {
  const f = game('401909914'); // MEM led 62-59 at the half; NO led 100-95 after three
  const ok = 'ממפיס הובילה במחצית 62:59, אך ניו אורלינס הובילה אחרי שלושה רבעים 100:95.';
  assert.deepEqual(codes(check(f, { paragraphs: [ok] })), []);
  const bad = check(f, { paragraphs: ['ממפיס הובילה במחצית 62:59, אך ניו אורלינס הובילה אחרי שלושה רבעים 95:100.'] });
  assert.ok(codes(bad).includes('score-order'));
  // overtime is a period score (winner first); a record in parentheses next to "ניצחון" is not a result
  assert.deepEqual(codes(check(f, { paragraphs: ['ניו אורלינס ניצחה את ההארכה 11:10.'] })), []);
  assert.deepEqual(codes(check(f, { paragraphs: ['ניצחון בחוץ על ממפיס (6:1).'] })), []);
  assert.ok(codes(check(f, { paragraphs: ['ניו אורלינס ניצחה 135:134.'] })).includes('result-order'));
});

test('a score in parentheses that is not a record is still checked (real output, TOR @ LAC)', () => {
  const f = game('401909920'); // Toronto trailed 62-78 (round 3: subject first)
  assert.ok(codes(check(f, { paragraphs: ['טורונטו פיגרה ב-16 ברבע השלישי (78:62).'] })).includes('score-order'));
  assert.deepEqual(codes(check(f, { paragraphs: ['טורונטו פיגרה ב-16 ברבע השלישי (62:78).'] })), []);
});

test('the closest result word decides the final-score order ("6 ניצחונות... ונכנעה")', () => {
  const f = game('401909914'); // NO won 135-134 at Memphis
  // round 2: the final score is checked where it may appear — an article headline
  const art = { ...gameBrief(f), final_score_in: 'headline' };
  assert.deepEqual(codes(check(f, { headline: 'ממפיס ספגה הפסד ראשון, אחרי 6 ניצחונות בפתיחת העונה, ונכנעה 135:134 לניו אורלינס.' }, art)), []);
  const bad = check(f, { headline: 'ממפיס ספגה הפסד ראשון, אחרי 6 ניצחונות בפתיחת העונה, ונכנעה 134:135 לניו אורלינס.' }, art);
  assert.deepEqual(codes(bad), ['result-order']);
  assert.deepEqual(codes(check(f, { headline: 'ניו אורלינס ניצחה 134:135.' }, art)), []);
});

test('a paragraph cut in the middle is caught (real output: כ"א split the JSON string)', () => {
  const f = game('401909914');
  const r = check(f, { headline: 'הפסד ראשון לממפיס', paragraphs: ['שניהם קלעו 25 נקודות כ', ', דריק קווין תרם 20 נקודות.'] });
  assert.ok(codes(r).includes('broken'));
  assert.ok(!r.ok);
});
