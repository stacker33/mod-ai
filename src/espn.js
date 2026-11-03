// Free data source: ESPN public JSON (unofficial, no key). Only this file knows ESPN's URLs;
// swapping to a paid provider later means replacing this module, not the facts engine.

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const UA = 'Mozilla/5.0 (compatible; ModAI/0.2)';

async function getJson(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (r.ok) return await r.json();
      if (i >= tries || ![429, 500, 502, 503, 504].includes(r.status)) throw new Error(`ESPN ${r.status} for ${url}`);
    } catch (e) {
      if (i >= tries || /ESPN \d+/.test(e.message)) throw e;
    }
    await new Promise((res) => setTimeout(res, 2000 * i));
  }
}

// date = 'YYYYMMDD' (US date, as ESPN schedules it)
export async function listGames(date) {
  const j = await getJson(`${BASE}/scoreboard?dates=${date}`);
  return (j.events || []).map((e) => {
    const c = e.competitions?.[0];
    const side = (ha) => {
      const t = c?.competitors?.find((x) => x.homeAway === ha);
      return t && { abbr: t.team.abbreviation, name: t.team.displayName, score: Number(t.score) };
    };
    return {
      id: e.id,
      start: e.date,
      state: e.status?.type?.state, // pre | in | post
      completed: !!e.status?.type?.completed,
      detail: e.status?.type?.detail,
      seasonType: e.season?.type, // 1 pre, 2 regular, 3 playoffs, 5 play-in
      home: side('home'),
      away: side('away'),
    };
  });
}

export async function getSummary(gameId) {
  return getJson(`${BASE}/summary?event=${gameId}`);
}

// team schedule for the current season (results so far + upcoming games)
export async function getTeamSchedule(abbr) {
  return getJson(`${BASE}/teams/${abbr.toLowerCase()}/schedule`);
}
