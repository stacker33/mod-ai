// AP's recap of a game. ESPN carries it inside the same game summary we already download, usually 8-30
// minutes after the final buzzer. It is BACKGROUND for the writer — what the story was, the context our
// numbers cannot show (a return from injury, a rematch, what was said after the game) — never text to copy,
// and never a source for a player's or a team's numbers (those come from the box score only).

const ENT = { nbsp: ' ', amp: '&', quot: '"', apos: "'", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', mdash: '—', ndash: '–', hellip: '...' };
const strip = (h) => String(h || '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&(#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCharCode(Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m))
  .replace(/\s+/g, ' ')
  .trim();

// AP files a short take right after the game and updates it with quotes and detail; a recap under this
// length is that first take — worth waiting for the full one while there is time
export const RECAP_FULL = 1800;
const MAX_CHARS = 4000; // the first ~600 words carry the story; the rest is "up next" and notes

export function apRecap(summary) {
  const a = summary?.article;
  if (!a || a.type !== 'Recap') return null;
  const text = strip(a.story);
  if (text.length < 300) return null;
  return { source: a.source || 'AP', headline: strip(a.headline), text: text.slice(0, MAX_CHARS), chars: text.length, published: a.published || null };
}

// How long a finished game waits for AP before it is written without it. The morning shift starts at
// 06:00, so a game that ends at night waits until 05:30 Israel time; one that ends later (or in the
// evening) waits at most 30 minutes — AP's recap took 8-29 minutes on the nights measured.
export function recapDeadline(finalSeen) {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(finalSeen)).split(':').map(Number);
  const cap = finalSeen + 30 * 60e3;
  const toNight = (5 * 60 + 30 - (h * 60 + m)) * 60e3;
  return toNight > 0 ? Math.max(cap, finalSeen + toNight) : cap;
}

// AP's wording that verifies a milestone claim the box score cannot (a career best, a streak, a series)
export const AP_GATES = {
  season_high: /season[- ]high|season[- ]best/i,
  career_high: /career[- ]high|career[- ]best/i,
  streak: /straight|streak|consecutive|in a row/i,
  standings: /\b(first|1st|top|last) place|standings|conference lead|play-in/i,
  playoffs: /playoff|postseason|eliminat|series/i,
};

// whose night it was, by AP's headline vs. ours (the morning comparison): the surname of our protagonist
export function sameHero(recap, heroEnglishName) {
  if (!recap?.headline || !heroEnglishName) return null;
  const sur = heroEnglishName.split(' ').filter((w) => !/^(jr|sr|ii|iii|iv)\.?$/i.test(w)).slice(1).join(' ');
  return sur.length >= 3 && recap.headline.toLowerCase().includes(sur.toLowerCase());
}
