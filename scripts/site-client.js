// Browser side of the editor page (inlined by scripts/site.js). Plain JS, no libraries.
/* global DB */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/_(.+?)_/g, '<i>$1</i>');

// the editor box ("> " lines) -> one summary line of chips, details on click
function checkSummary(lines) {
  const chips = [];
  const has = (re) => lines.find((l) => re.test(l));
  if (has(/⛔/)) chips.push(['bad', '⛔ לא פורסם']);
  else if (has(/נבדקו מול ESPN|✅/)) chips.push(['ok', '✅ נבדק מול הנתונים']);
  const fixed = has(/🔧/);
  if (fixed) chips.push(['warn', `🔧 תוקן אוטומטית (${fixed.split(/;\s/).length})`]);
  const names = has(/✏️/);
  if (names) chips.push(['warn', `✏️ ${names.split(':').slice(1).join(':').split(',').length} שמות לאישור`]);
  if (has(/❓/)) chips.push(['warn', '❓ שמות חסרים']);
  if (has(/✍️/)) chips.push(['mute', '✍️ הערות ניסוח']);
  if (has(/🔤 הגהה: הוגה/)) chips.push(['mute', '🔤 הוגה']);
  return chips.map(([c, t]) => `<span class="chip ${c}">${esc(t)}</span>`).join('');
}

// one markdown file -> blocks split on ---; "> " lines are the editor box (never copied)
function render(md) {
  return md.split(/\n---\n/).map((part) => {
    const lines = part.trim().split('\n');
    const text = [], check = [];
    let h = '', when = '', id = '';
    for (const l of lines) {
      const a = l.match(/^\{#(g\d+)\}$/);
      if (a) id = a[1];
      else if (l.startsWith('> ')) check.push(l.slice(2));
      else if (/^#{1,3} /.test(l)) h = l.replace(/^#+ /, '');
      else if (/^_.*_$/.test(l) && !text.length && !h) when = l.slice(1, -1);
      else if (/^\*\*.*\*\*$/.test(l) && !h) h = l.slice(2, -2);
      else text.push(l);
    }
    const body = text.join('\n').trim().split(/\n\s*\n/).filter(Boolean);
    const copy = [h, ...body].filter(Boolean).join('\n\n').replace(/\*\*/g, '').replace(/^_\(.*\)_$/gm, '').trim();
    const notes = check.filter((c) => !/^\*\*לעורך/.test(c));
    return `<section class="block"${id ? ` data-g="${id}"` : ''}>` +
      (body.length ? `<button class="copy" data-t="${encodeURIComponent(copy)}">העתק</button>` : '') +
      (when ? `<div class="when">${esc(when)}</div>` : '') + (h ? `<h3>${inline(h)}</h3>` : '') +
      body.map((p) => `<p>${inline(p).replace(/\n/g, '<br>')}</p>`).join('') +
      (notes.length ? `<details class="check"><summary>${checkSummary(notes)}<span class="more">פרטים</span></summary>${notes.map((c) => `<p>${inline(c)}</p>`).join('')}</details>` : '') +
      '</section>';
  }).join('');
}

// status: [class, icon, words] — the icon is on the card, the words in its tooltip
const STATUS = {
  ok: ['ok', '✅', 'מוכן לאישור'], fixed: ['ok', '🔧', 'מוכן לאישור (תוקן אוטומטית)'], review: ['warn', '⚠️', 'לבדיקה'], held: ['bad', '⛔', 'לא פורסם — לכתוב ידנית'], partial: ['warn', '⚠️', 'חלק מהפריטים לא פורסמו'],
  quota: ['warn', '⏳', 'ממתין למכסת כתיבה'], retry: ['warn', '🔁', 'ניסיון חוזר'], manual: ['bad', '⛔', 'נכשל — לכתוב ידנית'],
  live: ['live', '🏀', 'משוחק עכשיו'], upcoming: ['mute', '', 'טרם התחיל'], final: ['mute', '', 'הסתיים'],
};

const isrTags = (list) => (list || []).map((i) => `<span class="isrtag${i.full ? ' full' : ''}">${i.full ? '★ ' : ''}${esc(i.name)}</span>`).join(' ');

// one line above the scoreboard: the night's numbers + copy of "כל התוצאות" in Sport5's form
function topLine(d) {
  const finals = d.results.filter((r) => r.state === 'post');
  const copy = ['כל התוצאות:', ...finals.map((r) => r.line)].join('\n');
  const s = d.summary;
  const bits = [`<b>${d.results.length}</b> משחקים`];
  if (s) {
    bits.push(`<b>${s.ready}</b> מוכנים לאישור`);
    if (s.review) bits.push(`<span class="warn">${s.review} לבדיקה</span>`);
    if (s.avgMinutes != null) bits.push(`⚡ <b>${s.avgMinutes}</b> ד׳ מהבאזר לסיכום (חציון)`);
    bits.push(`<b>${s.publishedContradictions}</b> סתירות שפורסמו`);
    if (s.autoFixes) bits.push(`<b>${s.autoFixes}</b> תיקונים אוטומטיים`);
    if (s.held) bits.push(`<span class="bad">${s.held} לא פורסמו</span>`);
    if (s.waiting) bits.push(`<span class="warn">${s.waiting} ממתינים</span>`);
  }
  const live = d.results.filter((r) => r.state === 'in').length;
  if (live) bits.push(`<span class="livet">${live} משוחקים עכשיו</span>`);
  const c = d.compare;
  const cmp = c ? `<div class="topline cmp"><a href="${esc(c.url)}" target="_blank" rel="noopener">השוואה לכתבת ערוץ הספורט</a><span class="nums"><b>${c.namesCovered ?? '—'}%</b> מהשחקנים שהעורך הזכיר<i>·</i><b>${c.numbersCovered ?? '—'}%</b> מהמספרים<i>·</i><b>${c.sameAngle ?? '—'}%</b> אותו שחקן בפתיחה<i>·</i>אורך <b>${c.lengthRatio ?? '—'}%</b>${c.missedInOurData ? `<i>·</i><span class="warn">${c.missedInOurData} נתונים שהיו אצלנו ולא נכתבו</span>` : ''}</span></div>` : '';
  return `${cmp}<div class="topline"><span class="night">${esc(d.night)}</span><span class="nums">${bits.join('<i>·</i>')}</span>${finals.length ? `<button class="copy small" data-t="${encodeURIComponent(copy)}">העתק תוצאות</button>` : ''}</div>`;
}

// the scoreboard: one compact card per game (result / live / start time), status icon, angle, Israelis
function scoreboard(d) {
  const byId = new Map((d.board || []).map((g) => [g.id, g]));
  return `<div class="board">${d.results.map((r) => {
    const g = byId.get(r.id);
    const st = g ? g.status : r.state === 'in' ? 'live' : r.state === 'pre' ? 'upcoming' : 'final';
    const [cls, icon, words] = STATUS[st] || ['mute', '', st];
    const when = r.state === 'pre' ? `<span class="t">${esc(r.time)}</span>` : '';
    const cr = (d.compare?.rows || []).find((x) => x.gameId === r.id);
    const tip = [words, ...(g?.review || []), cr ? `מול ערוץ הספורט: ${cr.names[0]}/${cr.names[1]} שחקנים, ${cr.numbers[0]}/${cr.numbers[1]} מספרים${cr.missedNames.length ? ` (חסרים: ${cr.missedNames.join(', ')})` : ''}${cr.sameAngle ? ', אותה פתיחה' : ''}` : '', g?.minutes != null ? `${g.minutes} דקות מהבאזר לסיכום` : '', g?.late ? 'נכתב מאוחר' : g?.rewritten ? 'נכתב מחדש' : ''].filter(Boolean).join(' · ');
    return `<button class="card ${cls}${r.israelis.length ? ' israeli' : ''}" data-go="g${r.id}" data-teams="${esc((g?.teams || []).join('|'))}" title="${esc(tip)}">
      <span class="row">${when}<span class="score">${esc(r.line)}</span><span class="st">${icon}</span></span>
      ${g?.angle ? `<span class="angle">${esc(g.angle)}</span>` : ''}
      ${r.israelis.length || g?.minutes != null ? `<span class="meta">${isrTags(r.israelis)}${g?.minutes != null ? `<span class="chip mute">⚡ ${g.minutes} ד׳</span>` : ''}</span>` : ''}
    </button>`;
  }).join('')}</div>`;
}

// follow-ups: per game, ESPN's links (headlines stay in English — they are links, not our text)
const FU_KIND = { recap: ['ok', 'סיכום ESPN'], injury: ['bad', 'פציעה'], news: ['live', 'חדשות'], story: ['mute', 'כתבה'], next: ['warn', 'המשחק הבא'], video: ['mute', 'וידאו'] };
function followupsView(d) {
  const ilTime = (iso) => (iso ? new Date(iso).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
  const games = d.results.filter((r) => d.followups?.games?.[r.id]?.length);
  if (!games.length) return '<p class="empty-day">אין עדיין קישורי מעקב לתאריך הזה.</p>';
  return `<p class="extra">קישורים של ESPN לכל משחק — הסיכום, קטעי וידאו, וחדשות שהגיעו אחריו (פציעות, ציטוטים, המשחק הבא). מתעדכן בבוקר ובצהריים.</p>` + games.map((r) => `<div class="fu-game${r.israelis.length ? ' israeli' : ''}"><h3>${esc(r.line)} ${isrTags(r.israelis)}</h3><ul>${d.followups.games[r.id].map((x) => {
    const [cls, label] = FU_KIND[x.kind] || ['mute', x.kind];
    return `<li><span class="chip ${cls}">${label}</span><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a><span class="tm" dir="ltr">${esc(ilTime(x.published))}</span></li>`;
  }).join('')}</ul></div>`).join('');
}
// Israeli tracker: one card per player (season, last 5 team games, minutes, next game, milestones)
const awayHe = (opp) => `ב${opp.replace(/^ה/, '')}`; // "בלייקרס" / "באטלנטה"
const vsHe = (home, opp) => (home ? `נגד ${opp}` : awayHe(opp));
function trackerView() {
  const T = DB.tracker;
  if (!T?.players?.length) return '<p class="empty-day">אין עדיין נתוני מעקב לישראלים.</p>';
  const dm = (iso) => new Date(iso).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric' });
  const fmtP = (x) => (x == null ? '—' : `${x}%`);
  const order = [...T.players].sort((a, b) => (a.track === 'full' ? 0 : 1) - (b.track === 'full' ? 0 : 1));
  const cards = order.map((p) => {
    if (p.error) return `<div class="trk-card"><h3>${esc(p.he)}<small>${esc(p.team_he)}</small></h3><p class="trk-sub">הנתונים לא נטענו (${esc(p.error)})</p></div>`;
    const a = p.avg;
    const line = a.gp ? `${p.he} העונה: ${a.pts} נקודות, ${a.reb} ריבאונדים ו-${a.ast} אסיסטים ב-${a.min} דקות למשחק (${a.gp} משחקים).` : '';
    const nums = a.gp ? `<div class="trk-nums">${[['נק׳', a.pts], ['ריב׳', a.reb], ['אס׳', a.ast], ['דק׳', a.min]].map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('')}</div>
      <div class="trk-sub">שדה ${fmtP(a.fg)} · שלוש ${fmtP(a.tp)} · עונשין ${fmtP(a.ft)} · שיחק ${a.gp} מתוך ${a.teamGp} משחקי הקבוצה${p.seasonHigh && a.gp >= 3 ? ` · שיא העונה: ${p.seasonHigh.pts} נק׳ נגד ${esc(p.seasonHigh.opp_he)}` : ''}</div>`
      : `<div class="trk-sub">עוד לא שיחק העונה (${a.teamGp} משחקי קבוצה).</div>`;
    const maxM = Math.max(40, ...p.minutes);
    const tr = p.trend ? { up: '↗ עולות', down: '↘ יורדות', flat: '→ יציבות' }[p.trend.dir] : '';
    const mins = p.minutes.length ? `<div><div class="trk-sub">דקות לפי משחק${tr ? ` — ${tr} (${p.trend.last5} ב-5 האחרונים, ${p.trend.season} בעונה, כולל משחקים שלא שיחק)` : ''}</div>
      <div class="trk-min" title="${esc(p.minutes.join(', '))}">${p.minutes.map((m) => `<i class="${m ? '' : 'dnp'}" style="height:${m ? Math.max(6, Math.round((m / maxM) * 100)) : 6}%"></i>`).join('')}</div></div>` : '';
    const rows = p.last5.map((g) => `<tr><td>${dm(g.date)}</td><td>${esc(vsHe(g.home, g.opp_he))}</td><td class="${g.won ? 'w' : 'l'}">${g.won ? 'נ' : 'ה'} ${esc(g.score_he || '')}</td><td class="ln">${g.played ? `${g.pts} נק׳, ${g.reb} ריב׳, ${g.ast} אס׳ · ${g.min} ד׳${g.fg ? ` · ${g.fg[0]}/${g.fg[1]} שדה` : ''}` : '<span class="chip mute">לא שיחק</span>'}</td></tr>`).join('');
    const next = p.next ? `<span class="chip live">${p.next.live ? 'משחק עכשיו' : 'הבא'}: ${esc(vsHe(p.next.home, p.next.opp_he))} · ${esc(p.next.when_he)}</span>` : '';
    const ms = (p.milestones || []).map((m) => `<span class="chip isr">🎯 ${esc(m.text_he)}</span>`).join(' ');
    return `<div class="trk-card"><h3>${p.track === 'full' ? '★ ' : ''}${esc(p.he)}<small>${esc(p.team_he)} · ${esc(p.season || '')}</small></h3>${nums}${mins}
      <table><tbody>${rows}</tbody></table>
      <div class="trk-foot">${next}${ms}${line ? `<button class="copy" data-t="${encodeURIComponent(line)}">העתק שורת עונה</button>` : ''}</div></div>`;
  }).join('');
  const at = new Date(T.at).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `<p class="extra">הישראלים ב-NBA — ממוצעי העונה, 5 משחקי הקבוצה האחרונים, דקות, המשחק הבא ואבן דרך קרובה. נתוני ESPN, עודכן ${esc(at)}.</p><div class="trk">${cards}</div>`;
}
let TAB = 'recaps';
try { TAB = sessionStorage.getItem('mtab') || 'recaps'; } catch { /* default */ }

function show(i) {
  const d = DB.days[i];
  CUR = i;
  document.querySelectorAll('nav.dates button').forEach((b, k) => b.classList.toggle('on', k === i));
  const nFu = Object.values(d.followups?.games || {}).reduce((a, x) => a + x.length, 0);
  const tabs = `<div class="tabs"><button data-tab="recaps" class="${TAB === 'recaps' ? 'on' : ''}">סגירת הלילה וכתבות</button><button data-tab="followups" class="${TAB === 'followups' ? 'on' : ''}">מעקב${nFu ? ` (${nFu})` : ''}</button>${DB.tracker ? `<button data-tab="israelis" class="${TAB === 'israelis' ? 'on' : ''}">הישראלים</button>` : ''}</div>`;
  if (!d.results.length) { document.getElementById('app').innerHTML = (TAB === 'israelis' && DB.tracker) ? tabs + trackerView() : `${DB.tracker ? tabs : ''}<p class="empty-day">אין משחקי NBA ב${esc(d.label)}.</p>`; return; }
  let h = topLine(d) + scoreboard(d);
  if (d.board || nFu || DB.tracker) h += tabs;
  if (TAB === 'israelis' && DB.tracker) {
    document.getElementById('app').innerHTML = h + trackerView();
    try { sessionStorage.setItem('mday', d.date); } catch { /* private mode */ }
    return;
  }
  if (TAB === 'followups' && (d.board || nFu)) {
    document.getElementById('app').innerHTML = h + followupsView(d);
    try { sessionStorage.setItem('mday', d.date); } catch { /* private mode */ }
    return;
  }
  if (d.board) {
    // the nightly page is always the first article; stand-alone articles follow it
    if (d.closing) h += '<h2 class="sec">סגירת הלילה ב-NBA</h2>' + render(d.closing);
    if (d.pieces.length) h += '<h2 class="sec">כתבות נוספות</h2>' + d.pieces.map((p) => render(p.md)).join('');
  } else if (!d.future) h += '<p class="empty-day">המערכת לא כתבה סיכומים לתאריך הזה.</p>';
  document.getElementById('app').innerHTML = h;
  // Israeli recaps / articles: highlighted wherever they appear
  const isrGames = new Map(d.results.filter((r) => r.israelis.length).map((r) => [`g${r.id}`, r.israelis.some((x) => x.full)]));
  document.querySelectorAll('.block[data-g]').forEach((b) => {
    if (!isrGames.has(b.dataset.g)) return;
    b.classList.add('israeli');
    if (isrGames.get(b.dataset.g)) b.classList.add('full');
    const r = d.results.find((x) => `g${x.id}` === b.dataset.g);
    const h3 = b.querySelector('h3');
    if (h3 && r) h3.insertAdjacentHTML('beforebegin', `<div style="margin-bottom:6px">${isrTags(r.israelis)}</div>`);
  });
  try { sessionStorage.setItem('mday', d.date); } catch { /* private mode */ }
}
function start() {
  const nav = document.getElementById('dates');
  nav.innerHTML = DB.days.map((d, i) => `<button data-day="${i}" class="${d.results.length ? '' : 'empty'}">${esc(d.today ? 'היום' : d.label.split(' ')[0])}<small>${esc(d.label.split(' ')[1])}</small></button>`).join('');
  nav.onclick = (e) => { const b = e.target.closest('[data-day]'); if (b) show(+b.dataset.day); };
  document.getElementById('meta').textContent = 'עודכן ' + new Date(DB.builtAt).toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });
  let i = DB.open;
  try { const m = sessionStorage.getItem('mday'); const k = DB.days.findIndex((d) => d.date === m); if (k >= 0) i = k; } catch { /* none */ }
  show(i >= 0 ? i : 0);
}
let CUR = 0;
document.addEventListener('click', async (e) => {
  const tb = e.target.closest('[data-tab]');
  if (tb) { TAB = tb.dataset.tab; try { sessionStorage.setItem('mtab', TAB); } catch { /* private */ } show(CUR); return; }
  const b = e.target.closest('.copy');
  if (b) { try { await navigator.clipboard.writeText(decodeURIComponent(b.dataset.t)); b.textContent = 'הועתק ✓'; } catch { b.textContent = 'לא הועתק'; } return; }
  const c = e.target.closest('[data-go]');
  if (c) {
    // the recap's jump point; fallback: the first recap whose heading names both teams
    const teams = (c.dataset.teams || '').split('|').filter(Boolean);
    const t = document.querySelector(`[data-g="${c.dataset.go}"]`)
      || [...document.querySelectorAll('.block')].find((b) => teams.length === 2 && teams.every((x) => (b.querySelector('h3')?.textContent || '').includes(x)))
      || [...document.querySelectorAll('.block')].find((b) => teams.length === 2 && teams.every((x) => b.textContent.includes(x)));
    if (t) { t.scrollIntoView({ block: 'start' }); t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1600); }
  }
});
start();
