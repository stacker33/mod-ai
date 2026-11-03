// Builds site/index.html: the drafts of the last nights, ENCRYPTED with PAGE_PASSWORD (AES-256-GCM,
// key from PBKDF2). The repo and the page are public; only someone with the password can read the drafts.
//   PAGE_PASSWORD=… node scripts/site.js

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pbkdf2Sync, randomBytes, createCipheriv } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NIGHTS = 7;
const ITER = 200000;
const password = process.env.PAGE_PASSWORD;
if (!password) { console.log('site: no PAGE_PASSWORD, skipped'); process.exit(0); }

const outDir = join(ROOT, 'out');
const nights = readdirSync(outDir).filter((d) => /^\d{8}$/.test(d) && existsSync(join(outDir, d, 'drafts', 'closing.md'))).sort().reverse().slice(0, NIGHTS)
  .map((d) => {
    const dd = join(outDir, d, 'drafts');
    const pieces = readdirSync(dd).filter((f) => f.endsWith('.md') && f !== 'closing.md').sort((a, b) => (a.startsWith('player') ? -1 : 1) - (b.startsWith('player') ? -1 : 1))
      .map((f) => ({ name: f, md: readFileSync(join(dd, f), 'utf8') }));
    return { date: d, closing: readFileSync(join(dd, 'closing.md'), 'utf8'), pieces };
  });

const payload = Buffer.from(JSON.stringify({ builtAt: new Date().toISOString(), nights }), 'utf8');
const salt = randomBytes(16), iv = randomBytes(12);
const key = pbkdf2Sync(password, salt, ITER, 32, 'sha256');
const c = createCipheriv('aes-256-gcm', key, iv);
const enc = Buffer.concat([c.update(payload), c.final(), c.getAuthTag()]); // WebCrypto expects the tag appended
const blob = { salt: salt.toString('base64'), iv: iv.toString('base64'), iter: ITER, data: enc.toString('base64') };

const html = `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Mod-AI · NBA</title>
<style>
:root{--bg:#f5f6f8;--card:#fff;--ink:#16181d;--mute:#5d6370;--line:#dde1e7;--brand:#0b2a5b;--accent:#c2185b;--ok:#1b7f3b;--bad:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#181b21;--ink:#e9ebef;--mute:#9aa1ad;--line:#2a2f38;--brand:#9cc0ff;--accent:#ff6fa5;--ok:#5fd28a;--bad:#ff8a80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 system-ui,"Segoe UI",Arial,sans-serif}
header{background:#0b2a5b;color:#fff;padding:12px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}header b{font-size:18px}
main{max-width:820px;margin:0 auto;padding:16px}
.lock{max-width:360px;margin:15vh auto;background:var(--card);border:1px solid var(--line);padding:20px}
input,button,select{font:inherit;padding:8px 10px;border:1px solid var(--line);background:var(--card);color:var(--ink)}button{cursor:pointer;background:#c2185b;color:#fff;border:0}
.block{background:var(--card);border:1px solid var(--line);padding:14px 16px;margin:12px 0}
.block h3{margin:0 0 6px;font-size:17px;color:var(--brand)}.when{color:var(--mute);font-size:13px}
.check{border-inline-start:3px solid var(--line);padding:6px 10px;color:var(--mute);font-size:14px;margin-top:10px}
.check p{margin:2px 0}.copy{float:left;font-size:13px;padding:4px 10px}
h1{font-size:22px}h2{font-size:19px}
</style></head><body>
<header><b>Mod-AI · NBA</b><span id="meta"></span><select id="night" hidden></select></header>
<main id="app"><div class="lock"><p>טיוטות פנימיות. הכנס סיסמה:</p><form id="f"><input id="pw" type="password" autocomplete="current-password" style="width:100%"><p><button>פתח</button> <span id="err"></span></p></form></div></main>
<script>
const BLOB=${JSON.stringify(blob)};
const b64=(s)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function open(pw){const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(pw),'PBKDF2',false,['deriveKey']);
const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:b64(BLOB.salt),iterations:BLOB.iter,hash:'SHA-256'},k,{name:'AES-GCM',length:256},false,['decrypt']);
const out=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64(BLOB.iv)},key,b64(BLOB.data));return JSON.parse(new TextDecoder().decode(out));}
const esc=(s)=>s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const inline=(s)=>esc(s).replace(/\\*\\*(.+?)\\*\\*/g,'<b>$1</b>').replace(/_(.+?)_/g,'<i>$1</i>');
// one markdown file -> blocks split on ---; the "> " lines are the editor's check box (never copied)
function render(md){return md.split(/\\n---\\n/).map(part=>{const lines=part.trim().split('\\n');const text=[],check=[];let h='',when='';
for(const l of lines){if(l.startsWith('> '))check.push(l.slice(2));else if(/^#{1,3} /.test(l))h=l.replace(/^#+ /,'');else if(/^_.*_$/.test(l)&&!text.length)when=l.slice(1,-1);else if(/^\\*\\*.*\\*\\*$/.test(l)&&!h)h=l.slice(2,-2);else text.push(l);}
const body=text.join('\\n').trim().split(/\\n\\s*\\n/).filter(Boolean);
const copy=[h,...body].filter(Boolean).join('\\n\\n');
return '<div class="block">'+(body.length?'<button class="copy" data-t="'+encodeURIComponent(copy)+'">העתק</button>':'')+(when?'<div class="when">'+esc(when)+'</div>':'')+(h?'<h3>'+inline(h)+'</h3>':'')+body.map(p=>'<p>'+inline(p).replace(/\\n/g,'<br>')+'</p>').join('')+(check.length?'<div class="check">'+check.map(c=>'<p>'+inline(c)+'</p>').join('')+'</div>':'')+'</div>';}).join('');}
function show(db,i){const n=db.nights[i];document.getElementById('app').innerHTML=n.pieces.map(p=>render(p.md)).join('')+render(n.closing);}
document.getElementById('f').onsubmit=async(e)=>{e.preventDefault();const pw=document.getElementById('pw').value;
if(!window.crypto||!crypto.subtle){document.getElementById('err').textContent='הדפדפן חוסם פענוח בכתובת הזו (צריך https)';return}
try{const db=await open(pw);try{sessionStorage.setItem('mpw',pw)}catch{}start(db)}catch{document.getElementById('err').textContent='סיסמה שגויה'}};
function start(db){const sel=document.getElementById('night');sel.hidden=false;sel.innerHTML=db.nights.map((n,i)=>'<option value="'+i+'">'+n.date.slice(6)+'.'+n.date.slice(4,6)+'</option>').join('');
sel.onchange=()=>show(db,+sel.value);document.getElementById('meta').textContent='עודכן '+new Date(db.builtAt).toLocaleTimeString('he-IL',{timeZone:'Asia/Jerusalem',hour:'2-digit',minute:'2-digit'});if(db.nights.length)show(db,0);else document.getElementById('app').innerHTML='<p>אין עדיין טיוטות.</p>';}
document.addEventListener('click',async(e)=>{const b=e.target.closest('.copy');if(!b)return;try{await navigator.clipboard.writeText(decodeURIComponent(b.dataset.t));b.textContent='הועתק ✓'}catch{b.textContent='לא הועתק'}});
(async()=>{let pw=null;try{pw=sessionStorage.getItem('mpw')}catch{}if(pw){try{start(await open(pw))}catch{}}})();
</script></body></html>
`;
mkdirSync(join(ROOT, 'site'), { recursive: true });
writeFileSync(join(ROOT, 'site', 'index.html'), html);
writeFileSync(join(ROOT, 'site', '.nojekyll'), '');
console.log(`site: ${nights.length} nights, ${Math.round(html.length / 1024)} KB -> site/index.html`);
