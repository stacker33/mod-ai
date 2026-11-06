// FOLLOW-UPS per game for the editor: ESPN's own links about the game and what came after it — the recap,
// highlight clips, injury / roster news, quotes, the next game's preview. Headlines stay in English (they are
// links, not our text). All from data ESPN already serves for free: the game summary (recap + clips) and each
// team's news feed (2 calls per game). No AI. Shown on the editor page only, never sent to Telegram.

import { getSummary, getTeamNews } from './espn.js';

const INJURY = /injur|out for|surgery|mri|sprain|strain|fracture|return|status|questionable|ruled out|day-to-day/i;
const FANTASY = /fantasy/i;

// one link in one shape: { kind, title, url, published }
function entry(kind, a) {
  const url = a.links?.web?.href || a.links?.source?.href || null;
  return url && a.headline ? { kind, title: a.headline, url: url.replace(/^http:/, 'https:'), published: a.published || a.lastModified || null } : null;
}

// is an ESPN news item about THIS game / these teams, from the game on? (league-wide lists are not)
export function relevantNews(a, f, sinceIso) {
  if (!a?.headline || FANTASY.test(a.headline) || (a.categories || []).some((c) => /fantasy/i.test(c.description || ''))) return false;
  const teams = (a.categories || []).filter((c) => c.type === 'team');
  if (teams.length > 3) return false; // power rankings, league-wide lists
  const ours = new Set([f.teams.home.id, f.teams.away.id].map(String));
  const names = [f.teams.home.name, f.teams.away.name];
  const mine = teams.some((c) => ours.has(String(c.teamId ?? c.team?.id ?? '')) || names.includes(c.description));
  if (!mine) return false;
  return !sinceIso || !a.published || Date.parse(a.published) >= Date.parse(sinceIso);
}

export function kindOf(a, f) {
  if (a.type === 'Recap') return 'recap';
  if (a.type === 'Media') return 'video';
  if (a.type === 'Preview') return 'next';
  if (INJURY.test(a.headline)) return 'injury';
  return a.type === 'HeadlineNews' ? 'news' : 'story';
}

// everything for one game, newest first, de-duplicated by link
export async function collectFollowups(f) {
  const since = new Date(Date.parse(f.date) - 2 * 3600e3).toISOString(); // from just before tip-off
  const out = [];
  try {
    const s = await getSummary(f.gameId);
    if (s.article) out.push(entry('recap', { ...s.article, links: s.article.links || { web: { href: `https://www.espn.com/nba/recap?gameId=${f.gameId}` } } }));
    for (const v of (s.videos || []).slice(0, 6)) out.push(entry('video', v));
  } catch { /* team news below still works */ }
  for (const id of [f.teams.home.id, f.teams.away.id]) {
    try {
      for (const a of await getTeamNews(id)) {
        if (!relevantNews(a, f, since)) continue;
        // a preview is a follow-up only when it is about the NEXT game (not this one)
        if (a.type === 'Preview' && (a.categories || []).some((c) => c.type === 'event' && String(c.eventId ?? '') === String(f.gameId))) continue;
        out.push(entry(kindOf(a, f), a));
      }
    } catch { /* one team's feed missing is fine */ }
  }
  // the useful ones first: the recap, then news / injuries / stories, the next game, a few clips
  const ORDER = { recap: 0, injury: 1, news: 2, story: 3, next: 4, video: 5 };
  const seen = new Set();
  const list = out.filter(Boolean).filter((x) => (seen.has(x.url) ? false : seen.add(x.url)))
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || String(b.published).localeCompare(String(a.published)));
  const clips = list.filter((x) => x.kind === 'video').slice(0, 4);
  return [...list.filter((x) => x.kind !== 'video').slice(0, 8), ...clips];
}
