// Browser side of the encrypted editor page (inlined by scripts/site.js). Plain JS, no libraries.
/* global BLOB */
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function open(pw) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(BLOB.salt), iterations: BLOB.iter, hash: 'SHA-256' }, k, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const out = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(BLOB.iv) }, key, b64(BLOB.data));
  return JSON.parse(new TextDecoder().decode(out));
}
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
    return `<button class="card ${cls}" data-go="g${g.id}" data-teams="${esc((g.teams || []).join('|'))}">
      <span class="score">${esc(g.line)}</span>
      ${g.angle ? `<span class="angle">${esc(g.angle)}</span>` : ''}
      <span class="meta"><span class="chip ${cls}">${esc(label)}</span>${g.minutes != null ? `<span class="chip mute">⚡ ${g.minutes} ד׳ מהבאזר</span>` : ''}${g.israelis.length ? `<span class="chip isr">ישראלי: ${esc(g.israelis.join(', '))}</span>` : ''}${g.late ? '<span class="chip mute">נכתב מאוחר</span>' : g.rewritten ? '<span class="chip mute">נכתב מחדש</span>' : ''}</span>
    </button>`;
  }).join('')}</div>`;
}

function show(db, i) {
  const n = db.nights[i];
  document.getElementById('app').innerHTML = summary(n) + board(n) + '<h2 class="sec">כתבות</h2>' + n.pieces.map((p) => render(p.md)).join('') + '<h2 class="sec">סגירת הלילה</h2>' + render(n.closing);
}
function start(db) {
  const sel = document.getElementById('night');
  sel.hidden = false;
  sel.innerHTML = db.nights.map((n, i) => `<option value="${i}">${n.date.slice(6)}.${n.date.slice(4, 6)}</option>`).join('');
  sel.onchange = () => show(db, +sel.value);
  document.getElementById('meta').textContent = 'עודכן ' + new Date(db.builtAt).toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });
  if (db.nights.length) show(db, 0); else document.getElementById('app').innerHTML = '<p>אין עדיין טיוטות.</p>';
}
document.getElementById('f').onsubmit = async (e) => {
  e.preventDefault();
  const pw = document.getElementById('pw').value;
  if (!window.crypto || !crypto.subtle) { document.getElementById('err').textContent = 'הדפדפן חוסם פענוח בכתובת הזו (צריך https)'; return; }
  try { const db = await open(pw); try { sessionStorage.setItem('mpw', pw); } catch { /* private mode */ } start(db); } catch { document.getElementById('err').textContent = 'סיסמה שגויה'; }
};
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
(async () => { let pw = null; try { pw = sessionStorage.getItem('mpw'); } catch { /* none */ } if (pw) { try { start(await open(pw)); } catch { /* ask again */ } } })();
