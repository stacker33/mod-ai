// Operator alerts: they go to the private chat only (never the recaps channel), and the 08:00 summary
// lists what needs a person.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendAlert, alertReady } from '../src/notify.js';
import { morningSummary } from '../src/board.js';

test('an alert goes to TELEGRAM_ALERT_CHAT, never to the channel; without it nothing is sent', async () => {
  const sent = [];
  globalThis.fetch = async (url, o) => { sent.push(JSON.parse(o.body).chat_id); return { ok: true, json: async () => ({ ok: true }) }; };
  assert.equal(await sendAlert({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT: '@nba_mod_ai' }, 'x'), false);
  assert.equal(sent.length, 0);
  assert.equal(alertReady({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_ALERT_CHAT: '123' }), true);
  assert.equal(await sendAlert({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT: '@nba_mod_ai', TELEGRAM_ALERT_CHAT: '123' }, 'x'), true);
  assert.deepEqual(sent, ['123']);
});

test('morning summary: counts, speed, the games that need a look, and the comparison when it is in', () => {
  const g = (status, extra = {}) => ({ status, line: 'פורטלנד - הלייקרס 110:104', review: [], late: false, ...extra });
  const board = [g('ok'), g('fixed'), g('review', { review: ['מספר לא מאומת'] }), g('manual'), g('upcoming')];
  const summary = { ready: 2, review: 1, held: 1, waiting: 0, avgMinutes: 4, publishedContradictions: 0 };
  const m = morningSummary('20261106', { board, summary }, null, 'https://x/');
  assert.match(m, /^☀️ סיכום הלילה 6\.11 — 4 משחקים/);
  assert.match(m, /✅ 2 מוכנים · 🟡 1 לבדיקה · ⛔ 1 לכתיבה ידנית/);
  assert.match(m, /חציון 4 דק׳/);
  assert.match(m, /לבדיקה — מספר לא מאומת/);
  assert.match(m, /לכתיבה ידנית/);
  assert.match(m, /תגיע כשהכתבה שלהם תעלה/);
  assert.match(morningSummary('20261106', { board, summary }, { sameAngle: 67, numbersCovered: 60, namesCovered: 75 }), /אותה פתיחה ב-67%/);
});
