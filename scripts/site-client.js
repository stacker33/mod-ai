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

const STATUS = {
  ok: ['ok', '✅ מוכן'], fixed: ['ok', '🔧 מוכן (תוקן אוטומטית)'], held: ['bad', '⛔ לא פורסם — לכתוב ידנית'], partial: ['warn', '⚠️ חלק מהפריטים לא פורסמו'],
  quota: ['warn', '⏳ ממתין למכסת כתיבה'], retry: ['warn', '🔁 ניסיון חוזר'], manual: ['bad', '⛔ נכשל — לכתוב ידנית'],
  live: ['live', '🏀 משוחק עכשיו'], upcoming: ['mute', '🕐 טרם התחיל'], final: ['mute', '⏱️ הסתיים — נכתב'],
};

const isrTags = (list) => (list || []).map((i) => `<span class="isrtag${i.full ? ' full' : ''}">${i.full ? '★ ' : ''}${esc(i.name)}</span>`).join(' ');

// "כל התוצאות" — always first; copy gives Sport5's plain list
function resultsBox(d) {
  if (!d.results.length) return `<div class="results"><h2>${esc(d.label)}</h2><p class="empty-day">אין משחקי NBA בתאריך הזה.</p></div>`;
  const live = d.results.filter((r) => r.state === 'in').length;
  const copy = ['כל התוצאות:', ...d.results.filter((r) => r.state === 'post').map((r) => r.line)].join('\n');
  const title = d.future ? 'לוח המשחקים' : 'כל התוצאות';
  return `<div class="results">${d.future ? '' : `<button class="copy" data-t="${encodeURIComponent(copy)}">העתק</button>`}<h2>${title}<span class="night">${esc(d.night)}${live ? ` · ${live} משוחקים עכשיו` : ''}</span></h2><ul>${d.results.map((r) => {
    const st = r.state === 'post' ? '' : r.state === 'in' ? '<span class="chip live">משוחק עכשיו</span>' : `<span class="t">${esc(r.time)}</span>`;
    return `<li class="${r.state}${r.israelis.length ? ' isr' : ''}" data-go="g${r.id}">${st}<span class="ln">${esc(r.line)}</span>${isrTags(r.israelis)}</li>`;
  }).join('')}</ul></div>`;
}

function summary(n) {
  const s = n.summary;
  const cells = [
    [s.games, 'משחקים'],
    [s.ready, 'סיכומים מוכנים'],
    [s.avgMinutes != null ? `${s.avgMinutes} ד׳` : '—', 'חציון: מהבאזר לסיכום'],
    [s.publishedContradictions, 'סתירות לנתונים שפורסמו'],
    [s.autoFixes, 'תיקונים אוטומטיים'],
  ];
  const extra = [s.held && `${s.held} לא פורסמו`, s.waiting && `${s.waiting} ממתינים`, s.live && `${s.live} משוחקים עכשיו`, s.upcoming && `${s.upcoming} טרם התחילו`].filter(Boolean).join(' · ');
  return `<div class="summary">${cells.map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>${extra ? `<p class="extra">${esc(extra)}</p>` : ''}`;
}

function board(n) {
  return `<div class="board">${n.board.map((g) => {
    const [cls, label] = STATUS[g.status] || ['mute', g.status];
    return `<button class="card ${cls}${g.isr?.length ? ' israeli' : ''}" data-go="g${g.id}" data-teams="${esc((g.teams || []).join('|'))}">
      <span class="score">${esc(g.line)}</span>
      ${g.angle ? `<span class="angle">${esc(g.angle)}</span>` : ''}
      <span class="meta"><span class="chip ${cls}">${esc(label)}</span>${g.minutes != null ? `<span class="chip mute">⚡ ${g.minutes} ד׳ מהבאזר</span>` : ''}${isrTags(g.isr)}${g.late ? '<span class="chip mute">נכתב מאוחר</span>' : g.rewritten ? '<span class="chip mute">נכתב מחדש</span>' : ''}</span>
    </button>`;
  }).join('')}</div>`;
}

function show(i) {
  const d = DB.days[i];
  document.querySelectorAll('nav.dates button').forEach((b, k) => b.classList.toggle('on', k === i));
  let h = resultsBox(d);
  if (d.board) {
    // Israelis on the board: names from the board, "full" from the results list
    const full = new Map(d.results.flatMap((r) => r.israelis.map((x) => [x.name, x.full])));
    for (const g of d.board) g.isr = g.israelis.map((name) => ({ name, full: !!full.get(name) }));
    h += summary(d) + board(d);
    if (d.pieces.length) h += '<h2 class="sec">כתבות</h2>' + d.pieces.map((p) => render(p.md)).join('');
    if (d.closing) h += '<h2 class="sec">סגירת הלילה</h2>' + render(d.closing);
  } else if (!d.future && d.results.length) h += '<p class="empty-day">המערכת לא כתבה סיכומים לתאריך הזה.</p>';
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
document.addEventListener('click', async (e) => {
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
