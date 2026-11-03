// The "colorful" layer: things that are not about the score — technicals, flagrants, ejections,
// challenges, buzzer baskets at the end of quarters, and ESPN's own highlight-clip titles.
// Play-by-play items are facts; highlight titles are leads (ESPN's wording of a moment).
// Fans, fights off the ball, quotes and injuries usually appear only in news text — those stay
// in `leads` for the editor and are never written as fact without a source.

import { normPlays, periodName } from './facts.js';

const MINOR_TECH = /defensive 3-seconds|delay of game|illegal defense/i;

export function gameColor(summary, f) {
  const names = new Map();
  for (const side of ['home', 'away']) for (const p of f.players[side]) names.set(p.id, p.name);
  const teamOf = new Map();
  for (const side of ['home', 'away']) for (const p of f.players[side]) teamOf.set(p.id, f.teams[side].abbr);
  const plays = normPlays(summary.plays, names, f.teams.home.id);
  const finalPeriod = f.clutch.finalPeriod;
  const isClutch = (p) => p.period >= Math.min(4, finalPeriod) && p.period === finalPeriod && p.cs <= 300;
  const who = (p) => (p.ids[0] ? { player: names.get(p.ids[0]) || null, team: teamOf.get(p.ids[0]) || null } : { player: null, team: null });
  const when = (p) => ({ period: p.period, periodName: periodName(p.period), clock: p.clockText, clutch: isClutch(p), score: { home: p.home, away: p.away } });

  const events = [];
  for (const p of plays) {
    const type = p.type.toLowerCase();
    const text = p.text.toLowerCase();
    if (/technical/.test(type) && !MINOR_TECH.test(p.type)) {
      events.push({ kind: /flop/.test(type) ? 'flopping technical' : /double/.test(type) || /double technical/.test(text) ? 'double technical' : 'technical', ...who(p), ...when(p), text: p.text });
    } else if (/flagrant foul/.test(type)) {
      events.push({ kind: /type 2/.test(type) ? 'flagrant 2' : 'flagrant 1', ...who(p), ...when(p), text: p.text });
    } else if (/ejection|ejected/.test(type) || /ejected/.test(text)) {
      events.push({ kind: 'ejection', ...who(p), ...when(p), text: p.text });
    } else if (/coach's challenge \(/.test(type)) {
      events.push({ kind: /overturned/.test(type) ? 'challenge won' : 'challenge lost', team: (p.text.match(/\[([^\]]+)\]/) || [])[1] || null, player: null, ...when(p), text: p.text });
    } else if (p.scoring && p.period < finalPeriod && p.cs <= 1) {
      events.push({ kind: 'end-of-period buzzer basket', ...who(p), ...when(p), text: p.text });
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
    if (e.kind === 'double technical') c.push({ type: 'SCUFFLE', weight: 45, why: `double technical (${e.player || '?'}), ${e.periodName} ${e.clock} — check for a confrontation`, evidence: 'pbp' });
  }
  const clutchTechs = color.events.filter((e) => e.clutch && /technical/.test(e.kind));
  if (clutchTechs.length >= 2) c.push({ type: 'HEATED_FINISH', weight: 40, why: `${clutchTechs.length} technicals in the last five minutes (${clutchTechs.map((e) => e.player).join(', ')})`, evidence: 'pbp' });
  return c;
}
