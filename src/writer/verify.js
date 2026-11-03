// Checks a Hebrew draft against the brief it was written from. Code, not AI.
// Errors send the draft back to the model; what is left is shown to the editor.

const NUM = /\d+(?:\.\d+)?/g;
const PAIR = /\d+:\d+/g;
const LATIN_OK = new Set(['NBA', 'LA', 'MVP', 'TD', 'W']);

export function allowedFrom(brief) {
  const s = JSON.stringify(brief);
  return { numbers: new Set(s.match(NUM) || []), pairs: new Set(s.match(PAIR) || []) };
}

// Score order: Sport5 writes the subject's score last. For each X:Y in a sentence, find which team the
// sentence is about (its first team / player mention) and check the pair was written for that team.
function orientation(text, brief, ctx) {
  const errors = [];
  const states = brief.states || [];
  const sideOf = (a, b) => {
    const m = states.filter((s) => (s.home === a && s.away === b) || (s.home === b && s.away === a));
    if (!m.length) return null;
    const subj = new Set(m.map((s) => (s.home === b ? 'home' : 'away'))); // the last number is the subject's
    return subj.size === 1 ? [...subj][0] : null; // both orders happened in the game: cannot tell
  };
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
  for (const sentence of text.split(/(?<=[.!?\n])/)) {
    const pairs = [...sentence.matchAll(/(\d+):(\d+)/g)].filter((m) => m[1] !== m[2]);
    if (!pairs.length) continue;
    let first = null;
    for (const { w, side } of words) {
      const i = sentence.indexOf(w);
      if (i >= 0 && (!first || i < first.i)) first = { i, side, w };
    }
    if (!first) continue;
    for (const m of pairs) {
      const subj = sideOf(Number(m[1]), Number(m[2]));
      const before = sentence.slice(Math.max(0, m.index - 40), m.index);
      if (subj && subj !== first.side && !/ריצת\s*$/.test(before)) {
        errors.push(`"${sentence.trim().slice(0, 80)}": המשפט על ${first.w}, אבל ${m[0]} כתוב מנקודת המבט של היריבה — צריך ${m[2]}:${m[1]}`);
        continue;
      }
      // the verb has to fit the numbers: the subject's score is the last one
      const mine = Number(m[2]), theirs = Number(m[1]);
      const near = before.split(/[,،]/).pop();
      if (/פיגר|בפיגור|נקלע.? לפיגור/.test(near) && mine > theirs) errors.push(`"${sentence.trim().slice(0, 80)}": כתוב פיגור, אבל ב-${m[0]} ${first.w} דווקא מובילה`);
      if (/הוביל|ביתרון|הובילו/.test(near) && mine < theirs) errors.push(`"${sentence.trim().slice(0, 80)}": כתוב יתרון, אבל ב-${m[0]} ${first.w} בפיגור`);
    }
  }
  return errors;
}

// names: [{he, inGame, status}] — every dictionary name, flagged if the player is in this game
// ctx: {teams: {home: [aliases], away: [aliases]}, players: [{he, surname, side}], winner, loser}
export function verifyDraft(text, brief, names, ctx = null) {
  const errors = [];
  if (ctx) errors.push(...orientation(text, brief, ctx));
  const { numbers, pairs } = allowedFrom(brief);
  const withoutPairs = text.replace(PAIR, ' ');
  for (const n of new Set(withoutPairs.match(NUM) || [])) if (!numbers.has(n)) errors.push(`המספר ${n} לא מופיע בנתונים`);
  for (const p of new Set(text.match(PAIR) || [])) if (!pairs.has(p)) errors.push(`התוצאה ${p} לא מופיעה בנתונים (או בסדר הפוך)`);
  for (const m of text.matchAll(/(ניצחון|ניצחה|ניצחו|גברה|גברו)[^.\n:]{0,25}?(\d+):(\d+)/g)) if (Number(m[2]) > Number(m[3])) errors.push(`"${m[0]}": בניצחון המספר הגבוה צריך להיות אחרון (${m[3]}:${m[2]})`);
  for (const m of text.matchAll(/(הפסד|הפסידה|הפסידו|נכנעה|נכנעו)[^.\n:]{0,25}?(\d+):(\d+)/g)) if (Number(m[2]) < Number(m[3])) errors.push(`"${m[0]}": בהפסד המספר הנמוך צריך להיות אחרון (${m[3]}:${m[2]})`);
  for (const w of new Set(text.match(/[A-Za-z][A-Za-z.'-]+/g) || [])) if (!LATIN_OK.has(w)) errors.push(`מילה באנגלית: ${w}`);
  // weaker models sometimes slip in Greek / Cyrillic / Arabic letters mid-word
  for (const w of new Set(text.match(/\S*[Ͱ-ϿЀ-ӿ؀-ۿ]\S*/g) || [])) errors.push(`אותיות זרות במילה: ${w}`);
  for (const n of names.filter((x) => !x.inGame && x.he && x.he.includes(' '))) if (text.includes(n.he)) errors.push(`השם ${n.he} לא שייך למשחק הזה`);
  for (const bad of ['משחק מרתק', 'דרמה גדולה']) if (text.includes(bad) && !(brief.margin <= 3 || brief.overtimes)) errors.push(`ביטוי מוגזם למשחק לא צמוד: ${bad}`);
  const toApprove = names.filter((x) => x.inGame && x.he && x.status !== 'approved' && x.status !== 'sport5' && (text.includes(x.he) || (x.surname && x.surname.length >= 3 && text.includes(x.surname)))).map((x) => `${x.he} (${x.en})`);
  return { ok: errors.length === 0, errors, toApprove };
}
