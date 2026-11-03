// Usage:
//   node scripts/facts.js              -> last night (US date of the night that just ended in Israel)
//   node scripts/facts.js 20261101     -> a specific US date
//   node scripts/facts.js --fixtures   -> offline, from fixtures/*.json (no history / schedules)
// Writes out/<date>/<gameId>.json (facts), out/<date>/raw/<gameId>.json (ESPN source), out/<date>/report.md

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listGames, getSummary, getTeamSchedule } from '../src/espn.js';
import { playerHistory } from '../src/gamelog.js';
import { analyzeGame } from '../src/game.js';
import { nightReport } from '../src/report.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const israelis = JSON.parse(await readFile(join(ROOT, 'config', 'israelis.json'), 'utf8')).players;
const names = new Map(JSON.parse(await readFile(join(ROOT, 'config', 'names.he.json'), 'utf8')).players.map((p) => [p.id, p]));

// US Eastern clock minus 12h: at 04:00–09:00 Israel this lands on the US date of the night's games
function lastNight() {
  const d = new Date(Date.now() - 12 * 3600e3);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return p.replaceAll('-', '');
}

const arg = process.argv[2];
const fixtures = arg === '--fixtures';
const date = fixtures ? 'fixtures' : arg || lastNight();
if (!fixtures && !/^\d{8}$/.test(date)) throw new Error(`date must be YYYYMMDD, got ${date}`);

const out = join(ROOT, 'out', date);
await mkdir(join(out, 'raw'), { recursive: true });

let rows;
const summaries = new Map();
if (fixtures) {
  const files = (await readdir(join(ROOT, 'fixtures'))).filter((x) => x.endsWith('.json'));
  rows = [];
  for (const file of files) {
    const s = JSON.parse(await readFile(join(ROOT, 'fixtures', file), 'utf8'));
    const c = s.header.competitions[0];
    const side = (ha) => { const t = c.competitors.find((x) => x.homeAway === ha); return { abbr: t.team.abbreviation, score: Number(t.score) }; };
    rows.push({ id: s.header.id, state: c.status.type.state, detail: c.status.type.detail, home: side('home'), away: side('away') });
    summaries.set(s.header.id, s);
  }
} else {
  rows = await listGames(date);
}

// history + schedule only for Israelis who played tonight (fetched once per run)
const histories = new Map(), schedules = new Map();
if (!fixtures) {
  const tonight = new Set(rows.filter((r) => r.state === 'post').flatMap((r) => [r.home?.abbr, r.away?.abbr]));
  for (const p of israelis.filter((x) => tonight.has(x.team))) {
    try { histories.set(p.id, await playerHistory(p.id, join(ROOT, 'cache', 'gamelog'))); } catch (e) { console.log(`  ! history ${p.name}: ${e.message}`); }
    if (!schedules.has(p.team)) {
      try { schedules.set(p.team, await getTeamSchedule(p.team)); } catch (e) { console.log(`  ! schedule ${p.team}: ${e.message}`); }
    }
  }
}

const facts = new Map();
for (const r of rows) {
  if (r.state !== 'post') continue; // only finished games
  try {
    const s = summaries.get(r.id) || (await getSummary(r.id));
    if (!fixtures) await writeFile(join(out, 'raw', `${r.id}.json`), JSON.stringify(s));
    const f = analyzeGame(s, { israelis, histories, schedules, names });
    facts.set(r.id, f);
    await writeFile(join(out, `${r.id}.json`), JSON.stringify(f, null, 2));
  } catch (e) {
    r.error = e.message;
  }
}

await writeFile(join(out, 'report.md'), nightReport(fixtures ? '00000000' : date, rows, facts));
const okCount = [...facts.values()].filter((f) => f.ok).length;
const tracks = [...facts.values()].flatMap((f) => f.tracks);
console.log(`${date}: ${rows.length} games, ${facts.size} final, ${okCount} passed checks, ${rows.filter((r) => r.error).length} errors, Israeli tracks: ${tracks.map((t) => `${t.player.name} ${t.played ? (t.ok ? 'ok' : 'CHECK') : 'did not play'}`).join(', ') || 'none'} -> ${join(out, 'report.md')}`);
for (const r of rows.filter((x) => x.error)) console.log(`  ! ${r.id}: ${r.error}`);
