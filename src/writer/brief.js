// facts -> the brief the model writes from. Hebrew names only, numbers already in Sport5 form.
// Everything the model may say is in here; the verifier checks the draft against it.

import { heTeam } from '../teams.js';
import { pair, recordHe, whenHe, periodNumber, nightHe, fullLineHe, shortLineHe, KIND_HE, PERIOD_HE } from './he.js';

const heOf = (f) => {
  const m = new Map();
  for (const s of ['home', 'away']) for (const p of f.players[s]) m.set(p.name, p.he || p.name);
  return m;
};
// swap English player names inside ESPN play text for Hebrew ones
const heText = (names, text) => [...names.entries()].sort((a, b) => b[0].length - a[0].length).reduce((t, [en, he]) => t.split(en).join(he), text || '');

function teamBrief(f, side) {
  const t = f.teams[side];
  return { he: t.he, short: t.heShort, score: t.score, record_he: recordHe(t.record) };
}

function starBrief(p, full = false) {
  return { name_he: p.he || p.name, starter: p.starter, line_he: full ? fullLineHe(p) : shortLineHe(p), pts: p.pts, reb: p.reb, ast: p.ast, notes: p.flags };
}

export function gameBrief(f) {
  const names = heOf(f);
  const W = f.result.winner, L = f.result.loser, fp = f.clutch.finalPeriod;
  const tn = (side) => f.teams[side].heShort || f.teams[side].he;
  const at = (a) => (a ? whenHe(a.period ?? periodNumber(a.periodName), a.clock, fp) : null);
  // every score state, written once per team: pick the version of the team the sentence is about
  const states = [];
  const by = (h, a) => {
    states.push({ home: h, away: a });
    return h === a ? `${h}:${a}` : { [tn('home')]: pair(h, a), [tn('away')]: pair(a, h) };
  };
  const byS = (s) => by(s.home, s.away);
  const b = {
    kind: 'game',
    night_he: `הלילה (${nightHe(f.date)})`,
    heading: `${f.teams.home.he} ${recordHe(f.teams.home.record)} - ${f.teams.away.he} ${recordHe(f.teams.away.record)} ${f.teams.away.score}:${f.teams.home.score}`,
    home: teamBrief(f, 'home'),
    away: teamBrief(f, 'away'),
    home_is: tn('home'),
    away_is: tn('away'),
    winner_he: tn(W),
    loser_he: tn(L),
    margin: f.result.margin,
    overtimes: f.clutch.overtimes,
    final_score_by_subject: byS({ home: f.teams.home.score, away: f.teams.away.score }),
    result_for_winner: `ניצחון ${pair(f.teams[W].score, f.teams[L].score)}`,
    result_for_loser: `הפסד ${pair(f.teams[L].score, f.teams[W].score)}`,
    quarters: f.teams.home.periods.map((_, i) => ({ period_he: PERIOD_HE(i + 1, fp), [tn('home')]: f.teams.home.periods[i], [tn('away')]: f.teams.away.periods[i], quarter_score_by_subject: by(f.teams.home.periods[i], f.teams.away.periods[i]) })),
    halftime_by_subject: byS(f.result.halftime),
    after_three_by_subject: byS(f.result.after3),
  };
  if (f.flow.available) {
    b.largest_lead = ['home', 'away'].filter((s) => f.flow.largestLead[s].pts > 0).map((s) => ({ team_he: tn(s), pts: f.flow.largestLead[s].pts, when_he: at(f.flow.largestLead[s].at), score_by_subject: byS(f.flow.largestLead[s].score) }));
    b.lead_changes = f.flow.leadChanges;
    b.runs = f.flow.spurts.slice(0, 3).map((s) => {
      states.push(s.side === 'home' ? { home: s.for, away: s.against } : { home: s.against, away: s.for });
      return { team_he: tn(s.side), run_he: `ריצת ${pair(s.for, s.against)}`, from_he: at(s.from), to_he: at(s.to), score_after_by_subject: byS(s.scoreAfter) };
    });
  }
  const c = f.clutch;
  b.final_minutes = {
    five_minutes_left_by_subject: c.marginAt5min ? byS(c.marginAt5min) : null,
    two_minutes_left_by_subject: c.marginAt2min ? byS(c.marginAt2min) : null,
    winning_basket: c.winningBasket ? { player_he: names.get(c.winningBasket.player) || c.winningBasket.player, team_he: tn(c.winningBasket.side), when_he: at(c.winningBasket), decisive_late: c.winningBasket.late, score_after_by_subject: byS(c.winningBasket.scoreAfter), play: heText(names, c.winningBasket.text) } : null,
    tying_shot_to_overtime: c.tyingShotToOT ? { player_he: names.get(c.tyingShotToOT.player) || c.tyingShotToOT.player, team_he: tn(c.tyingShotToOT.side), when_he: at(c.tyingShotToOT), score: byS(c.tyingShotToOT.score), play: heText(names, c.tyingShotToOT.text) } : null,
    loser_led_in_last_three_minutes: c.loserLedInLast3min,
    last_two_minutes: c.finalSequence.filter((p) => p.scoring || /miss|block|steal|turnover|foul/i.test(p.text)).slice(-14).map((p) => ({ when_he: whenHe(fp, p.clock, fp), team_he: p.side ? tn(p.side) : null, score_by_subject: byS(p.score), play: heText(names, p.text) })),
  };
  b.stars = {
    [tn(W)]: f.players[W].filter((p) => p.played).sort((x, y) => y.pts - x.pts).slice(0, 4).map((p) => starBrief(p)),
    [tn(L)]: f.players[L].filter((p) => p.played).sort((x, y) => y.pts - x.pts).slice(0, 3).map((p) => starBrief(p)),
  };
  const outInjured = ['home', 'away'].flatMap((s) => f.players[s].filter((p) => !p.played && p.dnpReason && !/coach/i.test(p.dnpReason)).map((p) => `${p.he || p.name} (${tn(s)}) לא שיחק — ${p.dnpReason}`));
  if (outInjured.length) b.did_not_play = outInjured;
  b.color = (f.color?.events || []).filter((e) => !/challenge/.test(e.kind)).map((e) => ({ what_he: KIND_HE[e.kind] || e.kind, player_he: names.get(e.player) || e.player, team_he: e.team ? tn(e.team === f.teams.home.abbr ? 'home' : 'away') : null, when_he: e.kind === 'end-of-period buzzer basket' ? `בסיום ${PERIOD_HE(e.period, fp)}` : at(e), in_crunch_time: e.clutch }));
  const w = f.candidates[0]?.weight || 0;
  b.paragraphs_target = w >= 70 ? '2-3' : w >= 50 ? '2' : '1-2';
  b.story_candidates = f.candidates.slice(0, 4).map((k) => ({ type: k.type, why: heText(names, k.why) }));
  b.do_not_state = f.research.map((r) => heText(names, r));
  b.states = states; // for the verifier (stripped from the prompt)
  return b;
}

export function playerBrief(f, t) {
  const g = gameBrief(f);
  const names = heOf(f);
  const sideW = t.won;
  const tnp = (side) => f.teams[side].heShort || f.teams[side].he;
  const subject = (s) => { g.states.push({ home: s.home, away: s.away }); return s.home === s.away ? `${s.home}:${s.away}` : { [tnp('home')]: pair(s.home, s.away), [tnp('away')]: pair(s.away, s.home) }; };
  const b = {
    kind: 'player',
    player_he: t.player.he,
    team_he: t.team.he,
    opp_he: t.opp.he,
    home: t.home,
    won: t.won,
    result_he: `${sideW ? 'ניצחון' : 'הפסד'} ${pair(t.team.score, t.opp.score)}`,
    team_record_he: recordHe(t.team.record),
    team_streak: t.team.context.streak ? `${t.team.context.streak.length} ${t.team.context.streak.kind === 'W' ? 'ניצחונות' : 'הפסדים'} רצופים` : null,
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
  b.states = g.states;
  return b;
}
