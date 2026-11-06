// ISRAELI TRACKER: one card per Israeli player for the editor page — season averages, the last 5 team
// games (with "didn't play"), the minutes trend, the next game and a career milestone if one is close.
// Pure numbers from ESPN (player game log + team schedule). No model, no quota. out/tracker.json.

import { join } from 'node:path';
import { getTeamSchedule } from './espn.js';
import { playerHistory } from './gamelog.js';
import { trimSchedule } from './context.js';
import { heTeam } from './teams.js';
import { pair } from './writer/he.js';

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r1 = (x) => Math.round(x * 10) / 10;
const pct = (made, att) => (att ? Math.round((made / att) * 1000) / 10 : null);
const seasonLabel = (year) => `${year - 1}-${String(year).slice(2)}`; // ESPN 2027 -> "2026-27"
const ilTime = (iso) => new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

// career milestones (regular season, as Sport5 counts them): the next round number of each stat
const MILESTONES = [
  { key: 'pts', he: 'נקודות', step: (t) => (t < 1000 ? 500 : 1000) },
  { key: 'reb', he: 'ריבאונדים', step: (t) => (t < 1000 ? 250 : 500) },
  { key: 'ast', he: 'אסיסטים', step: (t) => (t < 1000 ? 250 : 500) },
  { key: 'tpm', he: 'שלשות', step: () => 100 },
  { key: 'gp', he: 'משחקים', step: () => 100 },
];

// the milestones within about two games at this season's pace (games: within 3)
export function milestonesOf(career, perGame) {
  const out = [];
  for (const m of MILESTONES) {
    const total = career[m.key] || 0;
    const step = m.step(total);
    const target = (Math.floor(total / step) + 1) * step;
    const left = target - total;
    const pace = m.key === 'gp' ? 1 : perGame[m.key] || 0;
    if (!pace) continue;
    const games = Math.ceil(left / pace);
    if (games <= (m.key === 'gp' ? 3 : 2)) out.push({ stat: m.key, target, left, games, text_he: `${left} ${m.key === 'gp' ? 'משחקים' : m.he} עד ${m.key === 'gp' ? 'המשחק ה-' : ''}${target.toLocaleString('en-US')}${m.key === 'gp' ? '' : ` ${m.he}`} בקריירה` });
  }
  return out.sort((a, b) => a.games - b.games || a.left - b.left);
}

// one player's card from his game log rows (gamelog.js) and his team's schedule (trimSchedule)
export function trackPlayer(p, rows, schedule, now = new Date()) {
  const season = schedule?.season ? seasonLabel(schedule.season) : rows.filter((r) => r.type === 'regular').at(-1)?.season;
  const mine = (e) => e.teams.find((t) => t.abbr === p.team);
  const teamGames = (schedule?.events || []).filter((e) => e.state === 'post' && mine(e)).sort((a, b) => a.date.localeCompare(b.date));
  const byEvent = new Map(rows.map((r) => [r.eventId, r]));
  const played = (r) => r && r.min > 0;
  const games = rows.filter((r) => r.type === 'regular' && r.season === season && played(r));

  const sum = (k) => games.reduce((a, r) => a + (r[k] || 0), 0);
  const shots = (k) => games.reduce((a, r) => [a[0] + (r[k]?.[0] || 0), a[1] + (r[k]?.[1] || 0)], [0, 0]);
  const [fgm, fga] = shots('fg'), [tpm, tpa] = shots('tp'), [ftm, fta] = shots('ft');
  const n = games.length;
  const per = (k) => (n ? r1(sum(k) / n) : 0);
  const seasonAvg = { gp: n, teamGp: teamGames.length, min: per('min'), pts: per('pts'), reb: per('reb'), ast: per('ast'), stl: per('stl'), blk: per('blk'), to: per('to'), fg: pct(fgm, fga), tp: pct(tpm, tpa), ft: pct(ftm, fta), tpm: n ? r1(tpm / n) : 0 };

  // the last 5 TEAM games: a game he missed shows as "לא שיחק", not as a gap
  const last5 = teamGames.slice(-5).reverse().map((e) => {
    const me = mine(e), opp = e.teams.find((t) => t !== me);
    const r = byEvent.get(e.id);
    const won = me.winner;
    const base = { eventId: e.id, date: e.date, opp: opp.abbr, opp_he: heTeam(opp.abbr) || opp.abbr, home: me.home, won, score_he: Number.isFinite(me.score) && Number.isFinite(opp.score) ? pair(me.score, opp.score) : null };
    if (!played(r)) return { ...base, played: false };
    return { ...base, played: true, min: r.min, pts: r.pts, reb: r.reb, ast: r.ast, fg: r.fg, tp: r.tp };
  });

  // minutes, game by game this season (0 = didn't play), and the last 5 against the season
  const minutes = teamGames.map((e) => (played(byEvent.get(e.id)) ? byEvent.get(e.id).min : 0));
  const recent = minutes.slice(-5);
  const diff = r1(avg(recent) - avg(minutes));
  const trend = minutes.length < 4 ? null : { last5: r1(avg(recent)), season: r1(avg(minutes)), diff, dir: diff >= 3 ? 'up' : diff <= -3 ? 'down' : 'flat' };

  const best = games.reduce((a, r) => (!a || r.pts > a.pts ? r : a), null);
  const seasonHigh = best ? { pts: best.pts, opp_he: heTeam(best.opp) || best.opp, date: best.date } : null;

  const nextE = (schedule?.events || []).filter((e) => e.state !== 'post' && mine(e) && new Date(e.date) > new Date(now.getTime() - 4 * 3600e3)).sort((a, b) => a.date.localeCompare(b.date))[0];
  const next = nextE ? (() => {
    const me = mine(nextE), opp = nextE.teams.find((t) => t !== me);
    return { eventId: nextE.id, date: nextE.date, live: nextE.state === 'in', home: me.home, opp: opp.abbr, opp_he: heTeam(opp.abbr) || opp.abbr, when_he: ilTime(nextE.date) };
  })() : null;

  // regular-season career totals for the milestones
  const career = rows.filter((r) => r.type === 'regular' && played(r)).reduce((a, r) => ({ pts: a.pts + r.pts, reb: a.reb + r.reb, ast: a.ast + r.ast, tpm: a.tpm + (r.tp?.[0] || 0), gp: a.gp + 1 }), { pts: 0, reb: 0, ast: 0, tpm: 0, gp: 0 });
  const milestones = milestonesOf(career, seasonAvg);

  return { id: p.id, name: p.name, he: p.he, team: p.team, team_he: heTeam(p.team) || p.team, track: p.track, season, avg: seasonAvg, last5, trend, minutes, seasonHigh, next, career, milestones };
}

// every Israeli in config/israelis.json; a player whose data fails gets a card with the error, the rest still build
export async function buildTracker(israelis, { cacheDir }) {
  const schedules = {};
  const players = [];
  for (const p of israelis) {
    try {
      schedules[p.team] ??= trimSchedule(await getTeamSchedule(p.team));
      const rows = await playerHistory(p.id, join(cacheDir, 'gamelog'));
      players.push(trackPlayer(p, rows, schedules[p.team]));
    } catch (e) {
      players.push({ id: p.id, name: p.name, he: p.he, team: p.team, team_he: heTeam(p.team) || p.team, error: e.message.slice(0, 160) });
    }
  }
  return { at: new Date().toISOString(), players };
}
