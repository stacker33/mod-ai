// Human-readable review sheet of the facts (for checking the engine, not for publishing).

const tname = (t) => t.heShort || t.abbr;
const score = (f, s) => `${tname(f.teams.away)} ${s.away}, ${tname(f.teams.home)} ${s.home}`;
const when = (a) => (a ? `${a.periodName} ${a.clock}` : '?');
const shoot = (x) => (x ? `${x[0]}/${x[1]}` : '-');

function playerRow(p) {
  const mark = { approved: '', sport5: '', aligned: '', draft: ' ✏️', missing: ' ❓' }[p.heStatus] ?? '';
  return `| ${p.he ? `${p.he}${mark}` : `${p.name} ❓`}${p.starter ? '' : ' (ספסל)'} | ${p.min} | ${p.pts} | ${p.reb} | ${p.ast} | ${p.stl} | ${p.blk} | ${p.to} | ${shoot(p.fg)} | ${shoot(p.tp)} | ${shoot(p.ft)} | ${p.plusMinus > 0 ? '+' : ''}${p.plusMinus} | ${p.flags.join(', ')} |`;
}

export function gameReport(f) {
  const W = f.teams[f.result.winner], L = f.teams[f.result.loser];
  const o = [];
  o.push(`## ${tname(W)} ${W.score}, ${tname(L)} ${L.score}${f.clutch.overtimes ? ` (${f.clutch.overtimes > 1 ? f.clutch.overtimes + ' הארכות' : 'הארכה'})` : ''}`);
  o.push(`${f.teams.away.name} @ ${f.teams.home.name} · ESPN ${f.gameId} · [מקור](${f.source.url})`);
  o.push('');
  const bad = f.checks.filter((c) => c.severity === 'warn' || c.severity === 'error');
  o.push(f.ok ? `**בדיקות:** ✅ כל הבדיקות עברו${bad.length ? ` (אזהרות: ${bad.map((c) => `${c.name}: ${c.detail}`).join('; ')})` : ''}` : `**בדיקות:** ❌ ${bad.map((c) => `${c.name}: ${c.detail}`).join('; ')} — אסור לכתוב טיוטה מהמשחק הזה`);
  o.push('');
  o.push(`**מאזנים אחרי המשחק:** ${tname(f.teams.home)} ${f.teams.home.record || '?'}, ${tname(f.teams.away)} ${f.teams.away.record || '?'}${f.note ? ` · ${f.note}` : ''}`);
  o.push('');
  const n = f.teams.home.periods.length;
  const hdr = Array.from({ length: n }, (_, i) => (i < 4 ? `ר${i + 1}` : `ה${i - 3}`));
  o.push(`| | ${hdr.join(' | ')} | סה"כ |`, `|---|${hdr.map(() => '---').join('|')}|---|`);
  for (const side of ['away', 'home']) o.push(`| ${tname(f.teams[side])} | ${f.teams[side].periods.join(' | ')} | ${f.teams[side].score} |`);
  o.push('');
  o.push(`- **מחצית:** ${score(f, f.result.halftime)} · **אחרי 3 רבעים:** ${score(f, f.result.after3)}`);
  if (f.flow.available) {
    for (const side of ['home', 'away']) {
      const l = f.flow.largestLead[side];
      o.push(`- **יתרון שיא ${tname(f.teams[side])}:** ${l.pts}${l.at ? ` (${when(l.at)}, ${score(f, l.score)})` : ''}`);
    }
    o.push(`- **חילופי הובלה:** ${f.flow.leadChanges} · **שוויונות:** ${f.flow.ties}`);
    for (const s of f.flow.spurts.slice(0, 4)) o.push(`- **ריצה:** ${tname(f.teams[s.side])} ${s.for}:${s.against} (${when(s.from)} עד ${when(s.to)}; מ-${score(f, s.scoreBefore)} ל-${score(f, s.scoreAfter)})`);
  } else o.push('- ⚠️ אין play-by-play — אין נתוני ריצות וסיום');
  const c = f.clutch;
  if (c.marginAt5min) o.push(`- **5 דקות לסיום:** ${score(f, c.marginAt5min)} · **2 דקות לסיום:** ${score(f, c.marginAt2min)}`);
  if (c.tyingShotToOT) o.push(`- **שוויון שהוביל להארכה:** ${c.tyingShotToOT.player || '?'}, ${c.tyingShotToOT.secondsLeftInPeriod} שניות לסיום ר4 — "${c.tyingShotToOT.text}"`);
  if (c.winningBasket) {
    const w = c.winningBasket;
    o.push(`- **הסל שהעלה את ${tname(W)} ליתרון סופי:** ${w.player || '?'}, ${when(w)}${w.inFinalPeriod ? ` (${w.secondsLeftInPeriod} שניות לסיום)` : ''} — "${w.text}"${w.late ? ' ⭐ מכריע' : ''}`);
  }
  if (c.loserLedInLast3min) o.push(`- **${tname(L)} הובילה בשלוש הדקות האחרונות והפסידה**`);
  o.push('');
  o.push('**מועמדים לסיפור המרכזי (לפי משקל):**');
  for (const k of f.candidates.slice(0, 6)) o.push(`${k.weight} · ${k.type} — ${k.why} _(${k.evidence})_`);
  o.push('');
  for (const side of [f.result.winner, f.result.loser]) {
    const ps = f.players[side].filter((p) => p.played).sort((a, b) => b.pts - a.pts);
    o.push(`**${tname(f.teams[side])}** — ספסל ${f.bench[side]} נק' · FG ${f.teamStats[side].fgPct ?? '?'}% · 3P ${shoot(f.teamStats[side].tp)} · ריבאונדים ${f.teamStats[side].reb ?? '?'} · איבודים ${f.teamStats[side].to ?? '?'}`);
    o.push('', '| שחקן | דק\' | נק\' | ריב\' | אס\' | חט\' | חס\' | איב\' | FG | 3P | FT | +/- | ציון |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const p of ps.slice(0, 6)) o.push(playerRow(p));
    const dnp = f.players[side].filter((p) => !p.played);
    if (dnp.length) o.push('', `לא שיחקו: ${dnp.map((p) => `${p.name}${p.dnpReason ? ` (${p.dnpReason})` : ''}`).join(', ')}`);
    o.push('');
  }
  if (f.israelis.length) {
    o.push('**🇮🇱 ישראלים:**');
    for (const i of f.israelis) o.push(i.played ? `- ${i.name} (${i.team}): ${i.pts} נק', ${i.reb} ריב', ${i.ast} אס' ב-${i.min} דק'` : `- ${i.name} (${i.team}): לא שיחק${i.dnpReason ? ` (${i.dnpReason})` : ''}`);
    o.push('');
  }
  if (f.color) {
    const ev = f.color.events;
    if (ev.length || f.color.highlights.length) {
      o.push('**צבע (לא רק מספרים):**');
      for (const e of ev) o.push(`- ${e.kind}: ${e.player || e.team || '?'} (${e.periodName} ${e.clock}${e.clutch ? ', בקלאץ׳' : ''}) — "${e.text}" _(pbp)_`);
      if (f.color.highlights.length) o.push(`- קטעי וידאו של ESPN (כיוון בלבד, לא עובדה): ${f.color.highlights.map((h) => `"${h}"`).join(' · ')}`);
      o.push('');
    }
  }
  o.push('**דורש מחקר (לא נכתב כעובדה):**');
  for (const r of f.research) o.push(`- ${r}`);
  if (c.finalSequence.length) {
    o.push('', '<details><summary>רצף שתי הדקות האחרונות</summary>', '');
    for (const p of c.finalSequence) o.push(`- ${p.clock} · ${p.score.away}-${p.score.home} · ${p.text}`);
    o.push('', '</details>');
  }
  return o.join('\n');
}

const sign = (n) => (n > 0 ? `+${n}` : `${n}`);
const atSc = (t, sc) => `${sc[t.side]}:${sc[t.side === 'home' ? 'away' : 'home']}`; // his team first

export function trackReport(t) {
  const o = [];
  const nm = t.player.he || t.player.name;
  if (!t.inGame) return '';
  const res = `${t.won ? 'ניצחון' : 'הפסד'} ${t.team.score}:${t.opp.score} ${t.home ? 'בבית' : 'בחוץ'} מול ${t.opp.he || t.opp.abbr}`;
  o.push(`## 🇮🇱 ${nm} — ${res}`);
  o.push(`מאזן ${t.team.he || t.team.abbr}: ${t.team.record || '?'}${t.team.context.streak ? ` · רצף: ${t.team.context.streak.length} ${t.team.context.streak.kind === 'W' ? 'ניצחונות' : 'הפסדים'}` : ''}`);
  if (!t.inBoxScore) { o.push('', `⚠️ לא מופיע בבוקס סקור: ${t.note}`); return o.join('\n'); }
  if (!t.played) { o.push('', `**לא שיחק** (${t.dnpReason || 'ללא סיבה בנתונים'})`); return o.join('\n'); }
  const l = t.line;
  const sh = (x) => (x ? `${x[0]} מ-${x[1]}` : '-');
  o.push('', t.ok ? `✅ הנתונים שלו אומתו (play-by-play = בוקס סקור)${t.pbpWarnings?.length ? ` · ⚠️ ${t.pbpWarnings.join('; ')} (נכתב לפי הבוקס סקור)` : ''}` : `❌ אי התאמה: ${Object.entries(t.pbpCheck).filter(([, c]) => !c.ok).map(([k, c]) => `${k} pbp ${c.pbp} / box ${c.box}`).join(', ')}`);
  o.push('', `**השורה:** ${l.pts} נקודות (${sh(l.fg)} מהשדה, ${sh(l.tp)} משלוש, ${sh(l.ft)} מהעונשין), ${l.reb} ריבאונדים, ${l.ast} אסיסטים (${l.to} איבודים), ${l.stl} חטיפות, ${l.blk} חסימות, פלוס מינוס ${sign(l.plusMinus)} ב-${l.min} דקות${l.starter ? '' : ' (מהספסל)'}`);
  o.push(`**לפי רבעים (נק'):** ${t.byPeriod.map((x) => `${x.periodName} ${x.pts}`).join(' · ')} · מחצית ראשונה ${t.halves.first}, שנייה ${t.halves.second}`);
  if (t.bestBurst) o.push(`**הרצף הכי חם שלו:** ${t.bestBurst.pts} נק' (${t.bestBurst.from.periodName} ${t.bestBurst.from.clock} עד ${t.bestBurst.to.periodName} ${t.bestBurst.to.clock})`);
  if (t.assistsTo.length) o.push(`**אסיסטים ל:** ${t.assistsTo.map((a) => `${a.name} ${a.n}`).join(', ')}`);
  if (t.milestones.length) { o.push('', '**הישגים מאומתים:**'); for (const m of t.milestones) o.push(`- ${m.text}`); }
  if (t.history) {
    const h = t.history, a = h.seasonAverageBefore;
    o.push('', `**ממוצעים העונה לפני המשחק** (${h.gamesBeforeThisSeason} משחקים): ${a.pts ?? '-'} נק', ${a.reb ?? '-'} ריב', ${a.ast ?? '-'} אס' · שיא קריירה בנקודות: ${h.records.pts.careerHigh?.value ?? '?'} (${h.records.pts.careerHigh?.season || ''} מול ${h.records.pts.careerHigh?.opp || '?'})`);
    if (h.previousGame) o.push(`**משחק קודם:** ${h.previousGame.atVs === '@' ? 'בחוץ' : 'בבית'} מול ${h.previousGame.opp}, ${h.previousGame.result === 'W' ? 'ניצחון' : 'הפסד'} ${h.previousGame.score} · ${h.previousGame.pts} נק', ${h.previousGame.reb} ריב', ${h.previousGame.ast} אס'`);
  }
  if (t.clutch.length) { o.push('', '**בדקות ההכרעה (5 אחרונות, פער עד 10):**'); for (const c of t.clutch) o.push(`- ${c.periodName} ${c.clock} · ${c.kind}${c.partner ? ` (${c.partner})` : ''} · ${atSc(t, c.score)} — "${c.text}"`); }
  if (t.leadPlays.length) o.push('', `**סלים שלו שהשוו או העלו ליתרון:** ${t.leadPlays.map((x) => `${x.periodName} ${x.clock} (${atSc(t, x.score)}${x.tied ? ', שוויון' : ''})`).join(' · ')}`);
  if (t.leadAssists.length) o.push(`**אסיסטים שלו לסל שוויון/יתרון:** ${t.leadAssists.map((x) => `${x.periodName} ${x.clock} ל${x.to} (${atSc(t, x.score)})`).join(' · ')}`);
  if (t.fouls.fourth || t.technicals.length) o.push(`**עבירות:** ${t.fouls.total}${t.fouls.fourth ? ` · רביעית ב-${t.fouls.fourth.periodName} ${t.fouls.fourth.clock}` : ''}${t.technicals.length ? ` · טכנית: ${t.technicals.map((x) => `${x.periodName} ${x.clock}`).join(', ')}` : ''}`);
  o.push('', `**חברי קבוצה:** ${t.teammates.map((m) => `${m.name} ${m.pts}`).join(', ')} · **יריבה:** ${t.opponents.map((m) => `${m.name} ${m.pts}`).join(', ')}`);
  const nx = t.team.context.next;
  if (nx) o.push(`**המשחק הבא:** ${nx.home ? 'בבית' : 'בחוץ'} מול ${nx.oppHe || nx.opp}, יום ${nx.israel.weekday} ${nx.israel.date} ב-${nx.israel.time} שעון ישראל`);
  return o.join('\n');
}

export function nightReport(date, rows, facts) {
  const o = [`# Mod-AI · עובדות משחקי הלילה ${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`, ''];
  if (!rows.length) o.push('אין משחקי NBA בתאריך הזה.');
  for (const r of rows) {
    const f = facts.get(r.id);
    const st = r.state !== 'post' ? `⏳ ${r.detail}` : !f ? `❌ ${r.error || 'שגיאה'}` : f.ok ? '✅' : '❌ בדיקות נכשלו';
    o.push(`- ${r.away?.abbr} ${r.away?.score} @ ${r.home?.abbr} ${r.home?.score} — ${st}${f ? ` · ${f.candidates[0]?.type}` : ''}`);
  }
  const tracks = [...facts.values()].flatMap((f) => f.tracks || []).filter((t) => t.inGame).sort((a, b) => (a.player.track === 'full' ? -1 : 1) - (b.player.track === 'full' ? -1 : 1));
  for (const t of tracks) o.push('', '---', '', trackReport(t));
  for (const f of [...facts.values()].sort((a, b) => (b.candidates[0]?.weight || 0) - (a.candidates[0]?.weight || 0))) o.push('', '---', '', gameReport(f));
  return o.join('\n') + '\n';
}
