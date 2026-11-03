// Backfill: Hebrew drafts from facts already on disk (live use is scripts/tick.js).
//   node scripts/write.js 20261027            -> every game of that US date (run scripts/facts.js first)
//   node scripts/write.js 20261027 401909880  -> one game
//   node scripts/write.js 20261027 --refetch  -> rebuild the facts from ESPN first (after a code change)
// Same per-game code as the live runner: out/<date>/drafts/items/<gameId>.json, stand-alone .md files, closing.md

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, dayDir, factsForGame, draftsForGame, assembleClosing } from '../src/pipeline.js';

const args = process.argv.slice(2);
const refetch = args.includes('--refetch');
const [date, only] = args.filter((a) => a !== '--refetch');
if (!/^\d{8}$/.test(date || '')) throw new Error('usage: node scripts/write.js YYYYMMDD [gameId]');
const cfg = loadConfig();
if (!cfg.ai.key) throw new Error('GEMINI_API_KEY missing in .env');
const dir = dayDir(date);

const ids = readdirSync(dir).filter((x) => /^\d+\.json$/.test(x)).map((x) => x.slice(0, -5)).filter((id) => !only || id === only);
const facts = [];
for (const id of ids) {
  if (refetch) { try { facts.push(await factsForGame(date, id, cfg)); continue; } catch (e) { console.log(`${id}: refetch failed (${e.message}), using facts on disk`); } }
  facts.push(JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')));
}
for (const f of facts) {
  if (!f.ok) { console.log(`${f.gameId}: facts failed checks, skipped`); continue; }
  if (!f.endedAt) { try { f.endedAt = JSON.parse(readFileSync(join(dir, 'raw', `${f.gameId}.json`), 'utf8')).plays?.at(-1)?.wallclock || null; } catch { /* keep start time */ } }
  console.log(`${f.gameId} ${f.teams.away.abbr} @ ${f.teams.home.abbr}`);
  await draftsForGame(date, f, cfg, { log: console.log });
}
console.log(`closing page -> ${assembleClosing(date)}`);
