// STORY SELECTION — a separate stage before any prose. Every candidate angle (game facts from facts.js and
// color.js, verified context facts from context.js) gets a category and a score; the strongest one is the
// main angle the writer must lead with. An ordinary box-score leader (G) ranks below real context.
//
//   A Israeli relevance · B historical milestone · C season / individual milestone · D team significance
//   E game drama · F exceptional circumstances · G ordinary box-score leader

export const CATEGORY = {
  ISRAELI_ANGLE: 'A',
  CAREER_HIGH: 'C', TIES_CAREER_HIGH: 'C', SEASON_HIGH: 'C', TIES_SEASON_HIGH: 'C', SCORING_STREAK: 'C',
  TRIPLE_DOUBLE: 'C', UNUSUAL_STAT_LINE: 'C', BIG_SCORING: 'C',
  FIRST_LOSS: 'D', FIRST_WIN: 'D', UNBEATEN: 'D', WINLESS: 'D', WIN_STREAK: 'D', LOSS_STREAK: 'D',
  STREAK_ENDED: 'D', LOSING_STREAK_ENDED: 'D', H2H_STREAK: 'D', LOST_FIRST_PLACE: 'D', TOOK_FIRST_PLACE: 'D', CONFERENCE_LEADER: 'D', STANDINGS: 'D',
  BUZZER_BEATER: 'E', GAME_WINNER: 'E', FORCED_OT: 'E', OVERTIME: 'E', COMEBACK: 'E', LATE_COLLAPSE: 'E',
  CLOSE_FINISH: 'E', DECISIVE_RUN: 'E', DOMINANT_QUARTER: 'E', MAJOR_RUN: 'E', BLOWOUT: 'E',
  SHORT_ROSTER: 'F', EJECTION: 'F', FLAGRANT_2: 'F',
  TOP_PERFORMER: 'G',
};

// the same story told twice: keep the stronger wording, at the higher of the two weights
const SAME_STORY = [
  ['FIRST_LOSS', 'STREAK_ENDED'], // the unbeaten team lost = its winning streak ended
  ['UNBEATEN', 'WIN_STREAK'],
  ['WINLESS', 'LOSS_STREAK'],
  ['FIRST_WIN', 'LOSING_STREAK_ENDED'],
];

export function rankStory(gameCandidates, contextFacts = []) {
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
  all.sort((a, b) => b.weight - a.weight || a.category.localeCompare(b.category));
  return { main: all[0] || null, secondary: all.slice(1, 3), ranked: all };
}
