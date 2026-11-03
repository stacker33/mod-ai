// One game at a time: ESPN summary -> facts -> Hebrew drafts -> files, and the night's closing page
// rebuilt from whatever games are done so far. Used by scripts/tick.js (live) and scripts/write.js (backfill).

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSummary, getTeamSchedule } from './espn.js';
import { playerHistory } from './gamelog.js';
import { analyzeGame } from './game.js';
import { gameBrief, playerBrief } from './writer/brief.js';
import { buildPrompt, schemaFor } from './writer/prompt.js';
import { generateJSON } from './writer/gemini.js';
import { verifyDraft } from './writer/verify.js';
import { nightHe } from './writer/he.js';
import { NICK_HE } from './teams.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const BIG_GAME = 90; // story weight that earns a stand-alone article

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
  const f = analyzeGame(s, { israelis: cfg.israelis, histories, schedules, names });
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
  const { system, user } = buildPrompt(ROOT, mode, brief);
  const messages = [{ role: 'user', text: user }];
  let last;
  for (let round = 1; round <= 3; round++) {
    const res = await generateJSON({ ...cfg.ai, system, messages, schema: schemaFor(mode) });
    const d = res.data;
    const text = [d.headline, d.subheadline, d.lead, ...(d.paragraphs || [])].filter(Boolean).join('\n');
    const check = verifyDraft(text, brief, names, ctxFor(f));
    last = { mode, gameId: f.gameId, model: res.model, rounds: round, draft: d, check, writtenAt: new Date().toISOString() };
    if (check.ok) break;
    messages.push({ role: 'model', text: res.text }, { role: 'user', text: `הטיוטה נכשלה בבדיקה האוטומטית. תקן רק את הבעיות האלה והחזר את כל ה-JSON מחדש:\n- ${check.errors.join('\n- ')}` });
  }
  return last;
}

const checkBox = (it) => {
  const o = ['', '> **לבדיקת העורך (לא להעתקה):**'];
  if (!it.check.ok) o.push(`> ❌ נכשל בבדיקה גם אחרי ${it.rounds} סבבים: ${it.check.errors.join('; ')}`);
  else o.push(`> ✅ כל המספרים, התוצאות והשמות נבדקו מול הנתונים (${it.rounds === 1 ? 'בסבב הראשון' : `אחרי ${it.rounds} סבבים`})`);
  if (it.corrected) o.push('> 🔁 נכתב מחדש אחרי תיקון סטטיסטיקה של ESPN');
  if (it.check.toApprove.length) o.push(`> ✏️ שמות שעוד לא אושרו: ${it.check.toApprove.join(', ')}`);
  if (it.leads?.namesMissing?.length) o.push(`> ❓ שחקנים בלי שם בעברית: ${it.leads.namesMissing.join(', ')}`);
  if (it.leads?.unverified?.length) o.push(`> 🔎 לא אומת (לא נכתב): ${it.leads.unverified.join(' · ')}`);
  if (it.leads?.highlights?.length) o.push(`> 🎬 קטעי וידאו של ESPN (כיוון לצבע): ${it.leads.highlights.join(' · ')}`);
  return o.join('\n');
};

// every item of one game -> out/<date>/drafts/items/<gameId>.json (+ .md for stand-alone pieces)
export async function draftsForGame(date, f, cfg, { corrected = false, log = () => {} } = {}) {
  const dd = join(dayDir(date), 'drafts');
  mkdirSync(join(dd, 'items'), { recursive: true });
  const items = [];
  const gb = gameBrief(f);
  const game = await writeItem(cfg, 'game', gb, f);
  Object.assign(game, { heading: gb.heading, end: f.endedAt || f.date, weight: f.candidates[0]?.weight || 0, corrected, leads: { highlights: f.color?.highlights || [], unverified: gb.do_not_state, namesMissing: f.namesMissing } });
  items.push(game);
  log(`  block ${game.check.ok ? 'ok' : 'CHECK'} (${game.rounds} rounds, ${game.model})`);
  if (game.weight >= BIG_GAME) {
    const a = await writeItem(cfg, 'article', gb, f);
    Object.assign(a, { heading: gb.heading, corrected });
    items.push(a);
    log(`  big-game article ${a.check.ok ? 'ok' : 'CHECK'}`);
  }
  for (const t of f.tracks || []) {
    if (!t.inGame || !t.played || !t.ok) continue; // did not play -> the normal block covers the game
    const mode = t.player.track === 'full' ? 'player' : 'short';
    const it = await writeItem(cfg, mode, playerBrief(f, t), f);
    Object.assign(it, { player: t.player, corrected });
    items.push(it);
    log(`  ${mode} ${t.player.name} ${it.check.ok ? 'ok' : 'CHECK'} (${it.rounds} rounds)`);
  }
  writeFileSync(join(dd, 'items', `${f.gameId}.json`), JSON.stringify(items, null, 1));
  for (const it of items.filter((x) => x.mode !== 'game')) {
    const name = it.player ? `${it.mode}-${it.player.name.replace(/\W+/g, '-')}-${it.gameId}` : `article-${it.gameId}`;
    const body = [`# ${it.draft.headline}`, it.draft.subheadline ? `\n**${it.draft.subheadline}**` : '', '', ...it.draft.paragraphs.flatMap((p) => [p, '']), checkBox(it)];
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
    o.push('', '---', '', `_${when}_`, '', `**${g.heading}**`, `${g.draft.lead} ${g.draft.paragraphs[0] || ''}`.trim(), ...g.draft.paragraphs.slice(1).map((p) => `\n${p}`), checkBox(g));
  }
  writeFileSync(join(dd, 'closing.md'), o.join('\n') + '\n');
  return join(dd, 'closing.md');
}
