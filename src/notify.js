// Telegram: one message per finished game (and per stand-alone article), sent to the Mod-AI channel.
// Needs TELEGRAM_BOT_TOKEN (secret) and TELEGRAM_CHAT ("@channel" or "-100…"). Without them nothing is sent.

const API = 'https://api.telegram.org/bot';
const LIMIT = 4000; // Telegram allows 4096 characters per message

export const telegramReady = (env) => !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT);

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

function status(it) {
  const s = [it.check.ok ? '✅ נבדק מול הנתונים' : `❌ לבדוק: ${it.check.errors.slice(0, 3).join('; ')}`];
  if (it.check.toApprove.length) s.push(`✏️ שמות לאישור: ${it.check.toApprove.length}`);
  return s.join(' · ');
}

export function itemMessage(it, pageUrl) {
  const d = it.draft;
  const tag = it.corrected ? '🔁 עודכן אחרי תיקון של ESPN\n' : '';
  const link = pageUrl ? `\n\n${pageUrl}` : '';
  if (it.mode === 'game') {
    return `${tag}🏀 ${it.heading}\n\n${[`${d.lead} ${d.paragraphs[0] || ''}`.trim(), ...d.paragraphs.slice(1)].join('\n\n')}\n\n— ${status(it)}${link}`;
  }
  const kind = it.mode === 'player' ? '🇮🇱 כתבה' : it.mode === 'short' ? '🇮🇱 ידיעה' : '⭐ כתבת משחק';
  return `${tag}${kind}\n\n${d.headline}\n${d.subheadline ? `\n${d.subheadline}\n` : ''}\n${d.paragraphs.join('\n\n')}\n\n— ${status(it)}${link}`;
}
