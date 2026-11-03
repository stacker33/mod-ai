// Live runner: write each game's recap as soon as it ends.
//   node scripts/tick.js          -> one check (for a scheduler: every 5 minutes)
//   node scripts/tick.js --loop   -> keep checking every 5 minutes (local trial)
//
// Each check costs one ESPN scoreboard request per night being watched. Heavy work (facts, Gemini)
// happens only for a game that has just finished, and once more ~45 minutes later only if ESPN
// changed its box score in the meantime. State per night: out/<date>/state.json.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { listGames } from '../src/espn.js';
import { loadConfig, dayDir, factsForGame, draftsForGame, assembleClosing, boxHash } from '../src/pipeline.js';
import { heTeam } from '../src/teams.js';
import { telegramReady, sendTelegram, itemMessage, heldAlert } from '../src/notify.js';
import { ROOT } from '../src/pipeline.js';

const RECHECK_AFTER = 45 * 60e3; // ESPN stat corrections usually land within the hour
const RETRY_AFTER = 10 * 60e3;
const MAX_ATTEMPTS = 6;
const EVERY = 5 * 60e3;

// the US-Eastern dates that can still have games ending: yesterday and today
function watchedDates(now = new Date()) {
  const fmt = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replaceAll('-', '');
  return [...new Set([fmt(new Date(now.getTime() - 24 * 3600e3)), fmt(now)])];
}

const stamp = () => new Date().toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });

async function tickDate(date, cfg) {
  const dir = dayDir(date);
  const stateFile = join(dir, 'state.json');
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { games: {} };
  const rows = await listGames(date);
  if (!rows.length) return { date, rows: 0, changed: false };
  mkdirSync(dir, { recursive: true });
  const now = Date.now();
  let changed = false;
  const log = (m) => console.log(`[${stamp()}] ${date} ${m}`);

  const pending = rows.filter((x) => x.state !== 'post').map((x) => `${heTeam(x.home.abbr) || x.home.abbr} - ${heTeam(x.away.abbr) || x.away.abbr}`);
  // schedule order, roughly the order the games ended
  for (const r of rows.filter((x) => x.state === 'post')) {
    const s = state.games[r.id] || { attempts: 0 };
    const label = `${r.away.abbr} @ ${r.home.abbr} ${r.away.score}-${r.home.score}`;
    const due = !s.status || (s.status === 'retry' && now >= s.nextTry);
    const recheck = s.status === 'done' && !s.rechecked && now - s.doneAt >= RECHECK_AFTER;
    if (!due && !recheck) continue;
    try {
      const f = await factsForGame(date, r.id, cfg);
      const hash = boxHash(f);
      if (recheck) {
        s.rechecked = true;
        if (hash === s.hash) { state.games[r.id] = s; changed = true; log(`${label}: re-check, no ESPN changes`); continue; }
        log(`${label}: ESPN corrected the box score — rewriting`);
      } else log(`${label}: final — writing`);
      if (!f.ok) {
        s.attempts++;
        Object.assign(s, { status: s.attempts >= MAX_ATTEMPTS ? 'blocked' : 'retry', nextTry: now + RETRY_AFTER, why: f.checks.filter((c) => c.severity === 'error').map((c) => c.name) });
        log(`${label}: facts failed checks (${s.why.join(', ')}) — ${s.status}`);
        if (s.status === 'blocked' && telegramReady(cfg.env)) await sendTelegram(cfg.env, `⚠️ ${label}: הנתונים של ESPN לא עברו את הבדיקות (${s.why.join(', ')}) — לא נכתב סיכום. צריך לכתוב ידנית.`).catch(() => {});
      } else {
        const items = await draftsForGame(date, f, cfg, { corrected: recheck, log });
        Object.assign(s, { status: 'done', doneAt: s.doneAt || now, hash, items: items.map((i) => ({ mode: i.mode, ok: i.check.ok })) });
        if (recheck) s.correctedAt = now;
        if (telegramReady(cfg.env)) {
          for (const it of items.filter((x) => !x.noSend)) {
            try { await sendTelegram(cfg.env, itemMessage(it) || heldAlert(it)); } catch (e) { log(`  telegram error: ${e.message.slice(0, 120)}`); }
          }
          s.notifiedAt = Date.now();
        }
      }
    } catch (e) {
      s.attempts++;
      Object.assign(s, { status: s.attempts >= MAX_ATTEMPTS ? 'failed' : 'retry', nextTry: now + RETRY_AFTER, error: e.message.slice(0, 300) });
      log(`${label}: error (${s.status}): ${e.message.slice(0, 160)}`);
    }
    state.games[r.id] = s;
    changed = true;
    // publish this game right away, even if more finished games are waiting in the same check
    state.updatedAt = Date.now();
    writeFileSync(stateFile, JSON.stringify(state, null, 1));
    assembleClosing(date, { pending });
  }
  const done = Object.values(state.games).filter((g) => g.status === 'done').length;
  return { date, rows: rows.length, done, live: rows.filter((x) => x.state === 'in').length, upcoming: rows.filter((x) => x.state === 'pre').length, changed };
}

// keep 10 nights of drafts; raw ESPN files only 3 days (they are big)
function prune() {
  const dir = join(ROOT, 'out');
  if (!existsSync(dir)) return;
  const nights = readdirSync(dir).filter((d) => /^\d{8}$/.test(d)).sort().reverse();
  nights.slice(10).forEach((d) => rmSync(join(dir, d), { recursive: true, force: true }));
  nights.slice(3).forEach((d) => rmSync(join(dir, d, 'raw'), { recursive: true, force: true }));
}

async function tick(cfg) {
  prune();
  const out = [];
  for (const date of watchedDates()) {
    try { out.push(await tickDate(date, cfg)); } catch (e) { console.log(`[${stamp()}] ${date} scoreboard error: ${e.message}`); }
  }
  // tells the workflow whether the page needs a new deploy
  mkdirSync(join(ROOT, 'out'), { recursive: true });
  writeFileSync(join(ROOT, 'out', 'changed'), out.some((x) => x.changed) ? 'yes' : 'no');
  console.log(`[${stamp()}] ${out.map((x) => `${x.date}: ${x.rows ? `${x.done}/${x.rows} written, ${x.live} live, ${x.upcoming} upcoming` : 'no games'}`).join(' | ')}`);
}

const cfg = loadConfig();
if (!cfg.ai.key) throw new Error('GEMINI_API_KEY missing (.env or environment)');
if (!telegramReady(cfg.env)) console.log(`[${stamp()}] ⚠️ Telegram is off: ${!cfg.env.TELEGRAM_BOT_TOKEN ? 'TELEGRAM_BOT_TOKEN' : 'TELEGRAM_CHAT'} is missing — drafts are written but not sent`);
await tick(cfg);
if (process.argv.includes('--loop')) {
  for (;;) {
    await new Promise((r) => setTimeout(r, EVERY));
    await tick(cfg);
  }
}
