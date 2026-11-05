// CONTEXT FACTS: what the season and history say around one game (streaks, head-to-head, season and
// career highs, scoring streaks). They are never inferred from this game's box score alone: each one is
// computed from an external ESPN source (team schedules, player game logs) and carries that source.
// If the source is missing, the fact is simply not produced. The writer may state only what is here.
//
// GAME FACTS (score, quarters, box score, play-by-play, runs) live in facts.js.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getTeamSchedule, getStandings } from './espn.js';
import { playerHistory } from './gamelog.js';
import { v, withLamed, heTeam } from './teams.js';
import { pair, nightHe } from './writer/he.js';

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
export async function fetchContext(summary, { cacheDir }) {
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
  return ext;
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
        if (m.type === 'SEASON_HIGH' && p.pts >= 25) add({ type: m.type, side, player: p.name, value: m.value, source, fact_he: `${name} קלע ${m.value} נקודות, שיא העונה שלו${prevHe(m)}`, tokens: ['שיא העונה'], weight: hiW(58, 10), flag: 'season_high' });
        if (m.type === 'TIES_SEASON_HIGH' && p.pts >= 25) add({ type: m.type, side, player: p.name, value: m.value, source, fact_he: `${name} השווה את שיא העונה שלו עם ${m.value} נקודות`, tokens: ['שיא העונה'], weight: hiW(50, 8), flag: 'season_high' });
        // the record he broke, as Sport5 writes it: "שבר את שיאו הקודם (50 נגד וושינגטון)"
        const prevHe = (m2) => (m2.previous != null ? ` (שיאו הקודם: ${m2.previous}${m2.previousOpp ? ` נגד ${heTeam(m2.previousOpp) || m2.previousOpp}` : ''})` : '');
        if (m.type === 'CAREER_HIGH') add({ type: m.type, side, player: p.name, value: m.value, source, fact_he: `${name} קלע ${m.value} נקודות, שיא הקריירה שלו${prevHe(m)}`, tokens: ['שיא הקריירה'], weight: hiW(72, 15), flag: 'career_high' });
        if (m.type === 'TIES_CAREER_HIGH') add({ type: m.type, side, player: p.name, value: m.value, source, fact_he: `${name} השווה את שיא הקריירה שלו עם ${m.value} נקודות`, tokens: ['שיא הקריירה'], weight: hiW(62, 10), flag: 'career_high' });
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
