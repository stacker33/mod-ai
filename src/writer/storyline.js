// STORYLINE: the game as a story, decided in code before any prose — the way a Sport5 editor sees it.
// Not "who scored what" but: what kind of night it was (theme -> the hook), whose game it was and why
// (protagonist), how it turned (turn), who else mattered and in what role (cast: added / stepped up /
// wasn't enough / was held down), and one or two lines of color. Every fact here comes from verified data;
// the writer supplies the voice (the hook, the verbs), never new facts.

// what the hook has to convey, per theme (instructions to the writer, not text to copy)
const HOOK = {
  DRAMA: 'משפט פתיחה קצר שמשדר דרמה של סיום צמוד, ואז מה קרה ברגעים האחרונים',
  HERO: 'משפט פתיחה ששם את הגיבור במרכז — זה היה הערב שלו — ואז מה הוא עשה שהכריע',
  COMEBACK: 'משפט פתיחה על המהפך — מי חזרה ומאיפה — ואז מי הוביל אותו',
  COLLAPSE: 'משפט פתיחה על קבוצה שהייתה בדרך לניצחון ואיבדה אותו, ואז איך זה קרה',
  DOMINANCE: 'משפט פתיחה קצר על ניצחון שלא היה בו ספק, ואז מי בנה אותו ומתי זה נגמר',
  CONTEXT: 'משפט פתיחה על מה שהמשחק הזה אומר (הרצף / החזרה / הטבלה / השיא), ואז איך זה קרה על המגרש',
  DUEL: 'משפט פתיחה על הדו-קרב בין שני הכוכבים, ואז מי ניצח אותו',
};
const DRAMA = new Set(['GAME_WINNER', 'BUZZER_BEATER', 'FORCED_OT', 'OVERTIME', 'CLOSE_FINISH']);
const HERO = new Set(['BIG_SCORING', 'CAREER_HIGH', 'TIES_CAREER_HIGH', 'SEASON_HIGH', 'TIES_SEASON_HIGH', 'TRIPLE_DOUBLE', 'TOP_PERFORMER', 'UNUSUAL_STAT_LINE', 'SCORING_STREAK']);
const FORM = new Set(['RETURN_TO_FORMER_TEAM', 'RECENT_FORM', 'STAR_HELD']);
const CONTEXT = new Set(['STAR_ABSENT', 'FIRST_LOSS', 'FIRST_WIN', 'UNBEATEN', 'WINLESS', 'WIN_STREAK', 'LOSS_STREAK', 'STREAK_ENDED', 'LOSING_STREAK_ENDED', 'H2H_STREAK', 'LOST_FIRST_PLACE', 'TOOK_FIRST_PLACE', 'CONFERENCE_LEADER', 'RETURN_TO_FORMER_TEAM', 'SHORT_ROSTER']);

// "קלע 7 מתוך 8 הנקודות האחרונות של בוסטון": the longest closing stretch of a team's scoring that one
// player owned (70%+), late in a game that was still open
export function closingShare(f, side) {
  const fp = f.clutch.finalPeriod;
  const ms = (f.flow.moments || []).filter((m) => m.side === side && m.points > 0);
  if (!ms.length || ms.at(-1).period !== fp) return null;
  let team = 0, best = null;
  const his = new Map();
  for (let i = ms.length - 1; i >= 0; i--) {
    const m = ms[i];
    if (m.period !== fp || m.secondsLeft > 420) break;
    team += m.points;
    his.set(m.player, (his.get(m.player) || 0) + m.points);
    const margin = Math.abs(m.before.home - m.before.away);
    for (const [player, pts] of his) {
      if (pts >= 7 && pts / team >= 0.7 && margin <= 8 && (!best || team > best.team)) best = { player, pts, team };
    }
  }
  return best;
}

export function storyline(f, b, names, tn, momentOf = () => null) {
  const W = f.result.winner, L = f.result.loser;
  const other = (s) => (s === 'home' ? 'away' : 'home');
  const all = ['home', 'away'].flatMap((s) => f.players[s].filter((p) => p.played).map((p) => ({ ...p, side: s })));
  const heName = (p) => names.get(p.name) || p.he || p.name;
  const byEn = (en) => all.find((p) => p.name === en);
  const byId = (id) => all.find((p) => p.id === id);
  const main = f.story?.main || null;
  const notable = f.notable || [];

  // whose game it was: the main angle's player, else the one with the strongest arc, else the winner's top scorer
  const arcFor = (p) => notable.filter((m) => m.playerId === p.id);
  let hero = main?.player ? byEn(main.player) : null;
  if (!hero) {
    const arc = notable.find((m) => ['PERIOD_TAKEOVER', 'PLAYER_SURGE', 'BIG_HALF'].includes(m.type) && byId(m.playerId)?.side === W);
    hero = arc ? byId(arc.playerId) : [...all.filter((p) => p.side === W)].sort((a, b2) => b2.pts - a.pts)[0];
  }
  const share = closingShare(f, hero?.side || W);
  const shareHe = share && byEn(share.player) ? `${heName(byEn(share.player))} קלע ${share.pts} מתוך ${share.team} הנקודות האחרונות של ${tn(byEn(share.player).side)}` : null;

  // the other side's leading men
  const topOf = (s) => all.filter((p) => p.side === s).sort((a, b2) => b2.pts - a.pts);
  const loserTop = topOf(L)[0];
  const duel = hero && loserTop && hero.side === W && hero.pts >= 30 && loserTop.pts >= 30;

  // theme -> the hook
  const t = main?.type;
  const close = f.result.margin <= 4 || f.clutch.overtimes > 0;
  let theme = 'HERO';
  if (t && DRAMA.has(t) && close) theme = 'DRAMA';
  else if (t === 'COMEBACK') theme = 'COMEBACK';
  else if (t === 'LATE_COLLAPSE' || notable.some((m) => m.type === 'Q4_COLLAPSE')) theme = close || t === 'LATE_COLLAPSE' ? 'COLLAPSE' : 'COMEBACK';
  else if (t && CONTEXT.has(t)) theme = 'CONTEXT';
  else if (duel) theme = 'DUEL';
  else if ((t === 'BLOWOUT' || t === 'DOMINANT_QUARTER' || t === 'MAJOR_RUN') && f.result.margin >= 18) theme = 'DOMINANCE';
  else if (t && HERO.has(t)) theme = 'HERO';
  else if (close) theme = 'DRAMA';
  else if (f.result.margin >= 20) theme = 'DOMINANCE';

  // the protagonist: who, his short line, and what made it his game (arcs, the closing stretch)
  const momentHe = momentOf;
  const protagonist = hero ? {
    name_he: heName(hero),
    team_he: tn(hero.side),
    line_he: lineHe(hero),
    what_made_it_he: [
      // what he came in with / against (a return, his last game, a run of 40s) — verified context
      ...(f.contextFacts || []).filter((c) => c.verified && c.player === hero.name && c.type !== main?.type && FORM.has(c.type)).map((c) => c.fact_he),
      ...arcFor(hero).map((m) => momentHe(m)).filter(Boolean),
      ...(shareHe && share.player === hero.name ? [shareHe] : []),
    ].slice(0, 3),
  } : null;

  // the cast: everyone else who belongs in the story, each with a role the data supports
  const cast = [];
  const used = new Set([hero?.id]);
  const add = (p, role, fact_he) => { if (!p || used.has(p.id)) return; used.add(p.id); cast.push({ name_he: heName(p), team_he: tn(p.side), role, fact_he }); };
  // the winner's second (and third, if he really mattered) man — one number each
  for (const p of topOf(W).filter((x) => x.id !== hero?.id).slice(0, 2)) if (p.pts >= 15) add(p, 'support', `${heName(p)} הוסיף ${p.pts} נקודות${p.starter ? '' : ' מהספסל'}`);
  // a bench player who stepped up
  for (const p of all.filter((x) => !x.starter && x.pts >= 18)) add(p, 'stepped_up', `${heName(p)} התעלה מהספסל עם ${p.pts} נקודות`);
  // the loser's best: a big night that wasn't enough
  if (loserTop && loserTop.id !== hero?.id) add(loserTop, loserTop.pts >= 28 ? 'not_enough' : 'best_of_losers', loserTop.pts >= 28 ? `${loserTop.pts} הנקודות של ${heName(loserTop)} לא הספיקו ל${tn(L).replace(/^ה/, '')}` : `${heName(loserTop)} הוביל את ${tn(L)} עם ${lineHe(loserTop)}`);
  // a starter who was held down (big minutes, poor game) — Sport5's "אכזב", "נעצר על"
  for (const p of all.filter((x) => x.starter && x.min >= 28)) {
    const cold = p.fg && p.fg[1] >= 10 && p.fg[0] / p.fg[1] <= 0.3;
    const missed = p.fg && p.fg[1] >= 8 && p.pts <= 6; // he shot and it did not go in — not a role player's quiet night
    const star = (f.contextFacts || []).find((c) => c.type === 'STAR_HELD' && c.player === p.name);
    if (star) add(p, 'held_down', star.fact_he);
    else if (cold || missed) add(p, 'held_down', `${heName(p)} נעצר על ${p.pts} נקודות${p.fg ? ` (${p.fg[0]} מ-${p.fg[1]} מהשדה)` : ''}`);
  }
  // the other arcs of the night (a fade on the losing side, a takeover by someone else)
  for (const m of notable.filter((x) => x.playerId && byId(x.playerId) && !used.has(x.playerId)).slice(0, 2)) {
    const s = momentHe(m);
    if (s) add(byId(m.playerId), m.type === 'PLAYER_FADE' ? 'faded' : 'arc', s);
  }

  // how it turned: the moment / quarter / stretch that decided it (already selected and verified upstream)
  const turn = [];
  if (shareHe && share.player !== hero?.name) turn.push(shareHe);
  for (const m of notable.filter((x) => ['MISSED_WINNER', 'Q4_COLLAPSE'].includes(x.type))) { const s = momentHe(m); if (s) turn.push(s); }
  const told = notable.some((m) => m.type === 'Q4_COLLAPSE');
  if (b.after_three_clause && !told) turn.push(b.after_three_clause);
  else if (b.halftime_clause) turn.push(b.halftime_clause);

  // color: a former team (even when it is not the first return), the previous meeting, who was out
  const color = [];
  const inStory = new Set([...(protagonist?.what_made_it_he || []), ...cast.map((c) => c.fact_he)]);
  const COLOR = ['STAR_ABSENT', 'RETURN_TO_FORMER_TEAM', 'STAR_HELD', 'RECENT_FORM', 'H2H_STREAK', 'WIN_STREAK', 'LOSS_STREAK', 'STREAK_ENDED'];
  for (const x of (f.contextFacts || []).filter((c) => c.verified && c.type !== main?.type && COLOR.includes(c.type) && !inStory.has(c.fact_he)).sort((a, b) => COLOR.indexOf(a.type) - COLOR.indexOf(b.type))) color.push(x.fact_he);
  return {
    theme,
    hook: HOOK[theme],
    angle_he: b.main_angle?.fact_he || null,
    protagonist,
    turn_he: [...new Set(turn)].slice(0, 3),
    cast: cast.slice(0, 5),
    color_he: color.slice(0, 3),
    duel: duel ? { a: heName(hero), a_pts: hero.pts, b: heName(loserTop), b_pts: loserTop.pts } : null,
  };
}

// the short line Sport5 gives a protagonist: points, then what else stands out
function lineHe(p) {
  const bits = [`${p.pts} נקודות`];
  if (p.reb >= 8) bits.push(`${p.reb} ריבאונדים`);
  if (p.ast >= 6) bits.push(`${p.ast} אסיסטים`);
  if (p.stl >= 4) bits.push(`${p.stl} חטיפות`);
  if (p.blk >= 4) bits.push(`${p.blk} חסימות`);
  const last = bits.pop();
  return bits.length ? `${bits.join(', ')} ו-${last}` : last;
}

