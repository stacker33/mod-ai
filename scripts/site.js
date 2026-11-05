// Builds site/index.html: the editor page (open, no password; hidden from search engines).
//   node scripts/site.js
//
// A strip of dates, 3 days back and 3 forward (US dates, as ESPN schedules them). For each date:
//   - "כל התוצאות" on top: every game — final score / playing now / start time in Israel — ready to copy
//   - past nights the system wrote: a summary (games, recaps ready, median minutes from final buzzer to
//     recap, contradictions published, automatic fixes), a board with one card per game, the stand-alone
//     articles and the nightly page; editor notes folded into one line of chips
//   - future dates: the schedule, Israelis' games marked
// Israeli players are highlighted everywhere; full-track players (own article) the most.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { heTeam } from '../src/teams.js';
import { listGames } from '../src/espn.js';
import { nightHe } from '../src/writer/he.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BACK = 3, FORWARD = 3;

const outDir = join(ROOT, 'out');
const readJ = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

// one card per game of the night, from the runner's state, the drafts and the facts
function nightBoard(dir) {
  const state = readJ(join(dir, 'state.json')) || { games: {} };
  const itemsDir = join(dir, 'drafts', 'items');
  const items = existsSync(itemsDir) ? readdirSync(itemsDir).filter((f) => f.endsWith('.json')).flatMap((f) => readJ(join(itemsDir, f)) || []) : [];
  const byGame = new Map();
  for (const it of items) byGame.set(it.gameId, [...(byGame.get(it.gameId) || []), it]);
  const ids = [...new Set([...(state.schedule || []).map((x) => x.id), ...Object.keys(state.games || {}), ...byGame.keys()])];
  const board = ids.map((id) => {
    const f = readJ(join(dir, `${id}.json`));
    const sched = (state.schedule || []).find((x) => x.id === id);
    const g = state.games?.[id];
    const its = byGame.get(id) || [];
    const published = its.filter((x) => !x.noSend);
    let status;
    if (its.length) {
      const held = published.filter((x) => x.held).length;
      status = held && held === published.length ? 'held' : held ? 'partial' : published.some((x) => x.review?.length) ? 'review' : its.some((x) => x.autoFixed?.length) ? 'fixed' : 'ok';
    } else if (g?.status === 'retry' && /quota/.test(g.error || '')) status = 'quota';
    else if (g && ['failed', 'blocked'].includes(g.status)) status = 'manual';
    else if (g?.status === 'retry') status = 'retry';
    else status = sched?.state === 'in' ? 'live' : 'upcoming';
    const t = (side) => heTeam(f?.teams?.[side]?.abbr || sched?.[side]) || f?.teams?.[side]?.heShort || sched?.[side] || '';
    const line = f ? `${t('home')} - ${t('away')} ${f.teams.away.score}:${f.teams.home.score}` : `${t('home')} - ${t('away')}`;
    const block = its.find((x) => x.mode === 'game');
    // speed: final buzzer (ESPN's last play) -> the first time the runner had the recap ready
    const ended = f?.endedAt ? Date.parse(f.endedAt) : null;
    const minutes = ended && g?.doneAt ? Math.round((g.doneAt - ended) / 60e3) : null;
    const firstWritten = Math.min(...its.map((x) => Date.parse(x.writtenAt) || Infinity));
    return {
      id,
      line,
      teams: [t('home'), t('away')],
      angle: block?.angle?.fact_he || its.find((x) => x.angle)?.angle?.fact_he || null,
      status,
      // over 3 hours = written later (backfill / quota wait), not a live time
      minutes: minutes != null && minutes >= 0 && minutes <= 180 ? minutes : null,
      late: minutes != null && minutes > 180,
      rewritten: !!(g?.doneAt && firstWritten - g.doneAt > 30 * 60e3),
      israelis: (f?.israelis || []).filter((i) => i.played).map((i) => i.he || i.name),
      published: published.filter((x) => !x.held && x.draft).length,
      contradictions: published.filter((x) => !x.held && x.check?.blocking > 0).length,
      review: published.flatMap((x) => x.review || []),
      fixes: its.reduce((a, x) => a + (x.autoFixed?.length || 0), 0),
      end: f?.endedAt || sched?.start || '',
    };
  });
  // finished games newest first, then the ones still to come
  board.sort((a, b) => (['live', 'upcoming'].includes(a.status) - ['live', 'upcoming'].includes(b.status)) || String(b.end).localeCompare(String(a.end)));
  const mins = board.map((x) => x.minutes).filter((x) => x != null).sort((a, b) => a - b);
  const summary = {
    games: board.length,
    ready: board.filter((x) => ['ok', 'fixed'].includes(x.status)).length,
    review: board.filter((x) => ['review', 'partial'].includes(x.status)).length,
    held: board.filter((x) => ['held', 'manual'].includes(x.status)).length,
    waiting: board.filter((x) => ['quota', 'retry'].includes(x.status)).length,
    live: board.filter((x) => x.status === 'live').length,
    upcoming: board.filter((x) => x.status === 'upcoming').length,
    avgMinutes: mins.length ? mins[Math.floor((mins.length - 1) / 2)] : null, // median: one late game does not skew it
    publishedContradictions: board.reduce((a, x) => a + x.contradictions, 0),
    autoFixes: board.reduce((a, x) => a + x.fixes, 0),
  };
  return { board, summary };
}

// jump targets for the board. Drafts written before anchors existed get them here: a block by its score
// heading (matched to the game's items), an article by the game id at the end of its file name.
function withAnchors(md, headingToId, fileId = null) {
  return md.split('\n---\n').map((part, i) => {
    if (/^\{#g\d+\}$/m.test(part)) return part;
    const h = part.match(/^\*\*(.+)\*\*$/m);
    const id = (i === 0 && fileId) || (h && headingToId.get(h[1].trim()));
    return id ? `{#g${id}}\n${part.replace(/^\n+/, '')}` : part;
  }).join('\n---\n');
}
function headingsOf(dir) {
  const itemsDir = join(dir, 'drafts', 'items');
  const m = new Map();
  if (!existsSync(itemsDir)) return m;
  for (const f of readdirSync(itemsDir).filter((x) => x.endsWith('.json'))) for (const it of readJ(join(itemsDir, f)) || []) if (it.heading) m.set(it.heading.trim(), it.gameId);
  return m;
}

const ISRAELIS = readJ(join(ROOT, 'config', 'israelis.json'))?.players || [];
const etDate = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t).replaceAll('-', '');
const ilTime = (iso) => new Date(iso).toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });
const DAY_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

// "כל התוצאות": one line per game, Sport5 form (home - away away:home); Israelis by team (box score for past games)
function results(rows, dir) {
  return rows.map((r) => {
    const f = dir ? readJ(join(dir, `${r.id}.json`)) : null;
    const t = (x) => heTeam(x.abbr) || x.name;
    const track = (i) => ISRAELIS.find((p) => p.id === i.id || p.name === i.name)?.track || i.track;
    const played = (f?.israelis || []).filter((i) => i.played).map((i) => ({ name: i.he || i.name, full: track(i) === 'full' }));
    const onTeams = ISRAELIS.filter((p) => [r.home.abbr, r.away.abbr].includes(p.team)).map((p) => ({ name: p.he, full: p.track === 'full' }));
    const israelis = r.state === 'post' && f ? played : onTeams;
    return {
      id: r.id,
      state: r.state,
      line: r.state === 'post' ? `${t(r.home)} - ${t(r.away)} ${r.away.score}:${r.home.score}` : `${t(r.home)} - ${t(r.away)}`,
      time: ilTime(r.start),
      israelis,
    };
  });
}

const today = etDate(new Date());
const dates = [];
for (let k = -BACK; k <= FORWARD; k++) dates.push(etDate(new Date(Date.now() + k * 86400e3)));

const days = [];
for (const d of dates) {
  const dir = join(outDir, d);
  let rows = [];
  try { rows = await listGames(d); } catch {
    // ESPN unreachable: fall back to what the runner saved
    rows = (readJ(join(dir, 'state.json'))?.schedule || []).map((x) => ({ id: x.id, state: x.state, start: x.start, home: { abbr: x.home }, away: { abbr: x.away } }));
  }
  const night = rows[0] ? nightHe(rows[0].start) : '';
  const dt = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T12:00:00-05:00`);
  const day = { date: d, label: `${DAY_HE[dt.getUTCDay()]} ${d.slice(6)}.${d.slice(4, 6)}`, night, today: d === today, future: d > today, results: results(rows, existsSync(dir) ? dir : null) };
  const dd = join(dir, 'drafts');
  if (existsSync(dd)) {
    const pieces = readdirSync(dd).filter((f) => f.endsWith('.md') && f !== 'closing.md').sort((a, b) => (a.startsWith('player') ? -1 : 1) - (b.startsWith('player') ? -1 : 1))
      .map((f) => ({ name: f, md: withAnchors(readFileSync(join(dd, f), 'utf8'), new Map(), f.match(/-(\d+)\.md$/)?.[1]) }));
    const closing = existsSync(join(dd, 'closing.md')) ? withAnchors(readFileSync(join(dd, 'closing.md'), 'utf8'), headingsOf(dir)) : '';
    Object.assign(day, { pieces, closing, ...nightBoard(dir) });
  } else if (existsSync(join(dir, 'state.json'))) Object.assign(day, { pieces: [], closing: '', ...nightBoard(dir) });
  days.push(day);
}
// open on the latest date that has finished games (or today)
const openOn = [...days].reverse().findIndex((x) => !x.future && x.results.some((r) => r.state === 'post'));
const db = { builtAt: new Date().toISOString(), days, open: openOn >= 0 ? days.length - 1 - openOn : days.findIndex((x) => x.today) };

const client = readFileSync(join(ROOT, 'scripts', 'site-client.js'), 'utf8');

const css = `
:root{--bg:#f4f5f7;--card:#fff;--ink:#16181d;--mute:#5d6370;--line:#dde1e7;--brand:#0b2a5b;--accent:#c2185b;--ok:#1b7f3b;--okbg:#e6f4ea;--warn:#8a5a00;--warnbg:#fff4dc;--bad:#b3261e;--badbg:#fde7e7;--live:#0b57d0;--livebg:#e3edfd;--isr:#0038b8;--isrbg:#e8eefc}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#181b21;--ink:#e9ebef;--mute:#9aa1ad;--line:#2a2f38;--brand:#9cc0ff;--accent:#ff6fa5;--ok:#5fd28a;--okbg:#14301f;--warn:#f2c46b;--warnbg:#33290f;--bad:#ff8a80;--badbg:#3a1614;--live:#8ab4f8;--livebg:#132744;--isr:#a9c1ff;--isrbg:#18234a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 system-ui,"Segoe UI",Arial,sans-serif}
header{background:#0b2a5b;color:#fff;padding:8px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;position:sticky;top:0;z-index:5}header b{font-size:18px}
header .logo{width:40px;height:40px;border-radius:50%;display:block}
.lock .biglogo{display:block;width:120px;height:120px;margin:0 auto 12px;border-radius:50%}
main{max-width:860px;margin:0 auto;padding:16px}
.lock{max-width:360px;margin:15vh auto;background:var(--card);border:1px solid var(--line);padding:20px;border-radius:10px}
input,button,select{font:inherit;padding:8px 10px;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:6px}
form button{cursor:pointer;background:#c2185b;color:#fff;border:0}
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:4px 0 6px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.stat b{display:block;font-size:24px;line-height:1.2;color:var(--brand)}.stat span{font-size:13px;color:var(--mute)}
.extra{margin:0 0 12px;color:var(--mute);font-size:14px}
.topline{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;margin:2px 0 10px;font-size:14px;color:var(--mute)}
.topline .night{font-weight:600;color:var(--ink)}.topline .nums b{color:var(--brand)}.topline i{font-style:normal;margin:0 6px;opacity:.5}
.topline .bad{color:var(--bad)}.topline .warn{color:var(--warn)}.topline .livet{color:var(--live);font-weight:600}
.copy.small{float:none;margin-inline-start:auto;border-radius:999px}
.board{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px;margin:0 0 22px}
.card{display:flex;flex-direction:column;gap:3px;text-align:start;cursor:pointer;background:var(--card);border:1px solid var(--line);border-inline-start:4px solid var(--line);border-radius:8px;padding:7px 10px}
.card .row{display:flex;align-items:center;gap:6px}.card .row .score{flex:1}.card .st{font-size:14px}.card .t{font-size:13px;color:var(--mute)}
.card .angle{font-size:12.5px;color:var(--mute);line-height:1.35;overflow:hidden;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}
.card:hover{border-color:var(--brand)}.card.ok{border-inline-start-color:var(--ok)}.card.warn{border-inline-start-color:var(--warn)}.card.bad{border-inline-start-color:var(--bad)}.card.live{border-inline-start-color:var(--live)}
.card .score{font-weight:700;font-size:15px}
.meta{display:flex;flex-wrap:wrap;gap:6px}
.chip{display:inline-block;font-size:12px;padding:2px 8px;border-radius:999px;background:var(--line);color:var(--ink);white-space:nowrap}
.chip.ok{background:var(--okbg);color:var(--ok)}.chip.warn{background:var(--warnbg);color:var(--warn)}.chip.bad{background:var(--badbg);color:var(--bad)}.chip.live{background:var(--livebg);color:var(--live)}.chip.isr{background:var(--isrbg);color:var(--isr)}.chip.mute{color:var(--mute)}
h2.sec{font-size:15px;color:var(--mute);font-weight:600;margin:22px 0 4px;border-bottom:1px solid var(--line);padding-bottom:4px}
.block{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:12px 0;scroll-margin-top:70px;transition:box-shadow .3s}
.block.flash{box-shadow:0 0 0 3px var(--accent)}
.block h3{margin:0 0 6px;font-size:17px;color:var(--brand)}.when{color:var(--mute);font-size:13px}
.copy{float:left;font-size:13px;padding:4px 10px;cursor:pointer;background:var(--accent);color:#fff;border:0}
details.check{margin-top:10px;border-top:1px dashed var(--line);padding-top:8px;font-size:14px;color:var(--mute)}
details.check summary{cursor:pointer;list-style:none;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
details.check summary::-webkit-details-marker{display:none}
details.check .more{font-size:12px;text-decoration:underline;margin-inline-start:auto}
details.check p{margin:4px 0}
nav.dates{position:sticky;top:56px;z-index:4;background:var(--bg);border-bottom:1px solid var(--line);display:flex;gap:6px;overflow-x:auto;padding:8px 16px;justify-content:center}
nav.dates button{flex:0 0 auto;cursor:pointer;border-radius:999px;padding:5px 12px;font-size:14px;line-height:1.3;text-align:center}
nav.dates button small{display:block;font-size:11px;color:var(--mute)}
nav.dates button.on{background:var(--brand);color:#fff;border-color:var(--brand)}nav.dates button.on small{color:#dfe7f7}
nav.dates button.empty{opacity:.55}
.results{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px;margin:4px 0 14px}
.results h2{margin:0 0 6px;font-size:17px;color:var(--brand)}.results .night{color:var(--mute);font-size:13px;font-weight:400;margin-inline-start:6px}
.results ul{list-style:none;margin:0;padding:0}.results li{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:4px 0;border-bottom:1px dashed var(--line)}.results li:last-child{border:0}
.results li .t{color:var(--mute);font-size:13px;min-width:44px}.results li.post .ln{font-weight:600}
.results li.isr{background:var(--isrbg);margin:0 -8px;padding:4px 8px;border-radius:6px}
.isrtag{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:999px;background:var(--isr);color:#fff;white-space:nowrap}
.isrtag.full{background:linear-gradient(90deg,#0038b8,#1d5fe0)}
.card.israeli{border-color:var(--isr);border-width:2px;background:var(--isrbg)}
.block.israeli{border:2px solid var(--isr);background:linear-gradient(180deg,var(--isrbg),var(--card) 90px)}
.block.israeli.full{border-width:3px}
.empty-day{color:var(--mute);text-align:center;padding:30px 0}
@media (max-width:520px){main{padding:10px}.board{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.card{padding:6px 8px;border-inline-start-width:3px}.card .score{font-size:13px;line-height:1.35}.card .st{font-size:12px}.card .angle{font-size:11.5px}.isrtag{font-size:11px;padding:1px 6px}.stat b{font-size:20px}nav.dates{justify-content:flex-start;padding:8px 10px}}
`;

const html = `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Mod-AI · NBA</title>
<link rel="icon" type="image/png" href="favicon.png"><link rel="apple-touch-icon" href="logo.png">
<style>${css}</style></head><body>
<header><img class="logo" src="logo.png" alt=""><b>Mod-AI · NBA</b><span id="meta"></span></header>
<nav id="dates" class="dates"></nav>
<main id="app"></main>
<script>
const DB=${JSON.stringify(db).replace(/</g, '\\u003c')};
${client.replace(/<\/script/gi, '<\\/script')}
</script></body></html>
`;
mkdirSync(join(ROOT, 'site'), { recursive: true });
writeFileSync(join(ROOT, 'site', 'index.html'), html);
writeFileSync(join(ROOT, 'site', '.nojekyll'), '');
for (const f of ['logo.png', 'favicon.png']) copyFileSync(join(ROOT, 'assets', f), join(ROOT, 'site', f));
console.log(`site: ${days.length} dates (${days.filter((x) => x.board).length} with drafts), ${Math.round(html.length / 1024)} KB -> site/index.html`);
