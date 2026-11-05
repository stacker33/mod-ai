// One finished game -> facts + color + Israeli player tracks.

import { buildFacts } from './facts.js';
import { gameColor, colorCandidates } from './color.js';
import { buildPlayerFacts } from './player.js';
import { buildContext, standingsFacts, gameContext } from './context.js';
import { rankStory } from './story.js';

// names: Map espnId -> {he, status, approved} from config/names.he.json
// context: what context.fetchContext returned (schedules, head-to-head, game logs); empty = no context facts
export function analyzeGame(summary, { israelis = [], histories = new Map(), schedules = new Map(), names = new Map(), context = {} } = {}) {
  const f = buildFacts(summary, { israelis });
  const missing = [];
  for (const side of ['home', 'away']) {
    for (const p of f.players[side]) {
      const n = names.get(p.id);
      p.he = n?.he || null;
      p.heStatus = n ? (n.approved ? 'approved' : n.status) : 'missing';
      if (!n?.he && p.played) missing.push(p.name);
    }
  }
  f.namesMissing = missing;
  f.color = gameColor(summary, f);
  // GAME FACTS (facts.js, color.js) and CONTEXT FACTS (context.js) stay separate until story selection
  f.contextFacts = [...buildContext(f, context), ...standingsFacts(f, context)];
  // next game, previous meeting, absences: background for the recap (not story angles)
  const enToHe = new Map([...names.values()].filter((n) => n.en && n.he).map((n) => [n.en, n.he]));
  f.gameContext = gameContext(f, context, enToHe);
  f.story = rankStory([...f.candidates, ...colorCandidates(f.color)], f.contextFacts);
  f.candidates = f.story.ranked;
  const teams = [f.teams.home.abbr, f.teams.away.abbr];
  f.tracks = israelis
    .filter((p) => teams.includes(p.team) || f.israelis.some((i) => i.id === p.id))
    .map((p) => buildPlayerFacts({ summary, facts: f, player: p, history: histories.get(p.id) || [], schedule: schedules.get(p.team) || null }));
  // a track is only usable when the player's own play-by-play agrees with his box-score line
  for (const t of f.tracks) t.ok = f.ok && (!t.played || t.pbpOk);
  return f;
}
