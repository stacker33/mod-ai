// Live runner: write each game's recap as soon as it ends.
//   node scripts/tick.js          -> one check (for a scheduler: every 5 minutes)
//   node scripts/tick.js --loop   -> keep checking every 5 minutes (local trial)
//
// Each check costs one ESPN scoreboard request per night being watched. Heavy work (facts, Gemini)
// happens only for a game that has just finished, and once more ~45 minutes later only if ESPN
// changed its box score in the meantime. State per night: out/<date>/state.json.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { listGames, getStandings, getSummary } from '../src/espn.js';
import { apRecap, recapDeadline, RECAP_FULL } from '../src/recap.js';
import { backupGames } from '../src/secondary.js';
import { loadConfig, dayDir, factsForGame, draftsForGame, recheckGame, writeIntro, assembleClosing, boxHash, morningCompare, saveFollowups } from '../src/pipeline.js';
import { heTeam } from '../src/teams.js';
import { telegramReady, sendTelegram, itemMessage, heldAlert, sendAlert } from '../src/notify.js';
import { nightBoard, morningSummary, compareLine, nightHe8 } from '../src/board.js';
import { ROOT } from '../src/pipeline.js';
import { buildTracker } from '../src/tracker.js';

const RECHECK_AFTER = 45 * 60e3; // ESPN stat corrections usually land within the hour
const RETRY_AFTER = 4 * 60e3; // = the next 5-minute check
const MAX_ATTEMPTS = 6;
const EVERY = 5 * 60e3;

// the US-Eastern dates that can still have games ending: yesterday and today
function watchedDates(now = new Date()) {
  const fmt = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replaceAll('-', '');
  return [...new Set([fmt(new Date(now.getTime() - 24 * 3600e3)), fmt(now)])];
}

const stamp = () => new Date().toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });

// Gemini's free daily quota resets at midnight Pacific time. While it is used up, finished games wait
// (not counted as failures) and are written right after the reset. One notice to the channel per wait.
const QUOTA_FILE = join(ROOT, 'out', 'quota.json');
const readQuota = () => { try { return JSON.parse(readFileSync(QUOTA_FILE, 'utf8')); } catch { return {}; } };
function nextPacificMidnight(now) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
  let t = Math.ceil(now / 300e3) * 300e3;
  for (let i = 0; i < 300; i++, t += 300e3) {
    const [h, m] = fmt.format(t).split(':').map(Number);
    if (h === 0 && m < 5) return t;
  }
  return now + 6 * 3600e3;
}
async function quotaOut(cfg, now) {
  const q = readQuota();
  if (q.until && q.until > now) return q.until;
  const until = nextPacificMidnight(now) + 10 * 60e3;
  mkdirSync(join(ROOT, 'out'), { recursive: true });
  writeFileSync(QUOTA_FILE, JSON.stringify({ until, since: now }));
  const il = new Date(until).toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });
  await sendAlert(cfg.env, `⏳ המכסה היומית של מודל הכתיבה נגמרה. משחקים שמסתיימים עכשיו ייכתבו וישלחו לערוץ אוטומטית אחרי ${il} (שעון ישראל).`);
  return until;
}

async function tickDate(date, cfg) {
  const dir = dayDir(date);
  const stateFile = join(dir, 'state.json');
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { games: {} };
  // ESPN's scoreboard; if it fails, the night's games from a second source
  let rows;
  try { rows = await listGames(date); } catch (e) {
    rows = await backupGames(cfg.env, date);
    if (!rows.length) throw e;
    console.log(`[${stamp()}] ${date} ESPN scoreboard unavailable — using ${rows[0].backup.provider}`);
  }
  if (!rows.length) return { date, rows: 0, changed: false };
  mkdirSync(dir, { recursive: true });
  const now = Date.now();
  // the table BEFORE the night (free, one call): makes "lost / took first place" a verifiable story
  const before = join(dir, 'standings-before.json');
  if (!existsSync(before) && rows.every((x) => x.state === 'pre')) {
    try { writeFileSync(before, JSON.stringify({ at: new Date().toISOString(), table: await getStandings() })); } catch { /* next check */ }
  }
  let changed = false;
  let israeliDone = false; // an Israeli's game was written: refresh the tracker now
  const log = (m) => console.log(`[${stamp()}] ${date} ${m}`);

  const pending = rows.filter((x) => x.state !== 'post').map((x) => `${heTeam(x.home.abbr) || x.home.abbr} - ${heTeam(x.away.abbr) || x.away.abbr}`);
  // schedule order, roughly the order the games ended
  for (const r of rows.filter((x) => x.state === 'post')) {
    const s = state.games[r.id] || { attempts: 0 };
    // a game that failed on an older version of the code is tried again once the code changes
    if (s.status === 'failed' && process.env.GITHUB_SHA && s.failedSha !== process.env.GITHUB_SHA) Object.assign(s, { status: 'retry', attempts: 0, nextTry: 0 });
    // the same game already written under the other source's id (ESPN came back after a backup night)
    s.teams = `${r.away.abbr}@${r.home.abbr}`;
    if (!s.status && Object.entries(state.games).some(([id, g]) => id !== r.id && g.teams === s.teams && g.status === 'done')) continue;
    const label = `${r.away.abbr} @ ${r.home.abbr} ${r.away.score}-${r.home.score}`;
    const due = !s.status || s.status === 'await_recap' || (s.status === 'retry' && now >= s.nextTry);
    const recheck = s.status === 'done' && !s.rechecked && now - s.doneAt >= RECHECK_AFTER;
    if (!due && !recheck) continue;
    const quotaUntil = readQuota().until || 0;
    if (quotaUntil > now) continue; // waiting for the daily writing quota; nothing is lost
    // AP FIRST (editor, 2026-11-10): a regular game is written once AP's recap is in — it tells the story
    // the numbers cannot. At night it waits until 05:30 (the shift starts at 06:00), later at most 30 min.
    // Games with an Israeli are written right away, as before.
    const israeliTeam = (cfg.israelis || []).some((p) => [r.home.abbr, r.away.abbr].includes(p.team));
    if (!recheck && !r.backup && !israeliTeam && (!s.status || s.status === 'await_recap')) {
      s.finalSeen ||= now;
      const deadline = recapDeadline(s.finalSeen);
      let rec = null;
      try { rec = apRecap(await getSummary(r.id)); } catch { /* ESPN busy: try at the next check */ }
      // a short take that has not grown for 10 minutes is AP's recap for this game: write from it
      if (rec && !s.recapSeen) { s.recapSeen = now; state.games[r.id] = s; changed = true; }
      const settled = rec && (rec.chars >= RECAP_FULL || now - s.recapSeen >= 10 * 60e3);
      if (!settled && now < deadline) {
        if (s.status !== 'await_recap') {
          const until = new Date(deadline).toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });
          log(`${label}: final — waiting for AP's recap (until ${until})${rec ? ` — only a first take so far (${rec.chars} chars)` : ''}`);
          s.status = 'await_recap';
          state.games[r.id] = s;
          changed = true;
        }
        continue;
      }
      log(`${label}: ${rec ? `AP's recap is in (${rec.chars} chars, ${Math.round((now - s.finalSeen) / 60e3)} min after final)` : "no AP recap by the deadline — writing without it"}`);
    }
    try {
      const f = await factsForGame(date, r.id, cfg, r);
      const hash = boxHash(f);
      if (recheck) {
        s.rechecked = true;
        if (hash === s.hash) { state.games[r.id] = s; changed = true; log(`${label}: re-check, no ESPN changes`); continue; }
        if (!f.ok) { state.games[r.id] = s; changed = true; log(`${label}: ESPN changed the box score but it does not add up yet — recap kept`); continue; }
        log(`${label}: ESPN corrected the box score — checking the recap that was sent`);
      } else log(`${label}: final — writing`);
      if (!f.ok) {
        s.attempts++;
        Object.assign(s, { status: s.attempts >= MAX_ATTEMPTS ? 'blocked' : 'retry', nextTry: now + RETRY_AFTER, why: f.checks.filter((c) => c.severity === 'error').map((c) => c.name) });
        log(`${label}: facts failed checks (${s.why.join(', ')}) — ${s.status}`);
        if (s.status === 'blocked') await sendAlert(cfg.env, `⚠️ ${label}: הנתונים של ESPN לא עברו את הבדיקות (${s.why.join(', ')}) — לא נכתב סיכום. צריך לכתוב ידנית.`);
      } else {
        // a re-check rewrites (and re-sends) only when the corrected facts make the sent recap wrong
        const rc = recheck ? await recheckGame(date, f, cfg, { log, oldHash: s.hash }) : null;
        const items = rc ? rc.items : await draftsForGame(date, f, cfg, { log });
        if (recheck && !items.length) { Object.assign(s, { hash }); state.games[r.id] = s; changed = true; continue; }
        if (rc?.rewritten) {
          // a real correction: the page shows the new text; nothing is re-sent to Telegram (recaps only)
          Object.assign(s, { hash, correctedAt: now });
          state.games[r.id] = s;
          changed = true;
          continue;
        }
        Object.assign(s, { status: 'done', doneAt: s.doneAt || now, hash, items: items.map((i) => ({ mode: i.mode, ok: i.check.ok })) });
        if (recheck) s.correctedAt = now;
        if (telegramReady(cfg.env)) {
          for (const it of items.filter((x) => !x.noSend)) {
            // Telegram is for recaps only: a held draft, a failure or a quota wait shows on the editor page
            const msg = itemMessage(it);
            if (!msg) { await sendAlert(cfg.env, heldAlert(it)); continue; }
            try { await sendTelegram(cfg.env, msg); } catch (e) { log(`  telegram error: ${e.message.slice(0, 120)}`); }
          }
          s.notifiedAt = Date.now();
        }
        // follow-up links for the editor page (ESPN recap, clips, team news) — web only
        try { await saveFollowups(date, r.id); } catch { /* the morning refresh will add them */ }
        if (f.israelis?.some((i) => i.played)) israeliDone = true;
      }
    } catch (e) {
      if (e.quota) {
        // not a failure: wait for the quota reset, then write it (a re-check simply runs again later)
        const until = await quotaOut(cfg, now);
        if (recheck) s.rechecked = false;
        else Object.assign(s, { status: 'retry', nextTry: until, error: 'daily writing quota used up' });
        log(`${label}: writing quota used up — waiting until ${new Date(until).toISOString()}`);
      } else if (/Gemini \S+ (5\d\d|429)/.test(e.message) && (s.transient || 0) < 30) {
        // the model is busy / rate-limited: try again at the very next check, and it is not a failure
        s.transient = (s.transient || 0) + 1;
        if (recheck) s.rechecked = false;
        else Object.assign(s, { status: 'retry', nextTry: now, error: e.message.slice(0, 200) });
        log(`${label}: model busy — trying again at the next check`);
      } else {
        s.attempts++;
        Object.assign(s, { status: s.attempts >= MAX_ATTEMPTS ? 'failed' : 'retry', nextTry: now + RETRY_AFTER, error: e.message.slice(0, 300) });
        log(`${label}: error (${s.status}): ${e.message.slice(0, 160)}`);
        if (s.status === 'failed') {
          s.failedSha = process.env.GITHUB_SHA || null;
          // shown on the editor page as a game to write by hand; the operator hears about it now (private chat)
          await sendAlert(cfg.env, `⚠️ ${label}: לא נכתב סיכום בגלל תקלה במערכת (${String(e.message).slice(0, 80)}). ננסה שוב אחרי תיקון — בינתיים צריך לכתוב ידנית.`);
        }
      }
    }
    state.games[r.id] = s;
    changed = true;
    // publish this game right away, even if more finished games are waiting in the same check
    state.updatedAt = Date.now();
    writeFileSync(stateFile, JSON.stringify(state, null, 1));
    assembleClosing(date, { pending });
  }
  // every game of the night is in: write the opening paragraph once (Sport5's "לא פחות מ-14 משחקים...")
  if (rows.length && rows.every((x) => x.state === 'post') && rows.every((x) => state.games[x.id]?.status === 'done') && !state.introAt) {
    try { if (await writeIntro(date, cfg)) { state.introAt = Date.now(); assembleClosing(date, { pending: [] }); changed = true; log('opening paragraph written'); } } catch (e) { log(`opening paragraph: ${e.message.slice(0, 120)}`); }
    writeFileSync(stateFile, JSON.stringify(state, null, 1));
  }
  // the morning comparison with the Sport5 editor's article: after 08:00 Israel time, every 15 minutes until
  // the article is up (until 14:00), once per night
  const ilHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  if (state.introAt && !state.compareAt && ilHour >= 8 && ilHour < 14 && now - (state.compareTriedAt || 0) >= 15 * 60e3) {
    state.compareTriedAt = now;
    try {
      const r = await morningCompare(date, cfg);
      if (r) { state.compareAt = now; changed = true; log(`Sport5 comparison: ${r.games} games, names ${r.namesCovered}%, numbers ${r.numbersCovered}%, same opening ${r.sameAngle}%`); }
      else log('Sport5 article not up yet');
    } catch (e) { log(`Sport5 comparison: ${e.message.slice(0, 120)}`); }
    writeFileSync(stateFile, JSON.stringify(state, null, 1));
  }
  // the 08:00 summary to the operator's private chat: how the night went, in one message
  if (!state.summaryAt && rows.length && ilHour >= 8 && ilHour < 14 && (state.introAt || ilHour >= 9)) {
    state.summaryAt = now;
    await sendAlert(cfg.env, morningSummary(date, nightBoard(dayDir(date)), readCompare(date), cfg.pageUrl));
    writeFileSync(stateFile, JSON.stringify(state, null, 1));
  }
  // the Sport5 comparison usually comes after 08:00: one more line when it lands
  if (state.summaryAt && state.compareAt && !state.compareSentAt) {
    state.compareSentAt = now;
    const c = readCompare(date);
    if (c) await sendAlert(cfg.env, `📊 ${nightHe8(date)} מול Sport5: ${compareLine(c)}`);
    writeFileSync(stateFile, JSON.stringify(state, null, 1));
  }
  // follow-ups again in the morning and at midday: injury updates, quotes and stories come after the game
  for (const [key, hour] of [['followups8', 8], ['followups13', 13]]) {
    if (state.introAt && !state[key] && ilHour >= hour && ilHour < hour + 4) {
      try { await saveFollowups(date); state[key] = now; changed = true; log(`follow-up links refreshed (${hour}:00)`); } catch (e) { log(`follow-ups: ${e.message.slice(0, 100)}`); }
      writeFileSync(stateFile, JSON.stringify(state, null, 1));
    }
  }
  // the night's schedule for the editor page board (which games are still to come / playing); saved only
  // when a game changes state, so live score changes do not rebuild the page every check
  const schedule = rows.map((x) => ({ id: x.id, state: x.state, start: x.start, home: x.home.abbr, away: x.away.abbr }));
  if (JSON.stringify(schedule) !== JSON.stringify(state.schedule || [])) {
    state.schedule = schedule;
    state.updatedAt = Date.now();
    writeFileSync(stateFile, JSON.stringify(state, null, 1));
    changed = true;
  }
  const done = Object.values(state.games).filter((g) => g.status === 'done').length;
  return { date, rows: rows.length, done, live: rows.filter((x) => x.state === 'in').length, upcoming: rows.filter((x) => x.state === 'pre').length, changed, israeliDone };
}

const readCompare = (date) => { try { return JSON.parse(readFileSync(join(dayDir(date), 'compare.json'), 'utf8')); } catch { return null; } };

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
  mkdirSync(join(ROOT, 'out'), { recursive: true });
  // the Israeli tracker (editor page tab): every 2 hours, and right after an Israeli's game is written
  const trackerFile = join(ROOT, 'out', 'tracker.json');
  let prev = null;
  try { prev = JSON.parse(readFileSync(trackerFile, 'utf8')); } catch { /* first run */ }
  if (!prev || Date.now() - new Date(prev.at).getTime() > 2 * 3600e3 || out.some((x) => x.israeliDone)) {
    try {
      const t = await buildTracker(cfg.israelis || [], { cacheDir: join(ROOT, 'cache') });
      writeFileSync(trackerFile, JSON.stringify(t, null, 1));
      if (JSON.stringify(t.players) !== JSON.stringify(prev?.players)) out.push({ date: 'tracker', changed: true });
      console.log(`[${stamp()}] Israeli tracker refreshed (${t.players.map((p) => `${p.name}${p.error ? ' ERROR' : ''}`).join(', ')})`);
    } catch (e) { console.log(`[${stamp()}] tracker: ${e.message.slice(0, 120)}`); }
  }
  // tells the workflow whether the page needs a new deploy
  writeFileSync(join(ROOT, 'out', 'changed'), out.some((x) => x.changed) ? 'yes' : 'no');
  console.log(`[${stamp()}] ${out.filter((x) => x.date !== 'tracker').map((x) => `${x.date}: ${x.rows ? `${x.done}/${x.rows} written, ${x.live} live, ${x.upcoming} upcoming` : 'no games'}`).join(' | ')}`);
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
