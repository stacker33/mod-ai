// facts -> the brief the model writes from. Hebrew names only, and every number already rendered in the
// order its context needs (see he.js). The model copies strings; it never orders numbers, picks the angle
// or decides whether a milestone is true. A claim the data does not verify is not in the brief at all.

import { heTeam, v } from '../teams.js';
import { classifyPlay } from '../pbp.js';
import { storyline } from './storyline.js';
import { formatRecord, pair, partialPair, formatScore, shotActionHe, PLAY_LABEL_HE, recordForms, whenHe, periodNumber, nightHe, fullLineHe, shortLineHe, KIND_HE, PERIOD_HE } from './he.js';

export const FEATURED = 90; // story weight from which a game gets a stand-alone article

// every Israeli who played in this game, as a ready sentence — the game's ONE piece must include each of
// them (editor, 2026-11-04: Wolf / Saraf / Avdija / Sharp in the same game = one piece, never two)
export function israeliLines(f, exceptId = null) {
  return (f.tracks || []).filter((t) => t.inGame && t.played && t.line && t.player.id !== exceptId).map((t) => {
    const he = t.player.he || t.player.name;
    const team = heTeam(t.team.abbr) || t.team.he;
    const line = `${shortLineHe(t.line)} ב-${t.line.min} דקות`;
    return { player_he: he, team_he: team, line_he: line, sentence_he: `${he} (${team}) סיים עם ${line}` };
  });
}

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

// overtime in the score line, as Sport5 writes it ("117:116 בהארכה")
export const otHe = (n) => (!n ? '' : n === 1 ? ' בהארכה' : ` אחרי ${n} הארכות`);

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

// a notable moment (facts.js notableMoments) as a Hebrew fact
function momentHe(m, f, names, tn) {
  const byId = (id) => { for (const s of ['home', 'away']) { const p = f.players[s].find((x) => x.id === id); if (p) return names.get(p.name) || p.he || p.name; } return null; };
  const vb = (s, fem, pl) => v(f.teams[s].abbr, fem, pl);
  const other = (s) => (s === 'home' ? 'away' : 'home');
  switch (m.type) {
    case 'MISSED_WINNER': {
      const who = byId(m.player);
      if (!who) return null;
      const what = m.shot === 'three' ? 'שלשה' : 'זריקה';
      const could = m.kind === 'winning' ? 'שהייתה יכולה להכריע את המשחק' : 'שהייתה יכולה לשלוח להארכה';
      // the exact time, so the order against the other late plays is never guessed (a tie at 1.5, the miss at 0.5)
      const end = m.regulation ? 'הזמן החוקי' : m.period > 4 ? 'ההארכה' : null;
      const s = m.secondsLeft;
      const when = s != null && s < 1 ? `בשנייה האחרונה${end ? ` של ${end}` : ''}` : s != null && s < 60 ? `${Math.round(s)} שניות לסיום${end ? ` ${end}` : ''}` : end ? `בסיום ${end}` : 'בהתקפה האחרונה';
      return `${who} החטיא ${what} ${m.regulation && m.kind === 'winning' ? 'שהייתה יכולה להכריע את המשחק' : could} ${when}`;
    }
    case 'BIG_HALF': { const who = byId(m.playerId); return who ? `${who} קלע ${m.pts} נקודות כבר במחצית הראשונה` : null; }
    case 'POOR_SHOOTING_TD': { const who = byId(m.playerId); return who ? `${who} רשם טריפל-דאבל, אבל קלע רק ${m.fg[0]} מ-${m.fg[1]} מהשדה` : null; }
    case 'Q4_COLLAPSE': {
      const s = m.side;
      const by = m.by && byId(m.by.playerId) ? `, שבו ${byId(m.by.playerId)} קלע ${m.by.pts} נקודות` : '';
      return `${tn(s)} ${vb(s, 'הובילה', 'הובילו')} אחרי שלושה רבעים ${pair(m.after3[s], m.after3[other(s)])}, אבל ${vb(s, 'הפסידה', 'הפסידו')} ${pair(m.q4[s], m.q4[other(s)])} את הרבע האחרון${by}`;
    }
    case 'PERIOD_TAKEOVER': {
      const who = byId(m.playerId);
      const P = PERIOD_HE(m.period, f.clutch.finalPeriod);
      return who ? `${who} קלע ${m.pts} נקודות ${pre('ב', P)}, כש${tn(m.side)} ${vb(m.side, 'ניצחה', 'ניצחו')} אותו ${pair(m.score.for, m.score.against)}` : null;
    }
    case 'PLAYER_FADE': {
      const who = byId(m.playerId);
      if (!who) return null;
      if (m.period) {
        const P = PERIOD_HE(m.period, f.clutch.finalPeriod);
        const quiet = m.ptsInPeriod ? `קלע רק ${m.ptsInPeriod} ${pre('ב', P)}` : `לא קלע ${pre('ב', P)}`;
        const lost = m.toInPeriod >= 2 ? ` ואיבד בו ${m.toInPeriod} כדורים` : '';
        const total = m.toTotal >= 6 ? ` (${m.toTotal} איבודים במשחק כולו)` : '';
        return `${who} קלע ${m.h1} נקודות במחצית הראשונה, אבל ${quiet}${lost}${total}, כש${tn(m.side)} ${vb(m.side, 'הפסידה', 'הפסידו')} אותו ${pair(m.score.for, m.score.against)}`;
      }
      return `${who} קלע ${m.h1} נקודות במחצית הראשונה, אבל ${m.h2 ? `רק ${m.h2}` : 'לא קלע'} אחרי ההפסקה`;
    }
    case 'PLAYER_SURGE': { const who = byId(m.playerId); return who ? `${who} קלע ${m.h2} מ-${m.h1 + m.h2} נקודותיו אחרי ההפסקה` : null; }
    case 'TURNOVERS': { const who = byId(m.playerId); return who ? `${who} איבד ${m.to} כדורים` : null; }
    case 'HOT_THREES': return m.half
      ? `${tn(m.side)} ${vb(m.side, 'קלעה', 'קלעו')} ${m.half[0]} מ-${m.half[1]} משלוש כבר במחצית הראשונה${m.tp ? ` (${m.tp[0]} מ-${m.tp[1]} במשחק כולו)` : ''}`
      : `${tn(m.side)} ${vb(m.side, 'קלעה', 'קלעו')} ${m.tp[0]} מ-${m.tp[1]} משלוש`;
    case 'COLD_THREES': return `${tn(m.side)} ${vb(m.side, 'קלעה', 'קלעו')} רק ${m.tp[0]} מ-${m.tp[1]} משלוש`;
    case 'COLD_SHOOTING': return `${tn(m.side)} ${vb(m.side, 'נעצרה', 'נעצרו')} על ${m.pct}% מהשדה`;
    default: return null;
  }
}

// the same run as a noun phrase, to sit inside a sentence: "ריצת 3:19 של סן אנטוניו בסיום הרבע השני"
export function runNoun(run, f) {
  const fp = f.clutch.finalPeriod;
  const r = { start_period: run.from?.period, end_period: run.to?.period, points_for: run.for, points_against: run.against, ...run };
  const t = heTeam(f.teams[r.side].abbr) || f.teams[r.side].heShort || f.teams[r.side].he;
  const P = PERIOD_HE(r.start_period, fp);
  const where = r.start_period !== r.end_period ? '' : r.closes_period ? ` בסיום ${P}` : r.opens_period ? ` בפתיחת ${P}` : ` ${pre('ב', P)}`;
  return `ריצת ${pair(r.points_for, r.points_against)} של ${t}${where}`;
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
    case 'SPECIAL_VENUE': return `${t(k.side)} ${vb(k.side, 'ניצחה', 'ניצחו')} את ${t(f.result.loser)} במשחק שנערך ב${k.city_he}`;
    case 'FIRST_VENUE_LOSS': return `${t(k.side)} ${vb(k.side, 'ספגה', 'ספגו')} הפסד ${k.home ? 'בית' : 'חוץ'} ראשון העונה`;
    case 'GAME_WINNER': {
      const wb = f.clutch.winningBasket;
      if (!who) return null;
      return /free-throw/.test(wb?.shot || '') ? `${who} הכריע את המשחק מהקו בשניות האחרונות` : `${who} ${shotActionHe(wb?.shot || 'field-goal')} והכריע את המשחק בשניות האחרונות`;
    }
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
    case 'ISRAELI_ANGLE': {
      const tr = (f.tracks || []).find((x) => x.player?.name === k.player && x.line);
      return tr ? `${who} (${t(k.side)}) סיים עם ${shortLineHe(tr.line)} ב-${tr.line.min} דקות` : null;
    }
    case 'FIRST_LOSS': return `${t(k.side)} ${vb(k.side, 'ספגה', 'ספגו')} הפסד ראשון העונה, אחרי ${k.n} ניצחונות בפתיחת העונה`;
    case 'FIRST_WIN': return `${t(k.side)} ${vb(k.side, 'רשמה', 'רשמו')} ניצחון ראשון העונה, אחרי ${k.n} הפסדים בפתיחת העונה`;
    case 'UNBEATEN': return `${t(k.side)} ${vb(k.side, 'נשארה', 'נשארו')} בלי הפסד: ${k.n} ניצחונות ב-${k.n} משחקים`;
    case 'WINLESS': return `${t(k.side)} עדיין בלי ניצחון: ${k.n} הפסדים ב-${k.n} משחקים`;
    case 'DOMINANT_QUARTER': return `${t(k.side)} ${vb(k.side, 'הכריעה', 'הכריעו')} ${pre('ב', PERIOD_HE(k.period, f.clutch.finalPeriod))}: ${pair(k.score[k.side], k.score[k.side === 'home' ? 'away' : 'home'])}`;
    case 'SHORT_ROSTER': return `${t(k.side)} ${vb(k.side, 'שיחקה', 'שיחקו')} עם ${COUNT_HE[k.n] || k.n} שחקנים בלבד`;
    case 'DECISIVE_RUN': return runClause(k.run, f);
    default: return null;
  }
}

// Sport5's score line in a Cup game: "קליבלנד (4:5, 0:1)" — the season record, then the Cup record
const withCup = (paren, cup) => (!paren ? '' : cup ? paren.replace(/\)$/, `, ${formatRecord(cup.w, cup.l, 'standalone')})`) : paren);

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
    states.push({ home: h, away: a, kind: 'last', label });
    const fmt = pair; // Sport5: the subject's score last, for every kind of score
    return h === a ? `${h}:${a}` : { [tn('home')]: fmt(h, a), [tn('away')]: fmt(a, h) };
  };
  // a game state (lead, late score, score after a play): Sport5 order, the subject's score last (he.js)
  const byS = (s, kind = 'partial') => by(s.home, s.away, kind);
  const recs = { home: recordForms(f.teams.home.record, W === 'home', !f.teams.home.plural), away: recordForms(f.teams.away.record, W === 'away', !f.teams.away.plural) };
  const story = f.story || { main: f.candidates[0] || null, secondary: f.candidates.slice(1, 3) };
  const top = story.main;
  const featured = (top?.weight || 0) >= FEATURED;

  const b = {
    kind: 'game',
    night_he: `הלילה (${nightHe(f.date)})`,
    heading: `${f.teams.home.he} ${withCup(recs.home?.in_parentheses, f.cup?.records?.home)} - ${f.teams.away.he} ${withCup(recs.away?.in_parentheses, f.cup?.records?.away)} ${f.teams.away.score}:${f.teams.home.score}${otHe(f.clutch.overtimes)}`.replace(/\s+/g, ' '),
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
    records: Object.fromEntries(['home', 'away'].filter((s) => recs[s]).map((s) => [tn(s), { after_team_name: recs[s].in_parentheses, after_verb: recs[s].phrase, sentence_he: `${tn(s)} ${recs[s].phrase}`, ...(f.cup?.records?.[s] ? { cup_he: `(${formatRecord(f.cup.records[s].w, f.cup.records[s].l, 'standalone')} בגביע)` } : {}) }])),
    // an NBA Cup game: "במסגרת הגביע"; each team's Cup record is in records[].cup_he
    cup_game: !!f.cupGame,
    quarters: f.teams.home.periods.map((h, i) => {
      const a = f.teams.away.periods[i];
      const win = h === a ? null : h > a ? 'home' : 'away';
      return {
        period_he: PERIOD_HE(i + 1, fp),
        clause: win ? `${tn(win)} ${vb(win, 'ניצחה', 'ניצחו')} ${pair(f.teams[win].periods[i], f.teams[other(win)].periods[i])} את ${PERIOD_HE(i + 1, fp)}` : `${PERIOD_HE(i + 1, fp)} הסתיים בשוויון ${h}:${a}`,
        score_by_subject: by(h, a, 'partial', 'quarter'),
      };
    }),
  };
  const lead = (s, word, label) => {
    const lv = s.home === s.away ? null : s.home > s.away ? 'home' : 'away';
    by(s.home, s.away, 'partial', label);
    return lv ? `${tn(lv)} ${vb(lv, 'הובילה', 'הובילו')} ${word} ${pair(s[lv], s[other(lv)])}` : `שוויון ${word} ${s.home}:${s.away}`;
  };
  const halfClause = lead(f.result.halftime, 'במחצית', 'half');
  const threeClause = lead(f.result.after3, 'אחרי שלושה רבעים', 'after3');
  // SELECTION IN CODE: a checkpoint / quarter score reaches the writer only when it tells the story
  // (the leader then was not the winner, a dominant quarter, a lopsided half) — not as narration
  const leaderAt = (s) => (s.home === s.away ? null : s.home > s.away ? 'home' : 'away');
  const swingHalf = leaderAt(f.result.halftime) !== W || Math.abs(f.result.halftime.home - f.result.halftime.away) >= 15;
  const swingThree = leaderAt(f.result.after3) !== W;
  const hasPeriods = f.teams.home.periods.length >= 4 && f.teams.away.periods.length >= 4;
  b.halftime_clause = hasPeriods && swingHalf ? halfClause : null;
  b.after_three_clause = hasPeriods && swingThree ? threeClause : null;
  const lastReg = Math.min(4, f.teams.home.periods.length);
  b.quarters = b.quarters.filter((q, i) => {
    const h = f.teams.home.periods[i], a = f.teams.away.periods[i];
    return Math.abs(h - a) >= 12 || (i + 1 === lastReg && swingThree);
  });

  // the angle is chosen by the story stage (story.js), in code; the lead must open with it
  b.main_angle = top ? { type: top.type, category: top.category || null, player: top.player || null, fact_he: angleHe(top, f, tn, names) || heText(names, top.why), tokens: angleTokens(top, names) } : null;
  b.secondary_angles = story.secondary.map((k) => ({ type: k.type, category: k.category || null, fact_he: angleHe(k, f, tn, names) || heText(names, k.why) }));
  // CONTEXT FACTS (streaks, highs, head-to-head): the only season / history claims the text may make
  const ctxFacts = (f.contextFacts || []).filter((x) => x.verified);
  b.context_facts = ctxFacts.map((x) => x.fact_he);
  // background from ESPN data, ready in Hebrew: next games, the previous meeting, who was out
  if (f.gameContext) b.context_game = f.gameContext;
  // the one or two telling details (notable moments, chosen in code by their wow score)
  const det = (f.notable || []).map((m) => momentHe(m, f, names, tn)).filter(Boolean);
  if (det.length) b.details = det.slice(0, 2);

  if (f.flow.available) {
    b.largest_lead = ['home', 'away'].filter((s) => f.flow.largestLead[s].pts > 0).map((s) => ({ team_he: tn(s), pts: f.flow.largestLead[s].pts, period_he: f.flow.largestLead[s].at ? PERIOD_HE(f.flow.largestLead[s].at.period, fp) : null, score_by_subject: byS(f.flow.largestLead[s].score) }));
    b.lead_changes = f.flow.leadChanges;
    // runs come from the play-by-play (facts.js, validated); the clause is ready to copy, without times
    // only runs inside one period: a cross-period run is computable but rarely a clean story
    b.runs = f.flow.spurts.filter((s) => s.start_period === s.end_period).slice(0, 2).map((s) => {
      states.push(s.side === 'home' ? { home: s.for, away: s.against, kind: 'last' } : { home: s.against, away: s.for, kind: 'last' });
      // clause_he is a full sentence; noun_he fits INSIDE a sentence ("... אחרי ריצת 3:19 של סן אנטוניו ברבע השני")
      return { team_he: tn(s.side), clause_he: runClause(s, f), noun_he: runNoun(s, f) };
    });
  }

  // decisive plays: each one separately, with who, assist, time and the score after it
  const c = f.clutch;
  // a decisive play, classified in code: what kind of shot (free throws are never "a basket") and the score after
  const play = (x, side) => {
    if (!x) return null;
    const scorer = names.get(x.player) || x.player;
    const assist = (x.text.match(/\(([^)]+) assists\)/) || [])[1];
    return { player_he: scorer, assist_he: assist ? names.get(assist) || assist : null, team_he: tn(side), shot: x.shot || null, action_he: x.shot ? `${scorer} ${shotActionHe(x.shot, x.made || 1)}` : null, free_throws: /free-throw/.test(x.shot || ''), when_he: at(x), score_after_by_subject: byS(x.tripScoreAfter || x.scoreAfter || x.score) };
  };
  b.final_minutes = {
    five_minutes_left_by_subject: c.marginAt5min ? byS(c.marginAt5min) : null,
    two_minutes_left_by_subject: c.marginAt2min ? byS(c.marginAt2min) : null,
    // the play that put the winner ahead for good — only when it came late (last 3 minutes of the final period);
    // an early one does not explain the finish and its clock is noise
    winning_basket: c.winningBasket && c.winningBasket.period === fp && c.winningBasket.secondsLeftInPeriod <= 180 ? { ...play(c.winningBasket, c.winningBasket.side), decisive_late: c.winningBasket.late } : null,
    tying_shot_to_overtime: c.tyingShotToOT ? play(c.tyingShotToOT, c.tyingShotToOT.side) : null,
    loser_led_in_last_three_minutes: c.loserLedInLast3min,
    // separate plays, in order — never merge two of them into one sentence about one player
    // only plays that explain the finish: ties, go-ahead plays, the decisive one (free-throw trips merged)
    last_two_minutes: c.finalSequence.length ? keyPlays(f, fp).map((m) => ({ when_he: whenHe(fp, m.clock, fp), team_he: tn(m.side), player_he: names.get(m.player) || m.player, action_he: `${names.get(m.player) || m.player} ${shotActionHe(m.shot, m.made)}${m.andOne ? ' ועוד זריקת עונשין (סל ועבירה)' : ''}`, label_he: PLAY_LABEL_HE[m.label], score_after_by_subject: byS(m.after) })) : [],
  };
  b.stars = {
    // SELECTION IN CODE: the writer gets the 3 / 2 players that matter, not the whole box score
    [tn(W)]: f.players[W].filter((p) => p.played).sort((x, y) => y.pts - x.pts).slice(0, 3).map((p) => starBrief(p)),
    [tn(L)]: f.players[L].filter((p) => p.played).sort((x, y) => y.pts - x.pts).slice(0, 2).map((p) => starBrief(p)),
  };
  const outInjured = ['home', 'away'].flatMap((s) => f.players[s].filter((p) => !p.played && p.dnpReason && !/coach/i.test(p.dnpReason)).map((p) => `${p.he || p.name} (${tn(s)}) לא שיחק — ${p.dnpReason}`));
  if (outInjured.length) b.did_not_play = outInjured;
  // only events that change how the game is told (color.js decides relevance)
  b.color = (f.color?.events || []).filter((e) => e.relevant).map((e) => ({ what_he: KIND_HE[e.kind] || e.kind, players_he: (e.players || []).map((n) => names.get(n) || n), team_he: e.team ? tn(e.team === f.teams.home.abbr ? 'home' : 'away') : null, when_he: at(e) }));

  // what the data verifies — milestone language is allowed only where true
  const streakTypes = ['FIRST_LOSS', 'FIRST_WIN', 'UNBEATEN', 'WINLESS', 'FIRST_VENUE_LOSS'];
  const recordAngles = (f.candidates || []).filter((k) => streakTypes.includes(k.type));
  b.verified = {
    season_high: ctxFacts.some((x) => x.flag === 'season_high'),
    career_high: ctxFacts.some((x) => x.flag === 'career_high'),
    streak: recordAngles.length > 0 || ctxFacts.some((x) => x.flag === 'streak'),
    standings: false,
    // last season's playoff series between the two (ESPN schedule) — the only playoff language allowed
    playoffs: ctxFacts.some((x) => x.flag === 'history'),
    historical: false, // no NBA / franchise record source yet
  };
  // standard recap: 2 body paragraphs; 3 only when an Israeli played in the game
  const israeliPlayed = (f.israelis || []).some((i) => i.played);
  b.max_paragraphs = israeliPlayed ? 3 : 2;
  b.target_words = [90, 130]; // Sport5's nightly block: ~90-130 words, more when the game earns it
  const isr = israeliLines(f);
  if (isr.length) b.israelis_featured = isr;
  // the score line above the block already shows the final score: the text does not repeat it
  b.final_score_in = 'heading';
  b.featured = featured;
  // THE STORY, decided in code: theme -> hook, protagonist, the turn, the cast with roles, color
  b.story = storyline(f, b, names, tn, (m) => momentHe(m, f, names, tn), (k) => angleHe(k, f, tn, names));
  // the hero of the story is in the block even when the sentence about him had to go (wrong number -> dropped)
  const hero = b.story.protagonist;
  b.must_tell = [];
  // a major comeback that is not the angle must still be told (it explains how the game was won)
  const cbk = top?.type !== 'COMEBACK' && (f.candidates || []).find((k) => k.type === 'COMEBACK');
  if (cbk) { const s = angleHe(cbk, f, tn, names); if (s) b.must_tell.push({ fact_he: s, who: [tn(cbk.side)], num: String(cbk.pts), para: 1, full_only: true }); }
  // a rout: when / how the gap opened has to be in the block, not only the scorers
  if (b.story.theme === 'DOMINANCE' && b.story.turn_he[0]) { const s = b.story.turn_he[0]; const n = s.match(/\d+/)?.[0] || null; b.must_tell.push({ fact_he: s, who: [tn('home'), tn('away')], num: n, para: 1, full_only: true }); }
  if (hero && !(b.main_angle?.fact_he || '').includes(hero.name_he)) b.must_tell.push({ fact_he: `${hero.name_he} סיים עם ${hero.line_he}`, who: [hero.name_he, hero.name_he.split(' ').slice(1).join(' ')], num: hero.line_he.match(/\d+/)?.[0] || null, para: 0, full_only: true });
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
    winning_basket: c.winningBasket ? { side: c.winningBasket.side, after: c.winningBasket.scoreAfter, tripAfter: c.winningBasket.tripScoreAfter || null, secondsLeft: c.winningBasket.secondsLeftInPeriod, period: c.winningBasket.period, late: c.winningBasket.late, buzzer: c.winningBasket.buzzer, shot: c.winningBasket.shot || null, player: names.get(c.winningBasket.player) || c.winningBasket.player } : null,
    tying_to_ot: c.tyingShotToOT ? { secondsLeft: c.tyingShotToOT.secondsLeftInPeriod } : null,
    // periods that really ended on a basket at the buzzer (the color layer finds them in the play-by-play)
    buzzer_periods: [...new Set([...(f.color?.events || []).filter((e) => e.kind === 'end-of-period buzzer basket').map((e) => e.period),
      ...(c.winningBasket?.buzzer ? [c.winningBasket.period] : []), ...(c.tyingShotToOT && c.tyingShotToOT.secondsLeftInPeriod <= 1 ? [4] : [])])],
    runs: (f.flow.spurts || []).map((r) => ({ side: r.side, for: r.points_for, against: r.points_against })),
    largest_lead: { home: f.flow.largestLead?.home?.pts ?? null, away: f.flow.largestLead?.away?.pts ?? null },
    second_half: { home: (f.teams.home.periods[2] || 0) + (f.teams.home.periods[3] || 0), away: (f.teams.away.periods[2] || 0) + (f.teams.away.periods[3] || 0) },
    lines: Object.fromEntries(['home', 'away'].flatMap((s) => f.players[s].filter((p) => p.played).map((p) => [names.get(p.name) || p.name, { pts: p.pts, reb: p.reb, ast: p.ast, stl: p.stl, blk: p.blk, side: s }]))),
    streak_tokens: [...ctxFacts.filter((x) => x.flag === 'streak').flatMap((x) => x.tokens || []), ...(recordAngles.length ? ['ראשון', 'ראשונה', 'בלי הפסד', 'בלי ניצחון'] : [])],
  };
}

export function playerBrief(f, t) {
  const g = gameBrief(f);
  const names = heOf(f);
  const tnp = (side) => f.teams[side].heShort || f.teams[side].he;
  const subject = (s) => { g.states.push({ home: s.home, away: s.away, kind: 'last' }); return s.home === s.away ? `${s.home}:${s.away}` : { [tnp('home')]: formatScore(s, 'home'), [tnp('away')]: formatScore(s, 'away') }; };
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
    team_record: rec ? { after_team_name: rec.in_parentheses, after_verb: rec.phrase, ...(f.cup?.records?.[t.side] ? { cup_he: `(${formatRecord(f.cup.records[t.side].w, f.cup.records[t.side].l, 'standalone')} בגביע)` } : {}) } : null,
    cup_game: !!f.cupGame,
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
  // another Israeli in the same game (Wolf next to Avdija, Sharp against Avdija) belongs in this article
  const others = israeliLines(f, t.player.id);
  if (others.length) b.other_israelis = others;
  delete g.israelis_featured;
  // THE STORY, not only the line: his night (arcs from the play-by-play) and, when the game's main story is
  // someone else's (53 points on the other side), that story with its protagonist. Written in code; the text
  // must carry each one (verify.js "must-tell").
  const tnHe = (side) => heTeam(f.teams[side].abbr) || f.teams[side].heShort || f.teams[side].he;
  const surname = (he) => he.split(' ').slice(1).join(' ') || he;
  const firstNum = (s) => s.match(/\d+/)?.[0] || null;
  const toHigh = t.milestones.find((m) => m.type === 'CAREER_HIGH_TO');
  b.his_story_he = (f.notable || []).filter((m) => m.playerId === t.player.id).slice(0, 2)
    .map((m) => { const s = momentHe(m, f, names, tnHe); if (!s || !toHigh) return s; return m.type === 'TURNOVERS' ? `${s}, הכי הרבה בקריירה שלו` : s.replace('איבודים במשחק כולו)', 'איבודים במשחק כולו, הכי הרבה בקריירה שלו)'); }).filter(Boolean);
  // HOW HE ACTUALLY PLAYED — not the same as "led his team in scoring". From his line and the game only.
  b.performance = performanceVerdict(t, f);
  // his full line is part of every Israeli article (Sport5's fixed form), in the body
  const mt = [{ fact_he: `${t.player.he} סיים עם ${b.line_full_he}`, who: [t.player.he, surname(t.player.he)], num: String(t.line.pts) },
    ...b.his_story_he.map((s) => ({ fact_he: s, who: [t.player.he, surname(t.player.he)], num: firstNum(s) }))];
  const ma = g.main_angle;
  const mainIsHim = !ma || ma.type === 'ISRAELI_ANGLE' || ma.player === t.player.name;
  if (!mainIsHim) {
    const star = ma.player ? [...f.players.home, ...f.players.away].find((p) => p.name === ma.player) : null;
    const starHe = star ? names.get(star.name) || star.he || star.name : null;
    const takeover = star && (f.notable || []).find((m) => m.type === 'PERIOD_TAKEOVER' && m.playerId === star.id);
    let s = ma.fact_he;
    if (star && ma.type === 'BIG_SCORING') {
      // "לוקה דונצ'יץ' קלע 53 נקודות, 20 מהן ברבע השלישי, לצד 8 ריבאונדים ו-7 אסיסטים"
      const extras = shortLineHe(star).replace(/^\d+ נקודות(, | ו-)?/, '');
      s = `${starHe} קלע ${star.pts} נקודות${takeover ? `, ${takeover.pts} מהן ${pre('ב', PERIOD_HE(takeover.period, f.clutch.finalPeriod))}` : ''}${star.fg ? ` (${star.fg[0]} מ-${star.fg[1]} מהשדה)` : ''}${extras ? `, לצד ${extras}` : ''}`;
    } else if (takeover) s += `, ${takeover.pts} מהן ${pre('ב', PERIOD_HE(takeover.period, f.clutch.finalPeriod))}`;
    b.game_story_he = s;
    mt.push({ fact_he: s, who: starHe ? [starHe, surname(starHe)] : ma.tokens || [], num: firstNum(s) });
  }
  b.must_tell = mt.filter((x) => x.who.length);
  b.verified = {
    season_high: ms.includes('SEASON_HIGH'),
    career_high: ms.includes('CAREER_HIGH') || ms.includes('TIES_CAREER_HIGH'),
    streak: !!b.team_streak_he || ms.includes('STREAK') || g.verified.streak,
    standings: false,
    playoffs: g.verified.playoffs,
  };
  b.states = g.states;
  // the player piece may also state his team's streak and his own verified streaks
  const extraTokens = [b.team_streak_he ? ordinal(streak.length) : null, ...t.milestones.filter((m) => m.type === 'STREAK').map((m) => String(m.text.match(/\d+/)?.[0] || ''))].filter(Boolean);
  b._check = { ...g._check, streak_tokens: [...(g._check.streak_tokens || []), ...extraTokens] };
  return b;
}

// an Israeli's night, judged from the numbers: a verdict and the reasons (each one a verified fact)
export function performanceVerdict(t, f) {
  const l = t.line;
  const fgPct = l.fg && l.fg[1] ? l.fg[0] / l.fg[1] : null;
  const margin = t.won ? f.result.margin : -f.result.margin;
  const top = t.teamRank?.pts?.place === 1;
  const reasons = [];
  if (top) reasons.push(t.teamRank.pts.shared ? 'חלק את הובלת הקלעים של קבוצתו' : 'הקלע המוביל של קבוצתו');
  if (l.fg && l.fg[1] >= 8) reasons.push(`${l.fg[0]} מ-${l.fg[1]} מהשדה`);
  if (l.plusMinus != null && Math.abs(l.plusMinus) >= 10) reasons.push(`מדד פלוס מינוס ${l.plusMinus > 0 ? `${l.plusMinus}+` : `${-l.plusMinus}-`}`);
  if (l.to >= 5) reasons.push(`${l.to} איבודים`);
  const rout = !t.won && f.result.margin >= 18;
  if (rout && l.min <= 28) reasons.push(`${l.min} דקות בלבד במשחק שהוכרע מוקדם`);
  let verdict = 'solid';
  if ((l.pts >= 20 && (fgPct ?? 0) >= 0.45) || (l.pts >= 15 && l.ast >= 8) || (l.pts >= 15 && l.reb >= 10) || (t.won && (l.plusMinus ?? 0) >= 12)) verdict = 'strong';
  if ((fgPct != null && l.fg[1] >= 10 && fgPct < 0.35) || l.to >= 6 || (l.plusMinus ?? 0) <= -15) verdict = verdict === 'strong' ? 'mixed' : 'poor';
  if (rout && l.min <= 28 && verdict !== 'strong') verdict = 'quiet_in_rout';
  const he = { strong: 'ערב טוב שלו', solid: 'ערב סביר', mixed: 'ערב עם אור וצל', poor: 'ערב חלש שלו', quiet_in_rout: 'ערב שקט במשחק שהוכרע מוקדם' }[verdict];
  return { verdict, verdict_he: he, reasons_he: reasons, team_margin: margin };
}

// the late plays worth telling: ties and go-ahead plays in the last two minutes, the decisive play, and a
// free-throw trip as ONE play. Cuts and padding are left out (they rarely explain the finish).
export function keyPlays(f, fp) {
  const wb = f.clutch.winningBasket;
  const ms = (f.flow.moments || []).filter((m) => m.period === fp && m.secondsLeft <= 120);
  const merged = [];
  for (const m of ms) {
    const prev = merged.at(-1);
    const sameTrip = prev && prev.player === m.player && prev.clock === m.clock && /free-throw/.test(m.shot || '');
    if (sameTrip && /free-throw/.test(prev.shot || '')) { prev.after = m.after; prev.made++; prev.label = classifyPlay(prev.before, prev.after, prev.side); }
    else if (sameTrip) { prev.after = m.after; prev.andOne = true; prev.label = classifyPlay(prev.before, prev.after, prev.side); } // basket + the foul shot
    else merged.push({ ...m, made: 1 });
  }
  return merged.filter((m) => ['tying', 'go-ahead'].includes(m.label) || (wb && m.player === wb.player && m.clock === wb.clock && m.period === wb.period)).slice(-6);
}

// words the headline / sub-headline must contain to carry the main angle (the validator checks them)
function angleTokens(k, names) {
  const sur = (n) => { const he = names.get(n) || n || ''; return he.split(' ').slice(1).join(' ') || he; };
  if (k.context) return k.tokens || [];
  switch (k.type) {
    case 'FIRST_LOSS': case 'FIRST_WIN': case 'FIRST_VENUE_LOSS': return ['ראשון', 'ראשונה'];
    case 'SPECIAL_VENUE': return [k.city_he];
    case 'BLOWOUT': return ['הפרש', 'ניצחון', 'מחץ', 'דרס', 'דרסה', 'ריסק', 'ריסקה'];
    case 'UNBEATEN': return ['בלי הפסד', 'ללא הפסד', 'מושלמת'];
    case 'WINLESS': return ['בלי ניצחון', 'ללא ניצחון'];
    case 'SHORT_ROSTER': return ['שחקנים'];
    case 'COMEBACK': return ['פיגור', 'מהפך', 'קאמבק', 'חזרה', 'חזרו'];
    case 'OVERTIME': case 'FORCED_OT': return ['הארכה', 'הארכות'];
    case 'DOMINANT_QUARTER': return ['רבע'];
    case 'DECISIVE_RUN': case 'MAJOR_RUN': return ['ריצת', 'ריצה'];
    case 'LATE_COLLAPSE': return ['הובילה', 'הובילו', 'יתרון'];
    case 'TRIPLE_DOUBLE': return ['טריפל'];
    case 'GAME_WINNER': case 'BUZZER_BEATER': case 'BIG_SCORING': case 'TOP_PERFORMER': case 'ISRAELI_ANGLE': case 'UNUSUAL_STAT_LINE': case 'EJECTION':
      return k.player ? [sur(k.player)] : [];
    default: return [];
  }
}

const ORD = ['', 'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שביעי', 'שמיני', 'תשיעי', 'עשירי'];
function ordinal(n) {
  return ORD[n] || `${n}`;
}
