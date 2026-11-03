// Builds the Hebrew player-name dictionary draft.
//   node scripts/names.js
// In:  names/roster_list.json (ESPN rosters), names/draft_he.tsv (my draft spellings),
//      Sport5 texts in style/nights, style/avdija, names/articles, and out/<date>/*.json box scores.
// Out: config/names.he.json (the dictionary) and names/REVIEW.md (what needs a human look).
//
// Status per player:
//   sport5   — the exact spelling appears in Sport5 texts
//   aligned  — Sport5 used a different spelling for this player, found by matching a nightly
//              roundup paragraph against the box score of the same game (spelling taken from Sport5)
//   draft    — my spelling, not seen in Sport5 yet: needs approval

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const roster = JSON.parse(read('names/roster_list.json'));
const draft = new Map(read('names/draft_he.tsv').split('\n').filter(Boolean).map((l) => l.split('\t')).map(([en, he]) => [en.trim(), he.trim()]));

// ---------- text normalisation ----------
const norm = (s) => s.replace(/[׳’`]/g, "'").replace(/[״“”]/g, '"').replace(/[֑-ׇ]/g, '').replace(/ /g, ' ');
const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const skel = (s) => norm(s).replace(/[ךםןףץ]/g, (c) => FINALS[c]).replace(/['"\-\s]/g, '');

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const sim = (a, b) => { const x = skel(a), y = skel(b); return 1 - lev(x, y) / Math.max(x.length, y.length, 1); };

// ---------- corpus ----------
const docs = [];
for (const dir of ['style/nights', 'style/avdija', 'names/articles']) {
  if (!existsSync(join(ROOT, dir))) continue;
  for (const f of readdirSync(join(ROOT, dir)).filter((x) => x.endsWith('.txt'))) docs.push({ name: `${dir}/${f}`, text: norm(read(`${dir}/${f}`)) });
}
const corpus = docs.map((d) => d.text).join('\n');
const count = (needle) => (needle ? corpus.split(needle).length - 1 : 0);

// ---------- nightly roundup blocks aligned with box scores ----------
const TEAM_HE = {
  ATL: ['אטלנטה'], BOS: ['בוסטון'], BKN: ['ברוקלין'], CHA: ['שארלוט'], CHI: ['שיקגו'], CLE: ['קליבלנד'], DAL: ['דאלאס'], DEN: ['דנבר'],
  DET: ['דטרויט'], GS: ['גולדן סטייט'], HOU: ['יוסטון'], IND: ['אינדיאנה'], LAC: ['קליפרס'], LAL: ['לייקרס'], MEM: ['ממפיס'], MIA: ['מיאמי'],
  MIL: ['מילווקי'], MIN: ['מינסוטה'], NO: ['ניו אורלינס'], NY: ['ניקס', 'ניו יורק'], OKC: ['אוקלהומה'], ORL: ['אורלנדו'], PHI: ['פילדלפיה'],
  PHX: ['פיניקס'], POR: ['פורטלנד'], SAC: ['סקרמנטו'], SA: ['סן אנטוניו'], TOR: ['טורונטו'], UTAH: ['יוטה'], WSH: ['וושינגטון'],
};
const teamsIn = (s) => Object.entries(TEAM_HE).filter(([, ns]) => ns.some((n) => s.includes(n))).map(([a]) => a);

const games = new Map(); // "YYYYMMDD|A|B" -> facts
for (const d of readdirSync(join(ROOT, 'out')).filter((x) => /^\d{8}$/.test(x))) {
  for (const f of readdirSync(join(ROOT, 'out', d)).filter((x) => /^\d+\.json$/.test(x))) {
    const g = JSON.parse(read(`out/${d}/${f}`));
    games.set(`${d}|${[g.teams.home.abbr, g.teams.away.abbr].sort().join('|')}`, g);
  }
}

const aligned = new Map(); // espn id -> [{he, sim, doc}]
const seenInGame = new Map(); // espn id -> count of blocks where the draft appears
let blocksMatched = 0, blocksTotal = 0;
for (const doc of docs.filter((d) => d.name.startsWith('style/nights'))) {
  const parts = doc.text.split(/\n(\d{2})\.(\d{2})\.(\d{2}) - \d{2}:\d{2}\n/);
  for (let i = 1; i + 3 < parts.length + 1; i += 4) {
    const [dd, mm, yy, body] = [parts[i], parts[i + 1], parts[i + 2], parts[i + 3] || ''];
    const header = body.split('\n').find((l) => l.trim()) || '';
    const tm = teamsIn(header.split(/\s\d+:\d+\s*$/)[0]);
    if (tm.length !== 2) continue;
    blocksTotal++;
    const il = new Date(Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd)));
    const us = new Date(il.getTime() - 86400e3).toISOString().slice(0, 10).replaceAll('-', '');
    const g = games.get(`${us}|${tm.sort().join('|')}`);
    if (!g) continue;
    blocksMatched++;
    const tokens = body.split(/[^א-ת'"\-]+/).filter(Boolean);
    const grams = new Set();
    for (let k = 0; k < tokens.length; k++) {
      for (const n of [1, 2, 3]) {
        const w = tokens.slice(k, k + n);
        if (w.length < n) continue;
        grams.add(w.join(' '));
        if (/^[ולבשהמכ]/.test(w[0]) && w[0].length > 2) grams.add([w[0].slice(1), ...w.slice(1)].join(' ')); // ו/ל/ב… prefix
      }
    }
    for (const side of ['home', 'away']) {
      for (const p of g.players[side].filter((x) => x.played && x.pts >= 6)) {
        const he = draft.get(p.name);
        if (he && body.includes(he)) { seenInGame.set(p.id, (seenInGame.get(p.id) || 0) + 1); continue; }
        if (!he) continue;
        const words = he.split(' ').length;
        let best = null;
        for (const gr of grams) {
          if (gr.split(' ').length !== words) continue;
          const s = sim(gr, he);
          if (!best || s > best.sim) best = { he: gr, sim: s };
        }
        if (best && best.sim >= 0.72 && best.he !== he) {
          const list = aligned.get(p.id) || [];
          list.push({ ...best, doc: doc.name });
          aligned.set(p.id, list);
        }
      }
    }
  }
}

// ---------- build ----------
const out = [];
const seen = new Set();
for (const r of roster) {
  if (seen.has(r.id)) continue;
  seen.add(r.id);
  const he = draft.get(r.en) || null;
  const exact = he ? count(he) : 0;
  const al = aligned.get(r.id) || [];
  const votes = {};
  for (const a of al) votes[a.he] = (votes[a.he] || 0) + 1;
  const [topAligned] = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  const alignedCount = topAligned ? count(topAligned[0]) : 0;
  let status = 'draft', spelling = he, evidence = null;
  if (topAligned && alignedCount > exact) { status = 'aligned'; spelling = topAligned[0]; evidence = { sport5: alignedCount, draft: he, draftHits: exact, sim: Math.round(Math.max(...al.filter((a) => a.he === topAligned[0]).map((a) => a.sim)) * 100) / 100 }; }
  else if (exact > 0) { status = 'sport5'; evidence = { sport5: exact }; }
  const surname = spelling ? spelling.split(' ').slice(1).join(' ') : null;
  out.push({ id: r.id, en: r.en, he: spelling, status, team: r.team, pos: r.pos, surname, evidence, approved: false });
}

writeFileSync(join(ROOT, 'config', 'names.he.json'), JSON.stringify({ _comment: 'ESPN id -> Hebrew name. status: sport5 (seen in Sport5 texts) / aligned (Sport5 spelling found by matching a roundup to its box score) / draft (needs approval). approved: set true after a human check.', builtAt: new Date().toISOString(), players: out }, null, 1));

const by = (s) => out.filter((x) => x.status === s);
const md = [];
md.push('# מילון שמות — טיוטה לאישור', '');
md.push(`- ${out.length} שחקנים בסגלים (ESPN, ${new Date().toISOString().slice(0, 10)})`);
md.push(`- ✅ נמצא כמו שהוא בטקסטים של ערוץ הספורט: **${by('sport5').length}**`);
md.push(`- 🔄 ערוץ הספורט כתב אחרת מהטיוטה שלי (הוחלף לכתיב של ערוץ הספורט): **${by('aligned').length}**`);
md.push(`- ✏️ טיוטה שלי, עוד לא נמצא אצל ערוץ הספורט: **${by('draft').length}**`);
md.push(`- התאמה לפי משחק: ${blocksMatched}/${blocksTotal} פסקאות משחק בסגירות הלילה הותאמו לבוקס סקור`, '');
md.push('## 🔄 כתיב שונה אצל ערוץ הספורט (לבדוק קודם)', '', '| שחקן | ערוץ הספורט | הטיוטה שלי | מופעים |', '|---|---|---|---|');
for (const x of by('aligned')) md.push(`| ${x.en} (${x.team}) | **${x.he}**${x.evidence.sport5 === 1 ? ' ⚠️ הופעה אחת — אולי טעות הקלדה' : ''} | ${x.evidence.draft} | ${x.evidence.sport5} מול ${x.evidence.draftHits} |`);
md.push('', '## ✏️ טיוטה לאישור, לפי קבוצה', '');
const teams = [...new Set(out.map((x) => x.team))];
for (const t of teams) {
  const list = out.filter((x) => x.team === t && x.status === 'draft');
  if (list.length) md.push(`**${t}:** ${list.map((x) => `${x.en} = ${x.he || '❓'}`).join(' · ')}`, '');
}
md.push('## ✅ נמצא אצל ערוץ הספורט', '');
for (const t of teams) {
  const list = out.filter((x) => x.team === t && x.status === 'sport5');
  if (list.length) md.push(`**${t}:** ${list.map((x) => `${x.he} (${x.evidence.sport5})`).join(' · ')}`, '');
}
writeFileSync(join(ROOT, 'names', 'REVIEW.md'), md.join('\n') + '\n');
console.log(`players ${out.length}: sport5 ${by('sport5').length}, aligned ${by('aligned').length}, draft ${by('draft').length}; roundup blocks matched ${blocksMatched}/${blocksTotal}; corpus ${docs.length} docs`);
