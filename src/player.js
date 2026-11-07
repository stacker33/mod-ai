// Player track (Israelis first): everything about one player in one game, plus verified context
// from his career history and his team's schedule. Built only from ESPN structured data.

import { normPlays, periodName } from './facts.js';
import { heTeam } from './teams.js';
import { foulRole } from './pbp.js';

const STATS = ['pts', 'reb', 'ast', 'stl', 'blk'];
const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

// ESPN season year 2027 -> "2026-27"
export const seasonLabel = (year) => `${year - 1}-${String(year).slice(2)}`;

function israelTime(iso) {
  const d = new Date(iso);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(d).map((p) => [p.type, p.value]));
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'short' }).format(d);
  const dayIx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
  return { iso, date: `${parts.day}.${parts.month}`, time: `${parts.hour}:${parts.minute}`, weekday: HE_DAYS[dayIx] };
}

// what the player did on each play (ESPN participant order: shooter/assister, shooter/blocker, loser/stealer, in/out)
function playerEvents(plays, id, names, side) {
  const out = [];
  let prev = { home: 0, away: 0 };
  const other = side === 'home' ? 'away' : 'home';
  for (const p of plays) {
    const r0 = p.ids[0] === id, r1 = p.ids[1] === id;
    const before = prev;
    prev = { home: p.home, away: p.away };
    if (!r0 && !r1) continue;
    const type = p.type;
    let kind = null, partner = null;
    if (/substitution/i.test(type)) kind = r0 ? 'in' : 'out';
    else if (p.scoring) { kind = r0 ? 'score' : 'assist'; partner = names.get(p.ids[r0 ? 1 : 0]) || null; }
    else if (p.shooting) { kind = r0 ? (/blocks/i.test(p.text) ? 'blocked' : 'miss') : 'block'; partner = names.get(p.ids[r0 ? 1 : 0]) || null; }
    else if (/turnover/i.test(type)) { kind = r0 ? 'turnover' : 'steal'; partner = names.get(p.ids[r0 ? 1 : 0]) || null; }
    else if (/rebound/i.test(type)) kind = r0 ? (/offensive/i.test(type) ? 'oreb' : 'dreb') : null;
    else if (foulRole(type, p.text)) {
      // (free throws, technical ones included, were already handled above as score / miss)
      const role = foulRole(type, p.text);
      if (role.charged.some((i) => p.ids[i] === id)) {
        kind = role.kind === 'ejection' ? 'ejection' : /^flagrant/.test(role.kind) ? 'flagrant' : /technical/.test(role.kind) && role.kind !== 'minor-technical' ? 'technical' : 'foul';
      }
    }
    else if (/foul/i.test(type)) kind = r0 ? 'foul' : null;
    if (!kind) continue;
    const marginBefore = before[side] - before[other];
    const marginAfter = p[side] - p[other];
    out.push({
      kind,
      partner,
      value: p.scoring && r0 ? p.value : 0,
      three: p.scoring && r0 && p.value === 3,
      ft: /free throw/i.test(type),
      period: p.period,
      periodName: periodName(p.period),
      clock: p.clockText,
      cs: p.cs,
      t: p.t,
      marginBefore,
      marginAfter,
      score: { home: p.home, away: p.away },
      text: p.text,
    });
  }
  return out;
}

function sumBy(ev, kind) {
  return ev.filter((e) => e.kind === kind).length;
}

// only games played before this one count (reruns of old games must not see the future)
function historyContext(history, eventId, gameDate, line, seasonYear) {
  const season = seasonLabel(seasonYear);
  const before = (r) => r.date && new Date(r.date) < new Date(gameDate);
  const reg = history.filter((r) => r.type === 'regular' && r.eventId !== eventId && before(r));
  const thisSeason = reg.filter((r) => r.season === season);
  const tpm = (r) => r.tp?.[0] || 0;
  const value = (r, k) => (k === 'tpm' ? tpm(r) : r[k]);
  const records = {};
  for (const k of [...STATS, 'tpm', 'to']) {
    const cur = k === 'tpm' ? line.tp?.[0] || 0 : line[k];
    const best = (rows) => rows.reduce((b, r) => (value(r, k) > (b ? value(b, k) : -1) ? r : b), null);
    const cb = best(reg), sb = best(thisSeason);
    records[k] = {
      value: cur,
      careerHigh: cb ? { value: value(cb, k), date: cb.date, opp: cb.opp, season: cb.season } : null,
      seasonHigh: sb ? { value: value(sb, k), date: sb.date, opp: sb.opp } : null,
      isCareerHigh: cb ? cur > value(cb, k) : false,
      tiesCareerHigh: cb ? cur === value(cb, k) && cur > 0 : false,
      isSeasonHigh: sb ? cur > value(sb, k) : false,
    };
  }
  const avg = (k) => (thisSeason.length ? Math.round((thisSeason.reduce((a, r) => a + value(r, k), 0) / thisSeason.length) * 10) / 10 : null);
  const tens = (r) => STATS.filter((k) => r[k] >= 10).length;
  const withThis = [...thisSeason, { ...line, tp: line.tp, current: true }];
  const streak = (test) => {
    let n = 0;
    for (let i = withThis.length - 1; i >= 0 && test(withThis[i]); i--) n++;
    return n;
  };
  const careerTD = reg.filter((r) => tens(r) >= 3).length;
  const last = thisSeason.at(-1) || reg.at(-1) || null;
  return {
    season,
    gamesBeforeThisSeason: thisSeason.length,
    careerRegularSeasonGames: reg.length,
    seasonAverageBefore: { pts: avg('pts'), reb: avg('reb'), ast: avg('ast'), min: avg('min') },
    records,
    streaks: {
      games20plus: streak((r) => r.pts >= 20),
      doubleDoubles: streak((r) => tens(r) >= 2),
    },
    tripleDouble: tens(line) >= 3 ? { careerNumber: careerTD + 1 } : null,
    careerTripleDoublesBefore: careerTD,
    doubleDoublesThisSeasonBefore: thisSeason.filter((r) => tens(r) >= 2).length,
    previousGame: last ? { date: last.date, opp: last.opp, atVs: last.atVs, result: last.result, score: last.score, pts: last.pts, reb: last.reb, ast: last.ast } : null,
    source: 'ESPN game log, regular season only',
  };
}

function teamContext(schedule, eventId, gameDate, teamId) {
  const events = schedule?.events || [];
  const done = [];
  let next = null;
  for (const e of events) {
    const c = e.competitions?.[0];
    if (!c) continue;
    const st = c.status?.type?.state;
    const me = c.competitors?.find((x) => x.id === teamId || x.team?.id === teamId);
    const opp = c.competitors?.find((x) => x !== me);
    if (!me || !opp) continue;
    if (st === 'post' && new Date(e.date) <= new Date(gameDate)) done.push({ id: e.id, date: e.date, won: !!me.winner });
    if (new Date(e.date) > new Date(gameDate) && !next) {
      next = { id: e.id, opp: opp.team?.abbreviation, oppHe: heTeam(opp.team?.abbreviation, true), home: me.homeAway === 'home', israel: israelTime(e.date) };
    }
  }
  if (!done.some((d) => d.id === eventId)) done.push({ id: eventId, date: gameDate, won: null });
  let streak = null;
  const finished = done.filter((d) => d.won !== null);
  if (finished.length) {
    const w = finished.at(-1).won;
    let n = 0;
    for (let i = finished.length - 1; i >= 0 && finished[i].won === w; i--) n++;
    streak = { kind: w ? 'W' : 'L', length: n };
  }
  return { next, streak, source: 'ESPN team schedule' };
}

export function buildPlayerFacts({ summary, facts: f, player, history = [], schedule = null }) {
  const side = ['home', 'away'].find((s) => f.players[s].some((p) => p.id === player.id))
    || ['home', 'away'].find((s) => f.teams[s].abbr === player.team);
  const base = { schema: 1, gameId: f.gameId, player: { id: player.id, name: player.name, he: player.he || null, track: player.track || 'short' } };
  if (!side) return { ...base, inGame: false };
  const team = f.teams[side];
  const oppSide = side === 'home' ? 'away' : 'home';
  const line = f.players[side].find((p) => p.id === player.id) || null;
  const won = f.result.winner === side;
  const out = {
    ...base,
    inGame: true,
    side,
    team: { abbr: team.abbr, he: team.he, score: team.score, record: team.record },
    opp: { abbr: f.teams[oppSide].abbr, he: f.teams[oppSide].he, score: f.teams[oppSide].score, record: f.teams[oppSide].record },
    home: side === 'home',
    won,
    margin: f.result.margin,
    inBoxScore: !!line,
    played: !!line?.played,
    dnpReason: line && !line.played ? line.dnpReason : null,
  };
  out.team.context = teamContext(schedule, f.gameId, f.date, team.id);
  if (!line) { out.note = 'not in the box score (not on the active list — G League or inactive?)'; return out; }
  if (!line.played) return out;

  out.line = line;
  const names = new Map();
  for (const s of ['home', 'away']) for (const p of f.players[s]) names.set(p.id, p.name);
  const plays = normPlays(summary.plays, names, f.teams.home.id);
  const ev = playerEvents(plays, player.id, names, side);

  // the play-by-play has to agree with his box-score line before any of it is used
  const counted = {
    pts: ev.filter((e) => e.kind === 'score').reduce((a, e) => a + e.value, 0),
    ast: sumBy(ev, 'assist'),
    reb: sumBy(ev, 'oreb') + sumBy(ev, 'dreb'),
    stl: sumBy(ev, 'steal'),
    blk: sumBy(ev, 'block'),
    to: sumBy(ev, 'turnover'),
  };
  out.pbpCheck = Object.fromEntries(Object.entries(counted).map(([k, v]) => [k, { pbp: v, box: line[k], ok: v === line[k] }]));
  // points and assists drive the timeline (go-ahead baskets, assists in crunch time) and must match;
  // ESPN's feed sometimes drops a rebound or steal — the box-score line is what gets written anyway
  out.pbpOk = ['pts', 'ast'].every((k) => out.pbpCheck[k].ok);
  out.pbpWarnings = Object.entries(out.pbpCheck).filter(([k, c]) => !c.ok && !['pts', 'ast'].includes(k)).map(([k, c]) => `${k}: play-by-play ${c.pbp}, box score ${c.box}`);

  const finalPeriod = f.clutch.finalPeriod;
  const periods = Array.from({ length: finalPeriod }, (_, i) => i + 1);
  out.byPeriod = periods.map((p) => ({
    period: p,
    periodName: periodName(p),
    pts: ev.filter((e) => e.kind === 'score' && e.period === p).reduce((a, e) => a + e.value, 0),
    ast: ev.filter((e) => e.kind === 'assist' && e.period === p).length,
    reb: ev.filter((e) => (e.kind === 'oreb' || e.kind === 'dreb') && e.period === p).length,
  }));
  out.halves = { first: out.byPeriod.filter((x) => x.period <= 2).reduce((a, x) => a + x.pts, 0), second: out.byPeriod.filter((x) => x.period >= 3).reduce((a, x) => a + x.pts, 0) };

  const assistsTo = {};
  for (const e of ev.filter((x) => x.kind === 'assist')) assistsTo[e.partner || '?'] = (assistsTo[e.partner || '?'] || 0) + 1;
  out.assistsTo = Object.entries(assistsTo).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }));
  out.assistedBy = Object.entries(ev.filter((e) => e.kind === 'score' && e.partner).reduce((m, e) => ((m[e.partner] = (m[e.partner] || 0) + 1), m), {})).map(([name, n]) => ({ name, n }));

  // crunch time: his actions in the last five minutes of the final period (and OT) while it was within 10
  out.clutch = ev.filter((e) => e.period >= Math.min(4, finalPeriod) && e.period === finalPeriod && e.cs <= 300 && Math.abs(e.marginBefore) <= 10 && !['in', 'out'].includes(e.kind))
    .map(({ kind, partner, value, periodName: pn, clock, marginBefore, marginAfter, score, text }) => ({ kind, partner, value, periodName: pn, clock, marginBefore, marginAfter, score, text }));
  // his baskets that tied the game or put his team ahead
  out.leadPlays = ev.filter((e) => e.kind === 'score' && e.marginBefore <= 0 && e.marginAfter >= 0)
    .map((e) => ({ periodName: e.periodName, clock: e.clock, value: e.value, tied: e.marginAfter === 0, score: e.score, text: e.text }));
  // assists on his team's go-ahead or tying baskets
  out.leadAssists = ev.filter((e) => e.kind === 'assist' && e.marginBefore <= 0 && e.marginAfter >= 0)
    .map((e) => ({ periodName: e.periodName, clock: e.clock, to: e.partner, score: e.score, text: e.text }));

  // best scoring burst: most points inside six game-minutes
  const scores = ev.filter((e) => e.kind === 'score');
  let burst = null;
  for (let a = 0; a < scores.length; a++) {
    let pts = 0;
    for (let b = a; b < scores.length && scores[b].t - scores[a].t <= 360; b++) {
      pts += scores[b].value;
      if (!burst || pts > burst.pts) burst = { pts, from: { periodName: scores[a].periodName, clock: scores[a].clock }, to: { periodName: scores[b].periodName, clock: scores[b].clock } };
    }
  }
  out.bestBurst = burst && burst.pts >= 7 ? burst : null;

  const fouls = ev.filter((e) => e.kind === 'foul');
  out.fouls = {
    total: line.pf,
    fourth: fouls[3] ? { periodName: fouls[3].periodName, clock: fouls[3].clock, beforeHalf: fouls[3].period <= 2 } : null,
    fifth: fouls[4] ? { periodName: fouls[4].periodName, clock: fouls[4].clock } : null,
    fouledOut: line.pf >= 6,
  };
  out.technicals = ev.filter((e) => e.kind === 'technical').map((e) => ({ periodName: e.periodName, clock: e.clock, text: e.text }));
  out.dunks = scores.filter((e) => /dunk/i.test(e.text)).length;
  out.threes = scores.filter((e) => e.three).map((e) => ({ periodName: e.periodName, clock: e.clock, score: e.score }));

  // team context: who else starred, team shooting
  const mates = f.players[side].filter((p) => p.played && p.id !== player.id).sort((a, b) => b.pts - a.pts).slice(0, 4);
  const opps = f.players[oppSide].filter((p) => p.played).sort((a, b) => b.pts - a.pts).slice(0, 3);
  out.teammates = mates.map(({ name, pts, reb, ast, flags }) => ({ name, pts, reb, ast, flags }));
  out.opponents = opps.map(({ name, pts, reb, ast, flags }) => ({ name, pts, reb, ast, flags }));
  const rank = (k) => {
    const better = f.players[side].filter((p) => p.played && p.id !== player.id && p[k] > line[k]).length;
    const tied = f.players[side].some((p) => p.played && p.id !== player.id && p[k] === line[k]);
    return { place: better + 1, shared: tied };
  };
  out.teamRank = { pts: rank('pts'), reb: rank('reb'), ast: rank('ast'), min: rank('min') };

  if (history.length && f.seasonType === 2) out.history = historyContext(history, f.gameId, f.date, line, Number(summary.header?.season?.year));
  out.milestones = milestones(out);
  return out;
}

// a season high only counts as news above these numbers
const SEASON_HIGH_MIN = { pts: 20, reb: 8, ast: 6, stl: 3, blk: 3, tpm: 4 };

// plain list of verified "news" in his line (from history + box score)
function milestones(o) {
  const m = [];
  const h = o.history;
  const he = { pts: 'points', reb: 'rebounds', ast: 'assists', stl: 'steals', blk: 'blocks', tpm: 'threes' };
  if (h) {
    for (const [k, r] of Object.entries(h.records)) {
      // turnovers: only the bad record counts (most in his career), never as a "high"
      if (k === 'to') { if (r.isCareerHigh && r.value >= 5) m.push({ type: 'CAREER_HIGH_TO', stat: k, text: `most turnovers in his career: ${r.value} (previous ${r.careerHigh.value})` }); continue; }
      if (r.isCareerHigh) m.push({ type: 'CAREER_HIGH', stat: k, text: `career high ${he[k]}: ${r.value} (previous ${r.careerHigh.value}, ${r.careerHigh.season} vs ${r.careerHigh.opp})` });
      else if (r.tiesCareerHigh && r.value >= 5) m.push({ type: 'TIES_CAREER_HIGH', stat: k, text: `ties career high ${he[k]}: ${r.value}` });
      else if (r.isSeasonHigh && h.gamesBeforeThisSeason >= 3 && r.value >= SEASON_HIGH_MIN[k]) m.push({ type: 'SEASON_HIGH', stat: k, text: `season high ${he[k]}: ${r.value} (previous ${r.seasonHigh.value})` });
    }
    if (h.tripleDouble) m.push({ type: 'TRIPLE_DOUBLE', text: `career triple-double #${h.tripleDouble.careerNumber}` });
    if (h.streaks.games20plus >= 3) m.push({ type: 'STREAK', text: `${h.streaks.games20plus} straight games with 20+ points this season` });
    if (h.streaks.doubleDoubles >= 3) m.push({ type: 'STREAK', text: `${h.streaks.doubleDoubles} straight double-doubles` });
    if (o.line.flags.includes('double-double') && h.doubleDoublesThisSeasonBefore === 0 && h.gamesBeforeThisSeason > 0) m.push({ type: 'FIRST', text: 'first double-double of the season' });
  }
  const lead = (k, label, min) => {
    const r = o.teamRank[k];
    if (r.place === 1 && o.line[k] >= min) m.push({ type: 'TEAM_LEADER', text: r.shared ? `shared his team's lead in ${label}` : `led his team in ${label}` });
  };
  lead('pts', 'scoring', 1);
  lead('ast', 'assists', 5);
  lead('reb', 'rebounds', 7);
  if (o.fouls.fourth?.beforeHalf) m.push({ type: 'FOUL_TROUBLE', text: `fourth foul before halftime (${o.fouls.fourth.periodName} ${o.fouls.fourth.clock})` });
  if (o.fouls.fouledOut) m.push({ type: 'FOULED_OUT', text: 'fouled out' });
  return m;
}
