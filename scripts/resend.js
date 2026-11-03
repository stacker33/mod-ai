// Re-send a night's drafts to Telegram (oldest game first), e.g. after the channel was set up late.
//   node scripts/resend.js 20261102

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, dayDir } from '../src/pipeline.js';
import { telegramReady, sendTelegram, itemMessage, heldAlert } from '../src/notify.js';

const date = process.argv[2];
if (!/^\d{8}$/.test(date || '')) throw new Error('usage: node scripts/resend.js YYYYMMDD');
const cfg = loadConfig();
if (!telegramReady(cfg.env)) throw new Error('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT is missing');
const dir = join(dayDir(date), 'drafts', 'items');
if (!existsSync(dir)) throw new Error(`no drafts for ${date}`);
const items = readdirSync(dir).filter((f) => f.endsWith('.json')).flatMap((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
const end = (it) => items.find((x) => x.gameId === it.gameId && x.mode === 'game')?.end || '';
items.sort((a, b) => String(end(a)).localeCompare(String(end(b))) || (a.mode === 'game' ? -1 : 1));
let sent = 0;
for (const it of items.filter((x) => x.draft && !x.noSend)) {
  await sendTelegram(cfg.env, itemMessage(it) || heldAlert(it));
  sent++;
  await new Promise((r) => setTimeout(r, 1500)); // stay well under Telegram's per-chat rate limit
}
console.log(`${date}: sent ${sent} messages`);
