// Second sources (sportapi.ai / API-Sports) with a fake network: the cross-check catches a disagreement,
// and a backup box score becomes a summary the normal pipeline can write a clean recap from.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeGame } from '../src/game.js';
import { gameBrief } from '../src/writer/brief.js';
import { verifyDraft } from '../src/writer/verify.js';
import { templateDraft } from '../src/pipeline.js';
import { crossCheck, backupGames, backupSummary, nameKey } from '../src/secondary.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const names = new Map(JSON.parse(readFileSync(join(DIR, '..', 'config', 'names.he.json'), 'utf8')).players.map((p) => [p.id, p]));
const env = { SPORTAPI_KEY: 'test' };

// a fake sportapi.ai built from a real ESPN fixture (optionally with one number changed)
function fakeSportapi(summary, { homeScoreDelta = 0, ptsDelta = {} } = {}) {
  const comp = summary.header.competitions[0];
  const side = (ha) => comp.competitors.find((c) => c.homeAway === ha);
  const box = (ha) => {
    const tb = summary.boxscore.players.find((p) => p.team.id === side(ha).team.id).statistics[0];
    const ix = (l) => tb.labels.indexOf(l);
    return tb.athletes.map((a) => ({ player: { name: a.athlete.displayName }, starter: a.starter, dnp: a.didNotPlay ? 'DNP' : null, minutes: Number(a.stats?.[ix('MIN')]) || 0, pts: (Number(a.stats?.[ix('PTS')]) || 0) + (ptsDelta[a.athlete.displayName] || 0), reb: Number(a.stats?.[ix('REB')]) || 0, ast: Number(a.stats?.[ix('AST')]) || 0 }));
  };
  const game = { id: 77, status: 'FT', start: comp.date, home: { abbreviation: side('home').team.abbreviation, name: side('home').team.displayName, score: Number(side('home').score) + homeScoreDelta, periods: side('home').linescores.map((l) => Number(l.displayValue)) }, away: { abbreviation: side('away').team.abbreviation, name: side('away').team.displayName, score: Number(side('away').score), periods: side('away').linescores.map((l) => Number(l.displayValue)) } };
  globalThis.fetch = async (url) => ({ ok: true, status: 200, json: async () => (String(url).includes('/players') ? { data: { home: box('home'), away: box('away') } } : { data: [game] }) });
}

test('cross-check: ESPN and the second source agree -> nothing for the editor; a different number -> one actionable line', async () => {
  const s = JSON.parse(readFileSync(join(DIR, '401909933.json'), 'utf8')); // DAL @ SA
  const f = analyzeGame(s, { names });
  fakeSportapi(s);
  assert.deepEqual((await crossCheck(f, env, '20261104')).notes, []);
  fakeSportapi(s, { homeScoreDelta: 2, ptsDelta: { 'Victor Wembanyama': -2 } });
  // a fresh module cache per call is not needed: the games list is cached per run, so use a new date key
  const r = await crossCheck(f, env, '20261199');
  assert.equal(r.ok, false);
  assert.ok(r.notes.some((n) => /תוצאה סופית/.test(n)));
  assert.ok(r.notes.some((n) => /52 נקודות ב-ESPN, 50/.test(n)));
});

test('backup: a second source\'s box score becomes a summary; the pipeline writes a clean recap from it', async () => {
  const s = JSON.parse(readFileSync(join(DIR, '401909930.json'), 'utf8')); // MIN @ HOU
  fakeSportapi(s);
  const rows = await backupGames(env, '20261198');
  assert.equal(rows.length, 1);
  const bs = await backupSummary(env, rows[0]);
  const f = analyzeGame(bs, { names });
  assert.ok(f.ok, JSON.stringify(f.checks.filter((c) => c.severity === 'error')));
  assert.equal(f.teams.home.score, 107); // Houston at home lost 107-117
  assert.equal(f.flow.available, false); // no play-by-play in a backup
  const b = gameBrief(f);
  assert.ok(Object.values(b.stars).flat().some((p) => /דוראנט/.test(p.name_he))); // Hebrew names by English name (Durant, 21)
  const d = templateDraft('game', b);
  assert.equal(verifyDraft(d, b, [], null).blocking, 0);
});

test('names are matched across sources without accents / suffixes', () => {
  assert.equal(nameKey('Luka Dončić'), nameKey('Luka Doncic'));
  assert.equal(nameKey('Jaren Jackson Jr.'), nameKey('Jaren Jackson'));
});
