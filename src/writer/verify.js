// Pre-publication validation of a Hebrew draft against the brief it was written from. Code, not AI.
//
// Each issue has a code, a severity and (when possible) a fix:
//   block  — a factual / format contradiction. Sent back to the model; after the last round it is fixed in
//            code (swap a reversed pair, drop the sentence, trim paragraphs). If anything blocking is left,
//            the draft is not published.
//   style  — wording (translated Hebrew, redundancy, missing angle). Sent back to the model; never blocks.
// The checks look for the pre-rendered strings the brief hands the model (records, quarter clauses,
// per-team scores), so they compare strings instead of trying to parse Hebrew grammar.

import { narrativeChecks } from './narrative.js';

const NUM = /\d+(?:\.\d+)?/g;
const PAIR = /\d+:\d+/g;
const LATIN_OK = new Set(['NBA', 'LA', 'MVP', 'TD', 'W']);
const SENT = /[^.!?\n]+[.!?]?/g;

export function allowedFrom(brief) {
  const s = JSON.stringify(brief, (k, v) => (k === 'states' || k.startsWith('_') ? undefined : v));
  return { numbers: new Set(s.match(NUM) || []), pairs: new Set(s.match(PAIR) || []) };
}

// milestone / context language, allowed only when the brief says it is verified
const GATES = [
  { flag: 'season_high', re: /שיא (ה)?עונה|שיא עונתי|השיא העונתי|השיא שלו העונה/ },
  { flag: 'career_high', re: /שיא (ה)?קריירה|שיא אישי|השיא האישי/ },
  // any streak language at all ("ברציפות", "רצוף"/"רצופים", "רצף"); ף/פ: "רצוף" ends in a final letter
  { flag: 'streak', re: /ברציפות|רצו[ףפ]|רצופ(ים|ות)|(^|\s)ה?רצף/ },
  { flag: 'standings', re: /בטבלה|במקום ה|ראש (ה)?(מזרח|מערב|טבלה|ליגה)|מוליכת|הפלייאוף|פליי-אין|פלייאין/ },
];
// the same thing said twice ("2 consecutive wins in a row")
const REDUNDANT = [/רצו[ףפ]\S*\s+ברציפות|ברציפות\s+רצו[ףפ]\S*/, /רצף\s+של\s+\S+\s+(ניצחונות|הפסדים)\s+(רצופים|ברציפות)/, /(ברציפות|רצופים)\s+ברצף/];
// translated / AI Hebrew the editor flagged, with what to write instead
export const BANNED = [
  [/סלים? חשוב(ים)?/, 'כתוב מה הסל עשה (שוויון / יתרון / קבע X:Y)'],
  [/לצד (הופעה|יכולת|משחק) טוב/, 'לצידו, X ו-Y בלטו גם הם'],
  [/(שלט|שלטה|שלטו) בקצב/, 'הובילה ברוב המשחק'],
  [/(בכל|ברוב|לאורך רוב) שלבי/, 'ברוב המשחק'],
  [/תפקד|תיפקד/, 'הוסיף 19 נקודות מהספסל'],
  [/סיפק (הופעה|תצוגה)|הציג (יכולת|הופעה)/, 'קלע / רשם / הוביל עם'],
  [/עבודה גדולה|רצו בפיץ'|הפכו את הקערה על עורם/, 'משפט קצר וקונקרטי'],
  // English sports idioms translated word for word
  [/לא הסתכל(ה|ו)? אחורה/, '"ומשם X השתלטה על המשחק" / "ומשם לא איבדו את היתרון"'],
  [/הביא(ה|ו)? את (זה|המשחק|הניצחון) הביתה/, '"סגרה את המשחק" / "שמרה על היתרון"'],
  [/סגר(ה|ו)? את העסקה/, '"סגרה את המשחק"'],
  [/על הלוח/, '"פתחה את החשבון" / "קלעה ראשונה"'],
  [/בדרך הקשה/, 'משפט קונקרטי: מה היה קשה'],
  [/(על|באש)\s+בוערת|עלה באש/, '"היה חם" / "קלע שלשה אחרי שלשה"'],
];
const LEAK = /נבדק|נבדקו|אומת|מאומת|לבדיקת|לעורך|הערת עורך|BRIEF|JSON|https?:|www\.|✅|❌|✏️|🔎|\bQA\b|TODO|\[|\]/;

const sentences = (text) => (text.match(SENT) || []).map((s) => s.trim()).filter(Boolean);

function aliasWords(ctx) {
  const words = [];
  for (const side of ['home', 'away']) {
    for (const w of ctx.teams[side]) words.push({ w, side });
    for (const p of ctx.players.filter((x) => x.side === side)) {
      if (p.he) words.push({ w: p.he, side });
      if (p.surname && p.surname.length >= 4) words.push({ w: p.surname, side });
    }
  }
  const role = { 'המארחת': 'home', 'המארחים': 'home', 'האורחת': 'away', 'האורחים': 'away', 'המנצחת': ctx.winner, 'המפסידה': ctx.loser };
  for (const [w, side] of Object.entries(role)) words.push({ w, side });
  return words;
}
const firstMention = (sentence, words) => {
  let first = null;
  for (const { w, side } of words) {
    const i = sentence.indexOf(w);
    if (i >= 0 && (!first || i < first.i)) first = { i, side, w };
  }
  return first;
};

// The final result keeps Sport5's form after a result word: the subject's score last, so a win reads low:high
// and a loss high:low. The word that counts is the CLOSEST one before the score ("אחרי 6 ניצחונות... ונכנעה
// 135:134" is a loss); a plural count ("ניצחונות") is not a result word.
const WIN = /(ניצחון|ניצחה|ניצחו|גברה|גברו)(?![א-ת])/g;
const LOSS = /(הפסד|הפסידה|הפסידו|נכנעה|נכנעו)(?![א-ת])/g;
export function resultVerb(sentence, index) {
  const before = sentence.slice(Math.max(0, index - 35), index);
  if (/\(\s*$/.test(before)) return null; // "(6:1)" is a record
  const last = (re) => Math.max(-1, ...[...before.matchAll(re)].map((m) => m.index));
  const w = last(WIN), l = last(LOSS);
  return w < 0 && l < 0 ? null : w > l ? 'win' : 'loss';
}
const finalOf = (brief) => (brief.result_for_winner || brief.result_he || brief.game?.result_for_winner || '').match(/(\d+):(\d+)/)?.slice(1).map(Number) || null;
const isFinal = (fs, x, y) => !!fs && ((x === fs[0] && y === fs[1]) || (x === fs[1] && y === fs[0]));

// clause boundaries inside a sentence: commas and contrast/time conjunctions
const CLAUSE = /,|;| אך | אבל | בעוד | ואילו | כאשר /g;
function clauseAt(sentence, index) {
  let start = 0, end = sentence.length;
  for (const m of sentence.matchAll(CLAUSE)) {
    if (m.index < index) start = m.index + m[0].length;
    else { end = m.index; break; }
  }
  return { text: sentence.slice(start, end), start };
}

function recordPairSet(brief) {
  const recs = brief.records || (brief.team_record ? { t: brief.team_record } : {});
  return new Set(Object.values(recs).flatMap((r) => [r.after_team_name.replace(/[()]/g, ''), r.after_verb.match(/\d+:\d+/)?.[0]].filter(Boolean)));
}

function scoreIssues(text, brief, ctx) {
  const out = [];
  const states = brief.states || [];
  // which team a pair "a:b" is written for, given each state's convention (partial: subject first)
  // returns {side, kind}; kind is null when the same numbers were two different moments (verb unknowable)
  const subjectOf = (a, b, sentence) => {
    const subj = new Set(), kinds = new Set();
    // a sentence that names the moment ("במחצית", "אחרי שלושה רבעים") is about that labelled score only
    const label = /מחצית|הפסקה/.test(sentence) ? 'half' : /אחרי שלושה רבעים|בסיום הרבע השלישי/.test(sentence) ? 'after3' : null;
    const pool = label && states.some((s) => s.label === label && ((s.home === a && s.away === b) || (s.home === b && s.away === a))) ? states.filter((s) => s.label === label) : states;
    for (const s of pool) {
      if (s.home === s.away) continue;
      const first = s.kind === 'partial';
      if (s.home === a && s.away === b) { subj.add(first ? 'home' : 'away'); kinds.add(s.kind); }
      if (s.home === b && s.away === a) { subj.add(first ? 'away' : 'home'); kinds.add(s.kind); }
    }
    return subj.size === 1 ? { side: [...subj][0], kind: kinds.size === 1 ? [...kinds][0] : null } : null;
  };
  const words = aliasWords(ctx);
  const quarterScores = new Set((brief.quarters || []).flatMap((q) => (typeof q.score_by_subject === 'string' ? [q.score_by_subject] : Object.values(q.score_by_subject)).flatMap((p) => [p, p.split(':').reverse().join(':')])));
  const recordPairs = recordPairSet(brief);
  const finalScores = finalOf(brief);
  for (const sentence of sentences(text)) {
    const pairs = [...sentence.matchAll(/(\d+):(\d+)/g)].filter((m) => m[1] !== m[2]);
    if (!pairs.length) continue;
    for (const m of pairs) {
      // the subject is the first team/player of the clause the score sits in ("X led 62:59, but Y led 100:95")
      const clause = clauseAt(sentence, m.index);
      const first = firstMention(clause.text, words) || firstMention(sentence, words);
      const before = sentence.slice(Math.max(0, m.index - 40), m.index);
      const a = Number(m[1]), b = Number(m[2]);
      // records are checked separately
      if (/מאזן\s*$/.test(before) || (/\(\s*$/.test(before) && recordPairs.has(m[0]))) continue;
      // the final score next to a result word is judged by that word (resultVerb), not by the subject
      if (isFinal(finalScores, a, b) && resultVerb(sentence, m.index)) continue;
      // a quarter (or overtime) the subject WON: Sport5 writes its (higher) score last
      // (only for pairs that ARE a period score — a final result in the same sentence keeps its own order)
      if (quarterScores.has(`${a}:${b}`) && /רבע|הארכה/.test(clause.text) && /(ניצח|ניצחה|ניצחו|גבר|גברה|גברו|לקח|לקחה|לקחו|הכריע|הכריעה)/.test(clause.text) && a > b) {
        out.push({ code: 'quarter-order', severity: 'block', msg: `"${sentence.slice(0, 80)}": בכתיב של ערוץ הספורט הנקודות של הקבוצה שניצחה ברבע באות אחרונות — ${b}:${a}`, fix: { type: 'replace', sentence, from: m[0], to: `${b}:${a}` } });
        continue;
      }
      if (!first) continue;
      const subj = subjectOf(a, b, sentence);
      if (subj && subj.side !== first.side) {
        out.push({ code: 'score-order', severity: 'block', msg: `"${sentence.slice(0, 80)}": המשפט על ${first.w}, אבל ${m[0]} כתוב מנקודת המבט של היריבה — צריך ${b}:${a}`, fix: { type: 'replace', sentence, from: m[0], to: `${b}:${a}` } });
        continue;
      }
      // the verb has to fit the numbers (skipped when the pair is ambiguous)
      if (!subj?.kind) continue;
      const [mine, theirs] = subj.kind === 'partial' ? [a, b] : [b, a];
      const near = before.split(/[,،]/).pop();
      if (/פיגר|בפיגור|נקלע.? לפיגור/.test(near) && mine > theirs) out.push({ code: 'verb-score', severity: 'block', msg: `"${sentence.slice(0, 80)}": כתוב פיגור, אבל ב-${m[0]} ${first.w} מובילה`, fix: { type: 'drop', sentence } });
      if (/הוביל|ביתרון|הובילו/.test(near) && mine < theirs) out.push({ code: 'verb-score', severity: 'block', msg: `"${sentence.slice(0, 80)}": כתוב יתרון, אבל ב-${m[0]} ${first.w} בפיגור`, fix: { type: 'drop', sentence } });
    }
  }
  return out;
}

// records: "(W:L)" right after a team name, "L:W" after "עלתה/ירדה למאזן"
function recordIssues(text, brief, ctx) {
  const out = [];
  const recs = brief.records || (brief.team_record ? { [brief.team_he]: brief.team_record } : {});
  const forms = Object.values(recs).map((r) => ({ paren: r.after_team_name.replace(/[()]/g, ''), verb: r.after_verb.match(/\d+:\d+/)?.[0] }));
  const known = (p) => forms.some((f) => f.paren === p || f.verb === p);
  for (const sentence of sentences(text)) {
    for (const m of sentence.matchAll(/(עלה|עלתה|עלו|ירד|ירדה|ירדו|שיפר|שיפרה|שיפרו)\s+(ל|את\s+)?(ה)?מאזן\s+(של\s+)?(\d+):(\d+)/g)) {
      const p = `${m[5]}:${m[6]}`;
      if (forms.some((f) => f.verb === p)) continue;
      const swapped = `${m[6]}:${m[5]}`;
      const fixable = forms.some((f) => f.verb === swapped);
      out.push({ code: 'record-relative', severity: 'block', msg: `"${m[0]}": אחרי "${m[1]} למאזן" כותבים הפסדים:ניצחונות${fixable ? ` — ${swapped}` : ''}`, fix: fixable ? { type: 'replace', sentence, from: m[0], to: m[0].replace(p, swapped) } : { type: 'drop', sentence } });
    }
    for (const m of sentence.matchAll(/\((\d+):(\d+)\)/g)) {
      const p = `${m[1]}:${m[2]}`;
      if (!known(p) && !known(`${m[2]}:${m[1]}`)) continue; // not a record
      const name = sentence.slice(Math.max(0, m.index - 25), m.index);
      const team = (ctx?.teams ? ['home', 'away'] : []).find((s) => ctx.teams[s].some((w) => name.includes(w)));
      if (forms.some((f) => f.paren === p)) continue;
      const swapped = `${m[2]}:${m[1]}`;
      if (forms.some((f) => f.paren === swapped)) out.push({ code: 'record-standalone', severity: 'block', msg: `"${name.trim()} (${p})": מאזן בסוגריים אחרי שם קבוצה הוא ניצחונות:הפסדים — (${swapped})${team ? '' : ''}`, fix: { type: 'replace', sentence, from: m[0], to: `(${swapped})` } });
    }
  }
  return out;
}

// draft: {headline?, deck?/subheadline?, lead?, paragraphs[]}
export function draftText(d) {
  return [d.headline, d.deck, d.subheadline, d.lead, ...(d.paragraphs || [])].filter(Boolean).join('\n');
}

export function verifyDraft(input, brief, names, ctx = null) {
  const draft = typeof input === 'string' ? { paragraphs: [input] } : input;
  const text = draftText(draft);
  const issues = [];
  const push = (code, severity, msg, fix = null) => issues.push({ code, severity, msg, fix });

  if (ctx) issues.push(...scoreIssues(text, brief, ctx));
  issues.push(...recordIssues(text, brief, ctx));
  // entity, narrative vs scoreboard, impossible basketball, runs, broken Hebrew, context, repetition
  issues.push(...narrativeChecks(draft, text, brief, ctx));

  const { numbers, pairs } = allowedFrom(brief);
  const finalScores = (brief.result_for_winner || brief.result_he || brief.game?.result_for_winner || '').match(/(\d+):(\d+)/)?.slice(1).map(Number) || null;
  for (const s of sentences(text)) {
    for (const n of new Set(s.replace(PAIR, ' ').match(NUM) || [])) if (!numbers.has(n)) push('number', 'block', `המספר ${n} לא מופיע בנתונים`, { type: 'drop', sentence: s });
    // (a record in the wrong order is already a record issue with its own fix)
    for (const p of new Set(s.match(PAIR) || [])) if (!pairs.has(p) && !issues.some((i) => i.fix?.to === p || i.fix?.to?.includes?.(p) || (/^record-/.test(i.code) && i.fix?.sentence === s))) push('pair', 'block', `התוצאה ${p} לא מופיעה בנתונים`, { type: 'drop', sentence: s });
    // the final result after "ניצחון"/"הפסד" keeps Sport5's form (subject last). Only the final score is
    // checked here: quarter, overtime and record pairs near those words have their own rules.
    for (const m of s.matchAll(/(\d+):(\d+)/g)) {
      const verb = resultVerb(s, m.index);
      if (!verb || !isFinal(finalScores, +m[1], +m[2])) continue;
      const [x, y] = [Number(m[1]), Number(m[2])];
      if ((verb === 'win' && x > y) || (verb === 'loss' && x < y)) push('result-order', 'block', `"${s.slice(Math.max(0, m.index - 25), m.index + m[0].length)}": ${verb === 'win' ? 'בניצחון המספר הגבוה' : 'בהפסד המספר הנמוך'} אחרון (${y}:${x})`, { type: 'replace', sentence: s, from: m[0], to: `${y}:${x}` });
    }
    for (const w of new Set(s.match(/[A-Za-z][A-Za-z.'-]+/g) || [])) if (!LATIN_OK.has(w)) push('latin', 'block', `מילה באנגלית: ${w}`, { type: 'drop', sentence: s });
    for (const w of new Set(s.match(/\S*[Ͱ-ϿЀ-ӿ؀-ۿ]\S*/g) || [])) push('foreign', 'block', `אותיות זרות במילה: ${w}`, { type: 'drop', sentence: s });
    for (const n of names.filter((x) => !x.inGame && x.he && x.he.includes(' '))) if (s.includes(n.he)) push('name', 'block', `השם ${n.he} לא שייך למשחק הזה`, { type: 'drop', sentence: s });
    for (const g of GATES) if (!brief.verified?.[g.flag] && g.re.test(s)) push(`unverified-${g.flag}`, 'block', `"${s.slice(0, 70)}": טענה (${g.flag}) שלא אומתה בנתונים`, { type: 'drop', sentence: s });
    if (LEAK.test(s)) push('leak', 'block', `טקסט פנימי דלף לטיוטה: "${s.slice(0, 60)}"`, { type: 'drop', sentence: s });
    for (const re of REDUNDANT) if (re.test(s)) push('redundant', 'style', `ניסוח כפול: "${s.match(re)[0]}" — כתוב פעם אחת ("ניצחון שני ברציפות")`);
    for (const [re, better] of BANNED) if (re.test(s)) push('banned', 'style', `ניסוח מתורגם: "${s.match(re)[0]}" — עדיף: ${better}`);
  }
  for (const bad of ['משחק מרתק', 'דרמה גדולה']) if (text.includes(bad) && !(brief.margin <= 3 || brief.overtimes)) push('hype', 'style', `ביטוי מוגזם למשחק לא צמוד: ${bad}`);

  // a paragraph cut in the middle (an ASCII " inside כ"א splits the model's JSON string)
  (draft.paragraphs || []).forEach((p, i) => {
    if (/^\s*[,;:.\-–]/.test(p) || (!/[.!?״"'׳)]\s*$/.test(p) && i < draft.paragraphs.length - 1)) push('broken', 'block', `פסקה ${i + 1} נקטעה באמצע: "${p.slice(-30)}"`, { type: 'join', index: /^\s*[,;:.\-–]/.test(p) ? i - 1 : i });
  });

  // every Israeli who played must be in the piece (one piece per game); missing -> his line is added
  for (const x of [...(brief.israelis_featured || []), ...(brief.other_israelis || [])]) {
    const sur = x.player_he.split(' ').slice(1).join(' ');
    if (!text.includes(x.player_he) && !(sur.length >= 3 && text.includes(sur))) push('israeli-missing', 'block', `${x.player_he} שיחק ולא מופיע בטקסט — ${x.sentence_he}`, { type: 'append', text: `${x.sentence_he}.` });
  }

  // the final score appears once: in the score line above a block, or in an article's headline
  const fsc = finalOf(brief);
  if (fsc && brief.final_score_in) {
    const re = new RegExp(`(^|\\s)(ב-|ל-|-)?(${fsc[0]}:${fsc[1]}|${fsc[1]}:${fsc[0]})(?=[\\s.,!?]|$)`);
    const after = brief.final_score_in === 'heading' ? [draft.headline, draft.deck, draft.subheadline, draft.lead, ...(draft.paragraphs || [])] : [draft.deck, draft.subheadline, draft.lead, ...(draft.paragraphs || [])];
    for (const s of after.filter(Boolean).flatMap((t) => sentences(t))) {
      const m = s.match(re);
      if (m) push('score-repeat', 'block', `"${s.slice(0, 70)}": התוצאה הסופית ${m[3]} כבר ${brief.final_score_in === 'heading' ? 'בשורת התוצאה' : 'בכותרת'} — לא חוזרים עליה`, { type: 'replace', sentence: s, from: m[0], to: m[1] ? ' ' : '' });
    }
  }

  // length: a standard block has at most 2 body paragraphs (3 only for a featured game)
  if (brief.max_paragraphs && (draft.paragraphs || []).length > brief.max_paragraphs) push('length', 'block', `${draft.paragraphs.length} פסקאות — המקסימום כאן ${brief.max_paragraphs}`, { type: 'trim', keep: brief.max_paragraphs });

  // the story stage's main angle has to lead: headline or sub-headline. If not, the verified angle written by
  // the code becomes the headline (structure, not style: a recap that leads with the wrong story is wrong)
  const tokens = brief.main_angle?.tokens || [];
  if (brief.kind === 'game' && draft.headline && tokens.length) {
    const top = [draft.headline, draft.deck, draft.subheadline].filter(Boolean).join(' ');
    if (!tokens.some((t) => top.includes(t))) push('angle', 'block', `הכותרת לא מובילה בזווית המרכזית (${brief.main_angle.fact_he})`, { type: 'headline', to: brief.main_angle.fact_he });
  }

  const toApprove = names.filter((x) => x.inGame && x.he && x.status !== 'approved' && x.status !== 'sport5' && (text.includes(x.he) || (x.surname && x.surname.length >= 3 && text.includes(x.surname)))).map((x) => `${x.he} (${x.en})`);
  const blocking = issues.filter((i) => i.severity === 'block');
  return { ok: blocking.length === 0, errors: issues.map((i) => i.msg), issues, blocking: blocking.length, toApprove };
}

// last resort after the model's rounds: apply code fixes, never invent text. Only the claim that failed
// goes (a swapped pair, a dropped sentence); the rest of the recap stays. A dropped headline is replaced
// by the code-written main angle, never by new prose.
export function autoFix(draft, issues, brief = null) {
  const d = JSON.parse(JSON.stringify(draft));
  const join = issues.find((x) => x.severity === 'block' && x.fix?.type === 'join' && x.fix.index >= 0);
  if (join && d.paragraphs?.[join.fix.index + 1] !== undefined) {
    const i = join.fix.index;
    d.paragraphs.splice(i, 2, `${d.paragraphs[i].replace(/["״]\s*$/, '״')}${/^\s*[,;:.]/.test(d.paragraphs[i + 1]) ? '' : ' '}${d.paragraphs[i + 1].trim()}`);
  }
  const fields = ['headline', 'deck', 'subheadline', 'lead'];
  const edit = (fn) => {
    for (const k of fields) if (typeof d[k] === 'string') d[k] = fn(d[k]);
    d.paragraphs = (d.paragraphs || []).map(fn).map((p) => p.replace(/\s{2,}/g, ' ').replace(/\s+([.,!?])/g, '$1').trim()).filter(Boolean);
    for (const k of fields) if (typeof d[k] === 'string') d[k] = d[k].replace(/\s{2,}/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();
  };
  for (const i of issues.filter((x) => x.severity === 'block' && x.fix)) {
    if (i.fix.type === 'replace') edit((t) => (t.includes(i.fix.sentence) ? t.replace(i.fix.sentence, i.fix.sentence.replace(i.fix.from, i.fix.to)) : t));
    else if (i.fix.type === 'drop') edit((t) => t.replace(i.fix.sentence, ''));
  }
  for (const a of issues.filter((x) => x.severity === 'block' && x.fix?.type === 'append')) {
    if (!d.paragraphs?.length) d.paragraphs = [a.fix.text];
    else d.paragraphs[0] = `${d.paragraphs[0].trim()} ${a.fix.text}`;
  }
  const head = issues.find((x) => x.severity === 'block' && x.fix?.type === 'headline');
  if (head) d.headline = head.fix.to;
  const trim = issues.find((x) => x.fix?.type === 'trim');
  if (trim) d.paragraphs = d.paragraphs.slice(0, trim.fix.keep);
  for (const k of fields) if (typeof d[k] === 'string') d[k] = d[k].replace(/^[\s,;]+/, '').trim();
  d.paragraphs = (d.paragraphs || []).map((p) => p.replace(/^[\s,;]+/, '').trim()).filter((p) => /[א-ת]/.test(p));
  if (!d.headline && brief?.main_angle?.fact_he) d.headline = brief.main_angle.fact_he;
  return d;
}
