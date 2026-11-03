// facts -> the brief the model writes from. Hebrew names only, and every number already rendered in the
// order its context needs (see he.js). The model copies strings; it never orders numbers, picks the angle
// or decides whether a milestone is true. A claim the data does not verify is not in the brief at all.

import { heTeam } from '../teams.js';
import { pair, partialPair, recordForms, whenHe, periodNumber, nightHe, fullLineHe, shortLineHe, KIND_HE, PERIOD_HE } from './he.js';

export const FEATURED = 90; // story weight from which a game block may run to 3 paragraphs

const heOf = (f) => {
  const m = new Map();
  for (const s of ['home', 'away']) for (const p of f.players[s]) m.set(p.name, p.he || p.name);
  return m;
};
// swap English player names inside ESPN play text for Hebrew ones
const heText = (names, text) => [...names.entries()].sort((a, b) => b[0].length - a[0].length).reduce((t, [en, he]) => t.split(en).join(he), text || '');

function starBrief(p, full = false) {
  return { name_he: p.he || p.name, starter: p.starter, line_he: full ? fullLineHe(p) : shortLineHe(p), pts: p.pts, reb: p.reb, ast: p.ast, bench: !p.starter };
}

// the main angle, written as a Hebrew fact the lead must carry (only types the data proves)
function angleHe(k, f, tn) {
  const t = (s) => tn(s);
  switch (k.type) {
    case 'FIRST_LOSS': return `${t(k.side)} ספגה הפסד ראשון העונה, אחרי ${k.n} ניצחונות בפתיחת העונה`;
    case 'FIRST_WIN': return `${t(k.side)} רשמה ניצחון ראשון העונה, אחרי ${k.n} הפסדים בפתיחת העונה`;
    case 'UNBEATEN': return `${t(k.side)} נשארה בלי הפסד: ${k.n} ניצחונות ב-${k.n} משחקים`;
    case 'WINLESS': return `${t(k.side)} עדיין בלי ניצחון: ${k.n} הפסדים ב-${k.n} משחקים`;
    case 'DOMINANT_QUARTER': return `${t(k.side)} הכריעה ב${PERIOD_HE(k.period, f.clutch.finalPeriod)}: ${partialPair(k.score[k.side], k.score[k.side === 'home' ? 'away' : 'home'])}`;
    default: return null;
  }
}

export function gameBrief(f) {
  const names = heOf(f);
  const W = f.result.winner, L = f.result.loser, fp = f.clutch.finalPeriod;
  const other = (s) => (s === 'home' ? 'away' : 'home');
  const tn = (side) => f.teams[side].heShort || f.teams[side].he;
  const at = (a) => (a ? whenHe(a.period ?? periodNumber(a.periodName), a.clock, fp) : null);
  // every score state, once per team. kind 'partial' = subject first, 'last' = subject last (he.js)
  const states = [];
  const by = (h, a, kind, label = null) => {
    states.push({ home: h, away: a, kind, label });
    const fmt = kind === 'partial' ? partialPair : pair;
    return h === a ? `${h}:${a}` : { [tn('home')]: fmt(h, a), [tn('away')]: fmt(a, h) };
  };
  const byS = (s, kind = 'last') => by(s.home, s.away, kind);
  const recs = { home: recordForms(f.teams.home.record, W === 'home'), away: recordForms(f.teams.away.record, W === 'away') };
  const top = f.candidates[0];
  const featured = (top?.weight || 0) >= FEATURED;

  const b = {
    kind: 'game',
    night_he: `הלילה (${nightHe(f.date)})`,
    heading: `${f.teams.home.he} ${recs.home?.in_parentheses || ''} - ${f.teams.away.he} ${recs.away?.in_parentheses || ''} ${f.teams.away.score}:${f.teams.home.score}`.replace(/\s+/g, ' '),
    home_is: tn('home'),
    away_is: tn('away'),
    winner_he: tn(W),
    loser_he: tn(L),
    margin: f.result.margin,
    overtimes: f.clutch.overtimes,
    result_for_winner: `ניצחון ${pair(f.teams[W].score, f.teams[L].score)}`,
    result_for_loser: `הפסד ${pair(f.teams[L].score, f.teams[W].score)}`,
    // records: copy the form that fits the sentence — never reorder
    records: Object.fromEntries(['home', 'away'].filter((s) => recs[s]).map((s) => [tn(s), { after_team_name: recs[s].in_parentheses, after_verb: recs[s].phrase }])),
    quarters: f.teams.home.periods.map((h, i) => {
      const a = f.teams.away.periods[i];
      const win = h === a ? null : h > a ? 'home' : 'away';
      return {
        period_he: PERIOD_HE(i + 1, fp),
        clause: win ? `${tn(win)} ניצחה את ${PERIOD_HE(i + 1, fp)} ${partialPair(f.teams[win].periods[i], f.teams[other(win)].periods[i])}` : `${PERIOD_HE(i + 1, fp)} הסתיים בשוויון ${h}:${a}`,
        score_by_subject: by(h, a, 'partial', 'quarter'),
      };
    }),
  };
  const lead = (s, word, label) => {
    const lv = s.home === s.away ? null : s.home > s.away ? 'home' : 'away';
    by(s.home, s.away, 'partial', label);
    return lv ? `${tn(lv)} הובילה ${word} ${partialPair(s[lv], s[other(lv)])}` : `שוויון ${word} ${s.home}:${s.away}`;
  };
  b.halftime_clause = lead(f.result.halftime, 'במחצית', 'half');
  b.after_three_clause = lead(f.result.after3, 'אחרי שלושה רבעים', 'after3');

  // the angle is chosen here, in code; the lead must open with it
  b.main_angle = top ? { type: top.type, fact_he: angleHe(top, f, tn) || heText(names, top.why) } : null;
  b.secondary_angles = f.candidates.slice(1, 3).map((k) => ({ type: k.type, fact_he: angleHe(k, f, tn) || heText(names, k.why) }));

  if (f.flow.available) {
    b.largest_lead = ['home', 'away'].filter((s) => f.flow.largestLead[s].pts > 0).map((s) => ({ team_he: tn(s), pts: f.flow.largestLead[s].pts, when_he: at(f.flow.largestLead[s].at), score_by_subject: byS(f.flow.largestLead[s].score) }));
    b.lead_changes = f.flow.leadChanges;
    b.runs = f.flow.spurts.slice(0, 2).map((s) => {
      states.push(s.side === 'home' ? { home: s.for, away: s.against, kind: 'last' } : { home: s.against, away: s.for, kind: 'last' });
      return { team_he: tn(s.side), run_he: `ריצת ${pair(s.for, s.against)}`, from_he: at(s.from), to_he: at(s.to), score_after_by_subject: byS(s.scoreAfter) };
    });
  }

  // decisive plays: each one separately, with who, assist, time and the score after it
  const c = f.clutch;
  const play = (x, side) => {
    if (!x) return null;
    const scorer = names.get(x.player) || x.player;
    const assist = (x.text.match(/\(([^)]+) assists\)/) || [])[1];
    return { player_he: scorer, assist_he: assist ? names.get(assist) || assist : null, team_he: tn(side), points: x.points ?? x.value, when_he: at(x), score_after_by_subject: byS(x.scoreAfter || x.score) };
  };
  b.final_minutes = {
    five_minutes_left_by_subject: c.marginAt5min ? byS(c.marginAt5min) : null,
    two_minutes_left_by_subject: c.marginAt2min ? byS(c.marginAt2min) : null,
    winning_basket: c.winningBasket ? { ...play(c.winningBasket, c.winningBasket.side), decisive_late: c.winningBasket.late } : null,
    tying_shot_to_overtime: c.tyingShotToOT ? play(c.tyingShotToOT, c.tyingShotToOT.side) : null,
    loser_led_in_last_three_minutes: c.loserLedInLast3min,
    // separate plays, in order — never merge two of them into one sentence about one player
    last_two_minutes: c.finalSequence.filter((p) => p.scoring).slice(-8).map((p) => ({ when_he: whenHe(fp, p.clock, fp), team_he: p.side ? tn(p.side) : null, score_after_by_subject: byS(p.score), play: heText(names, p.text) })),
  };
  b.stars = {
    [tn(W)]: f.players[W].filter((p) => p.played).sort((x, y) => y.pts - x.pts).slice(0, 4).map((p) => starBrief(p)),
    [tn(L)]: f.players[L].filter((p) => p.played).sort((x, y) => y.pts - x.pts).slice(0, 3).map((p) => starBrief(p)),
  };
  const outInjured = ['home', 'away'].flatMap((s) => f.players[s].filter((p) => !p.played && p.dnpReason && !/coach/i.test(p.dnpReason)).map((p) => `${p.he || p.name} (${tn(s)}) לא שיחק — ${p.dnpReason}`));
  if (outInjured.length) b.did_not_play = outInjured;
  // only events that change how the game is told (color.js decides relevance)
  b.color = (f.color?.events || []).filter((e) => e.relevant).map((e) => ({ what_he: KIND_HE[e.kind] || e.kind, players_he: (e.players || []).map((n) => names.get(n) || n), team_he: e.team ? tn(e.team === f.teams.home.abbr ? 'home' : 'away') : null, when_he: at(e) }));

  // what the data verifies — milestone language is allowed only where true
  const streakTypes = ['FIRST_LOSS', 'FIRST_WIN', 'UNBEATEN', 'WINLESS'];
  b.verified = {
    season_high: false,
    career_high: false,
    streak: f.candidates.some((k) => streakTypes.includes(k.type)),
    standings: false,
  };
  b.max_paragraphs = featured ? 3 : 2;
  b.featured = featured;
  b.states = states; // for the verifier (stripped from the prompt)
  return b;
}

export function playerBrief(f, t) {
  const g = gameBrief(f);
  const names = heOf(f);
  const tnp = (side) => f.teams[side].heShort || f.teams[side].he;
  const subject = (s) => { g.states.push({ home: s.home, away: s.away, kind: 'last' }); return s.home === s.away ? `${s.home}:${s.away}` : { [tnp('home')]: pair(s.home, s.away), [tnp('away')]: pair(s.away, s.home) }; };
  const rec = recordForms(t.team.record, t.won);
  const ms = t.milestones.map((m) => m.type);
  const streak = t.team.context.streak;
  const b = {
    kind: 'player',
    player_he: t.player.he,
    team_he: t.team.he,
    opp_he: t.opp.he,
    home: t.home,
    won: t.won,
    result_he: `${t.won ? 'ניצחון' : 'הפסד'} ${pair(t.team.score, t.opp.score)}`,
    team_record: rec ? { after_team_name: rec.in_parentheses, after_verb: rec.phrase } : null,
    // written in full so the model never builds "N wins in a row in a row"
    team_streak_he: streak && streak.length >= 2 ? (streak.kind === 'W' ? `ניצחון ${ordinal(streak.length)} ברציפות` : `הפסד ${ordinal(streak.length)} ברציפות`) : null,
    night_he: g.night_he,
    line_full_he: fullLineHe(t.line),
    line_short_he: `(${t.line.pts} נק' ו-${t.line.ast >= t.line.reb ? `${t.line.ast} אס'` : `${t.line.reb} ריב'`})`,
    by_quarter: t.byPeriod.map((x) => ({ period_he: PERIOD_HE(x.period, f.clutch.finalPeriod), pts: x.pts })),
    halves: t.halves,
    hottest_stretch: t.bestBurst ? { pts: t.bestBurst.pts, from_he: whenHe(periodNumber(t.bestBurst.from.periodName), t.bestBurst.from.clock, f.clutch.finalPeriod), to_he: whenHe(periodNumber(t.bestBurst.to.periodName), t.bestBurst.to.clock, f.clutch.finalPeriod) } : null,
    assists_to: t.assistsTo.map((a) => ({ name_he: names.get(a.name) || a.name, n: a.n })),
    crunch_time: t.clutch.map((c) => ({ when_he: whenHe(periodNumber(c.periodName), c.clock, f.clutch.finalPeriod), score_by_subject: subject(c.score), play: heText(names, c.text) })),
    his_go_ahead_or_tying_baskets: t.leadPlays.map((x) => ({ when_he: whenHe(periodNumber(x.periodName), x.clock, f.clutch.finalPeriod), score_by_subject: subject(x.score), tied: x.tied })),
    his_assists_on_go_ahead_baskets: t.leadAssists.map((x) => ({ when_he: whenHe(periodNumber(x.periodName), x.clock, f.clutch.finalPeriod), to_he: names.get(x.to) || x.to, score_by_subject: subject(x.score) })),
    fouls: t.fouls.fourth?.beforeHalf ? `נשרקה לחובתו עבירה רביעית (בעיית עבירות) עוד לפני המחצית (${whenHe(periodNumber(t.fouls.fourth.periodName), t.fouls.fourth.clock, f.clutch.finalPeriod)})` : null,
    verified_milestones: t.milestones.map((m) => m.text),
    season_average_before: t.history?.seasonAverageBefore || null,
    games_this_season_before: t.history?.gamesBeforeThisSeason ?? null,
    previous_game: t.history?.previousGame ? { home: t.history.previousGame.atVs !== '@', opp_he: heTeam(t.history.previousGame.opp, true) || t.history.previousGame.opp, result: t.history.previousGame.result === 'W' ? 'ניצחון' : 'הפסד', his_points: t.history.previousGame.pts } : null,
    next_game: t.team.context.next ? { opp_he: t.team.context.next.oppHe, home: t.team.context.next.home, weekday_he: t.team.context.next.israel.weekday, time_il: t.team.context.next.israel.time } : null,
    teammates: t.teammates.map((m) => ({ name_he: names.get(m.name) || m.name, pts: m.pts, reb: m.reb, ast: m.ast })),
    opponents: t.opponents.map((m) => ({ name_he: names.get(m.name) || m.name, pts: m.pts, reb: m.reb, ast: m.ast })),
    game: g,
  };
  b.verified = {
    season_high: ms.includes('SEASON_HIGH'),
    career_high: ms.includes('CAREER_HIGH') || ms.includes('TIES_CAREER_HIGH'),
    streak: !!b.team_streak_he || ms.includes('STREAK') || g.verified.streak,
    standings: false,
  };
  b.states = g.states;
  return b;
}

const ORD = ['', 'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שביעי', 'שמיני', 'תשיעי', 'עשירי'];
function ordinal(n) {
  return ORD[n] || `${n}`;
}
