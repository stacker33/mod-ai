// Builds site/index.html: the drafts of the last nights, ENCRYPTED with PAGE_PASSWORD (AES-256-GCM,
// key from PBKDF2). The repo and the page are public; only someone with the password can read the drafts.
//   PAGE_PASSWORD=… node scripts/site.js
//
// Per night: a summary (games, recaps ready, median minutes from final buzzer to recap, contradictions
// published, automatic fixes), a board with one card per game (score, story angle, status, speed), then
// the stand-alone articles and the nightly page. Editor notes are folded into one line of chips.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pbkdf2Sync, randomBytes, createCipheriv } from 'node:crypto';
import { heTeam } from '../src/teams.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NIGHTS = 7;
const ITER = 200000;
const password = process.env.PAGE_PASSWORD;
if (!password) { console.log('site: no PAGE_PASSWORD, skipped'); process.exit(0); }

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
      status = held && held === published.length ? 'held' : held ? 'partial' : its.some((x) => x.autoFixed?.length) ? 'fixed' : 'ok';
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
      fixes: its.reduce((a, x) => a + (x.autoFixed?.length || 0), 0),
      end: f?.endedAt || sched?.start || '',
    };
  });
  // finished games newest first, then the ones still to come
  board.sort((a, b) => (['live', 'upcoming'].includes(a.status) - ['live', 'upcoming'].includes(b.status)) || String(b.end).localeCompare(String(a.end)));
  const mins = board.map((x) => x.minutes).filter((x) => x != null).sort((a, b) => a - b);
  const summary = {
    games: board.length,
    ready: board.filter((x) => ['ok', 'fixed', 'partial'].includes(x.status)).length,
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

const nights = readdirSync(outDir).filter((d) => /^\d{8}$/.test(d) && existsSync(join(outDir, d, 'drafts', 'closing.md'))).sort().reverse().slice(0, NIGHTS)
  .map((d) => {
    const dd = join(outDir, d, 'drafts');
    const pieces = readdirSync(dd).filter((f) => f.endsWith('.md') && f !== 'closing.md').sort((a, b) => (a.startsWith('player') ? -1 : 1) - (b.startsWith('player') ? -1 : 1))
      .map((f) => ({ name: f, md: withAnchors(readFileSync(join(dd, f), 'utf8'), new Map(), f.match(/-(\d+)\.md$/)?.[1]) }));
    const heads = headingsOf(join(outDir, d));
    return { date: d, closing: withAnchors(readFileSync(join(dd, 'closing.md'), 'utf8'), heads), pieces, ...nightBoard(join(outDir, d)) };
  });

const payload = Buffer.from(JSON.stringify({ builtAt: new Date().toISOString(), nights }), 'utf8');
const salt = randomBytes(16), iv = randomBytes(12);
const key = pbkdf2Sync(password, salt, ITER, 32, 'sha256');
const c = createCipheriv('aes-256-gcm', key, iv);
const enc = Buffer.concat([c.update(payload), c.final(), c.getAuthTag()]); // WebCrypto expects the tag appended
const blob = { salt: salt.toString('base64'), iv: iv.toString('base64'), iter: ITER, data: enc.toString('base64') };
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
.board{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px;margin:8px 0 22px}
.card{display:flex;flex-direction:column;gap:6px;text-align:start;cursor:pointer;background:var(--card);border:1px solid var(--line);border-inline-start:4px solid var(--line);border-radius:10px;padding:10px 12px}
.card:hover{border-color:var(--brand)}.card.ok{border-inline-start-color:var(--ok)}.card.warn{border-inline-start-color:var(--warn)}.card.bad{border-inline-start-color:var(--bad)}.card.live{border-inline-start-color:var(--live)}
.card .score{font-weight:700}.card .angle{font-size:14px;color:var(--mute);line-height:1.45}
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
@media (max-width:520px){main{padding:10px}.board{grid-template-columns:1fr}.stat b{font-size:20px}}
`;

const html = `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Mod-AI · NBA</title>
<link rel="icon" type="image/png" href="favicon.png"><link rel="apple-touch-icon" href="logo.png">
<style>${css}</style></head><body>
<header><img class="logo" src="logo.png" alt=""><b>Mod-AI · NBA</b><span id="meta"></span><select id="night" hidden></select></header>
<main id="app"><div class="lock"><img class="biglogo" src="logo.png" alt="Mod-AI"><p>טיוטות פנימיות. הכנס סיסמה:</p><form id="f"><input id="pw" type="password" autocomplete="current-password" style="width:100%"><p><button>פתח</button> <span id="err"></span></p></form></div></main>
<script>
const BLOB=${JSON.stringify(blob)};
${client.replace(/<\/script/gi, '<\\/script')}
</script></body></html>
`;
mkdirSync(join(ROOT, 'site'), { recursive: true });
writeFileSync(join(ROOT, 'site', 'index.html'), html);
writeFileSync(join(ROOT, 'site', '.nojekyll'), '');
for (const f of ['logo.png', 'favicon.png']) copyFileSync(join(ROOT, 'assets', f), join(ROOT, 'site', f));
console.log(`site: ${nights.length} nights, ${Math.round(html.length / 1024)} KB -> site/index.html`);
