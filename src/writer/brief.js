// facts -> the brief the model writes from. Hebrew names only, and every number already rendered in the
// order its context needs (see he.js). The model copies strings; it never orders numbers, picks the angle
// or decides whether a milestone is true. A claim the data does not verify is not in the brief at all.

import { heTeam, v } from '../teams.js';
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

// "ב" / "ל" + a name that starts with the definite article: "ברבע השלישי", "בהארכה"
export const pre = (prefix, name) => `${prefix}${name.startsWith('ה') ? name.slice(1) : name}`;
const COUNT_HE = { 3: 'שלושה', 4: 'ארבעה', 5: 'חמישה', 6: 'שישה', 7: 'שבעה' };

// a validated run, in words — no timestamps (the run object keeps them for the validator)
export function runClause(run, f) {
  const fp = f.clutch.finalPeriod;
  // facts saved before runs were structured carry only for/against/from/to
  const r = { start_period: run.from?.period, end_period: run.to?.period, points_for: run.for, points_against: run.against, ...run };
  const t = heTeam(f.teams[r.side].abbr) || f.teams[r.side].heShort || f.teams[r.side].he;
  const vb = (fem, pl) => v(f.teams[r.side].abbr, fem, pl);
  const pr = pair(r.points_for, r.points_against);
  const P = (p) => PERIOD_HE(p, fp);
  if (r.start_period === r.end_period) {
    if (r.closes_period) return `${t} ${vb('סגרה', 'סגרו')} את ${P(r.end_period)} בריצת ${pr}`;
    if (r.opens_period) return `${t} ${vb('פתחה', 'פתחו')} את ${P(r.start_period)} בריצת ${pr}`;
    return `${t} ${vb('רשמה', 'רשמו')} ריצת ${pr} ${pre('ב', P(r.start_period))}`;
  }
  return `${t} ${vb('רשמה', 'רשמו')} ריצת ${pr} בין ${P(r.start_period)} ${pre('ל', P(r.end_period))}`;
}

// the main angle, written as a Hebrew fact the lead must carry (only types the data proves)
function angleHe(k, f, tn, names = new Map()) {
  const t = (s) => tn(s);
  const vb = (s, fem, pl) => v(f.teams[s].abbr, fem, pl);
  const who = names.get(k.player) || k.player;
  const L = f.result.loser;
  if (k.context) return k.fact_he; // verified context facts arrive already written
  switch (k.type) {
    case 'COMEBACK': return `${t(k.side)} ${vb(k.side, 'חזרה', 'חזרו')} מפיגור ${k.pts}`;
    case 'GAME_WINNER': return who ? `${who} קלע את סל הניצחון של ${t(k.side)} בשניות האחרונות` : null;
    case 'BUZZER_BEATER': return who ? `${who} הכריע את המשחק עם הבאזר` : null;
    case 'FORCED_OT': return who ? `${who} השווה בסיום הזמן החוקי ושלח את המשחק להארכה` : null;
    case 'OVERTIME': return `${t(k.side)} ${vb(k.side, 'ניצחה', 'ניצחו')} אחרי ${k.n === 1 ? 'הארכה' : `${k.n} הארכות`}`;
    case 'LATE_COLLAPSE': return `${t(k.side)} ${vb(k.side, 'הובילה', 'הובילו')} בשלוש הדקות האחרונות ${vb(k.side, 'והפסידה', 'והפסידו')}`;
    case 'CLOSE_FINISH': return `המשחק הוכרע בהפרש של ${k.n === 1 ? 'נקודה' : `${k.n} נקודות`}`;
    case 'BLOWOUT': return `${t(k.side)} ${vb(k.side, 'ניצחה', 'ניצחו')} את ${t(k.side === 'home' ? 'away' : 'home')} בהפרש של ${k.n}`;
    case 'MAJOR_RUN': return k.run ? runClause(k.run, f) : null;
    case 'BIG_SCORING': case 'TOP_PERFORMER': return who ? `${who} קלע ${k.pts} נקודות${k.side === L ? ` בהפסד של ${t(k.side)}` : ''}` : null;
    case 'TRIPLE_DOUBLE': return who ? `${who} רשם טריפל-דאבל: ${k.pts} נקודות, ${k.reb} ריבאונדים ו-${k.ast} אסיסטים` : null;
    case 'UNUSUAL_STAT_LINE': return who ? `${who} קלע ${k.pts} נקודות ולקח ${k.reb} ריבאונדים` : null;
    case 'EJECTION': return who ? `${who} הורחק מהמשחק` : null;
    case 'FIRST_LOSS': return `${t(k.side)} ${vb(k.side, 'ספגה', 'ספגו')} הפסד ראשון העונה, אחרי ${k.n} ניצחונות בפתיחת העונה`;
    case 'FIRST_WIN': return `${t(k.side)} ${vb(k.side, 'רשמה', 'רשמו')} ניצחון ראשון העונה, אחרי ${k.n} הפסדים בפתיחת העונה`;
    case 'UNBEATEN': return `${t(k.side)} ${vb(k.side, 'נשארה', 'נשארו')} בלי הפסד: ${k.n} ניצחונות ב-${k.n} משחקים`;
    case 'WINLESS': return `${t(k.side)} עדיין בלי ניצחון: ${k.n} הפסדים ב-${k.n} משחקים`;
    case 'DOMINANT_QUARTER': return `${t(k.side)} ${vb(k.side, 'הכריעה', 'הכריעו')} ${pre('ב', PERIOD_HE(k.period, f.clutch.finalPeriod))}: ${partialPair(k.score[k.side], k.score[k.side === 'home' ? 'away' : 'home'])}`;
    case 'SHORT_ROSTER': return `${t(k.side)} ${vb(k.side, 'שיחקה', 'שיחקו')} עם ${COUNT_HE[k.n] || k.n} שחקנים בלבד`;
    case 'DECISIVE_RUN': return runClause(k.run, f);
    default: return null;
  }
}

export function gameBrief(f) {
  const names = heOf(f);
  const W = f.result.winner, L = f.result.loser, fp = f.clutch.finalPeriod;
  const other = (s) => (s === 'home' ? 'away' : 'home');
  const tn = (side) => heTeam(f.teams[side].abbr) || f.teams[side].heShort || f.teams[side].he;
  const vb = (side, fem, pl) => v(f.teams[side].abbr, fem, pl);
  const at = (a) => (a ? whenHe(a.period ?? periodNumber(a.periodName), a.clock, fp) : null);
  // every score state, once per team. kind 'partial' = subject first, 'last' = subject last (he.js)
  const states = [];
  const by = (h, a, kind, label = null) => {
    states.push({ home: h, away: a, kind, label });
    const fmt = kind === 'partial' ? partialPair : pair;
    return h === a ? `${h}:${a}` : { [tn('home')]: fmt(h, a), [tn('away')]: fmt(a, h) };
  };
  const byS = (s, kind = 'last') => by(s.home, s.away, kind);
  const recs = { home: recordForms(f.teams.home.record, W === 'home', !f.teams.home.plural), away: recordForms(f.teams.away.record, W === 'away', !f.teams.away.plural) };
  const story = f.story || { main: f.candidates[0] || null, secondary: f.candidates.slice(1, 3) };
  const top = story.main;
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
    // records: copy the form that fits the sentence — never reorder. The record belongs to the TEAM:
    // sentence_he names it as the subject ("אטלנטה עלתה למאזן 4:4"), never a player.
    records: Object.fromEntries(['home', 'away'].filter((s) => recs[s]).map((s) => [tn(s), { after_team_name: recs[s].in_parentheses, after_verb: recs[s].phrase, sentence_he: `${tn(s)} ${recs[s].phrase}` }])),
    quarters: f.teams.home.periods.map((h, i) => {
      const a = f.teams.away.periods[i];
      const win = h === a ? null : h > a ? 'home' : 'away';
      return {
        period_he: PERIOD_HE(i + 1, fp),
        clause: win ? `${tn(win)} ${vb(win, 'ניצחה', 'ניצחו')} את ${PERIOD_HE(i + 1, fp)} ${partialPair(f.teams[win].periods[i], f.teams[other(win)].periods[i])}` : `${PERIOD_HE(i + 1, fp)} הסתיים בשוויון ${h}:${a}`,
        score_by_subject: by(h, a, 'partial', 'quarter'),
      };
    }),
  };
  const lead = (s, word, label) => {
    const lv = s.home === s.away ? null : s.home > s.away ? 'home' : 'away';
    by(s.home, s.away, 'partial', label);
    return lv ? `${tn(lv)} ${vb(lv, 'הובילה', 'הובילו')} ${word} ${partialPair(s[lv], s[other(lv)])}` : `שוויון ${word} ${s.home}:${s.away}`;
  };
  b.halftime_clause = lead(f.result.halftime, 'במחצית', 'half');
  b.after_three_clause = lead(f.result.after3, 'אחרי שלושה רבעים', 'after3');

  // the angle is chosen by the story stage (story.js), in code; the lead must open with it
  b.main_angle = top ? { type: top.type, category: top.category || null, fact_he: angleHe(top, f, tn, names) || heText(names, top.why) } : null;
  b.secondary_angles = story.secondary.map((k) => ({ type: k.type, category: k.category || null, fact_he: angleHe(k, f, tn, names) || heText(names, k.why) }));
  // CONTEXT FACTS (streaks, highs, head-to-head): the only season / history claims the text may make
  const ctxFacts = (f.contextFacts || []).filter((x) => x.verified);
  b.context_facts = ctxFacts.map((x) => x.fact_he);

  if (f.flow.available) {
    b.largest_lead = ['home', 'away'].filter((s) => f.flow.largestLead[s].pts > 0).map((s) => ({ team_he: tn(s), pts: f.flow.largestLead[s].pts, period_he: f.flow.largestLead[s].at ? PERIOD_HE(f.flow.largestLead[s].at.period, fp) : null, score_by_subject: byS(f.flow.largestLead[s].score) }));
    b.lead_changes = f.flow.leadChanges;
    // runs come from the play-by-play (facts.js, validated); the clause is ready to copy, without times
    b.runs = f.flow.spurts.slice(0, 2).map((s) => {
      states.push(s.side === 'home' ? { home: s.for, away: s.against, kind: 'last' } : { home: s.against, away: s.for, kind: 'last' });
      return { team_he: tn(s.side), clause_he: runClause(s, f) };
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
  const recordAngles = (f.candidates || []).filter((k) => streakTypes.includes(k.type));
  b.verified = {
    season_high: ctxFacts.some((x) => x.flag === 'season_high'),
    career_high: ctxFacts.some((x) => x.flag === 'career_high'),
    streak: recordAngles.length > 0 || ctxFacts.some((x) => x.flag === 'streak'),
    standings: false,
    historical: false, // no NBA / franchise record source yet
  };
  // standard recap: 2 body paragraphs; 3 only when an Israeli played in the game
  const israeliPlayed = (f.israelis || []).some((i) => i.played);
  b.max_paragraphs = israeliPlayed ? 3 : 2;
  // the score line above the block already shows the final score: the text does not repeat it
  b.final_score_in = 'heading';
  b.featured = featured;
  b.states = states; // for the verifier (stripped from the prompt)
  b._check = checkData(f, names, tn, recordAngles, ctxFacts);
  return b;
}

// game-state data the validator needs and the model never sees (keys starting with _ are stripped)
function checkData(f, names, tn, recordAngles, ctxFacts) {
  const c = f.clutch;
  return {
    final_period: c.finalPeriod,
    team_side: Object.fromEntries(['home', 'away'].map((s) => [tn(s), s])),
    winner: f.result.winner,
    checkpoints: { q1: f.result.q1 || null, half: f.result.halftime, q3: f.result.after3, final: { home: f.teams.home.score, away: f.teams.away.score } },
    period_lead: f.flow.periodLead || [],
    quarters: f.teams.home.periods.map((h, i) => ({ home: h, away: f.teams.away.periods[i] })),
    moments: (f.flow.moments || []).map((m) => ({ side: m.side, period: m.period, s: m.secondsLeft, before: m.before, after: m.after })),
    winning_basket: c.winningBasket ? { side: c.winningBasket.side, after: c.winningBasket.scoreAfter, secondsLeft: c.winningBasket.secondsLeftInPeriod, period: c.winningBasket.period, late: c.winningBasket.late, buzzer: c.winningBasket.buzzer } : null,
    tying_to_ot: c.tyingShotToOT ? { secondsLeft: c.tyingShotToOT.secondsLeftInPeriod } : null,
    // periods that really ended on a basket at the buzzer (the color layer finds them in the play-by-play)
    buzzer_periods: [...new Set([...(f.color?.events || []).filter((e) => e.kind === 'end-of-period buzzer basket').map((e) => e.period),
      ...(c.winningBasket?.buzzer ? [c.winningBasket.period] : []), ...(c.tyingShotToOT && c.tyingShotToOT.secondsLeftInPeriod <= 1 ? [4] : [])])],
    runs: (f.flow.spurts || []).map((r) => ({ side: r.side, for: r.points_for, against: r.points_against })),
    lines: Object.fromEntries(['home', 'away'].flatMap((s) => f.players[s].filter((p) => p.played).map((p) => [names.get(p.name) || p.name, { pts: p.pts, reb: p.reb, ast: p.ast, stl: p.stl, blk: p.blk, side: s }]))),
    streak_tokens: [...ctxFacts.filter((x) => x.flag === 'streak').flatMap((x) => x.tokens || []), ...(recordAngles.length ? ['ראשון', 'ראשונה', 'בלי הפסד', 'בלי ניצחון'] : [])],
  };
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
  // the player piece may also state his team's streak and his own verified streaks
  const extraTokens = [b.team_streak_he ? ordinal(streak.length) : null, ...t.milestones.filter((m) => m.type === 'STREAK').map((m) => String(m.text.match(/\d+/)?.[0] || ''))].filter(Boolean);
  b._check = { ...g._check, streak_tokens: [...(g._check.streak_tokens || []), ...extraTokens] };
  return b;
}

const ORD = ['', 'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שביעי', 'שמיני', 'תשיעי', 'עשירי'];
function ordinal(n) {
  return ORD[n] || `${n}`;
}
