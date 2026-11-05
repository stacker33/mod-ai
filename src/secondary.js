// SECOND SOURCES next to ESPN: sportapi.ai (first; free 2,000 calls/day) and API-Sports (second; free 100/day).
//   1. cross-check: after every game, the final score and each player's points are compared with ESPN's;
//      a disagreement puts the recap to REVIEW with one line saying what differs.
//   2. backup: if ESPN cannot give a game, the second source's box score is turned into the same shape
//      as ESPN's summary, so the normal pipeline writes the recap (without play-by-play details).
// Keys come from the environment (GitHub Secrets): SPORTAPI_KEY, API_SPORTS_KEY. Without them, nothing here runs.

const T = 20000;
// API-Sports team codes -> ESPN's (sportapi.ai already uses ESPN's)
const TO_ESPN = { GSW: 'GS', NYK: 'NY', SAS: 'SA', NOP: 'NO', UTA: 'UTAH', WAS: 'WSH' };
const espnAbbr = (a) => TO_ESPN[a] || a;
// a player name as a key: no accents, no punctuation, no Jr./III
export const nameKey = (n) => String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '').replace(/[^a-z]/g, '');

async function getJson(url, headers) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(T) });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.json();
}
const plusDay = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
const ymd = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`; // 20261104 -> 2026-11-04

// ---------- providers: games of a US night, and one game's box score, in one shape ----------
const SPORTAPI = {
  name: 'sportapi.ai',
  ready: (env) => !!env.SPORTAPI_KEY,
  async games(env, date) {
    const j = await getJson(`https://sportapi.ai/api/basketball/games/date/${ymd(date)}?tz=America/New_York&league=nba`, { 'X-Api-Key': env.SPORTAPI_KEY });
    return (j.data || []).map((g) => ({ source: 'sportapi.ai', id: String(g.id), start: g.start, final: ['FT', 'AOT', 'POST'].includes(g.status), ot: g.status === 'AOT', home: { abbr: espnAbbr(g.home?.abbreviation), name: g.home?.name, score: Number(g.home?.score), periods: (g.home?.periods || []).map(Number) }, away: { abbr: espnAbbr(g.away?.abbreviation), name: g.away?.name, score: Number(g.away?.score), periods: (g.away?.periods || []).map(Number) } }));
  },
  async box(env, game) {
    const j = await getJson(`https://sportapi.ai/api/basketball/games/${game.id}/players`, { 'X-Api-Key': env.SPORTAPI_KEY });
    const side = (rows) => (rows || []).map((r) => ({ name: r.player?.name, starter: !!r.starter, played: !r.dnp && (r.minutes || 0) > 0, dnp: r.dnp || null, min: r.minutes || 0, pts: r.pts || 0, reb: r.reb || 0, ast: r.ast || 0, stl: r.stl || 0, blk: r.blk || 0, to: r.tov || 0, pf: r.pf || 0, fg: [r.fgm || 0, r.fga || 0], tp: [r.tpm || 0, r.tpa || 0], ft: [r.ftm || 0, r.fta || 0], plusMinus: r.plus_minus || 0 }));
    return { home: side(j.data?.home), away: side(j.data?.away) };
  },
};

const APISPORTS = {
  name: 'API-Sports',
  ready: (env) => !!env.API_SPORTS_KEY,
  async games(env, date) {
    // filed by UTC date: a US night spans the date and the next one
    const h = { 'x-apisports-key': env.API_SPORTS_KEY };
    const lists = await Promise.all([ymd(date), plusDay(ymd(date), 1)].map((d) => getJson(`https://v2.nba.api-sports.io/games?date=${d}`, h)));
    const usDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso)).replaceAll('-', '');
    return lists.flatMap((j) => j.response || []).filter((g) => usDate(g.date?.start) === date).map((g) => ({ source: 'API-Sports', id: String(g.id), start: g.date?.start, final: g.status?.long === 'Finished', ot: (g.periods?.total || 4) > 4, home: { abbr: espnAbbr(g.teams?.home?.code), name: g.teams?.home?.name, score: Number(g.scores?.home?.points), periods: (g.scores?.home?.linescore || []).map(Number) }, away: { abbr: espnAbbr(g.teams?.visitors?.code), name: g.teams?.visitors?.name, score: Number(g.scores?.visitors?.points), periods: (g.scores?.visitors?.linescore || []).map(Number) } }));
  },
  async box(env, game) {
    const j = await getJson(`https://v2.nba.api-sports.io/players/statistics?game=${game.id}`, { 'x-apisports-key': env.API_SPORTS_KEY });
    const out = { home: [], away: [] };
    for (const r of j.response || []) {
      const side = espnAbbr(r.team?.code) === game.home.abbr ? 'home' : 'away';
      const min = Number(String(r.min || '0').split(':')[0]) || 0;
      out[side].push({ name: `${r.player?.firstname || ''} ${r.player?.lastname || ''}`.trim(), starter: false, played: min > 0, dnp: min > 0 ? null : 'DNP', min, pts: r.points || 0, reb: r.totReb || 0, ast: r.assists || 0, stl: r.steals || 0, blk: r.blocks || 0, to: r.turnovers || 0, pf: r.pFouls || 0, fg: [r.fgm || 0, r.fga || 0], tp: [r.tpm || 0, r.tpa || 0], ft: [r.ftm || 0, r.fta || 0], plusMinus: Number(r.plusMinus) || 0 });
    }
    return out;
  },
};

const PROVIDERS = [SPORTAPI, APISPORTS];
const cache = new Map(); // one games list per provider and night, per run

async function gamesOf(p, env, date) {
  const k = `${p.name}:${date}`;
  if (!cache.has(k)) cache.set(k, p.games(env, date));
  return cache.get(k);
}

// the same game in a second source (by the two teams)
async function find(env, date, home, away) {
  for (const p of PROVIDERS.filter((x) => x.ready(env))) {
    try {
      const g = (await gamesOf(p, env, date)).find((x) => x.home.abbr === home && x.away.abbr === away);
      if (g) return { p, g };
    } catch { /* next provider */ }
  }
  return null;
}

// ---------- 1. cross-check ----------
// returns { source, ok, notes[] } — notes in Hebrew, one line each, for the editor (only real differences)
export async function crossCheck(f, env, date) {
  const hit = await find(env, date, f.teams.home.abbr, f.teams.away.abbr);
  if (!hit) return { source: null, ok: null, notes: [] };
  const { p, g } = hit;
  const notes = [];
  if (!g.final) return { source: p.name, ok: null, notes: [] }; // not final there yet: nothing to compare
  if (g.home.score !== f.teams.home.score || g.away.score !== f.teams.away.score) {
    notes.push(`${p.name} מראה תוצאה סופית ${g.away.score}:${g.home.score} (ב-ESPN ${f.teams.away.score}:${f.teams.home.score}) — לבדוק את התוצאה לפני פרסום`);
  }
  try {
    const box = await p.box(env, g);
    for (const side of ['home', 'away']) {
      const theirs = new Map(box[side].map((x) => [nameKey(x.name), x]));
      for (const pl of f.players[side].filter((x) => x.played && x.pts >= 10)) {
        const o = theirs.get(nameKey(pl.name));
        if (o && o.pts !== pl.pts) notes.push(`${pl.he || pl.name}: ${pl.pts} נקודות ב-ESPN, ${o.pts} ב-${p.name} — לבדוק`);
      }
    }
  } catch { /* the score check above still counts */ }
  return { source: p.name, ok: notes.length === 0, notes };
}

// ---------- 2. backup: the night's games, and one game as an ESPN-shaped summary ----------
export async function backupGames(env, date) {
  for (const p of PROVIDERS.filter((x) => x.ready(env))) {
    try {
      const list = await gamesOf(p, env, date);
      if (list.length) return list.map((g) => ({ id: `bk-${p.name === 'sportapi.ai' ? 'sp' : 'as'}-${g.id}`, start: g.start, state: g.final ? 'post' : 'pre', completed: g.final, home: g.home, away: g.away, backup: { provider: p.name, game: g } }));
    } catch { /* next provider */ }
  }
  return [];
}

// a second source's box score in the shape buildFacts reads (no play-by-play: the recap is plainer)
export async function backupSummary(env, row) {
  const p = PROVIDERS.find((x) => x.name === row.backup.provider);
  const g = row.backup.game;
  const box = await p.box(env, g);
  const labels = ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST', 'TO', 'STL', 'BLK', 'OREB', 'DREB', 'PF', '+/-'];
  const team = (side, id) => ({
    team: { id, abbreviation: g[side].abbr, displayName: g[side].name },
    statistics: [{ labels, athletes: box[side].map((x, i) => ({
      athlete: { id: `${row.id}-${side}-${i}`, displayName: x.name, position: {} }, starter: x.starter, didNotPlay: !x.played, reason: x.dnp || '',
      stats: x.played ? [String(x.min), String(x.pts), `${x.fg[0]}-${x.fg[1]}`, `${x.tp[0]}-${x.tp[1]}`, `${x.ft[0]}-${x.ft[1]}`, String(x.reb), String(x.ast), String(x.to), String(x.stl), String(x.blk), '0', '0', String(x.pf), String(x.plusMinus)] : [],
    })) }],
  });
  const comp = (side, id) => ({ homeAway: side, team: { id, abbreviation: g[side].abbr, displayName: g[side].name }, score: String(g[side].score), linescores: (g[side].periods || []).map((v) => ({ displayValue: String(v) })), record: [] });
  return {
    header: { id: row.id, season: { type: 2 }, competitions: [{ date: g.start, status: { type: { state: 'post', completed: true, detail: 'Final' } }, competitors: [comp('home', 'h'), comp('away', 'a')] }] },
    boxscore: { players: [team('home', 'h'), team('away', 'a')], teams: [] },
    plays: [],
    backupSource: p.name,
  };
}
