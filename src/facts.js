// Facts engine: turns one ESPN game summary into a structured, self-checked facts object.
// No AI here. Every value is read or computed from the box score / play-by-play, and each section
// says where it came from. The Hebrew writer (next stage) may only use what is in this object.
//
// Things the data cannot tell us (career/season highs, injury severity, quotes, standings meaning)
// are listed in `research` — never asserted.

import { heTeam } from './teams.js';

export const SCHEMA = 1;

const REG_PERIODS = 4;
const periodLen = (p) => (p <= REG_PERIODS ? 720 : 300);
export const periodName = (p) => (p <= REG_PERIODS ? `Q${p}` : `OT${p - REG_PERIODS}`);

export function clockSec(display) {
  const s = String(display ?? '');
  if (s.includes(':')) {
    const [m, sec] = s.split(':');
    return Number(m) * 60 + Number(sec);
  }
  return Number(s) || 0;
}

// seconds since tip-off at the moment of a play
function elapsed(period, cs) {
  let t = 0;
  for (let p = 1; p < period; p++) t += periodLen(p);
  return t + periodLen(period) - cs;
}

const at = (p) => ({ period: p.period, periodName: periodName(p.period), clock: p.clockText, secondsLeftInPeriod: p.cs });

// ---------- box score ----------

const STAT_KEYS = { MIN: 'min', PTS: 'pts', REB: 'reb', AST: 'ast', TO: 'to', STL: 'stl', BLK: 'blk', OREB: 'oreb', DREB: 'dreb', PF: 'pf', '+/-': 'plusMinus' };
const pair = (s) => {
  const m = String(s ?? '').match(/^(\d+)-(\d+)$/);
  return m ? [Number(m[1]), Number(m[2])] : null;
};

function readPlayers(teamBox) {
  const st = teamBox?.statistics?.[0];
  if (!st) return [];
  const labels = st.labels || st.names || [];
  return (st.athletes || []).map((a) => {
    const raw = a.stats || [];
    const get = (l) => raw[labels.indexOf(l)];
    const p = {
      id: a.athlete.id,
      name: a.athlete.displayName,
      pos: a.athlete.position?.abbreviation || '',
      starter: !!a.starter,
      played: !a.didNotPlay && raw.length > 0 && get('MIN') !== '0' && get('MIN') !== '--',
      dnpReason: a.didNotPlay ? a.reason || '' : '',
      ejected: !!a.ejected,
    };
    if (p.played) {
      for (const [l, k] of Object.entries(STAT_KEYS)) p[k] = Number(get(l)) || 0;
      p.fg = pair(get('FG'));
      p.tp = pair(get('3PT'));
      p.ft = pair(get('FT'));
    }
    return p;
  });
}

function playerFlags(p) {
  if (!p.played) return [];
  const f = [];
  const tens = ['pts', 'reb', 'ast', 'stl', 'blk'].filter((k) => p[k] >= 10).length;
  if (tens >= 3) f.push('triple-double');
  else if (tens === 2) f.push('double-double');
  if (p.pts >= 50) f.push('50+ points');
  else if (p.pts >= 40) f.push('40+ points');
  else if (p.pts >= 30) f.push('30+ points');
  if (p.reb >= 15) f.push('15+ rebounds');
  if (p.ast >= 12) f.push('12+ assists');
  if (p.blk >= 5) f.push('5+ blocks');
  if (p.stl >= 5) f.push('5+ steals');
  if (p.tp && p.tp[0] >= 7) f.push('7+ threes');
  if (p.fg && p.fg[1] >= 8 && p.fg[0] === p.fg[1]) f.push('perfect from the field');
  if (p.pf >= 6) f.push('fouled out');
  if (p.ejected) f.push('ejected');
  return f;
}

const TEAM_STATS = {
  fieldGoalPct: 'fgPct', threePointFieldGoalPct: 'threePct', freeThrowPct: 'ftPct', totalRebounds: 'reb',
  offensiveRebounds: 'oreb', assists: 'ast', steals: 'stl', blocks: 'blk', totalTurnovers: 'to',
  turnoverPoints: 'ptsOffTurnovers', fastBreakPoints: 'fastBreakPts', pointsInPaint: 'paintPts',
  largestLead: 'largestLead', leadChanges: 'leadChanges',
};

function readTeamStats(teamBox) {
  const out = {};
  for (const s of teamBox?.statistics || []) {
    if (TEAM_STATS[s.name]) out[TEAM_STATS[s.name]] = Number(s.displayValue);
    if (s.name === 'fieldGoalsMade-fieldGoalsAttempted') out.fg = pair(s.displayValue);
    if (s.name === 'threePointFieldGoalsMade-threePointFieldGoalsAttempted') out.tp = pair(s.displayValue);
    if (s.name === 'freeThrowsMade-freeThrowsAttempted') out.ft = pair(s.displayValue);
  }
  return out;
}

// ---------- play-by-play ----------

// ESPN's per-play score fields are sometimes corrupt (scores jump back and forth, or end on a different
// winner than the box score). The scoring plays themselves (team + points) have been reliable, so the
// running score is rebuilt from them; the reported fields are only counted as a quality signal.
export function normPlays(raw, names, homeId) {
  let home = 0, away = 0, reportedMismatches = 0, clockRegressions = 0;
  let prev = null;
  const plays = (raw || []).map((p, i) => {
    const period = p.period?.number || 1;
    const cs = clockSec(p.clock?.displayValue);
    const ids = (p.participants || []).map((x) => x.athlete?.id).filter(Boolean);
    const scorerId = ids[0];
    const side = p.team?.id ? (p.team.id === homeId ? 'home' : 'away') : null;
    const scoring = !!p.scoringPlay;
    const value = Number(p.scoreValue) || 0;
    if (scoring && side === 'home') home += value;
    if (scoring && side === 'away') away += value;
    if (Number(p.homeScore) !== home || Number(p.awayScore) !== away) reportedMismatches++;
    if (prev && prev.period === period && cs > prev.cs) clockRegressions++;
    prev = { period, cs };
    return {
      i,
      period,
      cs,
      clockText: p.clock?.displayValue || '',
      t: elapsed(period, cs),
      home,
      away,
      scoring,
      value,
      side,
      player: scorerId ? names.get(scorerId) || null : null,
      ids,
      shooting: !!p.shootingPlay,
      text: p.text || '',
      type: p.type?.text || '',
    };
  });
  plays.quality = { reportedMismatches, clockRegressions };
  return plays;
}

function leadFlow(plays) {
  const lead = { home: { pts: 0, at: null }, away: { pts: 0, at: null } };
  let changes = 0, ties = 0, last = 0;
  for (const p of plays.filter((x) => x.scoring)) {
    const d = p.home - p.away;
    if (d > lead.home.pts) lead.home = { pts: d, at: at(p), score: { home: p.home, away: p.away } };
    if (-d > lead.away.pts) lead.away = { pts: -d, at: at(p), score: { home: p.home, away: p.away } };
    const s = Math.sign(d);
    if (s === 0 && last !== 0) ties++;
    if (s !== 0 && last !== 0 && s !== last) changes++;
    if (s !== 0) last = s;
  }
  return { largestLead: lead, leadChanges: changes, ties };
}

// Best scoring spurts per side: window of scoring plays within 6 game-minutes, max (for - against).
function spurts(plays, minDiff = 10, maxWindow = 360) {
  const sc = plays.filter((p) => p.scoring && p.side);
  const found = [];
  for (const side of ['home', 'away']) {
    const cands = [];
    for (let a = 0; a < sc.length; a++) {
      if (sc[a].side !== side) continue;
      const before = a > 0 ? sc[a - 1] : { home: 0, away: 0 };
      for (let b = a; b < sc.length && sc[b].t - sc[a].t <= maxWindow; b++) {
        if (sc[b].side !== side) continue;
        const forPts = sc[b][side] - before[side];
        const other = side === 'home' ? 'away' : 'home';
        const against = sc[b][other] - before[other];
        if (forPts - against >= minDiff) cands.push({ side, for: forPts, against, a, b, before });
      }
    }
    cands.sort((x, y) => y.for - y.against - (x.for - x.against) || x.against - y.against);
    const taken = [];
    for (const c of cands) {
      if (taken.some((t) => !(c.b < t.a || c.a > t.b))) continue;
      taken.push(c);
      if (taken.length === 3) break;
    }
    for (const c of taken) {
      found.push({
        side: c.side,
        for: c.for,
        against: c.against,
        from: at(sc[c.a]),
        to: at(sc[c.b]),
        scoreBefore: { home: c.before.home, away: c.before.away },
        scoreAfter: { home: sc[c.b].home, away: sc[c.b].away },
      });
    }
  }
  return found.sort((x, y) => y.for - y.against - (x.for - x.against));
}

// score after the last play that happened with more than `secondsLeft` on the clock in `period`
function scoreAt(plays, period, secondsLeft) {
  let s = { home: 0, away: 0 };
  for (const p of plays) {
    if (p.period > period || (p.period === period && p.cs < secondsLeft)) break;
    s = { home: p.home, away: p.away };
  }
  return s;
}

function clutch(plays, winner, finalPeriod) {
  const sc = plays.filter((p) => p.scoring);
  const sign = winner === 'home' ? 1 : -1;
  // the basket that gave the winner the lead for good
  let decisive = null;
  for (let k = 0; k < sc.length; k++) {
    const prev = k > 0 ? sc[k - 1] : { home: 0, away: 0 };
    const before = sign * (prev.home - prev.away);
    const after = sign * (sc[k].home - sc[k].away);
    if (before <= 0 && after > 0) decisive = sc[k];
  }
  const out = {
    finalPeriod,
    finalPeriodName: periodName(finalPeriod),
    overtimes: Math.max(0, finalPeriod - REG_PERIODS),
    marginAt5min: null,
    marginAt2min: null,
    winningBasket: null,
    tyingShotToOT: null,
    loserLedInLast3min: false,
    finalSequence: [],
  };
  if (finalPeriod >= REG_PERIODS) {
    const s5 = scoreAt(plays, finalPeriod, 300);
    const s2 = scoreAt(plays, finalPeriod, 120);
    out.marginAt5min = { ...s5, winnerMargin: sign * (s5.home - s5.away) };
    out.marginAt2min = { ...s2, winnerMargin: sign * (s2.home - s2.away) };
  }
  if (decisive) {
    out.winningBasket = {
      ...at(decisive),
      player: decisive.player,
      side: decisive.side,
      points: decisive.value,
      text: decisive.text,
      scoreAfter: { home: decisive.home, away: decisive.away },
      inFinalPeriod: decisive.period === finalPeriod,
      late: decisive.period === finalPeriod && decisive.cs <= 30,
      buzzer: decisive.period === finalPeriod && decisive.cs <= 1,
    };
  }
  if (finalPeriod > REG_PERIODS) {
    const reg = sc.filter((p) => p.period === REG_PERIODS);
    const last = reg[reg.length - 1];
    if (last && last.home === last.away) {
      out.tyingShotToOT = { ...at(last), player: last.player, side: last.side, points: last.value, text: last.text, score: { home: last.home, away: last.away } };
    }
  }
  out.loserLedInLast3min = plays.some((p) => p.period === finalPeriod && p.cs <= 180 && -sign * (p.home - p.away) > 0);
  // last two minutes of the final period, when it was within 10 at the two-minute mark
  if (out.marginAt2min && Math.abs(out.marginAt2min.winnerMargin) <= 10) {
    out.finalSequence = plays
      .filter((p) => p.period === finalPeriod && p.cs <= 120 && !/substitution/i.test(p.type) && p.text && !/^End of/i.test(p.text))
      .map((p) => ({ clock: p.clockText, secondsLeft: p.cs, score: { home: p.home, away: p.away }, side: p.side, text: p.text, scoring: p.scoring }));
  }
  return out;
}

// ---------- story candidates (deterministic) ----------

function candidates(f) {
  const c = [];
  const W = f.teams[f.result.winner], L = f.teams[f.result.loser];
  const add = (type, weight, why, evidence) => c.push({ type, weight, why, evidence });
  const m = f.result.margin;
  const wb = f.clutch.winningBasket;

  if (wb?.late) add(wb.buzzer ? 'BUZZER_BEATER' : 'GAME_WINNER', wb.buzzer ? 100 : 92, `${wb.player || W.name} put ${W.abbr} ahead for good with ${wb.secondsLeftInPeriod}s left`, 'pbp');
  if (f.clutch.tyingShotToOT && f.clutch.tyingShotToOT.secondsLeftInPeriod <= 30) add('FORCED_OT', 75, `${f.clutch.tyingShotToOT.player || 'tying basket'} tied it with ${f.clutch.tyingShotToOT.secondsLeftInPeriod}s left in regulation`, 'pbp');
  if (f.clutch.overtimes) add('OVERTIME', 60 + 10 * f.clutch.overtimes, `${f.clutch.overtimes} overtime period(s)`, 'box');
  // a deficit is a story when it was big, or when it came after the first quarter
  const deficit = f.flow.largestLead[f.result.loser];
  const late = (deficit.at?.period || 1) >= 2;
  if (deficit.pts >= 15) add('COMEBACK', 70 + Math.min(20, deficit.pts - 15) + (late ? 5 : 0), `${W.abbr} came back from ${deficit.pts} down (${deficit.at?.periodName})`, 'pbp');
  else if (deficit.pts >= 10 && late) add('COMEBACK', 55, `${W.abbr} came back from ${deficit.pts} down (${deficit.at?.periodName})`, 'pbp');
  if (f.clutch.loserLedInLast3min && !wb?.late) add('LATE_COLLAPSE', 60, `${L.abbr} led inside the last three minutes and lost`, 'pbp');
  if (m <= 3 && !wb?.late) add('CLOSE_FINISH', 55, `decided by ${m}`, 'box');

  // season-context angles that the records themselves prove (records are after this game)
  const rec = (side) => {
    const r = String(f.teams[side].record || '').match(/^(\d+)-(\d+)$/);
    return r ? { w: Number(r[1]), l: Number(r[2]) } : null;
  };
  const wr = rec(f.result.winner), lr = rec(f.result.loser);
  // an unbeaten team's first loss outranks an ordinary game-winner or overtime: it is the night's news
  if (lr && lr.l === 1 && lr.w >= 3) c.push({ type: 'FIRST_LOSS', weight: 95, side: f.result.loser, n: lr.w, why: `${L.abbr} lost for the first time after a ${lr.w}-0 start`, evidence: 'box' });
  if (wr && wr.w === 1 && wr.l >= 3) c.push({ type: 'FIRST_WIN', weight: 80, side: f.result.winner, n: wr.l, why: `${W.abbr} won for the first time after an 0-${wr.l} start`, evidence: 'box' });
  if (wr && wr.l === 0 && wr.w >= 4) c.push({ type: 'UNBEATEN', weight: 62, side: f.result.winner, n: wr.w, why: `${W.abbr} stayed unbeaten at ${wr.w}-0`, evidence: 'box' });
  if (lr && lr.w === 0 && lr.l >= 4) c.push({ type: 'WINLESS', weight: 55, side: f.result.loser, n: lr.l, why: `${L.abbr} still winless at 0-${lr.l}`, evidence: 'box' });
  // one quarter that decided it
  f.teams.home.periods.forEach((h, i) => {
    const a = f.teams.away.periods[i];
    if (Math.abs(h - a) >= 18) {
      const side = h > a ? 'home' : 'away';
      c.push({ type: 'DOMINANT_QUARTER', weight: side === f.result.winner ? 58 : 40, side, period: i + 1, score: { home: h, away: a }, why: `${f.teams[side].abbr} won period ${i + 1} by ${Math.abs(h - a)}`, evidence: 'box' });
    }
  });
  if (m >= 25) add('BLOWOUT', 45, `won by ${m}`, 'box');

  for (const side of ['home', 'away']) {
    for (const p of f.players[side]) {
      if (!p.played) continue;
      const fl = p.flags;
      const won = side === f.result.winner;
      const base = won ? 0 : -5;
      if (fl.includes('triple-double')) add('TRIPLE_DOUBLE', 70 + base, `${p.name}: ${p.pts}/${p.reb}/${p.ast}`, 'box');
      if (fl.includes('50+ points')) add('BIG_SCORING', 95 + base, `${p.name}: ${p.pts} points`, 'box');
      else if (fl.includes('40+ points')) add('BIG_SCORING', 75 + base, `${p.name}: ${p.pts} points`, 'box');
      if (p.pts >= 20 && p.reb >= 20) add('UNUSUAL_STAT_LINE', 65 + base, `${p.name}: ${p.pts} points, ${p.reb} rebounds`, 'box');
      if (fl.includes('ejected')) add('EJECTION', 50, `${p.name} was ejected`, 'box');
    }
  }
  for (const s of f.flow.spurts.slice(0, 1)) {
    if (s.for - s.against >= 15) add('MAJOR_RUN', 45, `${f.teams[s.side].abbr} ${s.for}-${s.against} run (${s.from.periodName} ${s.from.clock} to ${s.to.periodName} ${s.to.clock})`, 'pbp');
  }
  for (const i of f.israelis) {
    if (i.played) add('ISRAELI_ANGLE', 85, `${i.name} (${i.team}): ${i.pts} pts, ${i.reb} reb, ${i.ast} ast in ${i.min} min`, 'box');
    else add('ISRAELI_ANGLE', 60, `${i.name} (${i.team}) did not play${i.dnpReason ? ': ' + i.dnpReason : ''}`, 'box');
  }
  // fallback so every game has a top performer candidate
  const top = [...f.players.home, ...f.players.away].filter((p) => p.played).sort((a, b) => b.pts - a.pts)[0];
  if (top) add('TOP_PERFORMER', 40, `${top.name}: ${top.pts} points`, 'box');
  return c.sort((a, b) => b.weight - a.weight);
}

function research(f) {
  const r = [];
  for (const side of ['home', 'away']) {
    for (const p of f.players[side]) {
      if (!p.played) continue;
      if (p.pts >= 30 || p.flags.includes('triple-double') || p.reb >= 15 || p.ast >= 12) r.push(`האם השורה של ${p.name} (${p.pts} נק', ${p.reb} ריב', ${p.ast} אס') היא שיא קריירה או עונה?`);
      if (p.ejected) r.push(`למה ${p.name} הורחק? צפוי עונש?`);
    }
    for (const p of f.players[side]) {
      if (!p.played && /injur|ill|sore|sprain|strain|surgery|rest/i.test(p.dnpReason)) r.push(`${p.name} (${f.teams[side].heShort || f.teams[side].abbr}) לא שיחק: ${p.dnpReason}. לכמה זמן? כמה חמור?`);
    }
  }
  if (f.clutch.winningBasket?.late) r.push('תגובות אחרי המשחק על המהלך האחרון (מאמן / קלע) — רק ממקור עם שם.');
  r.push(`רצפים ומשמעות בטבלה ל${f.teams.home.heShort || f.teams.home.abbr} ול${f.teams.away.heShort || f.teams.away.abbr}.`);
  return r;
}

// ---------- checks ----------

function checks(f) {
  const out = [];
  const add = (name, ok, detail, severity = 'error') => out.push({ name, ok, detail, severity: ok ? 'ok' : severity });
  add('final', f.status.final, f.status.detail);
  for (const side of ['home', 'away']) {
    const t = f.teams[side];
    const qs = t.periods.reduce((a, b) => a + b, 0);
    add(`${side}: periods sum = score`, qs === t.score, `${qs} vs ${t.score}`);
    const ps = f.players[side].filter((p) => p.played).reduce((a, p) => a + p.pts, 0);
    add(`${side}: player points sum = score`, ps === t.score, `${ps} vs ${t.score}`);
    if (f.teamStats[side].largestLead != null) {
      add(`${side}: largest lead matches ESPN`, f.teamStats[side].largestLead === f.flow.largestLead[side].pts, `computed ${f.flow.largestLead[side].pts}, ESPN ${f.teamStats[side].largestLead}`, 'warn');
    }
  }
  if (f.flow.available) {
    add('score rebuilt from play-by-play = box score', f.flow.finalScore.home === f.teams.home.score && f.flow.finalScore.away === f.teams.away.score,
      `pbp ${f.flow.finalScore.away}-${f.flow.finalScore.home}, box ${f.teams.away.score}-${f.teams.home.score}`);
    const q = f.flow.quality;
    add('ESPN per-play scores consistent', q.reportedMismatches === 0, `${q.reportedMismatches} plays with a wrong running score in the feed (ignored: score rebuilt from baskets)`, 'info');
    add('play clock in order', q.clockRegressions === 0, `${q.clockRegressions} plays out of clock order`, 'warn');
    const espnLc = f.teamStats.home.leadChanges;
    if (espnLc != null) add('lead changes match ESPN', espnLc === f.flow.leadChanges, `computed ${f.flow.leadChanges}, ESPN ${espnLc}`, 'warn');
  } else {
    add('play-by-play available', false, 'no plays in feed — clutch and runs unknown', 'warn');
  }
  return out;
}

// ---------- main ----------

export function buildFacts(summary, { israelis = [], fetchedAt = new Date().toISOString() } = {}) {
  const comp = summary.header?.competitions?.[0];
  if (!comp) throw new Error('summary has no competition header');
  const H = comp.competitors.find((c) => c.homeAway === 'home');
  const A = comp.competitors.find((c) => c.homeAway === 'away');
  const statusType = comp.status?.type || {};

  const boxFor = (id) => summary.boxscore?.players?.find((p) => p.team.id === id);
  const teamBoxFor = (id) => summary.boxscore?.teams?.find((t) => t.team.id === id);

  const team = (c) => ({
    id: c.team.id,
    abbr: c.team.abbreviation,
    name: c.team.displayName,
    he: heTeam(c.team.abbreviation, true),
    heShort: heTeam(c.team.abbreviation),
    score: Number(c.score),
    periods: (c.linescores || []).map((l) => Number(l.displayValue)),
    record: (c.record || []).find((r) => r.type === 'total')?.summary || '',
    venueRecord: (c.record || []).find((r) => r.type === 'home' || r.type === 'road')?.summary || '',
  });

  const f = {
    schema: SCHEMA,
    gameId: summary.header?.id,
    source: { provider: 'espn', fetchedAt, url: `https://www.espn.com/nba/game/_/gameId/${summary.header?.id}` },
    date: comp.date,
    seasonType: summary.header?.season?.type ?? null,
    note: (comp.notes || []).map((n) => n.headline).filter(Boolean).join('; ') || null,
    venue: summary.gameInfo?.venue?.fullName || null,
    status: { final: statusType.state === 'post' && !!statusType.completed, state: statusType.state, detail: statusType.detail || '' },
    teams: { home: team(H), away: team(A) },
  };

  const players = { home: readPlayers(boxFor(H.team.id)), away: readPlayers(boxFor(A.team.id)) };
  for (const side of ['home', 'away']) for (const p of players[side]) p.flags = playerFlags(p);
  f.players = players;
  f.bench = Object.fromEntries(['home', 'away'].map((s) => [s, players[s].filter((p) => p.played && !p.starter).reduce((a, p) => a + p.pts, 0)]));
  f.teamStats = { home: readTeamStats(teamBoxFor(H.team.id)), away: readTeamStats(teamBoxFor(A.team.id)) };

  const winner = f.teams.home.score > f.teams.away.score ? 'home' : 'away';
  f.result = {
    winner,
    loser: winner === 'home' ? 'away' : 'home',
    margin: Math.abs(f.teams.home.score - f.teams.away.score),
    halftime: { home: sum(f.teams.home.periods.slice(0, 2)), away: sum(f.teams.away.periods.slice(0, 2)) },
    after3: { home: sum(f.teams.home.periods.slice(0, 3)), away: sum(f.teams.away.periods.slice(0, 3)) },
  };

  const names = new Map();
  for (const side of ['home', 'away']) for (const p of players[side]) names.set(p.id, p.name);
  const plays = normPlays(summary.plays, names, H.team.id);
  const finalPeriod = Math.max(f.teams.home.periods.length, plays.at(-1)?.period || REG_PERIODS);
  f.flow = plays.length
    ? { available: true, quality: plays.quality, ...leadFlow(plays), spurts: spurts(plays), finalScore: { home: plays.at(-1).home, away: plays.at(-1).away } }
    : { available: false, largestLead: { home: { pts: f.teamStats.home.largestLead ?? 0 }, away: { pts: f.teamStats.away.largestLead ?? 0 } }, leadChanges: null, ties: null, spurts: [] };
  f.clutch = plays.length ? clutch(plays, winner, finalPeriod) : { finalPeriod, overtimes: Math.max(0, finalPeriod - REG_PERIODS), winningBasket: null, tyingShotToOT: null, finalSequence: [] };

  // context from ESPN structured data (not box score) — labelled as such
  f.context = {
    seasonSeries: (summary.seasonseries || []).map((s) => s.summary).filter(Boolean),
    injuryReport: (summary.injuries || []).flatMap((t) => (t.injuries || []).map((i) => ({ team: t.team?.abbreviation, name: i.athlete?.displayName, status: i.status, detail: i.details?.detail || i.details?.type || '' }))),
    source: 'ESPN structured data (pre-game injury report, season series)',
  };

  // config entries are {id, name, he, track} (a bare name string also works)
  const wanted = israelis.map((x) => (typeof x === 'string' ? { name: x } : x));
  f.israelis = [];
  for (const side of ['home', 'away']) {
    for (const p of players[side]) {
      const w = wanted.find((x) => (x.id && x.id === p.id) || (x.name && x.name.toLowerCase() === p.name.toLowerCase()));
      if (w) f.israelis.push({ ...p, he: w.he || null, track: w.track || 'short', team: f.teams[side].abbr, side });
    }
  }

  f.candidates = candidates(f);
  f.research = research(f);
  f.checks = checks(f);
  f.ok = f.checks.every((c) => c.severity !== 'error');
  return f;
}

function sum(a) {
  return a.reduce((x, y) => x + y, 0);
}
