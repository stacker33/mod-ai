// A player's game-by-game history from ESPN (every season of his career), for verified
// career/season highs, averages and streaks. Past seasons never change, so they are cached on disk;
// the current season is re-fetched on each run.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes';
const UA = 'Mozilla/5.0 (compatible; ModAI/0.2)';

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`ESPN gamelog ${r.status} for ${url}`);
  return r.json();
}

const pair = (s) => {
  const m = String(s ?? '').match(/^(\d+)-(\d+)$/);
  return m ? [Number(m[1]), Number(m[2])] : null;
};

function seasonTypeOf(displayName) {
  if (/play-?in/i.test(displayName)) return 'playin';
  if (/post|playoff/i.test(displayName)) return 'post';
  if (/pre/i.test(displayName)) return 'pre';
  if (/regular/i.test(displayName)) return 'regular';
  return 'other';
}

// raw ESPN gamelog JSON -> rows
export function parseGamelog(d) {
  const names = d.names || [];
  const ix = (n) => names.indexOf(n);
  const rows = [];
  for (const st of d.seasonTypes || []) {
    const type = seasonTypeOf(st.displayName || '');
    const season = (st.displayName || '').match(/\d{4}-\d{2}/)?.[0] || null;
    for (const cat of st.categories || []) {
      for (const e of cat.events || []) {
        const s = e.stats || [];
        const ev = d.events?.[e.eventId] || {};
        const num = (n) => Number(s[ix(n)]) || 0;
        rows.push({
          eventId: e.eventId,
          season,
          type,
          date: ev.gameDate || null,
          team: ev.team?.abbreviation || null, // his team in that game (a trade shows here)
          opp: ev.opponent?.abbreviation || null,
          atVs: ev.atVs || null,
          result: ev.gameResult || null,
          score: ev.score || null,
          min: num('minutes'),
          pts: num('points'),
          reb: num('totalRebounds'),
          ast: num('assists'),
          stl: num('steals'),
          blk: num('blocks'),
          to: num('turnovers'),
          pf: num('fouls'),
          fg: pair(s[ix('fieldGoalsMade-fieldGoalsAttempted')]),
          tp: pair(s[ix('threePointFieldGoalsMade-threePointFieldGoalsAttempted')]),
          ft: pair(s[ix('freeThrowsMade-freeThrowsAttempted')]),
        });
      }
    }
  }
  return rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

// every season of the player's career, oldest first
export async function playerHistory(athleteId, cacheDir) {
  await mkdir(cacheDir, { recursive: true });
  const current = await getJson(`${BASE}/${athleteId}/gamelog`);
  await writeFile(join(cacheDir, `${athleteId}-current.json`), JSON.stringify(current));
  const seasonFilter = (current.filters || []).find((f) => f.name === 'season');
  const currentSeason = seasonFilter?.value;
  const seasons = (seasonFilter?.options || []).map((o) => o.value).filter((v) => v !== currentSeason);
  const all = [current];
  for (const season of seasons) {
    const file = join(cacheDir, `${athleteId}-${season}.json`);
    let d;
    try {
      d = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      d = await getJson(`${BASE}/${athleteId}/gamelog?season=${season}`);
      await writeFile(file, JSON.stringify(d));
    }
    all.push(d);
  }
  const seen = new Set();
  return all.flatMap(parseGamelog).filter((r) => (seen.has(r.eventId + r.type) ? false : seen.add(r.eventId + r.type)))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

// this season and last season only (a former team he left within that window). The current season is
// fetched once per run; last season is cached on disk like the full history.
const recentMemo = new Map();
export async function recentHistory(athleteId, cacheDir) {
  if (recentMemo.has(athleteId)) return recentMemo.get(athleteId);
  await mkdir(cacheDir, { recursive: true });
  const current = await getJson(`${BASE}/${athleteId}/gamelog`);
  const seasonFilter = (current.filters || []).find((f) => f.name === 'season');
  const prev = (seasonFilter?.options || []).map((o) => o.value).filter((v) => v !== seasonFilter?.value).sort().at(-1);
  const all = [current];
  if (prev) {
    const file = join(cacheDir, `${athleteId}-${prev}.json`);
    let d;
    try { d = JSON.parse(await readFile(file, 'utf8')); } catch { d = await getJson(`${BASE}/${athleteId}/gamelog?season=${prev}`); await writeFile(file, JSON.stringify(d)); }
    all.push(d);
  }
  const seen = new Set();
  const rows = all.flatMap(parseGamelog).filter((r) => (seen.has(r.eventId + r.type) ? false : seen.add(r.eventId + r.type))).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  recentMemo.set(athleteId, rows);
  return rows;
}

// offline: build history from cached files only (tests / reruns)
export async function cachedHistory(athleteId, cacheDir, files) {
  const all = [];
  for (const f of files) all.push(JSON.parse(await readFile(join(cacheDir, f), 'utf8')));
  return all.flatMap(parseGamelog).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
