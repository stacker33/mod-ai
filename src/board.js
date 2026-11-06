// The night's board: one card per game (status, speed, Israelis, editor notes) and the night's summary
// numbers. Shared by the editor page (scripts/site.js) and the morning summary to the operator (tick.js),
// so both always count the same way.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { heTeam } from './teams.js';

const readJ = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

// one card per game of the night, from the runner's state, the drafts and the facts
export function nightBoard(dir) {
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
      status = held && held === published.length ? 'held' : held ? 'partial' : published.some((x) => x.review?.length) ? 'review' : its.some((x) => x.autoFixed?.length) ? 'fixed' : 'ok';
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
      review: published.flatMap((x) => x.review || []),
      fixes: its.reduce((a, x) => a + (x.autoFixed?.length || 0), 0),
      end: f?.endedAt || sched?.start || '',
    };
  });
  // finished games newest first, then the ones still to come
  board.sort((a, b) => (['live', 'upcoming'].includes(a.status) - ['live', 'upcoming'].includes(b.status)) || String(b.end).localeCompare(String(a.end)));
  const mins = board.map((x) => x.minutes).filter((x) => x != null).sort((a, b) => a - b);
  const summary = {
    games: board.length,
    ready: board.filter((x) => ['ok', 'fixed'].includes(x.status)).length,
    review: board.filter((x) => ['review', 'partial'].includes(x.status)).length,
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

export const nightHe8 = (date) => `${Number(date.slice(6, 8))}.${Number(date.slice(4, 6))}`;
export const compareLine = (c) => `אותה פתיחה ב-${c.sameAngle}% מהמשחקים · ${c.numbersCovered}% מהמספרים של העורך · ${c.namesCovered}% מהשמות`;

// one message: written / to check / by hand, speed, what needs a look, and the Sport5 comparison if it is in
export function morningSummary(date, { board, summary: s }, compare, pageUrl) {
  const finished = board.filter((x) => !['live', 'upcoming'].includes(x.status));
  const lines = [`☀️ סיכום הלילה ${nightHe8(date)} — ${finished.length} משחקים`];
  lines.push(`✅ ${s.ready} מוכנים · 🟡 ${s.review} לבדיקה · ⛔ ${s.held} לכתיבה ידנית${s.waiting ? ` · ⏳ ${s.waiting} ממתינים` : ''}`);
  if (s.avgMinutes != null) lines.push(`⚡ חציון ${s.avgMinutes} דק׳ מסיום המשחק עד הסיכום${board.some((x) => x.late) ? ` (${board.filter((x) => x.late).length} נכתבו מאוחר)` : ''}`);
  if (s.publishedContradictions) lines.push(`❗ ${s.publishedContradictions} טקסטים נשלחו עם סתירה לנתונים`);
  const look = board.filter((x) => ['review', 'partial', 'held', 'manual', 'quota', 'retry'].includes(x.status));
  for (const x of look.slice(0, 6)) lines.push(`• ${x.line}: ${{ review: 'לבדיקה', partial: 'חלק לא נשלח', held: 'לא נשלח', manual: 'לכתיבה ידנית', quota: 'ממתין למכסה', retry: 'בניסיון חוזר' }[x.status]}${x.review[0] ? ` — ${x.review[0]}` : ''}`);
  if (!look.length && finished.length) lines.push('אין משחקים שדורשים טיפול.');
  lines.push(compare ? `📊 מול Sport5: ${compareLine(compare)}` : '📊 ההשוואה ל-Sport5 תגיע כשהכתבה שלהם תעלה.');
  if (pageUrl) lines.push(pageUrl);
  return lines.join('\n');
}
