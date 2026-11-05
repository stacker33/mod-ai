// One-off probe of the secondary data sources, run inside GitHub Actions (where the keys are).
// Prints only the shape of the answers (counts, field names, one game's teams and score) — never a key.
//   SPORTAPI_KEY=… API_SPORTS_KEY=… node scripts/probe-apis.js 2026-11-04

const date = process.argv[2] || '2026-11-04';
const show = (label, x) => console.log(`${label}: ${String(JSON.stringify(x)).slice(0, 900)}`);

async function get(url, headers) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, body, text: body ? null : text.slice(0, 200) };
}

if (process.env.SPORTAPI_KEY) {
  const h = { 'X-Api-Key': process.env.SPORTAPI_KEY };
  const g = await get(`https://sportapi.ai/api/basketball/games/date/${date}?tz=America/New_York&league=nba`, h);
  show('sportapi games status', g.status);
  const games = g.body?.data || [];
  show('sportapi games count / keys', { count: games.length, keys: Object.keys(games[0] || {}), date: g.body?.date });
  show('sportapi first game', games[0] && { id: games[0].id, status: games[0].status, start: games[0].start, home: { abbr: games[0].home?.abbreviation, name: games[0].home?.name, score: games[0].home?.score }, away: { abbr: games[0].away?.abbreviation, score: games[0].away?.score }, has_boxscore: games[0].has_boxscore });
  show('sportapi all abbrs', games.map((x) => `${x.away?.abbreviation}@${x.home?.abbreviation} ${x.away?.score}-${x.home?.score} ${x.status}`));
  if (games[0]) {
    const p = await get(`https://sportapi.ai/api/basketball/games/${games[0].id}/players`, h);
    show('sportapi players status', p.status);
    const home = p.body?.data?.home || [];
    show('sportapi players sample', { count: home.length, first: home[0] && { name: home[0].player?.name, pts: home[0].pts, minutes: home[0].minutes, dnp: home[0].dnp } });
  }
} else console.log('sportapi: no key');

if (process.env.API_SPORTS_KEY) {
  const h = { 'x-apisports-key': process.env.API_SPORTS_KEY };
  // API-Sports files games by UTC date: a US night spans two dates
  const next = new Date(Date.parse(`${date}T12:00:00Z`) + 86400e3).toISOString().slice(0, 10);
  const g0 = await get(`https://v2.nba.api-sports.io/games?date=${date}`, h);
  const g = await get(`https://v2.nba.api-sports.io/games?date=${next}`, h);
  show('api-sports counts (date / next UTC date)', [g0.body?.response?.length, g.body?.response?.length, g.body?.errors]);
  const st = await get('https://v2.nba.api-sports.io/status', h);
  show('api-sports account', st.body?.response && { plan: st.body.response.subscription?.plan, requests: st.body.response.requests });
  show('api-sports games status', g.status);
  show('api-sports errors', g.body?.errors);
  const games = g.body?.response || [];
  show('api-sports games count / keys', { count: games.length, keys: Object.keys(games[0] || {}) });
  show('api-sports first game', games[0] && { id: games[0].id, status: games[0].status, date: games[0].date, teams: games[0].teams, scores: { home: games[0].scores?.home?.points, visitors: games[0].scores?.visitors?.points } });
  if (games[0]) {
    const p = await get(`https://v2.nba.api-sports.io/players/statistics?game=${games[0].id}`, h);
    show('api-sports players status', p.status);
    const rows = p.body?.response || [];
    show('api-sports players sample', { count: rows.length, first: rows[0] && { name: `${rows[0].player?.firstname} ${rows[0].player?.lastname}`, team: rows[0].team?.code, points: rows[0].points, min: rows[0].min } });
  }
} else console.log('api-sports: no key');
