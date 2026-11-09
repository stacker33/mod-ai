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
import { apRecap, sameHero } from './recap.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSummary, getTeamSchedule } from './espn.js';
import { playerHistory } from './gamelog.js';
import { analyzeGame } from './game.js';
import { gameBrief, playerBrief, FEATURED } from './writer/brief.js';
import { buildPrompt, proofPrompt, introPrompt, schemaFor } from './writer/prompt.js';
import { generateJSON } from './writer/gemini.js';
import { tidy, verifyDraft, autoFix, draftText } from './writer/verify.js';
import { fetchContext } from './context.js';
import { crossCheck, backupSummary, backupGames } from './secondary.js';
import { fetchSport5Night, compareNight } from './compare.js';
import { collectFollowups } from './followups.js';
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
    ai: { key: env.GEMINI_API_KEY, model: env.AI_MODEL || 'gemini-flash-latest', fallback: env.AI_MODEL_FALLBACK, healthFile: join(ROOT, 'out', 'model-health.json') },
    proofread: env.AI_PROOFREAD !== '0', // the language-only pass (one more model call per item)
    israelis: readJson(join(ROOT, 'config', 'israelis.json')).players,
    dict: readJson(join(ROOT, 'config', 'names.he.json')).players,
  };
}

export const dayDir = (date) => join(ROOT, 'out', date);

// ---------- facts for one game ----------

export async function factsForGame(date, gameId, cfg, row = null) {
  const dir = dayDir(date);
  mkdirSync(join(dir, 'raw'), { recursive: true });
  // ESPN first; if it cannot give this game, the same game from a second source (no play-by-play)
  let s;
  if (row?.backup) s = await backupSummary(cfg.env, row);
  else {
    try { s = await getSummary(gameId); } catch (e) {
      const alt = row ? (await backupGames(cfg.env, date)).find((x) => x.home.abbr === row.home.abbr && x.away.abbr === row.away.abbr && x.completed) : null;
      if (!alt) throw e;
      s = await backupSummary(cfg.env, alt);
      s.header.id = gameId; // keep the ESPN id: state and files stay the same
    }
  }
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
  f.backupSource = s.backupSource || null;
  // the second source's view of the same game: final score + every 10+ point scorer
  if (!f.backupSource) { try { f.crossCheck = await crossCheck(f, cfg.env, date); } catch { f.crossCheck = null; } }
  f.endedAt = s.plays?.at(-1)?.wallclock || null;
  f.apRecap = apRecap(s); // background for the writer (src/recap.js), when AP has filed
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
    // the story from storyline.js in plain sentences: angle + what made it his game, then the turn and the cast
    const st = b.story;
    if (st?.protagonist) {
      const angle = b.main_angle?.fact_he || `${W} ניצחה את ${L}`;
      const hero = st.protagonist;
      const heroLine = angle.includes(hero.name_he) ? '' : `${hero.name_he} סיים עם ${hero.line_he}.`;
      const made = hero.what_made_it_he.filter((x) => x !== angle).map((x) => `${x}.`).join(' ');
      const p1 = [`${angle}.`, heroLine, made].filter(Boolean).join(' ');
      const p2 = [...st.turn_he.slice(0, 2), ...st.cast.slice(0, 3).map((c) => c.fact_he)].map((x) => `${x}.`).join(' ');
      return { paragraphs: [p1, p2].filter(Boolean) };
    }
    const p1 = [`${b.main_angle?.fact_he || `${W} ניצחה את ${L}`}.`, b.stars?.[W]?.length ? `${lines(b.stars[W].slice(0, 2))}.` : ''].filter(Boolean).join(' ');
    const p2 = [b.details?.[0] ? `${b.details[0]}.` : '', b.records?.[L]?.sentence_he ? `${b.records[L].sentence_he}${b.stars?.[L]?.length ? `, ו${lines(b.stars[L].slice(0, 1))}` : ''}.` : ''].filter(Boolean).join(' ');
    return { paragraphs: [p1, p2].filter(Boolean) };
  }
  // an Israeli article
  const headline = `${b.player_he} ב${b.result_he} ${b.won ? 'על' : 'ל'}${b.opp_he}`;
  const p1 = `${b.player_he} סיים עם ${b.line_full_he}.${b.team_record?.after_verb ? ` ${b.team_he} ${b.team_record.after_verb}.` : ''}`;
  const story = (b.must_tell || []).map((x) => `${x.fact_he}.`).join(' ');
  const others = (b.other_israelis || []).map((x) => `${x.sentence_he}.`).join(' ');
  return { headline, subheadline: b.line_short_he ? `${b.player_he} ${b.line_short_he}` : b.team_he, paragraphs: [p1, story, others].filter(Boolean) };
}

// for a fallback model: the story in plain verified sentences, in order — the base to rewrite in a lively
// voice (the hook, the verbs), never to copy as it is and never to go beyond
function skeletonHint(mode, brief) {
  try {
    const d = templateDraft(mode, brief);
    const lines = [d.headline, d.subheadline, ...(d.paragraphs || [])].filter(Boolean).join('\n');
    return `שלד עובדתי של הסיפור (נכתב בקוד, כל עובדה בו מאומתת). כתוב ממנו את הטקסט בקול של עורך — פתיחה חיה, פעלים, סדר שמשרת את הסיפור — בלי להוסיף עובדות שאינן ב-BRIEF:\n${lines}`;
  } catch { return null; }
}

// LOCAL AI TESTS: the free quota resets at 10:00 Israel time, and the night's games use the same day's
// quota as any test run after that — so tests on this machine run only 08:00-10:00 (the night's leftover),
// unless MODAI_ALLOW_AI=1. The live runner (GitHub Actions) is never limited by this.
function localAiAllowed(env) {
  if (env.GITHUB_ACTIONS || env.MODAI_ALLOW_AI === '1') return true;
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  return h >= 8 && h < 10;
}

export async function writeItem(cfg, mode, brief, f) {
  if (!localAiAllowed(cfg.env || process.env)) throw Object.assign(new Error('Local AI test outside 08:00-10:00 Israel time (it would use tonight\'s quota). Set MODAI_ALLOW_AI=1 to override.'), { localGuard: true });
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
      res = await generateJSON({ ...cfg.ai, system, messages, schema: schemaFor(mode), fallbackHint: skeletonHint(mode, brief) });
      countCall(res.model);
    } catch (e) {
      if (!e.quota) throw e; // a busy model: the runner retries at the next check
      if (last) break; // quota ran out after a first draft: keep it (the code fixes the rest)
      // no model left today: the plain recap from verified strings, sent now
      const draft = templateDraft(mode, brief);
      last = { mode, gameId: f.gameId, model: 'template', template: true, rounds: 0, draft, check: verifyDraft(draft, brief, names, ctx), writtenAt: new Date().toISOString() };
      break;
    }
    res.data = tidy(res.data, brief); // records already in the score line: removed in code, not by another round
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
  // Also: the second source disagrees with ESPN, or the game came from the backup source.
  last.review = [
    ...(f.crossCheck?.notes || []),
    ...(f.backupSource ? [`ESPN לא היה זמין — המשחק נכתב לפי ${f.backupSource}, בלי פרטי מהלכים`] : []),
    ...(last.template ? ['נכתב בתבנית קבועה כי המכסה היומית של המודל נגמרה — העובדות נכונות, כדאי ללטש את הניסוח'] : []),
    ...(last.fixKinds || []).filter((k) => ['drop', 'prepend', 'append', 'insert'].includes(k.type)).map((k) => (k.type === 'drop' ? `משפט הוסר כי לא תאם את הנתונים: "${String(k.sentence || '').slice(0, 60)}" — לבדוק שהפסקה עדיין זורמת` : k.type === 'prepend' ? 'הזווית המרכזית נוספה בתחילת הבלוק — לבדוק שהפתיחה זורמת' : k.type === 'insert' ? 'משפט על סיפור המשחק נוסף בסוף הפסקה השנייה — לבדוק את המיקום' : 'שורה של שחקן ישראלי נוספה בסוף הפסקה — לבדוק את המיקום')),
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
  if (it.ap) o.push(`> 📰 ${it.ap.source}: ${it.ap.headline}${it.ap.sameHero === false ? ' (גיבור אחר משלנו)' : ''}`);
  else if (it.mode === 'game') o.push('> 📰 נכתב בלי הסיכום של AP');
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
  // AP's headline beside ours: did AP see the same protagonist? (the morning comparison)
  const heroEn = ['home', 'away'].flatMap((x) => f.players[x]).find((p) => p.he && p.he === gb.story?.protagonist?.name_he)?.name;
  const ap = f.apRecap ? { headline: f.apRecap.headline, source: f.apRecap.source, published: f.apRecap.published, sameHero: sameHero(f.apRecap, heroEn) } : null;
  const base = { heading: gb.heading, end: f.endedAt || f.date, weight, angle: gb.main_angle, corrected, ap, leads: { highlights: f.color?.highlights || [], unverified: f.research, namesMissing: f.namesMissing } };
  // Israelis who actually played (box score minutes); one who did not play changes nothing: normal recap
  const tracks = (f.tracks || []).filter((t) => t.inGame && t.played && t.ok);
  // editor, 2026-11-05 (as on Sport5's page): a game with an Israeli who played gets a separate article and
  // is NOT a block of the nightly page (it stays in "כל התוצאות"). One article per game: Avdija / Sharp lead
  // it, any other Israeli in the game is inside it. Big games stay on the nightly page, as a longer block.
  let main = null;
  if (tracks.length) {
    const lead = tracks.find((t) => t.player.track === 'full') || [...tracks].sort((x, y) => (y.line?.pts || 0) - (x.line?.pts || 0))[0];
    // Israeli article: the longer format (~250-350 words), more room than a nightly block
    main = await writeItem(cfg, 'player', { ...playerBrief(f, lead), max_paragraphs: 5, target_words: [250, 350], final_score_in: 'headline' }, f);
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

// What ESPN corrected between two box-score hashes (boxHash): the final score and each player's
// points / rebounds / assists / minutes — nothing else (the table or tomorrow's schedule moving is not a correction)
export function boxChanges(oldHash, f) {
  let old;
  try { old = JSON.parse(oldHash); } catch { return null; }
  const out = [];
  if (old[0] !== f.teams.home.score || old[1] !== f.teams.away.score) out.push({ kind: 'score', from: `${old[1]}:${old[0]}`, to: `${f.teams.away.score}:${f.teams.home.score}` });
  const prev = new Map(old.slice(2).map((r) => [r[0], r]));
  const LABEL = ['', 'נקודות', 'ריבאונדים', 'אסיסטים', 'דקות'];
  for (const side of ['home', 'away']) {
    for (const p of f.players[side]) {
      const r = prev.get(p.id);
      if (!r) continue;
      [p.pts, p.reb, p.ast, p.min].forEach((v, i) => {
        if ((r[i + 1] ?? null) !== (v ?? null)) out.push({ kind: 'stat', player: p.he || p.name, surname: (p.he || p.name).split(' ').slice(1).join(' '), stat: LABEL[i + 1], from: r[i + 1], to: v });
      });
    }
  }
  return out;
}

// After ESPN corrects a box score: only a correction that touches the TEXT already sent matters —
// the final score, or a corrected number next to that player's name. Then the recap is rewritten (the page
// shows the new version) and Telegram gets a short correction note, not the whole recap again.
export async function recheckGame(date, f, cfg, { log = () => {}, oldHash = null } = {}) {
  const file = join(dayDir(date), 'drafts', 'items', `${f.gameId}.json`);
  if (!existsSync(file)) return { rewritten: false, items: await draftsForGame(date, f, cfg, { corrected: true, log }), changes: [] };
  const items = readJson(file);
  const sent = items.filter((x) => x.draft && !x.held && !x.noSend).map((x) => draftText(x.draft)).join('\n');
  const changes = boxChanges(oldHash, f) || [];
  const touching = changes.filter((c) => (c.kind === 'score' ? true : sent.split(/[.!?\n]/).some((sentence) => (sentence.includes(c.player) || (c.surname.length >= 3 && sentence.includes(c.surname))) && new RegExp(`(^|[^\\d])${c.from}([^\\d]|$)`).test(sentence))));
  if (!touching.length) { log(`  ESPN corrected ${changes.length} number(s), none of them in the recap — nothing re-sent`); return { rewritten: false, items: [], changes }; }
  log(`  ESPN correction touches the recap (${touching.map((c) => (c.kind === 'score' ? `score ${c.from} -> ${c.to}` : `${c.player} ${c.stat} ${c.from} -> ${c.to}`)).join('; ')}) — rewriting`);
  return { rewritten: true, items: await draftsForGame(date, f, cfg, { corrected: true, log }), changes: touching };
}

// the short Telegram note for a correction (the full new text is on the page)
export function correctionNote(heading, changes, pageUrl = null) {
  const what = changes.map((c) => (c.kind === 'score' ? `התוצאה הסופית ${c.to} (במקום ${c.from})` : `${c.player}: ${c.to} ${c.stat} (במקום ${c.from})`)).join(' · ');
  return `🔁 עדכון ל${heading}: ESPN תיקן — ${what}. הטקסט בדף עודכן${pageUrl ? `: ${pageUrl}` : '.'}`;
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
  // Cup nights: "במסגרת הגביע" (how many of the night's games were NBA Cup games)
  const nightFacts = readdirSync(dir).filter((x) => /^\d+\.json$/.test(x)).map((x) => readJson(join(dir, x)));
  const cupGames = nightFacts.filter((x) => x?.cupGame).length;
  const brief = { kind: 'intro', cup_games: cupGames, verified: { season_high: true, career_high: true, streak: true, standings: true, historical: false }, night_he: `הלילה (${nightHe(first.date)})`, games_count: readdirSync(dir).filter((x) => /^\d+\.json$/.test(x)).length, top_stories: facts };
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

// The morning comparison with the Sport5 editor's article (once it is up): saved as out/<date>/compare.json.
// Only numbers and names are kept — never Sport5's text.
export async function morningCompare(date, cfg) {
  const dir = dayDir(date);
  const itemsDir = join(dir, 'drafts', 'items');
  if (!existsSync(itemsDir)) return null;
  const s5 = await fetchSport5Night(date);
  if (!s5) return null;
  const games = [];
  for (const file of readdirSync(itemsDir).filter((x) => x.endsWith('.json'))) {
    const items = readJson(join(itemsDir, file));
    const f = readJson(join(dir, file));
    // our published piece for the game: the Israeli article if there is one, else the nightly block
    const piece = items.find((x) => x.mode === 'player' && !x.held) || items.find((x) => x.mode === 'game' && !x.noSend && !x.held);
    if (!piece || !f) continue;
    games.push({ gameId: f.gameId, scorePair: `${f.teams.away.score}:${f.teams.home.score}`, text: draftText(piece.draft), facts: f });
  }
  const report = { url: s5.url, at: new Date().toISOString(), ...compareNight(s5.text, games, cfg.dict) };
  writeFileSync(join(dir, 'compare.json'), JSON.stringify(report, null, 1));
  return report;
}

// Follow-up links per game (ESPN recap, clips, team news since the game): out/<date>/followups.json.
// Collected when a game is written and refreshed in the morning (news keeps coming after the game).
export async function saveFollowups(date, onlyId = null) {
  const dir = dayDir(date);
  const file = join(dir, 'followups.json');
  const all = existsSync(file) ? readJson(file) : { games: {} };
  const ids = readdirSync(dir).filter((x) => /^\d+\.json$/.test(x)).map((x) => x.slice(0, -5)).filter((id) => !onlyId || id === onlyId);
  for (const id of ids) {
    const f = readJson(join(dir, `${id}.json`));
    if (!f?.status?.final) continue;
    try { all.games[id] = await collectFollowups(f); } catch { /* keep what we had */ }
  }
  all.at = new Date().toISOString();
  writeFileSync(file, JSON.stringify(all, null, 1));
  return all;
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
