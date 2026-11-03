// The "colorful" layer: things that are not about the score — technicals, flagrants, ejections,
// challenges, buzzer baskets at the end of quarters, and ESPN's own highlight-clip titles.
// Play-by-play items are facts; highlight titles are leads (ESPN's wording of a moment).
// Fans, fights off the ball, quotes and injuries usually appear only in news text — those stay
// in `leads` for the editor and are never written as fact without a source.

import { normPlays, periodName } from './facts.js';
import { foulRole } from './pbp.js';

const KIND = {
  technical: 'technical', 'flopping-technical': 'flopping technical', 'double-technical': 'double technical',
  'flagrant-1': 'flagrant 1', 'flagrant-2': 'flagrant 2', ejection: 'ejection',
};

export function gameColor(summary, f) {
  const names = new Map();
  for (const side of ['home', 'away']) for (const p of f.players[side]) names.set(p.id, p.name);
  const teamOf = new Map();
  for (const side of ['home', 'away']) for (const p of f.players[side]) teamOf.set(p.id, f.teams[side].abbr);
  const line = new Map();
  for (const side of ['home', 'away']) for (const p of f.players[side]) line.set(p.id, p);
  const plays = normPlays(summary.plays, names, f.teams.home.id);
  const finalPeriod = f.clutch.finalPeriod;
  const isClutch = (p) => p.period >= Math.min(4, finalPeriod) && p.period === finalPeriod && p.cs <= 300;
  const when = (p) => ({ period: p.period, periodName: periodName(p.period), clock: p.clockText, clutch: isClutch(p), score: { home: p.home, away: p.away } });

  const events = [];
  for (const p of plays) {
    const role = foulRole(p.type, p.text);
    if (role && KIND[role.kind]) {
      // only the players the play CHARGES — never the free-throw shooter or the fouled player
      const charged = role.charged.map((i) => p.ids[i]).filter(Boolean);
      const players = charged.map((id) => names.get(id)).filter(Boolean);
      const margin = Math.abs(p.home - p.away);
      const big = charged.some((id) => (line.get(id)?.starter || (line.get(id)?.min || 0) >= 12));
      // relevance: does this change how the game is told? ordinary technicals and flagrants do not
      const relevant = role.kind === 'ejection' ? big
        : role.kind === 'flagrant-2' ? true
        : isClutch(p) && margin <= 8;
      events.push({ kind: KIND[role.kind], player: players[0] || null, players, team: charged[0] ? teamOf.get(charged[0]) || null : null, ...when(p), text: p.text, relevant });
    } else if (/coach's challenge \(/i.test(p.type)) {
      events.push({ kind: /overturned/i.test(p.type) ? 'challenge won' : 'challenge lost', team: (p.text.match(/\[([^\]]+)\]/) || [])[1] || null, player: null, players: [], ...when(p), text: p.text, relevant: false });
    } else if (p.scoring && p.period < finalPeriod && p.cs <= 1) {
      events.push({ kind: 'end-of-period buzzer basket', player: names.get(p.ids[0]) || null, players: [names.get(p.ids[0])].filter(Boolean), team: teamOf.get(p.ids[0]) || null, ...when(p), text: p.text, relevant: false });
    }
  }
  // a late scoring play at the final horn that did not decide the game is still color
  const dunks = plays.filter((p) => p.scoring && /dunk/i.test(p.type)).length;

  const highlights = (summary.videos || [])
    .map((v) => v.headline)
    .filter((h) => h && !/game highlights/i.test(h));

  const article = summary.article?.headline ? { headline: summary.article.headline, source: 'ESPN recap (not used as fact)' } : null;

  return { events, dunks, highlights, highlightsSource: 'ESPN video titles (leads, not verified facts)', article };
}

// story weight for color events (merged into the game's candidates by the caller)
export function colorCandidates(color) {
  const c = [];
  for (const e of color.events) {
    if (e.kind === 'ejection') c.push({ type: 'EJECTION', weight: 55, why: `${e.player || '?'} (${e.team || '?'}) ejected, ${e.periodName} ${e.clock}`, evidence: 'pbp' });
    if (e.kind === 'flagrant 2') c.push({ type: 'FLAGRANT', weight: 45, why: `flagrant 2 on ${e.player || '?'}, ${e.periodName} ${e.clock}`, evidence: 'pbp' });
    if (e.kind === 'double technical' && e.relevant) c.push({ type: 'SCUFFLE', weight: 45, why: `double technical (${e.players.join(' and ')}), ${e.periodName} ${e.clock}`, evidence: 'pbp' });
  }
  const clutchTechs = color.events.filter((e) => e.relevant && /technical/.test(e.kind));
  if (clutchTechs.length >= 2) c.push({ type: 'HEATED_FINISH', weight: 40, why: `${clutchTechs.length} technicals in the last five minutes (${clutchTechs.flatMap((e) => e.players).join(', ')})`, evidence: 'pbp' });
  return c;
}
