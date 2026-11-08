// STORY SELECTION — a separate stage before any prose. Every candidate angle (game facts from facts.js and
// color.js, verified context facts from context.js) gets a category and a score; the strongest one is the
// main angle the writer must lead with. An ordinary box-score leader (G) ranks below real context.
//
//   A Israeli relevance · B historical milestone · C season / individual milestone · D team significance
//   E game drama · F exceptional circumstances · G ordinary box-score leader

export const CATEGORY = {
  ISRAELI_ANGLE: 'A',
  RETURN_TO_FORMER_TEAM: 'B',
  FORMER_TEAM_MEETING: 'C', PLAYOFF_REMATCH: 'D', STAR_ABSENT: 'F', STAR_HELD: 'C', RECENT_FORM: 'C', LAST_GAME_MOMENT: 'C', ROOKIE_GAME: 'C', DEBUT: 'F', FIRST_VENUE_LOSS: 'D',
  CAREER_HIGH: 'C', TIES_CAREER_HIGH: 'C', SEASON_HIGH: 'C', TIES_SEASON_HIGH: 'C', SCORING_STREAK: 'C',
  TRIPLE_DOUBLE: 'C', UNUSUAL_STAT_LINE: 'C', BIG_SCORING: 'C',
  FIRST_LOSS: 'D', FIRST_WIN: 'D', UNBEATEN: 'D', WINLESS: 'D', WIN_STREAK: 'D', LOSS_STREAK: 'D',
  STREAK_ENDED: 'D', LOSING_STREAK_ENDED: 'D', H2H_STREAK: 'D', LOST_FIRST_PLACE: 'D', TOOK_FIRST_PLACE: 'D', CONFERENCE_LEADER: 'D', STANDINGS: 'D',
  BUZZER_BEATER: 'E', GAME_WINNER: 'E', FORCED_OT: 'E', OVERTIME: 'E', COMEBACK: 'E', LATE_COLLAPSE: 'E',
  CLOSE_FINISH: 'E', DECISIVE_RUN: 'E', DOMINANT_QUARTER: 'E', MAJOR_RUN: 'E', BLOWOUT: 'E',
  SHORT_ROSTER: 'F', EJECTION: 'F', FLAGRANT_2: 'F',
  TOP_PERFORMER: 'G',
  SPECIAL_VENUE: 'F',
};

// the same story told twice: keep the stronger wording, at the higher of the two weights
const SAME_STORY = [
  ['FIRST_LOSS', 'STREAK_ENDED'], // the unbeaten team lost = its winning streak ended
  ['UNBEATEN', 'WIN_STREAK'],
  ['WINLESS', 'LOSS_STREAK'],
  ['FIRST_WIN', 'LOSING_STREAK_ENDED'],
];

// supporting details: true and worth a sentence, never the story of the game on their own
const SUPPORT = new Set(['FORMER_TEAM_MEETING', 'STAR_HELD', 'RECENT_FORM', 'LAST_GAME_MOMENT', 'ROOKIE_GAME', 'DEBUT', 'TOP_PERFORMER', 'STANDINGS', 'MAJOR_RUN', 'CLOSE_FINISH', 'DOMINANT_QUARTER']);
const STREAKS = new Set(['WIN_STREAK', 'LOSS_STREAK', 'H2H_STREAK']);
const DRAMA = new Set(['OVERTIME', 'FORCED_OT', 'GAME_WINNER', 'BUZZER_BEATER']);
const isSupport = (c, game) => SUPPORT.has(c.type)
  || (c.type === 'STAR_ABSENT' && game && c.side !== game.result?.winner) // a missing star on the losing side explains, it is not the story
  || (/SEASON_HIGH/.test(c.type) && (c.value ?? 99) < 35); // a season high of 29 (previous 27) is a detail

export function rankStory(gameCandidates, contextFacts = [], game = null) {
  const ctx = contextFacts.filter((x) => x.verified).map((x) => ({ ...x, why: x.fact_he, evidence: x.source, context: true }));
  let all = [...gameCandidates, ...ctx].map((c) => ({ ...c, category: CATEGORY[c.type] || 'G' }));
  for (const [keep, drop] of SAME_STORY) {
    const k = all.find((c) => c.type === keep);
    const d = all.find((c) => c.type === drop);
    if (k && d) {
      k.weight = Math.max(k.weight, d.weight);
      all = all.filter((c) => c !== d);
    }
  }
  // a dramatic finish or a 40-point night outranks a streak (a streak of 10+ still leads)
  const drama = all.some((c) => DRAMA.has(c.type)) || all.some((c) => c.type === 'BIG_SCORING' && (c.pts ?? c.value ?? 0) >= 40);
  if (drama) for (const c of all) if (STREAKS.has(c.type) && (c.value ?? 0) < 10) c.weight = Math.min(c.weight, 64);
  for (const c of all) c.support = isSupport(c, game);
  all.sort((a, b) => b.weight - a.weight || a.category.localeCompare(b.category));
  // the main angle is a story; with none, the winner's best player (TOP_PERFORMER) carries it
  const main = all.find((c) => !c.support) || all.find((c) => c.type === 'TOP_PERFORMER') || all[0] || null;
  return { main, secondary: all.filter((c) => c !== main && !c.support).slice(0, 2), ranked: [main, ...all.filter((c) => c !== main)].filter(Boolean) };
}
