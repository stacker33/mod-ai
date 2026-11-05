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
import { buildPrompt, proofPrompt, introPrompt, schemaFor } from './writer/prompt.js';
import { generateJSON } from './writer/gemini.js';
import { verifyDraft, autoFix, draftText } from './writer/verify.js';
import { fetchContext } from './context.js';
import { nightHe } from './writer/he.js';
import { NICK_HE, heTeam } from './teams.js';

// a team in Sport5's results list: the short name, nicknames without the article ("קליפרס - מיאמי")
const listName = (t) => (heTeam(t.abbr) || t.heShort || t.he).replace(/^ה(?=קליפרס|לייקרס|ניקס)/, '');

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
  // the table as it was before tonight's first tip-off (saved by the live runner), if there is one
  const beforeFile = join(dayDir(date), 'standings-before.json');
  if (existsSync(beforeFile)) context.standingsBefore = readJson(beforeFile).table;
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

const MAX_ROUNDS = 2;

// ---------- the night's model budget (free tier: 20 calls a day per model, reset at midnight Pacific) ----------
const USAGE_FILE = join(ROOT, 'out', 'model-usage.json');
const pacificDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
function usage() {
  try { const u = readJson(USAGE_FILE); if (u.day === pacificDay()) return u; } catch { /* new day */ }
  return { day: pacificDay(), calls: {} };
}
function countCall(model) {
  const u = usage();
  u.calls[model] = (u.calls[model] || 0) + 1;
  mkdirSync(join(ROOT, 'out'), { recursive: true });
  writeFileSync(USAGE_FILE, JSON.stringify(u));
}
// calls left on the good models (everything but the "lite" fallback) today
function goodCallsLeft(cfg) {
  const models = [cfg.ai.model, ...String(cfg.ai.fallback || '').split(',')].map((x) => x && x.trim()).filter((m) => m && !/lite/.test(m));
  const u = usage();
  return models.reduce((a, m) => a + Math.max(0, 20 - (u.calls[m] || 0)), 0);
}

// When no model is left for the day, the recap is still sent right away: written in code from the brief's
// verified strings only (a plain, correct text the editor can polish) — never a wait until the morning.
export function templateDraft(mode, b) {
  const lines = (list) => list.map((p, i) => `${p.name_he} ${i ? 'הוסיף' : 'סיים עם'} ${p.line_he}`).join(', ו');
  if (mode === 'game') {
    const [W, L] = [b.winner_he, b.loser_he];
    const p1 = [`${b.main_angle?.fact_he || `${W} ניצחה את ${L}`}.`, b.stars?.[W]?.length ? `${lines(b.stars[W].slice(0, 2))}.` : ''].filter(Boolean).join(' ');
    const p2 = [b.details?.[0] ? `${b.details[0]}.` : '', b.records?.[L]?.sentence_he ? `${b.records[L].sentence_he}${b.stars?.[L]?.length ? `, ו${lines(b.stars[L].slice(0, 1))}` : ''}.` : ''].filter(Boolean).join(' ');
    return { paragraphs: [p1, p2].filter(Boolean) };
  }
  // an Israeli article
  const headline = `${b.player_he} ב${b.result_he} ${b.won ? 'על' : 'ל'}${b.opp_he}`;
  const p1 = `${b.player_he} סיים עם ${b.line_full_he}.${b.team_record?.after_verb ? ` ${b.team_he} ${b.team_record.after_verb}.` : ''}`;
  const others = (b.other_israelis || []).map((x) => `${x.sentence_he}.`).join(' ');
  return { headline, subheadline: b.line_short_he ? `${b.player_he} ${b.line_short_he}` : b.team_he, paragraphs: [p1, others].filter(Boolean) };
}

export async function writeItem(cfg, mode, brief, f) {
  const inGame = new Set(['home', 'away'].flatMap((s) => f.players[s].map((p) => p.id)));
  const names = cfg.dict.map((d) => ({ ...d, inGame: inGame.has(d.id), status: d.approved ? 'approved' : d.status }));
  const ctx = ctxFor(f);
  const { system, user } = buildPrompt(ROOT, mode, brief);
  const messages = [{ role: 'user', text: user }];
  let last;
  // budget: when the good models are almost out, a routine game gets one round (Israeli articles and
  // stand-out games keep two) so the night's quota reaches the last game
  const routine = mode === 'game' && (f.candidates?.[0]?.weight || 0) < 70;
  const rounds = routine && goodCallsLeft(cfg) < 25 ? 1 : MAX_ROUNDS;
  // two rounds with the model at most (the code fixes the rest) — the free daily quota has to last the night
  for (let round = 1; round <= rounds; round++) {
    let res;
    try {
      res = await generateJSON({ ...cfg.ai, system, messages, schema: schemaFor(mode) });
      countCall(res.model);
    } catch (e) {
      if (!e.quota) throw e; // a busy model: the runner retries at the next check
      if (last) break; // quota ran out after a first draft: keep it (the code fixes the rest)
      // no model left today: the plain recap from verified strings, sent now
      const draft = templateDraft(mode, brief);
      last = { mode, gameId: f.gameId, model: 'template', template: true, rounds: 0, draft, check: verifyDraft(draft, brief, names, ctx), writtenAt: new Date().toISOString() };
      break;
    }
    const check = verifyDraft(res.data, brief, names, ctx);
    last = { mode, gameId: f.gameId, model: res.model, rounds: round, draft: res.data, check, writtenAt: new Date().toISOString() };
    if (!check.issues.length) break;
    if (round < MAX_ROUNDS) messages.push({ role: 'model', text: res.text }, { role: 'user', text: `הטיוטה לא עברה את הבדיקה. תקן רק את אלה והחזר את כל ה-JSON מחדש:\n- ${check.errors.join('\n- ')}` });
  }
  // still contradicting the data after the model's rounds: fix in code — only the failing claim goes
  // (swap a pair, drop that sentence, rejoin a split paragraph, trim), then check again
  last.autoFixed = [];
  last.fixKinds = [];
  for (let pass = 0; pass < 3 && !last.check.ok; pass++) {
    last.autoFixed.push(...last.check.issues.filter((i) => i.severity === 'block').map((i) => i.msg));
    last.fixKinds.push(...last.check.issues.filter((i) => i.severity === 'block' && i.fix).map((i) => ({ type: i.fix.type, sentence: i.fix.sentence })));
    last.draft = autoFix(last.draft, last.check.issues, brief);
    last.check = verifyDraft(last.draft, brief, names, ctx);
  }
  // held only when a contradiction is left, or nothing usable is left after removing the bad claims
  last.held = !last.check.ok || (mode !== 'game' && !last.draft.headline) || !(last.draft.paragraphs || []).length;
  // REVIEW (not READY): the code had to cut or add a sentence, or wrote the text from its template —
  // the facts are right but the editor should read the flow. Each reason is one actionable line.
  last.review = [
    ...(last.template ? ['נכתב בתבנית קבועה כי המכסה היומית של המודל נגמרה — העובדות נכונות, כדאי ללטש את הניסוח'] : []),
    ...(last.fixKinds || []).filter((k) => ['drop', 'prepend', 'append'].includes(k.type)).map((k) => (k.type === 'drop' ? `משפט הוסר כי לא תאם את הנתונים: "${String(k.sentence || '').slice(0, 60)}" — לבדוק שהפסקה עדיין זורמת` : k.type === 'prepend' ? 'הזווית המרכזית נוספה בתחילת הבלוק — לבדוק שהפתיחה זורמת' : 'שורה של שחקן ישראלי נוספה בסוף הפסקה — לבדוק את המיקום')),
  ];
  // language-only proofreading for the stand-alone articles; thrown away if it touches any fact
  if (!last.held && cfg.proofread && mode === 'player') {
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
  for (const r of it.review || []) o.push(`> ⚠️ לבדיקה: ${r}`);
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
  // editor, 2026-11-05 (as on Sport5's page): a game with an Israeli who played gets a separate article and
  // is NOT a block of the nightly page (it stays in "כל התוצאות"). One article per game: Avdija / Sharp lead
  // it, any other Israeli in the game is inside it. Big games stay on the nightly page, as a longer block.
  let main = null;
  if (tracks.length) {
    const lead = tracks.find((t) => t.player.track === 'full') || [...tracks].sort((x, y) => (y.line?.pts || 0) - (x.line?.pts || 0))[0];
    main = await writeItem(cfg, 'player', { ...playerBrief(f, lead), max_paragraphs: 3, final_score_in: 'headline' }, f);
    Object.assign(main, { player: lead.player, players: tracks.map((t) => t.player.he || t.player.name), corrected, heading: gb.heading, end: f.endedAt || f.date, weight, angle: gb.main_angle });
    items.push(main);
    log(`  article ${tracks.map((t) => t.player.name).join(' + ')} ${main.held ? 'HELD' : 'ok'} (${main.rounds} rounds, ${main.model})`);
  }
  if (!main || main.held) {
    // no Israeli played (or his article could not be published): the game's block on the nightly page
    const featured = weight >= FEATURED;
    const game = await writeItem(cfg, 'game', { ...gb, max_paragraphs: featured ? 4 : 3 }, f);
    Object.assign(game, base);
    items.push(game);
    log(`  block ${game.held ? 'HELD' : game.autoFixed?.length ? 'ok (auto-fixed)' : 'ok'} (${game.rounds} rounds, ${game.model})`);
  }
  writeFileSync(join(dd, 'items', `${f.gameId}.json`), JSON.stringify(items, null, 1));
  for (const it of items.filter((x) => x.mode !== 'game' && x.draft)) {
    const name = it.player ? `${it.mode}-${it.player.name.replace(/\W+/g, '-')}-${it.gameId}` : `article-${it.gameId}`;
    const body = [`{#g${it.gameId}}`, `# ${it.draft.headline}`, it.draft.subheadline ? `\n**${it.draft.subheadline}**` : '', '', ...it.draft.paragraphs.flatMap((p) => [p, '']), checkBox(it)];
    writeFileSync(join(dd, `${name}.md`), body.join('\n') + '\n');
  }
  return items;
}

// After ESPN corrects a box score: check the recap already sent against the corrected facts. Only if
// something in it is now wrong is it rewritten (and sent again as "עדכון"); otherwise nothing is sent.
export async function recheckGame(date, f, cfg, { log = () => {} } = {}) {
  const file = join(dayDir(date), 'drafts', 'items', `${f.gameId}.json`);
  if (!existsSync(file)) return { rewritten: false, items: await draftsForGame(date, f, cfg, { corrected: true, log }) };
  const items = readJson(file);
  const inGame = new Set(['home', 'away'].flatMap((s) => f.players[s].map((p) => p.id)));
  const names = cfg.dict.map((d) => ({ ...d, inGame: inGame.has(d.id), status: d.approved ? 'approved' : d.status }));
  const ctx = ctxFor(f);
  const wrong = [];
  for (const it of items.filter((x) => x.draft && !x.held && !x.noSend)) {
    const t = it.player ? (f.tracks || []).find((x) => x.player.id === it.player.id) : null;
    const brief = it.mode === 'player' && t ? { ...playerBrief(f, t), max_paragraphs: 3, final_score_in: 'headline' } : gameBrief(f);
    const check = verifyDraft(it.draft, brief, names, ctx);
    if (!check.ok) wrong.push(...check.issues.filter((i) => i.severity === 'block').map((i) => i.msg));
  }
  if (!wrong.length) { log(`  ESPN correction does not touch the recap — nothing re-sent`); return { rewritten: false, items: [] }; }
  log(`  ESPN correction changes the recap (${wrong.length}) — rewriting`);
  return { rewritten: true, items: await draftsForGame(date, f, cfg, { corrected: true, log }) };
}

// The night's opening paragraph (Sport5: "לא פחות מ-14 משחקים נערכו הלילה..., כשבמוקד ..."), written once
// all games are in, from the games' verified angles only. Fallback: a plain sentence in code.
export async function writeIntro(date, cfg) {
  const dir = dayDir(date);
  const itemsDir = join(dir, 'drafts', 'items');
  if (!existsSync(itemsDir)) return null;
  const games = readdirSync(itemsDir).filter((x) => x.endsWith('.json')).flatMap((x) => readJson(join(itemsDir, x))).filter((x) => x.angle && !x.noSend && x.mode !== 'game' || (x.mode === 'game' && x.angle));
  const seen = new Set();
  const facts = games.filter((x) => (seen.has(x.gameId) ? false : seen.add(x.gameId))).sort((a, b) => (b.weight || 0) - (a.weight || 0)).slice(0, 6).map((x) => ({ game: x.heading, story_he: x.angle.fact_he }));
  if (!facts.length) return null;
  const first = readJson(join(dir, `${games[0].gameId}.json`));
  // the stories are verified angles already: their streak / high / table wording is allowed
  const brief = { kind: 'intro', verified: { season_high: true, career_high: true, streak: true, standings: true, historical: false }, night_he: `הלילה (${nightHe(first.date)})`, games_count: readdirSync(dir).filter((x) => /^\d+\.json$/.test(x)).length, top_stories: facts };
  const { system, user } = introPrompt(ROOT, brief);
  let text = null;
  try {
    const res = await generateJSON({ ...cfg.ai, system, messages: [{ role: 'user', text: user }], schema: { type: 'OBJECT', properties: { intro: { type: 'STRING' } }, required: ['intro'] } });
    const check = verifyDraft({ paragraphs: [res.data.intro] }, brief, [], null);
    if (check.ok) text = res.data.intro.trim();
  } catch { /* keep the plain sentence */ }
  if (!text) text = `${brief.games_count} משחקים נערכו הלילה ב-NBA (${nightHe(first.date)}).`;
  writeFileSync(join(dir, 'drafts', 'intro.txt'), text);
  return text;
}

// ---------- the night's closing page, from the games done so far ----------

export function assembleClosing(date, { pending = [] } = {}) {
  const dir = dayDir(date);
  const dd = join(dir, 'drafts');
  const itemsDir = join(dd, 'items');
  if (!existsSync(itemsDir)) return null;
  // games with an Israeli article are not blocks here (Sport5); they stay in the results list
  const blocks = readdirSync(itemsDir).filter((x) => x.endsWith('.json')).flatMap((x) => readJson(join(itemsDir, x))).filter((x) => x.mode === 'game' && x.draft && !x.noSend)
    .sort((a, b) => String(b.end).localeCompare(String(a.end))); // newest game first, like Sport5's page
  const facts = readdirSync(dir).filter((x) => /^\d+\.json$/.test(x)).map((x) => readJson(join(dir, x))).filter((x) => x.status?.final)
    .sort((a, b) => String(b.endedAt).localeCompare(String(a.endedAt)));
  const night = facts[0] ? nightHe(facts[0].date) : '';
  const total = facts.length + pending.length;
  const o = ['# סגירת הלילה ב-NBA — טיוטה', ''];
  o.push(pending.length
    ? `_עודכן ${new Date().toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' })} · ${facts.length} מתוך ${total} משחקים הסתיימו · בהמשך: ${pending.join(', ')}_`
    : `_כל ${total} המשחקים הסתיימו_`, '');
  const intro = existsSync(join(dd, 'intro.txt')) ? readFileSync(join(dd, 'intro.txt'), 'utf8').trim() : `${total} משחקים נערכו הלילה ב-NBA (${night}).`;
  o.push(intro, 'כל התוצאות:');
  const ot = (f) => (f.clutch?.overtimes ? (f.clutch.overtimes === 1 ? ' בהארכה' : ` אחרי ${f.clutch.overtimes} הארכות`) : '');
  for (const f of facts) o.push(`${listName(f.teams.home)} - ${listName(f.teams.away)} ${f.teams.away.score}:${f.teams.home.score}${ot(f)}`);
  for (const g of blocks) {
    const when = new Date(g.end).toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });
    const d = g.draft;
    // a held draft (known contradiction) is shown to the editor as such, never as copy
    const body = g.held ? ['⛔ הטיוטה לא פורסמה — ראו הערות לעורך'] : [...(d.headline ? [`**${d.headline}**`, ''] : []), ...d.paragraphs.flatMap((p, i) => (i ? ['', p] : [p]))];
    o.push('', '---', '', `{#g${g.gameId}}`, `_${when}_`, '', `**${g.heading}**`, ...body, checkBox(g));
  }
  writeFileSync(join(dd, 'closing.md'), o.join('\n') + '\n');
  return join(dd, 'closing.md');
}
