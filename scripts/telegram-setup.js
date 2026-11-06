// Connects the operator's private Telegram chat for alerts (the channel stays recaps only).
//   1. In Telegram, open the bot and press Start.
//   2. Run this (GitHub: Actions -> "Telegram alerts setup"). The bot replies IN THAT PRIVATE CHAT with its
//      chat ID — the ID is never printed here (the repo's logs are public).
//   3. Save that number as the repository secret TELEGRAM_ALERT_CHAT, run this again: a test alert arrives.

const API = 'https://api.telegram.org/bot';
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is missing');

async function call(method, body = {}) {
  const r = await fetch(`${API}${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw Object.assign(new Error(`${method}: ${r.status} ${j.description || ''}`), { status: r.status });
  return j.result;
}

const me = await call('getMe');
console.log(`bot: @${me.username}`);

if (process.env.TELEGRAM_ALERT_CHAT) {
  await call('sendMessage', { chat_id: process.env.TELEGRAM_ALERT_CHAT, text: '✅ ההתראות של Mod-AI מחוברות. כאן יגיעו רק תקלות שדורשות טיפול וסיכום בוקר ב-08:00. הערוץ נשאר לסיכומים בלבד.' });
  console.log('TELEGRAM_ALERT_CHAT is set: test alert sent to the private chat');
} else {
  let updates;
  try {
    updates = await call('getUpdates', { allowed_updates: ['message'] });
  } catch (e) {
    if (e.status === 409) {
      console.log('The bot gets its messages another way (webhook / another program), so this script cannot read them.');
      console.log('Instead: in Telegram open @userinfobot, press Start, and it shows your ID. Save it as TELEGRAM_ALERT_CHAT.');
      process.exit(0);
    }
    throw e;
  }
  const chats = new Map(updates.map((u) => u.message?.chat).filter((c) => c?.type === 'private').map((c) => [c.id, c]));
  if (!chats.size) {
    console.log(`No private chat with the bot yet. In Telegram open @${me.username}, press Start (or send any message), then run this again within 24 hours.`);
  } else {
    for (const c of chats.values()) {
      await call('sendMessage', { chat_id: c.id, text: `ה-chat ID שלך: ${c.id}\n\nשמור אותו ב-GitHub כ-secret בשם TELEGRAM_ALERT_CHAT (Settings → Secrets and variables → Actions → New repository secret), והרץ שוב את "Telegram alerts setup" לבדיקה.` });
    }
    console.log(`Sent the chat ID privately to ${chats.size} chat(s) that pressed Start. Check Telegram.`);
  }
}
