// One game at a time: ESPN summary -> facts -> Hebrew drafts -> files, and the night's closing page
// rebuilt from whatever games are done so far. Used by scripts/tick.js (live) and scripts/write.js (backfill).
//
// FACTS FIRST -> STORY SELECTION -> NATURAL HEBREW -> VALIDATION -> PUBLICATION
//   1-4  parse, names, game facts, play-by-play facts (runs, checkpoints)   facts.js, color.js, game.js
//   5    verified external context (streaks, head-to-head, highs)          context.js
//   6-7  candidate angles, ranked                                          story.js
//   8    Hebrew from structured facts only                                 writer/brief.js, prompt.js
//   9    deterministic factual validation, code fixes                      writer/verify.js, narrative.js
//   10   language-only proofreading                                        proofread() below
//   11   facts re-checked after the language edit                          factPrint() + verifyDraft
//   12   publish (held only if a contradiction or nothing usable is left)  notify.js, scripts/tick.js

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSummary, getTeamSchedule } from './espn.js';
import { playerHistory } from './gamelog.js';
import { analyzeGame } from './game.js';
import { gameBrief, playerBrief, FEATURED } from './writer/brief.js';
import { buildPrompt, proofPrompt, schemaFor } from './writer/prompt.js';
import { generateJSON } from './writer/gemini.js';
import { verifyDraft, autoFix, draftText } from './writer/verify.js';
import { fetchContext } from './context.js';
import { nightHe } from './writer/he.js';
import { NICK_HE } from './teams.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

export function loadConfig() {
  const envFile = join(ROOT, '.env');
  const env = { ...process.env };
  if (existsSync(envFile)) {
    for (const l of readFileSync(envFile, 'utf8').split('\n')) if (l.includes('=') && !env[l.slice(0, l.indexOf('=')).trim()]) env[l.slice(0, l.indexOf('=')).trim()] = l.slice(l.indexOf('=') + 1).trim();
  }
  return {
    env,
    pageUrl: env.PAGE_URL || null,
    ai: { key: env.GEMINI_API_KEY, model: env.AI_MODEL || 'gemini-flash-latest', fallback: env.AI_MODEL_FALLBACK },
    proofread: env.AI_PROOFREAD !== '0', // the language-only pass (one more model call per item)
    israelis: readJson(join(ROOT, 'config', 'israelis.json')).players,
    dict: readJson(join(ROOT, 'config', 'names.he.json')).players,
  };
}

export const dayDir = (date) => join(ROOT, 'out', date);

// ---------- facts for one game ----------

export async function factsForGame(date, gameId, cfg) {
  const dir = dayDir(date);
  mkdirSync(join(dir, 'raw'), { recursive: true });
  const s = await getSummary(gameId);
  writeFileSync(join(dir, 'raw', `${gameId}.json`), JSON.stringify(s));
  const abbrs = s.header.competitions[0].competitors.map((c) => c.team.abbreviation);
  const histories = new Map(), schedules = new Map();
  for (const p of cfg.israelis.filter((x) => abbrs.includes(x.team))) {
    try { histories.set(p.id, await playerHistory(p.id, join(ROOT, 'cache', 'gamelog'))); } catch { /* track still works without history */ }
    if (!schedules.has(p.team)) try { schedules.set(p.team, await getTeamSchedule(p.team)); } catch { /* no next game */ }
  }
  const names = new Map(cfg.dict.map((p) => [p.id, p]));
  // CONTEXT FACTS (streaks, head-to-head, highs) from schedules and game logs; a failed fetch = no such fact
  let context = {};
  try { context = await fetchContext(s, { cacheDir: join(ROOT, 'cache') }); } catch (e) { context = { errors: [e.message] }; }
  const f = analyzeGame(s, { israelis: cfg.israelis, histories, schedules, names, context });
  f.contextErrors = context.errors || [];
  f.endedAt = s.plays?.at(-1)?.wallclock || null;
  writeFileSync(join(dir, `${gameId}.json`), JSON.stringify(f, null, 2));
  return f;
}

// what an ESPN stat correction would change
export function boxHash(f) {
  return JSON.stringify([f.teams.home.score, f.teams.away.score, ...['home', 'away'].flatMap((s) => f.players[s].map((p) => [p.id, p.pts, p.reb, p.ast, p.min]))]);
}

// ---------- Hebrew drafts for one game ----------

function ctxFor(f) {
  const alias = (t) => [t.he, t.heShort, ...(NICK_HE[t.abbr] || [])].filter(Boolean);
  return {
    teams: { home: alias(f.teams.home), away: alias(f.teams.away) },
    players: ['home', 'away'].flatMap((side) => f.players[side].filter((p) => p.he).map((p) => ({ he: p.he, surname: p.he.split(' ').slice(1).join(' '), side }))),
    winner: f.result.winner,
    loser: f.result.loser,
  };
}

async function writeItem(cfg, mode, brief, f) {
  const inGame = new Set(['home', 'away'].flatMap((s) => f.players[s].map((p) => p.id)));
  const names = cfg.dict.map((d) => ({ ...d, inGame: inGame.has(d.id), status: d.approved ? 'approved' : d.status }));
  const ctx = ctxFor(f);
  const { system, user } = buildPrompt(ROOT, mode, brief);
  const messages = [{ role: 'user', text: user }];
  let last;
  for (let round = 1; round <= 3; round++) {
    const res = await generateJSON({ ...cfg.ai, system, messages, schema: schemaFor(mode) });
    const check = verifyDraft(res.data, brief, names, ctx);
    last = { mode, gameId: f.gameId, model: res.model, rounds: round, draft: res.data, check, writtenAt: new Date().toISOString() };
    if (!check.issues.length) break;
    if (round < 3) messages.push({ role: 'model', text: res.text }, { role: 'user', text: `הטיוטה לא עברה את הבדיקה. תקן רק את אלה והחזר את כל ה-JSON מחדש:\n- ${check.errors.join('\n- ')}` });
  }
  // still contradicting the data after the model's rounds: fix in code — only the failing claim goes
  // (swap a pair, drop that sentence, rejoin a split paragraph, trim), then check again
  last.autoFixed = [];
  for (let pass = 0; pass < 3 && !last.check.ok; pass++) {
    last.autoFixed.push(...last.check.issues.filter((i) => i.severity === 'block').map((i) => i.msg));
    last.draft = autoFix(last.draft, last.check.issues, brief);
    last.check = verifyDraft(last.draft, brief, names, ctx);
  }
  // held only when a contradiction is left, or nothing usable is left after removing the bad claims
  last.held = !last.check.ok || !last.draft.headline || !(last.draft.paragraphs || []).length;
  // language-only proofreading; thrown away if it touches any fact
  if (!last.held && cfg.proofread) {
    try {
      const p = await proofread(cfg, mode, last.draft, brief, names, ctx);
      last.proofread = p.note;
      if (p.applied) { last.draft = p.draft; last.check = p.check; }
    } catch (e) { last.proofread = `לא רץ: ${e.message.slice(0, 80)}`; }
  }
  return last;
}

// the facts of a draft, for comparing before / after language editing: every number and score, every name
function factPrint(draft, names) {
  const t = draftText(draft);
  return JSON.stringify([(t.match(/\d+(?::\d+)?/g) || []).sort(), names.filter((n) => n.he && t.includes(n.he)).map((n) => n.he).sort()]);
}

async function proofread(cfg, mode, draft, brief, names, ctx) {
  const { system, user } = proofPrompt(mode, draft);
  const res = await generateJSON({ ...cfg.ai, system, messages: [{ role: 'user', text: user }], schema: schemaFor(mode), temperature: 0.2 });
  const d = res.data;
  if (factPrint(d, names) !== factPrint(draft, names)) return { applied: false, note: 'ההגהה שינתה מספר / תוצאה / שם — נזרקה' };
  if ((d.paragraphs || []).length > (draft.paragraphs || []).length) return { applied: false, note: 'ההגהה הוסיפה פסקה — נזרקה' };
  const check = verifyDraft(d, brief, names, ctx);
  if (!check.ok) return { applied: false, note: 'ההגהה יצרה סתירה — נזרקה' };
  return { applied: true, draft: d, check, note: `הוגה (${res.model})` };
}

// editor-only notes (the page shows them beside the draft; they are never part of the copyable text)
const checkBox = (it) => {
  const o = ['', '> **לעורך (לא להעתקה):**'];
  const issues = it.check.issues || []; // drafts written before the validation layer have no issue list
  if (it.held) o.push(`> ⛔ לא פורסם — סתירה לנתונים שלא תוקנה: ${issues.filter((i) => i.severity === 'block').map((i) => i.msg).join('; ')}`);
  else if (it.check.issues) o.push('> נבדקו מול ESPN: תוצאה, רבעים, מאזנים, מספרים, סדר תוצאות, שמות, מי עשה מה (שחקן/קבוצה), מהלך המשחק מול התוצאה במחצית ובסיום הרבעים, שוויון/יתרון/סל ניצחון/באזר, ריצות, שיאים/רצפים (רק אם אומתו), עברית שבורה, אורך');
  if (it.autoFixed?.length) o.push(`> 🔧 תוקן אוטומטית: ${it.autoFixed.join('; ')}`);
  if (it.proofread) o.push(`> 🔤 הגהה: ${it.proofread}`);
  const style = issues.filter((i) => i.severity === 'style');
  if (style.length) o.push(`> ✍️ ניסוח לבדיקה: ${style.map((i) => i.msg).join('; ')}`);
  if (it.angle) o.push(`> 🎯 זווית: ${it.angle.fact_he}`);
  if (it.corrected) o.push('> 🔁 נכתב מחדש אחרי תיקון סטטיסטיקה של ESPN');
  if (it.check.toApprove.length) o.push(`> ✏️ שמות שעוד לא אושרו: ${it.check.toApprove.join(', ')}`);
  if (it.leads?.namesMissing?.length) o.push(`> ❓ שחקנים בלי שם בעברית: ${it.leads.namesMissing.join(', ')}`);
  if (it.leads?.unverified?.length) o.push(`> 🔎 לא אומת ולכן לא נכתב: ${it.leads.unverified.join(' · ')}`);
  if (it.leads?.highlights?.length) o.push(`> 🎬 קטעי וידאו של ESPN (כיוון לצבע): ${it.leads.highlights.join(' · ')}`);
  return o.join('\n');
};

// every item of one game -> out/<date>/drafts/items/<gameId>.json (+ .md for stand-alone pieces)
export async function draftsForGame(date, f, cfg, { corrected = false, log = () => {} } = {}) {
  const dd = join(dayDir(date), 'drafts');
  mkdirSync(join(dd, 'items'), { recursive: true });
  const items = [];
  const gb = gameBrief(f);
  const weight = f.candidates[0]?.weight || 0;
  const base = { heading: gb.heading, end: f.endedAt || f.date, weight, angle: gb.main_angle, corrected, leads: { highlights: f.color?.highlights || [], unverified: f.research, namesMissing: f.namesMissing } };
  // Israelis who actually played (box score minutes); one who did not play changes nothing: normal recap
  const tracks = (f.tracks || []).filter((t) => t.inGame && t.played && t.ok);
  // ONE piece per game (editor, 2026-11-03/04): when a full-track Israeli (Avdija, Sharp) played, his article IS the game's
  // piece; a big game gets its stand-alone article INSTEAD of the short block. The nightly page then shows
  // that piece's opening. Both are written only when the main piece is held (no other choice).
  let main = null;
  const full = tracks.find((t) => t.player.track === 'full');
  if (full) {
    main = await writeItem(cfg, 'player', { ...playerBrief(f, full), max_paragraphs: 3, final_score_in: 'headline' }, f);
    Object.assign(main, { player: full.player, corrected });
    log(`  player ${full.player.name} ${main.held ? 'HELD' : 'ok'} (${main.rounds} rounds, ${main.model})`);
  } else if (weight >= FEATURED) {
    main = await writeItem(cfg, 'article', { ...gb, max_paragraphs: 3, final_score_in: 'headline' }, f);
    Object.assign(main, { heading: gb.heading, corrected });
    log(`  big-game article ${main.held ? 'HELD' : 'ok'} (${main.rounds} rounds, ${main.model})`);
  }
  if (main) items.push(main);
  if (main && !main.held) {
    // the nightly page's block for this game = the article's headline, sub-headline and first paragraph;
    // not sent to Telegram on its own (the article already was)
    const d = main.draft;
    items.push({ ...base, mode: 'game', gameId: f.gameId, model: main.model, rounds: 0, check: main.check, held: false, noSend: true, from: main.mode,
      draft: { headline: d.headline, deck: d.subheadline || d.deck || '', paragraphs: (d.paragraphs || []).slice(0, 1) }, writtenAt: main.writtenAt });
    log('  block = opening of the article (not sent separately)');
  } else {
    const game = await writeItem(cfg, 'game', gb, f);
    Object.assign(game, base);
    items.push(game);
    log(`  block ${game.held ? 'HELD' : game.autoFixed?.length ? 'ok (auto-fixed)' : 'ok'} (${game.rounds} rounds, ${game.model})`);
  }
  // Wolf / Saraf (short track) have no piece of their own: the game's one piece includes them
  // (brief.israelis_featured / other_israelis; the validator adds a missing one's line)
  writeFileSync(join(dd, 'items', `${f.gameId}.json`), JSON.stringify(items, null, 1));
  for (const it of items.filter((x) => x.mode !== 'game' && x.draft)) {
    const name = it.player ? `${it.mode}-${it.player.name.replace(/\W+/g, '-')}-${it.gameId}` : `article-${it.gameId}`;
    const body = [`{#g${it.gameId}}`, `# ${it.draft.headline}`, it.draft.subheadline ? `\n**${it.draft.subheadline}**` : '', '', ...it.draft.paragraphs.flatMap((p) => [p, '']), checkBox(it)];
    writeFileSync(join(dd, `${name}.md`), body.join('\n') + '\n');
  }
  return items;
}

// ---------- the night's closing page, from the games done so far ----------

export function assembleClosing(date, { pending = [] } = {}) {
  const dir = dayDir(date);
  const dd = join(dir, 'drafts');
  const itemsDir = join(dd, 'items');
  if (!existsSync(itemsDir)) return null;
  const blocks = readdirSync(itemsDir).filter((x) => x.endsWith('.json')).flatMap((x) => readJson(join(itemsDir, x))).filter((x) => x.mode === 'game' && x.draft)
    .sort((a, b) => String(b.end).localeCompare(String(a.end))); // newest game first, like Sport5's live page
  const facts = blocks.map((b) => readJson(join(dir, `${b.gameId}.json`)));
  const night = facts[0] ? nightHe(facts[0].date) : '';
  const total = blocks.length + pending.length;
  const o = ['# סגירת הלילה ב-NBA — טיוטה', ''];
  o.push(pending.length
    ? `_עודכן ${new Date().toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' })} · ${blocks.length} מתוך ${total} משחקים הסתיימו · בהמשך: ${pending.join(', ')}_`
    : `_כל ${total} המשחקים הסתיימו_`, '');
  o.push(`בוקר טוב לכל גולשי אתר ערוץ הספורט! ${total} משחקי NBA שוחקו הלילה (${night}), וכאן תוכלו למצוא את כל מה שפספסתם.`, '', 'כל התוצאות:');
  for (const f of [...facts].sort((a, b) => String(b.endedAt).localeCompare(String(a.endedAt)))) o.push(`${f.teams.home.heShort} - ${f.teams.away.heShort} ${f.teams.away.score}:${f.teams.home.score}`);
  for (const g of blocks) {
    const when = new Date(g.end).toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });
    const d = g.draft;
    // a held draft (known contradiction) is shown to the editor as such, never as copy
    const body = g.held ? ['⛔ הטיוטה לא פורסמה — ראו הערות לעורך'] : [...(d.headline ? [`**${d.headline}**`, ''] : []), ...(d.deck ? [d.deck, ''] : []), ...(d.lead ? [d.lead] : []), ...d.paragraphs.flatMap((p, i) => (i ? ['', p] : [p]))];
    const from = g.from === 'player' ? ['', '_(פתיחת הכתבה על השחקן הישראלי — הכתבה המלאה בנפרד)_'] : g.from === 'article' ? ['', '_(פתיחת הכתבה על המשחק — הכתבה המלאה בנפרד)_'] : [];
    o.push('', '---', '', `{#g${g.gameId}}`, `_${when}_`, '', `**${g.heading}**`, ...body, ...from, checkBox(g));
  }
  writeFileSync(join(dd, 'closing.md'), o.join('\n') + '\n');
  return join(dd, 'closing.md');
}
