// CONTEXT FACTS: what the season and history say around one game (streaks, head-to-head, season and
// career highs, scoring streaks). They are never inferred from this game's box score alone: each one is
// computed from an external ESPN source (team schedules, player game logs) and carries that source.
// If the source is missing, the fact is simply not produced. The writer may state only what is here.
//
// GAME FACTS (score, quarters, box score, play-by-play, runs) live in facts.js.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getTeamSchedule, getStandings } from './espn.js';
import { playerHistory, recentHistory } from './gamelog.js';
import { v, withLamed, heTeam } from './teams.js';
import { pair, nightHe, shortLineHe } from './writer/he.js';

const MAX_SEASONS_BACK = 6; // how far a head-to-head streak is followed before it counts as unknown

// only what context needs from an ESPN schedule (also keeps the on-disk cache small)
export function trimSchedule(j) {
  return {
    season: j?.season?.year || j?.requestedSeason?.year || null,
    events: (j?.events || []).map((e) => {
      const c = e.competitions?.[0] || {};
      return {
        id: e.id,
        date: e.date,
        state: c.status?.type?.state || null,
        cup: (c.notes || []).some((n) => /NBA Cup/i.test(n.headline || '')),
        teams: (c.competitors || []).map((x) => ({ id: x.team?.id || x.id, abbr: x.team?.abbreviation, winner: !!x.winner, home: x.homeAway === 'home', score: Number(x.score?.value ?? x.score?.displayValue ?? NaN) })),
      };
    }),
  };
}

// a team's finished games before this one, oldest first, plus this game's result from the box score
// (the schedule may not have this game marked final yet, so its result never comes from there)
export function resultsThrough(schedule, teamId, gameId, gameDate, wonThis) {
  const t = new Date(gameDate);
  const rows = (schedule?.events || [])
    .filter((e) => e.id !== gameId && e.state === 'post' && new Date(e.date) < t)
    .map((e) => {
      const me = e.teams.find((x) => x.id === teamId);
      const opp = e.teams.find((x) => x !== me);
      return me && opp ? { id: e.id, date: e.date, won: me.winner, opp: opp.id } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
  return [...rows, { id: gameId, date: gameDate, won: wonThis, opp: null }];
}

export function streakOf(rows) {
  if (!rows.length) return null;
  const w = rows.at(-1).won;
  let n = 0;
  for (let i = rows.length - 1; i >= 0 && rows[i].won === w; i--) n++;
  return { kind: w ? 'W' : 'L', length: n };
}

// consecutive wins of teamId over oppId, this game included; exact only when the last loss was found
export function h2hStreak(schedules, teamId, oppId, gameId, gameDate) {
  const t = new Date(gameDate);
  const meet = new Map();
  for (const s of schedules) {
    for (const e of s?.events || []) {
      if (e.state !== 'post' || e.id === gameId || new Date(e.date) >= t) continue;
      const me = e.teams.find((x) => x.id === teamId);
      const o = e.teams.find((x) => x.id === oppId);
      if (me && o) meet.set(e.id, { date: e.date, won: me.winner });
    }
  }
  const rows = [...meet.values()].sort((a, b) => b.date.localeCompare(a.date));
  let n = 1;
  for (const r of rows) {
    if (!r.won) return { n, exact: true };
    n++;
  }
  return { n, exact: false };
}

// NBA season label of a date: 2026-11-03 -> '2026-27'
export function seasonLabel(iso) {
  const d = new Date(iso);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  const start = m >= 8 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

// season high / career high / scoring streak for one player line, from his ESPN game log
export function playerContext(rows, line, gameId, gameDate) {
  const t = new Date(gameDate);
  const reg = (rows || []).filter((r) => r.type === 'regular' && r.eventId !== gameId && (!r.date || new Date(r.date) < t));
  const season = seasonLabel(gameDate);
  const thisSeason = reg.filter((r) => r.season === season);
  const out = [];
  if (thisSeason.length >= 3) {
    const max = Math.max(...thisSeason.map((r) => r.pts));
    if (line.pts > max) out.push({ type: 'SEASON_HIGH', value: line.pts, previous: max, previousOpp: thisSeason.find((r) => r.pts === max)?.opp || null });
    else if (line.pts === max) out.push({ type: 'TIES_SEASON_HIGH', value: line.pts });
  }
  if (reg.length >= 20) {
    const max = Math.max(...reg.map((r) => r.pts));
    if (line.pts > max) out.push({ type: 'CAREER_HIGH', value: line.pts, previous: max, previousOpp: [...reg].reverse().find((r) => r.pts === max)?.opp || null });
    else if (line.pts === max) out.push({ type: 'TIES_CAREER_HIGH', value: line.pts });
  }
  // the longest run of games ending tonight with 30+ points; its threshold is the lowest game in it
  const seq = [...thisSeason.map((r) => r.pts), line.pts];
  let best = null;
  for (let k = 4; k <= seq.length; k++) {
    const T = Math.min(...seq.slice(-k));
    if (T >= 30) best = { k, T };
    else break;
  }
  if (best) out.push({ type: 'SCORING_STREAK', games: best.k, min: best.T });
  return out;
}

// ---------- fetching (live) ----------

async function cachedSchedule(abbr, season, seasonType, cacheDir) {
  const file = join(cacheDir, 'schedules', `${abbr}-${season}-${seasonType}.json`);
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    const s = trimSchedule(await getTeamSchedule(abbr, { season, seasonType }));
    await mkdir(join(cacheDir, 'schedules'), { recursive: true });
    await writeFile(file, JSON.stringify(s));
    return s;
  }
}

// Everything buildContext needs, from ESPN. Failures leave a piece out (that context is then unknown).
export async function fetchContext(summary, { cacheDir, archiveDir = null }) {
  const comp = summary.header?.competitions?.[0];
  const ext = { schedules: {}, h2h: {}, gamelogs: {}, errors: [] };
  if (!comp) return ext;
  const cs = comp.competitors;
  const winner = [...cs].sort((a, b) => Number(b.score) - Number(a.score))[0];
  const loser = cs.find((c) => c !== winner);
  for (const c of cs) {
    try { ext.schedules[c.team.id] = trimSchedule(await getTeamSchedule(c.team.abbreviation)); } catch (e) { ext.errors.push(`schedule ${c.team.abbreviation}: ${e.message}`); }
  }
  // head-to-head: follow the winner's past seasons back until its last loss to this opponent
  const cur = ext.schedules[winner.team.id];
  if (cur?.season) {
    const list = [cur];
    let res = h2hStreak(list, winner.team.id, loser.team.id, summary.header.id, comp.date);
    for (let back = 1; !res.exact && back <= MAX_SEASONS_BACK; back++) {
      try {
        for (const type of [2, 3]) list.push(await cachedSchedule(winner.team.abbreviation, cur.season - back, type, cacheDir));
      } catch (e) { ext.errors.push(`h2h ${winner.team.abbreviation} ${cur.season - back}: ${e.message}`); break; }
      res = h2hStreak(list, winner.team.id, loser.team.id, summary.header.id, comp.date);
    }
    ext.h2h[winner.team.id] = { opp: loser.team.id, ...res };
  }
  // the conference table (ESPN standings) — used only where it already includes this game
  try { ext.standings = await getStandings(); } catch (e) { ext.errors.push(`standings: ${e.message}`); }
  // game logs of each team's top scorer when the line could be a season / career high or a streak
  for (const tb of summary.boxscore?.players || []) {
    const st = tb.statistics?.[0];
    const ix = (st?.labels || st?.names || []).indexOf('PTS');
    const top = (st?.athletes || []).map((a) => ({ id: a.athlete.id, pts: Number(a.stats?.[ix]) || 0 })).sort((a, b) => b.pts - a.pts)[0];
    if (!top || top.pts < 25) continue;
    try { ext.gamelogs[top.id] = await playerHistory(top.id, join(cacheDir, 'gamelog')); } catch (e) { ext.errors.push(`gamelog ${top.id}: ${e.message}`); }
  }
  // returns to a former team: every player with real minutes, this season + last (a trade shows in the log);
  // for the ones who face a former team, the full career (how many seasons he played there)
  ext.recent = {};
  // players OUT before the game: their season average says whether a star was missing
  const outIds = (summary.injuries || []).flatMap((t) => (t.injuries || []).filter((i) => /^out$/i.test(i.status || '')).map((i) => i.athlete?.id)).filter(Boolean);
  await Promise.all(outIds.map(async (id) => { try { ext.recent[id] = await recentHistory(id, join(cacheDir, 'gamelog')); } catch (e) { ext.errors.push(`recent ${id}: ${e.message}`); } }));
  const abbr = Object.fromEntries(cs.map((c) => [c.team.id, c.team.abbreviation]));
  for (const tb of summary.boxscore?.players || []) {
    const st = tb.statistics?.[0];
    const ix = (st?.labels || st?.names || []).indexOf('MIN');
    const opp = abbr[cs.find((c) => c.team.id !== tb.team.id)?.team.id];
    // one team's players in parallel (a recap must not wait 20 requests in a row)
    await Promise.all((st?.athletes || []).filter((x) => (Number(x.stats?.[ix]) || 0) >= 12).map(async (a) => {
      try {
        // starters with real minutes: the whole career (past seasons are cached, so only the first time costs);
        // the rest: this season and last
        const starter = a.starter && (Number(a.stats?.[ix]) || 0) >= 20;
        const rows = starter ? await playerHistory(a.athlete.id, join(cacheDir, 'gamelog')) : await recentHistory(a.athlete.id, join(cacheDir, 'gamelog'));
        ext.recent[a.athlete.id] = rows;
        if (starter) ext.gamelogs[a.athlete.id] = rows;
        if (rows.some((r) => r.team === opp && r.eventId !== summary.header.id) && !ext.gamelogs[a.athlete.id]) ext.gamelogs[a.athlete.id] = await playerHistory(a.athlete.id, join(cacheDir, 'gamelog'));
        // a star with a poor night: his whole career, to say how rare it is ("פעם עשירית בקריירה")
        const pts = Number(a.stats?.[(st?.labels || st?.names || []).indexOf('PTS')]) || 0;
        if (pts <= 10 && seasonAvg(rows, summary.header?.competitions?.[0]?.date, summary.header.id) >= 18 && !ext.gamelogs[a.athlete.id]) ext.gamelogs[a.athlete.id] = await playerHistory(a.athlete.id, join(cacheDir, 'gamelog'));
      } catch (e) { ext.errors.push(`recent ${a.athlete.id}: ${e.message}`); }
    }));
  }
  // OUR OWN ARCHIVE: each player's previous game, as this system wrote it (out/<date>/<game>.json, 10 nights)
  // — the moments a box score does not keep: a missed winner, the decisive basket
  ext.archive = previousMoments(summary, ext, archiveDir ?? join(cacheDir, '..', 'out'));
  return ext;
}

// game id -> our facts file, over the nights kept in out/
const archiveMemo = new Map();
function archiveIndex(dir) {
  if (archiveMemo.has(dir)) return archiveMemo.get(dir);
  const idx = new Map();
  if (existsSync(dir)) for (const night of readdirSync(dir).filter((d) => /^\d{8}$/.test(d))) {
    for (const file of readdirSync(join(dir, night)).filter((x) => /^\d+\.json$/.test(x))) idx.set(file.slice(0, -5), join(dir, night, file));
  }
  archiveMemo.set(dir, idx);
  return idx;
}

// for every player with a game log: his last game before this one, and what he did in its decisive moments
export function previousMoments(summary, ext, dir) {
  const out = {};
  const idx = archiveIndex(dir);
  const date = summary.header?.competitions?.[0]?.date;
  const gameId = summary.header?.id;
  const facts = new Map();
  for (const [pid, rows] of Object.entries({ ...ext.recent, ...ext.gamelogs })) {
    const prev = (rows || []).filter((r) => r.eventId !== gameId && r.min > 0 && r.date && new Date(r.date) < new Date(date)).at(-1);
    if (!prev || !idx.has(prev.eventId)) continue;
    if (!facts.has(prev.eventId)) { try { facts.set(prev.eventId, JSON.parse(readFileSync(idx.get(prev.eventId), 'utf8'))); } catch { facts.set(prev.eventId, null); } }
    const f = facts.get(prev.eventId);
    if (!f?.players) continue;
    const me = [...(f.players.home || []), ...(f.players.away || [])].find((p) => p.id === pid);
    if (!me) continue;
    const items = [];
    for (const m of (f.notable || []).filter((x) => x.type === 'MISSED_WINNER' && x.player === pid)) items.push({ kind: 'missed_winner', shot: m.shot, tying: m.kind === 'tying', lost: f.result?.loser === m.side });
    const wb = f.clutch?.winningBasket;
    if (wb?.late && wb.player === me.name) items.push({ kind: 'winner', buzzer: !!wb.buzzer, freeThrows: /free-throw/.test(wb.shot || '') });
    if (items.length) out[pid] = { eventId: prev.eventId, date: prev.date, opp: prev.opp, items };
  }
  return out;
}

// his points per game this season before this game (from 3 games on), else last season's
export function seasonAvg(rows, gameDate, gameId) {
  const t = new Date(gameDate);
  const reg = (rows || []).filter((r) => r.type === 'regular' && r.min > 0 && r.eventId !== gameId && r.date && new Date(r.date) < t);
  const season = seasonLabel(gameDate);
  const cur = reg.filter((r) => r.season === season);
  const lastSeason = reg.filter((x) => x.season < season).at(-1)?.season;
  const use = cur.length >= 3 ? cur : reg.filter((r) => r.season === lastSeason);
  return use.length >= 3 ? Math.round((use.reduce((a, r) => a + r.pts, 0) / use.length) * 10) / 10 : 0;
}

// a star: 18+ a game this season, or 20+ over a long career (LeBron at 15.7 this season is still LeBron)
export function isStar(rows, gameDate, gameId) {
  if (seasonAvg(rows, gameDate, gameId) >= 18) return true;
  const reg = (rows || []).filter((r) => r.type === 'regular' && r.min > 0 && r.eventId !== gameId && r.date && new Date(r.date) < new Date(gameDate));
  return reg.length >= 200 && reg.reduce((a, r) => a + r.pts, 0) / reg.length >= 20;
}

const ORD_F = ['', 'ראשונה', 'שנייה', 'שלישית', 'רביעית', 'חמישית', 'שישית', 'שביעית', 'שמינית', 'תשיעית', 'עשירית'];

// FORM FACTS — what a reader knows coming in, from ESPN game logs: a star missing (injury list + his average),
// a star held down (and how rare that is in his career), and a player's notable previous game
// ("48 hours after his 52"). Each one carries its numbers; nothing is inferred.
export function formFacts(f, ext = {}) {
  const out = [];
  const enToHe = ext.enToHe || new Map();
  const tn = (s) => f.teams[s].heShort || f.teams[s].he;
  const W = f.result.winner;
  const rowsOf = (id) => ext.gamelogs?.[id] || ext.recent?.[id] || null;
  const sur = (he) => he.split(' ').slice(1).join(' ') || he;
  const add = (x) => out.push({ verified: true, source: 'ESPN game log / injury report', ...x });
  // 1. stars who did not play
  const playedIds = new Set(['home', 'away'].flatMap((s) => f.players[s].filter((p) => p.played).map((p) => p.id)));
  const injured = (f.context?.injuryReport || []).filter((i) => /^out$/i.test(i.status || ''));
  for (const side of ['home', 'away']) {
    const stars = [];
    for (const i of injured.filter((x) => x.team === f.teams[side].abbr)) {
      const inBox = f.players[side].find((p) => p.name === i.name);
      const id = i.id || inBox?.id;
      const he = inBox?.he || enToHe.get(i.name);
      if (!id || !he || playedIds.has(id)) continue;
      const avg = seasonAvg(rowsOf(id), f.date, f.gameId);
      if (avg >= 18) stars.push({ he, avg });
    }
    if (!stars.length) continue;
    stars.sort((a, b) => b.avg - a.avg);
    const two = stars.slice(0, 2);
    const who = two.length === 2 ? `${two[0].he} (${two[0].avg} נקודות בממוצע) ו${two[1].he} (${two[1].avg})` : `${two[0].he} (${two[0].avg} נקודות בממוצע העונה)`;
    const won = side === W;
    add({ type: 'STAR_ABSENT', side, value: two.length, fact_he: `${tn(side)} ${v(f.teams[side].abbr, 'שיחקה', 'שיחקו')} בלי ${who}${won ? ` ${v(f.teams[side].abbr, 'וניצחה', 'וניצחו')}` : ''}`, tokens: [sur(two[0].he)], weight: won ? (two.length === 2 ? 74 : 64) : 48, flag: 'absent' });
  }
  // 2. a star held down, and 3. a notable previous game
  for (const side of ['home', 'away']) {
    for (const p of f.players[side].filter((x) => x.played)) {
      const rows = rowsOf(p.id);
      if (!rows || !p.he) continue;
      const avg = seasonAvg(rows, f.date, f.gameId);
      const before = rows.filter((r) => ['regular', 'post', 'playin'].includes(r.type) && r.min > 0 && r.eventId !== f.gameId && r.date && new Date(r.date) < new Date(f.date));
      if (isStar(rows, f.date, f.gameId) && p.min >= 20 && (p.pts <= 10 || (avg >= 18 && p.pts <= avg * 0.45))) {
        const fg = p.fg ? ` (${p.fg[0]} מ-${p.fg[1]} מהשדה)` : '';
        let rare = '';
        // single digits: how many times in his career (only with the whole career in the log)
        if (p.pts <= 9 && ext.gamelogs?.[p.id]) {
          const n = before.filter((r) => r.type === 'regular' && r.min >= 15 && r.pts <= 9).length + 1;
          if (n <= 20) rare = `, פעם ${n <= 10 ? ORD_F[n] : `ה-${n}`} בקריירה שלו בחד ספרתי`;
        }
        const avgHe = avg ? `, הרחק מממוצע של ${avg} העונה` : '';
        add({ type: 'STAR_HELD', side, player: p.name, value: p.pts, fact_he: `${p.he} נעצר על ${p.pts} נקודות${fg}${avgHe}${rare}`, tokens: [sur(p.he)], weight: rare ? 66 : 50, flag: 'form' });
      }
      // a rookie's big night / a debut (only with his log fetched: rows exist)
      const season = seasonLabel(f.date);
      const regBefore = before.filter((r) => r.type === 'regular');
      const rookie = !regBefore.some((r) => r.season < season);
      const dd = [p.pts, p.reb, p.ast].filter((x) => x >= 10).length >= 2;
      if (rookie && (p.pts >= 20 || dd)) {
        const hiPts = regBefore.length >= 2 && p.pts > Math.max(...regBefore.map((r) => r.pts));
        const hiReb = regBefore.length >= 2 && p.reb >= 10 && p.reb > Math.max(...regBefore.map((r) => r.reb));
        const hi = hiPts ? ', שיא הקריירה שלו ב-NBA' : hiReb ? ', שיא הריבאונדים שלו ב-NBA' : '';
        const line = [`${p.pts} נקודות`, p.reb >= 8 ? `${p.reb} ריבאונדים` : null, p.ast >= 6 ? `${p.ast} אסיסטים` : null].filter(Boolean);
        add({ type: 'ROOKIE_GAME', side, player: p.name, value: p.pts, fact_he: `הרוקי ${p.he} רשם ${line.length > 1 ? `${line.slice(0, -1).join(', ')} ו-${line.at(-1)}` : line[0]}${hi}`, tokens: [sur(p.he)], weight: hi ? 46 : 38, flag: hi ? 'career_high' : 'form' });
      }
      if (!before.some((r) => r.team === f.teams[side].abbr)) {
        const mine = heTeam(f.teams[side].abbr) || tn(side);
        add({ type: 'DEBUT', side, player: p.name, value: p.pts, fact_he: before.length ? `${p.he} ערך הופעת בכורה במדי ${mine.replace(/^ה/, '')} וסיים עם ${p.pts} נקודות` : `${p.he} ערך את הופעת הבכורה שלו ב-NBA וסיים עם ${p.pts} נקודות`, tokens: [sur(p.he)], weight: 40, flag: 'form' });
      }
      // his decisive moment in the previous game, from our own archive ("after missing the winner against SA")
      const arc = ext.archive?.[p.id];
      if (arc) {
        const hours = Math.round((new Date(f.date) - new Date(arc.date)) / 3600e3 / 24) * 24;
        const when = hours <= 72 ? `${hours} שעות אחרי ש` : 'משחק אחרי ש';
        const opp = heTeam(arc.opp) || arc.opp;
        for (const it of arc.items.slice(0, 1)) {
          const what = it.kind === 'missed_winner'
            ? `${p.he} החטיא ${it.shot === 'three' ? 'שלשה' : 'זריקה'} שהייתה יכולה ${it.tying ? 'לשלוח להארכה' : 'להכריע'} את המשחק נגד ${opp}`
            : `${p.he} הכריע ${it.freeThrows ? 'מהקו ' : it.buzzer ? 'עם הבאזר ' : ''}את המשחק נגד ${opp}`;
          add({ type: 'LAST_GAME_MOMENT', side, player: p.name, value: p.pts, fact_he: `${when}${what}, הוא סיים הפעם עם ${p.pts} נקודות`, tokens: [sur(p.he)], weight: it.kind === 'missed_winner' ? 46 : 44, flag: 'form' });
        }
      }
      const prev = before.at(-1);
      let run40 = 0;
      for (let i = before.length - 1; i >= 0 && before[i].pts >= 40; i--) run40++;
      if (prev && run40 >= 2) {
        add({ type: 'RECENT_FORM', side, player: p.name, value: run40, fact_he: `${p.he} הגיע אחרי ${run40 === 2 ? 'שני' : run40} משחקים רצופים עם 40 נקודות ומעלה, וסיים הפעם עם ${p.pts}`, tokens: [sur(p.he)], weight: 44, flag: 'form' });
      } else if (prev && prev.pts >= 40) {
        const hours = Math.round((new Date(f.date) - new Date(prev.date)) / 3600e3 / 24) * 24;
        const when = hours <= 72 ? `${hours} שעות אחרי` : 'במשחק שאחרי';
        const career = before.slice(0, -1).filter((r) => r.type === 'regular');
        const wasCareerHigh = !!ext.gamelogs?.[p.id] && career.length >= 40 && prev.pts > Math.max(...career.map((r) => r.pts));
        const opp = heTeam(prev.opp) || prev.opp;
        add({ type: 'RECENT_FORM', side, player: p.name, value: prev.pts, fact_he: `${when} ש${p.he} קלע ${prev.pts} נקודות נגד ${opp}${wasCareerHigh ? ', שיא הקריירה שלו' : ''}, הוא סיים הפעם עם ${p.pts}`, tokens: [sur(p.he)], weight: 42, flag: wasCareerHigh ? 'career_high' : 'form' });
      }
    }
  }
  return out;
}

const SEASONS_HE = (n) => (n === 1 ? 'עונה אחת' : n === 2 ? 'שתי עונות' : `${n} עונות`);

// RETURN TO A FORMER TEAM, from his game log: the opponent is a team he played for, and since he left he has
// not played against it (FIRST_MEETING) or not played in its arena (FIRST_RETURN). "For the first time" is
// claimed only when his whole time since leaving is in the log (left within this season or last).
export function formerTeamFact(rows, p, myAbbr, oppAbbr, gameId, gameDate, home) {
  const before = rows.filter((r) => r.eventId !== gameId && r.date && new Date(r.date) < new Date(gameDate) && ['regular', 'post', 'playin'].includes(r.type));
  const there = before.filter((r) => r.team === oppAbbr);
  if (!there.length || myAbbr === oppAbbr) return null;
  const left = there.at(-1).date;
  const since = before.filter((r) => new Date(r.date) > new Date(left));
  if (!since.some((r) => r.team === myAbbr)) return null; // not with his current team since — unclear, say nothing
  const met = since.filter((r) => r.opp === oppAbbr);
  const visited = met.filter((r) => r.atVs === '@');
  const seasons = new Set(rows.filter((r) => r.team === oppAbbr && r.type === 'regular').map((r) => r.season)).size;
  // he has been back with another team before, but not in these colors (LeBron in Cleveland as a 76er)
  const sinceJoined = since.filter((r) => r.team === myAbbr);
  const newColors = !home && visited.length && !sinceJoined.some((r) => r.opp === oppAbbr && r.atVs === '@') && seasons >= 4;
  const kind = !home && !visited.length ? 'FIRST_RETURN' : !met.length ? 'FIRST_MEETING' : newColors ? 'RETURN_NEW_COLORS' : null;
  if (!kind) return null;
  return { kind, seasons, left };
}

// ---------- context facts ----------

const ORD = ['', 'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שביעי', 'שמיני', 'תשיעי', 'עשירי'];
// "ניצחון חמישי ברציפות" / "הניצחון ה-15 ברציפות", and the word the validator looks for
const nth = (noun, n) => (n <= 10 ? { he: `${noun} ${ORD[n]} ברציפות`, token: ORD[n] } : { he: `את ה${noun} ה-${n} ברציפות`, token: `ה-${n}` });
const WIN_STREAK_W = { 3: 58, 4: 66, 5: 78, 6: 80 };
const LOSS_STREAK_W = { 3: 50, 4: 58, 5: 66, 6: 72 };
const ENDED_W = { 3: 60, 4: 70 };

// ext: output of fetchContext (or test data in the same shape). f must already carry Hebrew names.
export function buildContext(f, ext = {}) {
  const out = [];
  const tn = (s) => f.teams[s].heShort || f.teams[s].he;
  const W = f.result.winner, L = f.result.loser;
  const add = (x) => out.push({ verified: true, ...x });
  const vb = (side, fem, plural) => v(f.teams[side].abbr, fem, plural);

  for (const side of ['home', 'away']) {
    const sched = ext.schedules?.[f.teams[side].id];
    if (!sched) continue;
    const rows = resultsThrough(sched, f.teams[side].id, f.gameId, f.date, side === W);
    const now = streakOf(rows);
    const before = streakOf(rows.slice(0, -1));
    const source = 'ESPN team schedule';
    if (now.kind === 'W' && now.length >= 3) {
      const x = nth('ניצחון', now.length);
      add({ type: 'WIN_STREAK', side, value: now.length, source, fact_he: `${tn(side)} ${vb(side, 'רשמה', 'רשמו')} ${x.he}`, tokens: [x.token], weight: WIN_STREAK_W[now.length] || Math.min(90, 82 + now.length - 7), flag: 'streak' });
    }
    if (now.kind === 'L' && now.length >= 3) {
      const x = nth('הפסד', now.length);
      add({ type: 'LOSS_STREAK', side, value: now.length, source, fact_he: `${tn(side)} ${vb(side, 'ספגה', 'ספגו')} ${x.he}`, tokens: [x.token], weight: LOSS_STREAK_W[now.length] || Math.min(85, 75 + now.length - 7), flag: 'streak' });
    }
    // the streak this game ended
    if (before && before.kind === 'W' && side === L && before.length >= 3) {
      add({ type: 'STREAK_ENDED', side: W, value: before.length, source, fact_he: `${tn(W)} ${vb(W, 'קטעה', 'קטעו')} ${withLamed(tn(L))} רצף של ${before.length} ניצחונות`, tokens: [`${before.length} ניצחונות`], weight: ENDED_W[before.length] || 82, flag: 'streak' });
    }
    if (before && before.kind === 'L' && side === W && before.length >= 4) {
      add({ type: 'LOSING_STREAK_ENDED', side: W, value: before.length, source, fact_he: `${tn(W)} ${vb(W, 'שברה', 'שברו')} רצף של ${before.length} הפסדים`, tokens: [`${before.length} הפסדים`], weight: 60, flag: 'streak' });
    }
  }

  const h = ext.h2h?.[f.teams[W].id];
  if (h && h.exact && h.opp === f.teams[L].id && h.n >= 4) {
    add({ type: 'H2H_STREAK', side: W, value: h.n, source: 'ESPN team schedules (regular season + playoffs)', fact_he: `${tn(W)} ${vb(W, 'ניצחה', 'ניצחו')} את ${tn(L)} בפעם ה-${h.n} ברציפות`, tokens: [`ה-${h.n}`], weight: h.n >= 10 ? 78 : h.n >= 5 ? 65 : 55, flag: 'streak' });
  }

  for (const side of ['home', 'away']) {
    const opp = side === 'home' ? 'away' : 'home';
    for (const p of f.players[side].filter((x) => x.played)) {
      const rows = ext.gamelogs?.[p.id] || ext.recent?.[p.id];
      if (!rows) continue;
      const r = formerTeamFact(rows, p, f.teams[side].abbr, f.teams[opp].abbr, f.gameId, f.date, side === 'home');
      if (!r) continue;
      const name = p.he || p.name;
      const oppHe = heTeam(f.teams[opp].abbr) || tn(opp);
      const where = r.seasons ? `, הקבוצה שבה שיחק ${SEASONS_HE(r.seasons)}` : ', קבוצתו לשעבר';
      const how = `${p.pts ? `וסיים עם ${shortLineHe(p)} ` : ''}${side === W ? 'בניצחון' : 'בהפסד'}`;
      const mine = heTeam(f.teams[side].abbr) || tn(side);
      const fact_he = r.kind === 'FIRST_RETURN' ? `${name} חזר לראשונה ל${oppHe.replace(/^ה/, '')}${where}, ${how}`
        : r.kind === 'RETURN_NEW_COLORS' ? `${name} חזר ל${oppHe.replace(/^ה/, '')}${where}, לראשונה במדי ${mine.replace(/^ה/, '')}, ${how}`
        : `${name} פגש לראשונה את ${oppHe}${where}, ${how}`;
      const big = p.starter && p.min >= 20;
      add({ type: 'RETURN_TO_FORMER_TEAM', side, player: p.name, value: r.seasons, source: 'ESPN player game log', fact_he, tokens: [(name.split(' ').slice(1).join(' ') || name)], weight: (r.kind === 'FIRST_RETURN' ? 80 : r.kind === 'RETURN_NEW_COLORS' ? 66 : 70) - (big ? 0 : 20) + (r.seasons >= 3 ? 4 : 0) + (r.seasons >= 8 ? 12 : 0), flag: 'former_team' });
    }
  }

  for (const side of ['home', 'away']) {
    for (const p of f.players[side]) {
      const rows = ext.gamelogs?.[p.id];
      if (!rows || !p.played) continue;
      const name = p.he || p.name;
      const source = 'ESPN game log (regular season)';
      const ms = playerContext(rows, p, f.gameId, f.date);
      const won = side === W;
      // bigger and in a win = bigger story; a career high makes the season high redundant
      const hiW = (base, cap) => Math.round(base + Math.min(cap, Math.max(0, p.pts - 25)) + (won ? 3 : -8));
      const career = ms.some((m) => m.type === 'CAREER_HIGH' || m.type === 'TIES_CAREER_HIGH');
      for (const m of ms.filter((x) => !(career && /SEASON_HIGH/.test(x.type)))) {
        // the record he broke, as Sport5 writes it: "שבר את שיאו הקודם (50 נגד וושינגטון)"
        const prevHe = (m2) => (m2.previous != null ? ` (שיאו הקודם: ${m2.previous}${m2.previousOpp ? ` נגד ${heTeam(m2.previousOpp) || m2.previousOpp}` : ''})` : '');
        if (m.type === 'SEASON_HIGH' && p.pts >= 25) add({ type: m.type, side, player: p.name, value: m.value, source, fact_he: `${name} קלע ${m.value} נקודות, שיא העונה שלו${prevHe(m)}`, tokens: ['שיא העונה'], weight: hiW(58, 10), flag: 'season_high' });
        if (m.type === 'TIES_SEASON_HIGH' && p.pts >= 25) add({ type: m.type, side, player: p.name, value: m.value, source, fact_he: `${name} השווה את שיא העונה שלו עם ${m.value} נקודות`, tokens: ['שיא העונה'], weight: hiW(50, 8), flag: 'season_high' });
        if (m.type === 'CAREER_HIGH' && p.pts >= 20) add({ type: m.type, side, player: p.name, value: m.value, source, fact_he: `${name} קלע ${m.value} נקודות, שיא הקריירה שלו${prevHe(m)}`, tokens: ['שיא הקריירה'], weight: hiW(72, 15), flag: 'career_high' });
        if (m.type === 'TIES_CAREER_HIGH' && p.pts >= 20) add({ type: m.type, side, player: p.name, value: m.value, source, fact_he: `${name} השווה את שיא הקריירה שלו עם ${m.value} נקודות`, tokens: ['שיא הקריירה'], weight: hiW(62, 10), flag: 'career_high' });
        if (m.type === 'SCORING_STREAK') add({ type: m.type, side, player: p.name, value: m.games, min: m.min, source, fact_he: `זה המשחק ה-${m.games} ברציפות שבו ${name} קולע ${m.min} נקודות ומעלה`, tokens: [`ה-${m.games}`], weight: m.games >= 5 ? 80 : 65, flag: 'streak' });
      }
    }
  }
  return out;
}

// ---------- game context (not story angles): next game, previous meeting, absences, the table ----------

const CONF_HE = { East: 'המזרח', West: 'המערב' };
const DAY_MS = 86400e3;
const agoHe = (days) => (days <= 1 ? 'אתמול' : days === 2 ? 'לפני יומיים' : `לפני ${days} ימים`);
const reasonHe = (detail = '') => (/rest/i.test(detail) ? 'מנוחה' : /ill/i.test(detail) ? 'מחלה' : /suspen/i.test(detail) ? 'הרחקה' : /personal/i.test(detail) ? 'סיבות אישיות' : 'פציעה');

// standings facts (verified only when ESPN's table already counts this game: same wins and losses)
export function standingsFacts(f, ext = {}) {
  const out = [];
  const tn = (s) => f.teams[s].heShort || f.teams[s].he;
  for (const side of ['home', 'away']) {
    const e = (ext.standings || []).find((x) => x.teamId === f.teams[side].id || x.abbr === f.teams[side].abbr);
    const rec = String(f.teams[side].record || '').match(/^(\d+)-(\d+)$/);
    if (!e || !rec || e.wins !== Number(rec[1]) || e.losses !== Number(rec[2]) || !e.seed || !CONF_HE[e.conf]) continue;
    const tied = (ext.standings || []).some((x) => x !== e && x.conf === e.conf && x.pct === e.pct && x.seed <= 2);
    const conf = CONF_HE[e.conf];
    const fem = !f.teams[side].plural;
    const fact = e.seed === 1 ? (tied ? `${tn(side)} ${fem ? 'שותפה' : 'שותפים'} למקום הראשון ב${conf.slice(1)}` : `${tn(side)} ${fem ? 'מוליכת' : 'מוליכים את'} ${conf}`)
      : `${tn(side)} ${fem ? 'נמצאת' : 'נמצאים'} במקום ה-${e.seed} ב${conf.slice(1)}`;
    const tokens = ['מוליכת', 'מוליכים', 'במקום', 'שותפה', 'שותפים', 'ראשות', 'פסגת', 'המקום הראשון'];
    // compared with the table before tonight's first tip-off: first place taken or lost is the story
    const b = (ext.standingsBefore || []).find((x) => x.teamId === e.teamId || x.abbr === e.abbr);
    if (b && b.seed === 1 && e.seed !== 1) {
      const leader = (ext.standings || []).find((x) => x.conf === e.conf && x.seed === 1);
      const lh = leader ? heTeam(leader.abbr) : null;
      out.push({ type: 'LOST_FIRST_PLACE', side, verified: true, source: 'ESPN standings before tonight vs after this game', fact_he: `${tn(side)} ${fem ? 'איבדה' : 'איבדו'} את המקום הראשון ב${conf.slice(1)}${lh ? ` ${lh.startsWith('ה') ? 'ל' + lh.slice(1) : 'ל' + lh}` : ''}`, tokens, weight: 82, flag: 'standings' });
      continue;
    }
    if (b && b.seed !== 1 && e.seed === 1 && !tied) {
      out.push({ type: 'TOOK_FIRST_PLACE', side, verified: true, source: 'ESPN standings before tonight vs after this game', fact_he: `${tn(side)} ${fem ? 'עלתה' : 'עלו'} למקום הראשון ב${conf.slice(1)}`, tokens, weight: 80, flag: 'standings' });
      continue;
    }
    out.push({ type: e.seed === 1 ? 'CONFERENCE_LEADER' : 'STANDINGS', side, value: e.seed, verified: true, source: 'ESPN standings (after this game)', fact_he: fact, tokens, weight: e.seed === 1 && !tied ? 58 : 25, flag: 'standings' });
  }
  return out;
}

// what the recap may add around the game, all from ESPN structured data, already in Hebrew
// NBA Cup records after this game (group play counts the Cup games only), from each team's schedule
export function cupRecords(f, ext = {}) {
  if (!f.cupGame) return null;
  const out = {};
  for (const side of ['home', 'away']) {
    const sched = ext.schedules?.[f.teams[side].id];
    if (!sched) return null;
    const id = f.teams[side].id;
    const rows = sched.events.filter((e) => e.cup && e.state === 'post' && e.id !== f.gameId && new Date(e.date) < new Date(f.date));
    const w = rows.filter((e) => e.teams.find((x) => x.id === id)?.winner).length + (f.result.winner === side ? 1 : 0);
    const l = rows.length + 1 - w;
    out[side] = { w, l };
  }
  return out;
}

export function gameContext(f, ext = {}, enToHe = new Map()) {
  const tn = (s) => f.teams[s].heShort || f.teams[s].he;
  const other = (s) => (s === 'home' ? 'away' : 'home');
  const t = new Date(f.date);
  const out = { next_games: [], previous_meeting: null, absences: [] };
  for (const side of ['home', 'away']) {
    const sched = ext.schedules?.[f.teams[side].id];
    const next = (sched?.events || []).filter((e) => e.id !== f.gameId && new Date(e.date) > t && e.state !== 'post').sort((a, b) => a.date.localeCompare(b.date))[0];
    if (next) {
      const me = next.teams.find((x) => x.id === f.teams[side].id);
      const opp = next.teams.find((x) => x !== me);
      if (me && opp) out.next_games.push(`המשחק הבא של ${tn(side)}: ${me.home ? 'בבית נגד' : 'בחוץ מול'} ${heTeam(opp.abbr) || opp.abbr} (${nightHe(next.date)})`);
    }
  }
  // the previous meeting of these two this season
  const sched = ext.schedules?.[f.teams.home.id];
  const prev = (sched?.events || []).filter((e) => e.id !== f.gameId && e.state === 'post' && new Date(e.date) < t && e.teams.some((x) => x.id === f.teams.away.id))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (prev) {
    const w = prev.teams.find((x) => x.winner), l = prev.teams.find((x) => !x.winner);
    const side = w && w.id === f.teams.home.id ? 'home' : 'away';
    const days = Math.round((t - new Date(prev.date)) / DAY_MS);
    if (w && l && Number.isFinite(w.score) && Number.isFinite(l.score)) {
      out.previous_meeting = `במפגש הקודם ביניהן העונה, ${agoHe(days)}, ${tn(side)} ${v(f.teams[side].abbr, 'ניצחה', 'ניצחו')} ${pair(w.score, l.score)} ${w.home ? 'בבית' : 'בחוץ'}`;
    }
  }
  // players who were OUT before the game (pre-game injury report) and did not play
  const played = new Set(['home', 'away'].flatMap((s) => f.players[s].filter((p) => p.played).map((p) => p.name)));
  for (const i of f.context?.injuryReport || []) {
    if (!/^out$/i.test(i.status || '') || played.has(i.name)) continue;
    const side = f.teams.home.abbr === i.team ? 'home' : f.teams.away.abbr === i.team ? 'away' : null;
    if (!side) continue;
    out.absences.push(`${enToHe.get(i.name) || i.name} (${tn(side)}) לא שיחק — ${reasonHe(i.detail)}`);
  }
  out.absences = out.absences.slice(0, 6);
  return out;
}
