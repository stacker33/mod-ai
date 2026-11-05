// MORNING COMPARISON with the Sport5 editor's nightly NBA article (the funding metric: how close are we, and
// where exactly is the gap). For each game block in Sport5's article, matched to our game by its final score:
//   names   which players the editor named, and how many of them our recap named
//   numbers which numbers the editor used (stats, scores), how many our recap used, and — of the missed
//           ones — how many were in OUR DATA (a selection gap we can fix) vs not (extra reporting)
//   angle   does our opening name the same player / team the editor's opening names
//   length  characters and paragraphs, ours vs theirs
// Sport5's text is read for the comparison only: it is never published or committed (only numbers and
// names, which are facts, appear in the report).

const UA = 'Mozilla/5.0 (compatible; ModAI/0.2)';
const ARCHIVE = 'https://www.sport5.co.il/Archive/Events/5374?Page=';

async function getText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Sport5 ${r.status}`);
  return r.text();
}
const htmlText = (h) => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h\d|li)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n\s*\n+/g, '\n\n');

// US night 20261104 -> Sport5's morning title "5.11 סגירה NBA"
export function sport5Title(date) {
  const d = new Date(Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T12:00:00Z`) + 86400e3);
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1} סגירה NBA`;
}

// the article's link from the archive list (first two pages)
export async function findArticle(date) {
  const title = sport5Title(date);
  for (const page of [1, 2]) {
    const h = await getText(ARCHIVE + page);
    const re = /href="([^"]*dayevents\.aspx\?FolderID=5374&(?:amp;)?docID=(\d+))"[^>]*>([\s\S]*?)<\/a>/g;
    for (const m of h.matchAll(re)) {
      if (htmlText(m[3]).replace(/\s+/g, ' ').trim().includes(title)) return `https://www.sport5.co.il/dayevents.aspx?FolderID=5374&docID=${m[2]}`;
    }
  }
  return null;
}

// Sport5's article -> one block per game: { heading, scorePair, text }
export function parseSport5(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const head = /^(.+?)\s*\(\d+:\d+\)\s*-\s*(.+?)\s*\(\d+:\d+\)\s*(\d+:\d+)/;
  const blocks = [];
  let cur = null;
  for (const l of lines) {
    const m = l.match(head);
    if (m) { cur = { heading: l, scorePair: m[3], lines: [] }; blocks.push(cur); continue; }
    if (!cur) continue;
    if (/^צפו>>|^\d\d\.\d\d\.\d\d - \d\d:\d\d$/.test(l)) continue;
    if (/^(כדורגל עולמי|ליגת האלופות)$/.test(l)) { cur = null; continue; } // the site footer
    cur.lines.push(l);
  }
  return blocks.map((b) => ({ heading: b.heading, scorePair: b.scorePair, text: b.lines.join('\n') }));
}

const numbersIn = (t) => {
  const out = [];
  for (const m of String(t).matchAll(/\d+:\d+|\d+(?:\.\d+)?/g)) out.push(m[0]);
  return out;
};
const paragraphs = (t) => String(t).split(/\n+/).map((x) => x.trim()).filter((x) => x.length > 20);

// one game: Sport5's block vs our text for the same game (and the facts our system had for it)
export function compareGame(theirs, ours, facts, dict) {
  const heading = theirs.heading;
  // records and the final score are in both headings; they are not editorial choices
  const noise = new Set(numbersIn(heading));
  const tNums = [...new Set(numbersIn(theirs.text).filter((n) => !noise.has(n)))];
  const oNums = new Set(numbersIn(ours));
  const dataNums = new Set(numbersIn(JSON.stringify(facts || {})));
  // the score pairs we had (quarters, halftime, after three, records), in both orders
  if (facts?.teams) {
    const both = (a, b) => { dataNums.add(`${a}:${b}`); dataNums.add(`${b}:${a}`); };
    facts.teams.home.periods.forEach((h, i) => both(h, facts.teams.away.periods[i]));
    for (const k of ['halftime', 'after3', 'q1']) if (facts.result?.[k]) both(facts.result[k].home, facts.result[k].away);
    for (const s of ['home', 'away']) { const m = String(facts.teams[s].record || '').match(/^(\d+)-(\d+)$/); if (m) both(m[1], m[2]); }
  }
  const coveredNums = tNums.filter((n) => oNums.has(n));
  const missed = tNums.filter((n) => !oNums.has(n));
  const missedInData = missed.filter((n) => dataNums.has(n));
  // players named: Hebrew names from our dictionary, only this game's two teams, whole words
  // (a surname may carry a Hebrew prefix letter: "ולברון", "שקרי")
  const teams = facts?.teams ? [facts.teams.home.abbr, facts.teams.away.abbr] : null;
  const people = (dict || []).filter((p) => p.he && p.he.includes(' ') && (!teams || teams.includes(p.team)));
  const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hasWord = (t, w) => w.length >= 3 && new RegExp(`(^|[^א-ת])[ובלמשהכ]{0,2}${esc(w)}(?![א-ת])`).test(t);
  const named = (t) => new Set(people.filter((p) => hasWord(t, p.he) || hasWord(t, p.he.split(' ').slice(1).join(' '))).map((p) => p.he));
  const tNames = [...named(theirs.text)], oNames = named(ours);
  const firstNamed = (t) => {
    const first = paragraphs(t)[0] || '';
    let best = null;
    for (const p of people) {
      for (const w of [p.he, p.he.split(' ').slice(1).join(' ')]) {
        const i = hasWord(first, w) ? first.indexOf(w) : -1;
        if (i >= 0 && (!best || i < best.i)) best = { i, he: p.he };
      }
    }
    return best?.he || null;
  };
  const tLead = firstNamed(theirs.text), oLead = firstNamed(ours);
  return {
    heading,
    names: { theirs: tNames.length, covered: tNames.filter((n) => oNames.has(n)).length, missed: tNames.filter((n) => !oNames.has(n)) },
    numbers: { theirs: tNums.length, covered: coveredNums.length, missedInOurData: missedInData, missedNotInData: missed.filter((n) => !dataNums.has(n)) },
    angle: { theirs: tLead, ours: oLead, same: !!tLead && tLead === oLead },
    length: { theirs: theirs.text.length, ours: String(ours).length, paragraphsTheirs: paragraphs(theirs.text).length, paragraphsOurs: paragraphs(ours).length },
  };
}

// the whole night: Sport5's article + our games (items + facts) -> report
export function compareNight(sport5Text, games, dict) {
  const blocks = parseSport5(sport5Text);
  const rows = [];
  for (const b of blocks) {
    const g = games.find((x) => x.scorePair === b.scorePair);
    if (!g) continue;
    rows.push({ gameId: g.gameId, ...compareGame(b, g.text, g.facts, dict) });
  }
  const sum = (k) => rows.reduce((a, r) => a + k(r), 0);
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : null);
  return {
    games: rows.length,
    sport5Blocks: blocks.length,
    namesCovered: pct(sum((r) => r.names.covered), sum((r) => r.names.theirs)),
    numbersCovered: pct(sum((r) => r.numbers.covered), sum((r) => r.numbers.theirs)),
    // of the numbers the editor used and we did not: how many were in our data (selection) vs not (reporting)
    missedInOurData: sum((r) => r.numbers.missedInOurData.length),
    missedNotInData: sum((r) => r.numbers.missedNotInData.length),
    sameAngle: pct(rows.filter((r) => r.angle.same).length, rows.filter((r) => r.angle.theirs).length),
    lengthRatio: pct(sum((r) => r.length.ours), sum((r) => r.length.theirs)),
    rows,
  };
}

export async function fetchSport5Night(date) {
  const url = await findArticle(date);
  if (!url) return null;
  return { url, text: htmlText(await getText(url)) };
}
