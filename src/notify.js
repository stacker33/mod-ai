// Telegram, two destinations with the same bot:
//   TELEGRAM_CHAT        the channel — recaps only: one message per finished game (and per stand-alone article)
//   TELEGRAM_ALERT_CHAT  the operator's private chat — problems that need a person now, and the 08:00 summary
// Corrections are never sent anywhere (the editor page shows the new text).
// Needs TELEGRAM_BOT_TOKEN (secret) and TELEGRAM_CHAT ("@channel" or "-100…"). Without them nothing is sent.

const API = 'https://api.telegram.org/bot';
const LIMIT = 4000; // Telegram allows 4096 characters per message

export const telegramReady = (env) => !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT);

export const alertReady = (env) => !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_ALERT_CHAT);

// to the operator's private chat only; never fails the run
export async function sendAlert(env, text) {
  if (!alertReady(env)) return false;
  try { await sendTelegram({ ...env, TELEGRAM_CHAT: env.TELEGRAM_ALERT_CHAT }, text); return true; } catch { return false; }
}

export async function sendTelegram(env, text) {
  const parts = [];
  for (let t = text; t.length; ) {
    const cut = t.length <= LIMIT ? t.length : Math.max(t.lastIndexOf('\n\n', LIMIT), LIMIT / 2);
    parts.push(t.slice(0, cut).trim());
    t = t.slice(cut);
  }
  for (const p of parts) {
    const r = await fetch(`${API}${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT, text: p, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`Telegram ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
}

// the publishable text only: no check marks, editor notes or links (those live on the editor page)
export function itemMessage(it) {
  if (it.held || !it.draft) return null;
  const d = it.draft;
  const head = it.corrected ? 'עדכון: ' : '';
  const body = [d.headline, d.deck || d.subheadline, d.lead, ...(d.paragraphs || [])].filter(Boolean).join('\n\n');
  if (it.mode === 'game') return `${head}${it.heading}\n\n${body}`;
  return `${head}${body}`;
}

// a draft that still contradicts the data is not sent; the editor gets this alert instead
export function heldAlert(it) {
  const what = it.mode === 'game' ? it.heading : it.player ? `כתבה על ${it.player.he || it.player.name}` : 'כתבת משחק';
  return `⛔ ${what}: הטיוטה לא פורסמה כי לא עברה את הבדיקה מול הנתונים. צריך לכתוב ידנית.`;
}
