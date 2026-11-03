// Deterministic checks of WHAT a draft claims happened, against the game state the code computed
// (brief._check — never shown to the model). No AI here; each issue has a code, a severity and a fix:
//
//   entity     a team-level action (record, streak) hanging on a player as its subject
//   narrative  "took the lead / turned it around before halftime" vs the score at that checkpoint
//   semantic   impossible basketball: a mid-range three, a "tying" basket that did not tie, a go-ahead
//              basket that did not give the lead, a buzzer-beater with time left, a double-double that
//              is not one, "the final seconds" for a lead taken minutes earlier
//   run        a run that is not one of the play-by-play runs
//   hebrew     duplicated words, known typos, broken clause joins, nickname + singular verb
//   context    history / streak language that does not match a verified context fact
//   repetition headline, deck and opening sentence repeating the same numbers

import { NICK_HE } from '../teams.js';

const SENT = /[^.!?\n]+[.!?]?/g;
const sentences = (text) => (text.match(SENT) || []).map((s) => s.trim()).filter(Boolean);
const CLAUSE = /,|;| אך | אבל | בעוד | ואילו | כאשר /g;
const NOT_HE = '(?![א-ת])';

function clauseAt(sentence, index) {
  let start = 0, end = sentence.length;
  for (const m of sentence.matchAll(CLAUSE)) {
    if (m.index < index) start = m.index + m[0].length;
    else { end = m.index; break; }
  }
  return { text: sentence.slice(start, end), start };
}

// every team / player word the draft may use, with its side and kind
function lexicon(brief, ctx) {
  const words = [];
  const ck = brief._check || {};
  for (const [name, side] of Object.entries(ck.team_side || {})) words.push({ w: name, side, kind: 'team' });
  if (ctx?.teams) for (const side of ['home', 'away']) for (const w of ctx.teams[side]) words.push({ w, side, kind: 'team' });
  const role = { 'המארחת': 'home', 'המארחים': 'home', 'האורחת': 'away', 'האורחים': 'away' };
  for (const [w, side] of Object.entries(role)) words.push({ w, side, kind: 'team' });
  for (const [name, line] of Object.entries(ck.lines || {})) {
    words.push({ w: name, side: line.side, kind: 'player', name });
    const sur = name.split(' ').slice(1).join(' ');
    if (sur.length >= 3) words.push({ w: sur, side: line.side, kind: 'player', name });
  }
  if (ctx?.players) for (const p of ctx.players) {
    words.push({ w: p.he, side: p.side, kind: 'player', name: p.he });
    if (p.surname && p.surname.length >= 3) words.push({ w: p.surname, side: p.side, kind: 'player', name: p.he });
  }
  return words.sort((a, b) => b.w.length - a.w.length);
}
// first mention in a span (a longer word wins at the same position: "ניקיל אלכסנדר-ווקר" before "ניקיל")
function firstMention(span, words, kind = null) {
  let best = null;
  for (const x of words) {
    if (kind && x.kind !== kind) continue;
    const i = span.indexOf(x.w);
    if (i >= 0 && (!best || i < best.i)) best = { ...x, i };
  }
  return best;
}
const sideOfClause = (sentence, index, words) => {
  const c = clauseAt(sentence, index);
  return firstMention(c.text, words) || firstMention(sentence, words);
};

const other = (s) => (s === 'home' ? 'away' : 'home');
// a moment pair is written subject-last: "a:b" for side S means S has b
const pairFor = (a, b, side) => ({ [side]: b, [other(side)]: a });

// ---------- 1. entity: team-level actions need the team as their subject ----------
const TEAM_ACTION = new RegExp(`(^|\\s)(ו?)((?:עלתה|עלו|ירדה|ירדו|עלה|ירד)\\s+למאזן\\s+\\d+:\\d+|(?:רשמה|רשמו|רשם|ספגה|ספגו|ספג)\\s+(?:את\\s+)?ה?(?:ניצחון|הפסד)\\s+\\S+\\s+ברציפות|(?:האריכה|האריכו|האריך)\\s+את\\s+ה?רצף|(?:טיפסה|טיפסו|טיפס)\\s+למקום)`, 'g');

function entityIssues(sentence, brief, words) {
  const out = [];
  for (const m of sentence.matchAll(TEAM_ACTION)) {
    const at = m.index + m[1].length;
    const before = sentence.slice(0, at);
    const lastComma = Math.max(before.lastIndexOf(','), before.lastIndexOf(';'));
    const seg = before.slice(lastComma + 1);
    // "...ואטלנטה עלתה למאזן": the team right before the verb is its subject
    const tail = seg.trimEnd();
    if (words.some((x) => x.kind === 'team' && (tail.endsWith(` ${x.w}`) || tail.endsWith(`ו${x.w}`) || tail === x.w))) continue;
    const subj = firstMention(seg, words) || firstMention(before, words);
    if (!subj || subj.kind !== 'player') continue;
    // whose action is it? the record pair names the team; otherwise winner (win streak) / loser (loss)
    const pairTxt = m[3].match(/\d+:\d+/)?.[0];
    const recs = brief.records || {};
    let team = pairTxt ? Object.keys(recs).find((t) => recs[t].after_verb?.includes(pairTxt)) : null;
    if (!team) {
      const ts = brief._check?.team_side || {};
      const want = /הפסד|ספג|ירד/.test(m[3]) ? other(brief._check?.winner) : brief._check?.winner;
      team = Object.keys(ts).find((t) => ts[t] === want);
    }
    const core = m[3];
    const prevChar = before.trimEnd().slice(-1);
    // the record phrase is taken from the brief so the verb agrees with the team ("עלתה" / "עלו")
    const phrase = pairTxt && recs[team]?.after_verb?.includes(pairTxt) ? recs[team].after_verb : core;
    const fix = team
      ? { type: 'replace', sentence, from: `${m[1]}${m[2]}${core}`, to: `${prevChar === ',' ? ' ' : ', '}ו${team} ${phrase}` }
      : { type: 'drop', sentence };
    out.push({ code: 'entity', severity: 'block', msg: `"${sentence.slice(0, 90)}": "${core}" נאמר על ${subj.w}, אבל זה של הקבוצה — "${team || 'הקבוצה'} ${core}"`, fix });
  }
  return out;
}

// ---------- 2. narrative vs the scoreboard checkpoints ----------
const WINDOWS = [
  { re: /לפני ההפסקה|לפני המחצית|עד ההפסקה|עד המחצית|במחצית הראשונה|עוד לפני ההפסקה/, upto: 2, cp: 'half', he: 'המחצית' },
  { re: /ברבע הראשון/, upto: 1, cp: 'q1', he: 'הרבע הראשון', only: 1 },
  { re: /ברבע השני/, upto: 2, cp: 'half', he: 'הרבע השני', only: 2 },
  { re: /ברבע השלישי|אחרי שלושה רבעים|לפני הרבע האחרון|לפני הרבע הרביעי/, upto: 3, cp: 'q3', he: 'הרבע השלישי' },
];
const TURN = new RegExp(`(הפכ(ה|ו)\\s+את\\s+ה?(תוצאה|מגמה|משחק)|השלימ(ה|ו)\\s+(את\\s+)?ה?(מהפך|קאמבק|חזרה)|ביצע(ה|ו)?\\s+מהפך)${NOT_HE}`);
const TAKE = new RegExp(`(עבר(ה|ו)\\s+ליתרון|עלת?(ה|ו)\\s+ליתרון|עלו\\s+ליתרון|לקח(ה|ו)\\s+את\\s+ההובלה|תפס(ה|ו)\\s+את\\s+ההובלה|עקפ(ה|ו)|השתלט(ה|ו)\\s+על\\s+המשחק)${NOT_HE}`);
const LEAD_AT_HALF = new RegExp(`(הובילה|הובילו|נכנסה\\s+להפסקה\\s+ביתרון|נכנסו\\s+להפסקה\\s+ביתרון|ביתרון)${NOT_HE}[^,.]{0,20}(במחצית|בהפסקה|להפסקה)|(נכנסה|נכנסו)\\s+להפסקה\\s+ביתרון`);
const TRAIL_AT_HALF = new RegExp(`(פיגרה|פיגרו|בפיגור|נכנסה\\s+להפסקה\\s+בפיגור|נכנסו\\s+להפסקה\\s+בפיגור)${NOT_HE}[^,.]{0,20}(במחצית|בהפסקה|להפסקה)|(נכנסה|נכנסו)\\s+להפסקה\\s+בפיגור`);

function narrativeIssues(sentence, brief, words) {
  const ck = brief._check;
  if (!ck?.checkpoints) return [];
  const out = [];
  const subjAt = (i) => sideOfClause(sentence, i, words);
  const lead = (cp, side) => (ck.checkpoints[cp] ? ck.checkpoints[cp][side] - ck.checkpoints[cp][other(side)] : null);
  for (const w of WINDOWS) {
    if (!w.re.test(sentence)) continue;
    const turn = sentence.match(TURN);
    if (turn) {
      const subj = subjAt(turn.index);
      if (subj) {
        const margin = lead(w.cp, subj.side);
        if (margin !== null && margin <= 0) {
          // it did not lead at that checkpoint: "cut the deficit" if it did, otherwise the sentence goes
          const worst = Math.min(0, ...(ck.moments || []).filter((m) => m.period <= w.upto).map((m) => m.after[subj.side] - m.after[other(subj.side)]));
          const plural = /ו$/.test(turn[0].split(/\s+/)[0]);
          const cut = margin < 0 && margin > worst;
          out.push({ code: 'narrative', severity: 'block', msg: `"${sentence.slice(0, 90)}": ${subj.w} לא הובילה ב${w.he} (${ck.checkpoints[w.cp][subj.side]}:${ck.checkpoints[w.cp][other(subj.side)]} מנקודת מבטה) — אי אפשר "${turn[0]}"`, fix: cut ? { type: 'replace', sentence, from: turn[0], to: plural ? 'צימקו את הפער' : 'צימקה את הפער' } : { type: 'drop', sentence } });
        }
      }
    }
    const take = sentence.match(TAKE);
    if (take) {
      const subj = subjAt(take.index);
      if (subj) {
        const periods = (ck.period_lead || []).filter((p) => (w.only ? p.period === w.only : p.period <= w.upto));
        const led = periods.some((p) => (subj.side === 'home' ? p.homeLed : p.awayLed));
        if (periods.length && !led) out.push({ code: 'narrative', severity: 'block', msg: `"${sentence.slice(0, 90)}": ${subj.w} לא הובילה אף רגע עד סוף ${w.he}`, fix: { type: 'drop', sentence } });
      }
    }
  }
  for (const [re, wantLead] of [[LEAD_AT_HALF, true], [TRAIL_AT_HALF, false]]) {
    const m = sentence.match(re);
    if (!m || /\d+:\d+/.test(clauseAt(sentence, m.index).text)) continue; // with a score: scoreIssues judges it
    const subj = subjAt(m.index);
    if (!subj) continue;
    const margin = lead('half', subj.side);
    if (margin === null || margin === 0) continue;
    if ((margin > 0) !== wantLead) out.push({ code: 'narrative', severity: 'block', msg: `"${sentence.slice(0, 90)}": במחצית ${subj.w} ${margin > 0 ? 'הובילה' : 'פיגרה'} (${ck.checkpoints.half[subj.side]}:${ck.checkpoints.half[other(subj.side)]})`, fix: { type: 'drop', sentence } });
  }
  return out;
}

// ---------- 3. impossible basketball ----------
const THREE_CLOSE = /(שלש(ה|ות|ת)|זריקת\s+שלוש|קליעה\s+מחוץ\s+לקשת)[^.,]{0,25}(מחצי\s+מרחק|מטווח\s+(בינוני|קצר)|מתחת\s+לסל|מהצבע|מקרוב|בלייאפ|בדאנק|בהטבעה)|(מחצי\s+מרחק|לייאפ|הטבעה|דאנק)[^.,]{0,15}(שלשה|משלוש)/;
const FT_FAR = /(זריק(ת|ות)\s+עונשין|מהעונשין|מהקו)[^.,]{0,20}(מחוץ\s+לקשת|משלוש|מחצי\s+מרחק|מטווח\s+רחוק)/;
const QUARTER_WON = new RegExp(`(ניצח|ניצחה|ניצחו|לקחה|לקחו|גברה|גברו)\\s+(את\\s+|ב)?ה?רבע\\s+ה?(ראשון|שני|שלישי|רביעי|אחרון)${NOT_HE}`);
const Q_INDEX = { 'ראשון': 1, 'שני': 2, 'שלישי': 3, 'רביעי': 4, 'אחרון': 4 };
const TIE = new RegExp(`(השווה|השוותה|השוו|סל\\s+השוויון|שלשת\\s+השוויון|קבע(ה|ו)?\\s+שוויון|איזן|איזנה|איזנו)${NOT_HE}`);
const GO_AHEAD = new RegExp(`(העל(ה|תה|ו)\\s+את\\s+\\S+(\\s+\\S+)?\\s+ליתרון|(סל|שלשת|שלשה\\s+של|זריקת)\\s+היתרון|עבר(ה|ו)\\s+ליתרון|עלת(ה)?\\s+ליתרון|עלו\\s+ליתרון|החזיר(ה|ו)?\\s+את\\s+ה?יתרון|החזיר(ה|ו)?\\s+את\\s+\\S+(\\s+\\S+)?\\s+ליתרון|קבע(ה|ו)?\\s+יתרון)${NOT_HE}`);
const CUT = new RegExp(`(צימק|צימקה|צימקו|צמצם|צמצמה|צמצמו|הקטין|הקטינה|הקטינו)${NOT_HE}`);
const EXTEND = new RegExp(`(הגדיל|הגדילה|הגדילו|הרחיב|הרחיבה|הרחיבו)${NOT_HE}`);
const WINNER_SHOT = /סל\s+הניצחון|שלשת\s+הניצחון|הסל\s+המכריע|שהכריע\s+את\s+המשחק|קבע\s+את\s+הניצחון/;
const BUZZER = /באזר|בזמזם|עם\s+הצפירה|על\s+הצפירה|עם\s+הצלצול|עם\s+סיום\s+הזמן/;
const DD = /דאבל[- ]?דאבל/, TD = /טריפל[- ]?דאבל/;
const LAST_SECONDS = /בשניות\s+ה?(אחרונות|האחרונות|הסיום)|בשנייה\s+האחרונה|בשניות\s+האחרונות/;

function semanticIssues(sentence, brief, words) {
  const ck = brief._check || {};
  const out = [];
  const drop = (code, msg) => out.push({ code, severity: 'block', msg: `"${sentence.slice(0, 90)}": ${msg}`, fix: { type: 'drop', sentence } });
  if (THREE_CLOSE.test(sentence)) drop('semantic', 'שלשה היא זריקה מחוץ לקשת — לא מחצי מרחק / מתחת לסל');
  if (FT_FAR.test(sentence)) drop('semantic', 'זריקת עונשין נזרקת מהקו, לא מרחוק');

  const qm = sentence.match(QUARTER_WON);
  if (qm && ck.quarters) {
    const p = Q_INDEX[qm[3]];
    const q = ck.quarters[p - 1];
    const subj = sideOfClause(sentence, qm.index, words);
    if (q && subj && q[subj.side] <= q[other(subj.side)]) drop('semantic', `${subj.w} לא ניצחה את הרבע ה-${p} (${q[subj.side]}:${q[other(subj.side)]})`);
  }

  // plays: the claim must match the score the play produced
  const pairsIn = (text) => [...text.matchAll(/(\d+):(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const momentFor = (a, b, side) => (ck.moments || []).find((m) => m.after[side] === b && m.after[other(side)] === a);
  const claim = (re, test, msg) => {
    const m = sentence.match(re);
    if (!m) return;
    const c = clauseAt(sentence, m.index);
    // a checkpoint score ("אחרי שלושה רבעים 100:95") is a state, not a play: the narrative check owns it
    if (/מחצית|הפסקה|שלושה רבעים|בסיום הרבע|אחרי הרבע/.test(c.text)) return;
    const after = c.text.slice(m.index - c.start);
    const pr = pairsIn(after)[0] || pairsIn(c.text)[0];
    if (!pr) return;
    const subj = sideOfClause(sentence, m.index, words);
    const verdict = test(pr, subj?.side || null);
    if (verdict === false) drop('semantic', msg(pr));
  };
  claim(TIE, ([a, b]) => a === b, ([a, b]) => `"שוויון" אבל התוצאה ${a}:${b} אינה שוויון`);
  claim(GO_AHEAD, ([a, b], side) => {
    if (!side) return null;
    if (b <= a) return false; // subject-last: the subject has b
    const m = momentFor(a, b, side);
    if (!m) return null;
    return m.side === side && m.before[side] <= m.before[other(side)];
  }, ([a, b]) => `"יתרון" — אבל ${a}:${b} לא העלה את הקבוצה ליתרון (או שכבר הובילה)`);
  claim(CUT, ([a, b], side) => (side ? b < a : null), ([a, b]) => `"צימקה" — אבל ב-${a}:${b} הקבוצה כבר לא בפיגור`);
  claim(EXTEND, ([a, b], side) => {
    if (!side) return null;
    if (b <= a) return false;
    const m = momentFor(a, b, side);
    return m ? m.before[side] > m.before[other(side)] : null;
  }, ([a, b]) => `"הגדילה את היתרון" — אבל לפני ${a}:${b} הקבוצה לא הובילה`);
  if (WINNER_SHOT.test(sentence)) {
    const wb = ck.winning_basket;
    if (!wb || !wb.late) drop('semantic', 'אין "סל ניצחון" במשחק הזה (היתרון הסופי הושג מוקדם יותר)');
    else {
      // the score in that clause has to be the one the winning basket made (or the final score)
      const m = sentence.match(WINNER_SHOT);
      const W = wb.side;
      const okPair = (a, b) => (a === wb.after[other(W)] && b === wb.after[W]) || (a === wb.after[W] && b === wb.after[other(W)])
        || [ck.checkpoints?.final?.home, ck.checkpoints?.final?.away].sort().join() === [a, b].sort().join();
      const pr = pairsIn(clauseAt(sentence, m.index).text).find(([a, b]) => a !== b);
      if (pr && !okPair(...pr)) drop('semantic', `סל הניצחון קבע ${wb.after[other(W)]}:${wb.after[W]}, לא ${pr[0]}:${pr[1]}`);
    }
  }
  // a buzzer basket has to exist — in the period the sentence names, when it names one
  const bz = sentence.match(BUZZER);
  if (bz) {
    const have = ck.buzzer_periods || [];
    const named = clauseAt(sentence, bz.index).text.match(/(הרבע|המחצית)\s*ה?(ראשון|שני|שלישי|רביעי|אחרון|הראשונה)?/);
    const p = named ? (named[1] === 'המחצית' ? 2 : Q_INDEX[named[2]] || null) : null;
    if (!have.length || (p && !have.includes(p))) drop('semantic', p ? `אין סל עם הבאזר בסיום הרבע ה-${p}` : 'אין סל עם הבאזר בנתונים');
  }
  for (const [re, need, what] of [[TD, 3, 'טריפל-דאבל'], [DD, 2, 'דאבל-דאבל']]) {
    const dm = sentence.match(re);
    if (!dm) continue;
    // the player is the one named closest before the term, in the same clause ("..., X רשם דאבל-דאבל")
    const c = clauseAt(sentence, dm.index);
    const span = c.text.slice(0, dm.index - c.start);
    const rest = c.text.slice(dm.index - c.start + dm[0].length, dm.index - c.start + dm[0].length + 45);
    const players = words.filter((x) => x.kind === 'player');
    // "...דאבל-דאבל של 19 נקודות ו-10 אסיסטים מבריידן סמית'": named right after, with מ / של
    const after = players.map((x) => ({ ...x, i: rest.indexOf(x.w) })).filter((x) => x.i > 0 && (rest[x.i - 1] === 'מ' || rest.slice(Math.max(0, x.i - 3), x.i) === 'של ')).sort((a, b) => a.i - b.i || b.w.length - a.w.length)[0];
    const before = players.map((x) => ({ ...x, i: span.lastIndexOf(x.w) })).filter((x) => x.i >= 0 && span.length - (x.i + x.w.length) <= 30).sort((a, b) => b.i - a.i || b.w.length - a.w.length)[0];
    const p = after || before;
    if (!p) continue;
    const l = ck.lines?.[p.name];
    const tens = l ? ['pts', 'reb', 'ast', 'stl', 'blk'].filter((k) => l[k] >= 10).length : null;
    if (tens !== null && tens < need) drop('semantic', `${p.w} לא רשם ${what} (${tens} קטגוריות עם 10+)`);
  }
  // "the final seconds" only when the decisive moment really was in them
  const ls = sentence.match(LAST_SECONDS);
  if (ls && !(ck.winning_basket?.late || (ck.tying_to_ot && ck.tying_to_ot.secondsLeft <= 30))) {
    out.push({ code: 'timing', severity: 'block', msg: `"${sentence.slice(0, 90)}": "${ls[0]}" — ההכרעה הייתה מוקדם יותר; עדיף "בדקות הסיום"`, fix: { type: 'replace', sentence, from: ls[0], to: 'בדקות הסיום' } });
  }
  return out;
}

// ---------- 4. runs: only the ones computed from the play-by-play ----------
function runIssues(sentence, brief) {
  const runs = brief._check?.runs;
  if (!runs) return [];
  const out = [];
  for (const m of sentence.matchAll(/(ריצ(?:ת|ה)(?:\s+של)?|רצ(?:ה|ו))\s+(\d+):(\d+)/g)) {
    const a = Number(m[2]), b = Number(m[3]);
    if (runs.some((r) => r.against === a && r.for === b)) continue;
    if (runs.some((r) => r.against === b && r.for === a)) out.push({ code: 'run', severity: 'block', msg: `"${m[0]}": ריצה נכתבת עם נקודות הקבוצה הרצה אחרונות — ${b}:${a}`, fix: { type: 'replace', sentence, from: m[0], to: m[0].replace(`${a}:${b}`, `${b}:${a}`) } });
    else out.push({ code: 'run', severity: 'block', msg: `"${m[0]}": הריצה לא מופיעה בחישוב מהמהלכים`, fix: { type: 'drop', sentence } });
  }
  if (/\(\d+:\d+\s+לסיומו\)/.test(sentence)) out.push({ code: 'timestamp', severity: 'style', msg: `"${sentence.slice(0, 70)}": זמן מדויק נחוץ רק למהלכים מכריעים בסיום — בלי שעון לרבעים מוקדמים`, fix: null });
  return out;
}

// ---------- 5. Hebrew that should never reach publication ----------
const TYPOS = [
  [/האארכה/g, 'ההארכה'], [/בהאארכה/g, 'בהארכה'], [/מוומנטום/g, 'מומנטום'],
];
const NONSENSE = [/שלשה\s+מחייבת/, /מחציא/, /שלשה\s+מחצי\b/];
const PLURAL_NICKS = new Set([...Object.values(NICK_HE).flat(), 'הקליפרס', 'הלייקרס', 'הניקס']);
const SG_VERBS = ['ניצחה', 'הובילה', 'הפסידה', 'פתחה', 'סגרה', 'רשמה', 'ספגה', 'ברחה', 'עלתה', 'ירדה', 'קלעה', 'לקחה', 'השלימה', 'צימקה', 'שלטה', 'נכנסה'];
const toPlural = (verb) => (verb === 'עלתה' ? 'עלו' : verb.replace(/ה$/, 'ו'));

function hebrewIssues(sentence, brief, words) {
  const out = [];
  const dup = sentence.match(/(^|\s)([א-ת][א-ת"'״׳-]+)\s+\2(?=[\s.,!?]|$)/);
  if (dup) out.push({ code: 'hebrew', severity: 'block', msg: `מילה כפולה: "${dup[2]} ${dup[2]}"`, fix: { type: 'replace', sentence, from: `${dup[2]} ${dup[2]}`, to: dup[2] } });
  for (const [re, to] of TYPOS) {
    const m = sentence.match(re);
    if (m) out.push({ code: 'hebrew', severity: 'block', msg: `שגיאת כתיב: "${m[0]}" → "${to}"`, fix: { type: 'replace', sentence, from: m[0], to } });
  }
  for (const re of NONSENSE) if (re.test(sentence)) out.push({ code: 'hebrew', severity: 'block', msg: `ביטוי שבור: "${sentence.match(re)[0]}"`, fix: { type: 'drop', sentence } });
  // "פתחה חזק עם מינסוטה ניצחה ..." — a preposition swallowed the subject of the next clause
  const teams = words.filter((x) => x.kind === 'team').map((x) => x.w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (teams.length) {
    const re = new RegExp(`(?:^|\\s)(עם|של|על|מול|את)\\s+(${teams.join('|')})\\s+(${SG_VERBS.join('|')}|${SG_VERBS.map(toPlural).join('|')})${NOT_HE}`);
    const m = sentence.match(re);
    if (m) out.push({ code: 'hebrew', severity: 'block', msg: `משפט שבור: "${m[0].trim()}" — שני משפטים התחברו בלי פסיק / "ו"`, fix: { type: 'drop', sentence } });
  }
  // plural nickname + singular verb ("הקליפרס ניצחה")
  for (const n of PLURAL_NICKS) {
    const m = sentence.match(new RegExp(`(^|\\s)${n}\\s+(${SG_VERBS.join('|')})${NOT_HE}`));
    if (m) out.push({ code: 'hebrew', severity: 'block', msg: `"${n} ${m[2]}": שם ברבים — "${n} ${toPlural(m[2])}"`, fix: { type: 'replace', sentence, from: `${n} ${m[2]}`, to: `${n} ${toPlural(m[2])}` } });
  }
  return out;
}

// ---------- 6. history / streak language needs a verified context fact ----------
const HISTORICAL = /בהיסטוריה|אי פעם|המהיר ביותר|הצעיר ביותר|המבוגר ביותר|שיא\s+ה?(ליגה|מועדון|זיכיון|פרנצ'ייז)|שיא כל הזמנים|לראשונה מאז|בפעם הראשונה מאז/;
const STREAK_ANY = /ברציפות|רצו[ףפ]|רצופ(ים|ות)|(^|\s)ה?רצף/;

function contextIssues(sentence, brief) {
  const out = [];
  if (HISTORICAL.test(sentence) && !brief.verified?.historical) out.push({ code: 'unverified-historical', severity: 'block', msg: `"${sentence.slice(0, 70)}": טענה היסטורית בלי מקור מאומת`, fix: { type: 'drop', sentence } });
  const tokens = brief._check?.streak_tokens;
  if (tokens && brief.verified?.streak && STREAK_ANY.test(sentence) && !tokens.some((t) => sentence.includes(t))) {
    out.push({ code: 'unverified-streak', severity: 'block', msg: `"${sentence.slice(0, 70)}": רצף שלא תואם את העובדות המאומתות (${(brief.context_facts || []).join(' / ') || 'אין'})`, fix: { type: 'drop', sentence } });
  }
  return out;
}

// ---------- 7. headline / deck / opening sentence should complement, not repeat ----------
function repetitionIssues(draft) {
  const nums = (t) => new Set((String(t || '').match(/\d+:\d+|\d{2,}/g) || []));
  const h = nums(draft.headline), d = nums(draft.deck || draft.subheadline), first = nums(sentences(draft.paragraphs?.[0] || '')[0]);
  const thrice = [...h].filter((n) => d.has(n) && first.has(n));
  return thrice.length ? [{ code: 'repetition', severity: 'style', msg: `אותו נתון (${thrice.join(', ')}) בכותרת, בכותרת המשנה ובמשפט הפותח — כל אחד צריך להוסיף משהו`, fix: null }] : [];
}

export function narrativeChecks(draft, text, brief, ctx) {
  const words = lexicon(brief, ctx);
  const out = [];
  for (const s of sentences(text)) {
    out.push(...entityIssues(s, brief, words), ...narrativeIssues(s, brief, words), ...semanticIssues(s, brief, words), ...runIssues(s, brief), ...hebrewIssues(s, brief, words), ...contextIssues(s, brief));
  }
  out.push(...repetitionIssues(draft));
  return out;
}
