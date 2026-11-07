// Replay regression set #2: the night of 2026-11-06, the editor's notes. The system has to tell the STORY,
// not only the lines: Trae Young's first game back in Atlanta, Avdija's strong first half and the third
// quarter he disappeared in (8 turnovers), and Doncic's 53 inside the Avdija article.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeGame } from '../src/game.js';
import { gameBrief, playerBrief } from '../src/writer/brief.js';
import { verifyDraft, autoFix } from '../src/writer/verify.js';
import { templateDraft } from '../src/pipeline.js';
import { formerTeamFact } from '../src/context.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const names = new Map(json(join(DIR, '..', 'config', 'names.he.json')).players.map((p) => [p.id, p]));
const avdija = { id: '4683021', name: 'Deni Avdija', he: 'דני אבדיה', team: 'POR', track: 'full' };
const trae = json(join(DIR, 'extra', 'gamelog-4277905.json'));

test('POR @ LAL: Doncic carried the third quarter; Avdija went quiet in it after a 12-point first half', () => {
  const f = analyzeGame(json(join(DIR, '401909294.json')), { names, israelis: [avdija] });
  const take = f.notable.find((m) => m.type === 'PERIOD_TAKEOVER');
  assert.equal(take.period, 3);
  assert.equal(take.pts, 20);
  const fade = f.notable.find((m) => m.type === 'PLAYER_FADE' && m.playerId === avdija.id);
  assert.deepEqual([fade.h1, fade.period, fade.ptsInPeriod, fade.toTotal], [12, 3, 0, 8]);
  // the 8 turnovers are told inside the fade (one sentence), not again on their own
  assert.ok(!f.notable.some((m) => m.type === 'TURNOVERS' && m.playerId === avdija.id));
  const b = gameBrief(f);
  assert.ok(b.details.some((d) => d.includes('20 נקודות ברבע השלישי, כשהלייקרס ניצחו אותו 15:34')), b.details.join(' | '));
});

test('the Avdija article must tell his arc and the 53 on the other side — in the body, not only the deck', () => {
  const f = analyzeGame(json(join(DIR, '401909294.json')), { names, israelis: [avdija] });
  const pb = playerBrief(f, f.tracks[0]);
  assert.match(pb.his_story_he[0], /12 נקודות במחצית הראשונה, אבל לא קלע ברבע השלישי ואיבד בו 4 כדורים \(8 איבודים במשחק כולו\), כשפורטלנד הפסידה אותו 34:15/);
  assert.match(pb.game_story_he, /^לוקה דונצ'יץ' קלע 53 נקודות, 20 מהן ברבע השלישי/);
  // the plain template tells both and passes every check
  const t = templateDraft('player', pb);
  assert.equal(verifyDraft(t, pb, [], null).blocking, 0);
  // last night's text: 53 only in the sub-headline -> blocked, and the code puts the sentence in paragraph 2
  const lastNight = { headline: 'כמעט טריפל דאבל לדני אבדיה', subheadline: 'הישראלי בלט, אך 53 נקודות של לוקה דונצ\'יץ\' הכריעו.', paragraphs: [`דני אבדיה סיים עם ${pb.line_full_he}.`, pb.his_story_he[0] + '.', 'במשחקה הבא תארח פורטלנד את סן אנטוניו.'] };
  const r = verifyDraft(lastNight, pb, [], null);
  const miss = r.issues.filter((i) => i.code === 'must-tell');
  assert.equal(miss.length, 1);
  const fixed = autoFix(lastNight, r.issues, pb);
  assert.ok(fixed.paragraphs[1].includes('53 נקודות'));
  assert.equal(verifyDraft(fixed, pb, [], null).issues.filter((i) => i.code === 'must-tell').length, 0);
});

test('WSH @ ATL: Trae Young\'s first game back in Atlanta is the story (verified from his game log)', async () => {
  const { buildContext } = await import('../src/context.js');
  const f = analyzeGame(json(join(DIR, '401909287.json')), { names, context: { gamelogs: { 4277905: trae } } });
  const ret = f.contextFacts.find((x) => x.type === 'RETURN_TO_FORMER_TEAM');
  assert.ok(ret, JSON.stringify(f.contextFacts.map((x) => x.type)));
  assert.equal(ret.fact_he, 'טריי יאנג חזר לראשונה לאטלנטה, הקבוצה שבה שיחק 8 עונות, וסיים עם 23 נקודות ו-10 אסיסטים בהפסד');
  assert.equal(f.story.main.type, 'RETURN_TO_FORMER_TEAM'); // above "Atlanta beat Washington for the 5th straight time"
  const b = gameBrief(f);
  assert.equal(b.main_angle.fact_he, ret.fact_he);
  assert.equal(verifyDraft(templateDraft('game', b), b, [], null).blocking, 0);
  void buildContext;
});

test('former team: "for the first time" only when it is true', () => {
  const p = { id: '4277905', name: 'Trae Young' };
  const later = '2026-12-20T00:00:00Z';
  // a second visit to Atlanta (the 2026-11-07 one is in the log by then) -> nothing
  const visit = [...trae, { eventId: 'x1', season: '2026-27', type: 'regular', date: '2026-11-07T00:30:00Z', team: 'WSH', opp: 'ATL', atVs: '@' }];
  assert.equal(formerTeamFact(visit, p, 'WSH', 'ATL', 'x2', later, false), null);
  // Atlanta comes to him: already met them (2026-11-05) -> nothing
  assert.equal(formerTeamFact(trae, p, 'WSH', 'ATL', 'x2', later, true), null);
  // first time against them at all, at home -> FIRST_MEETING
  const beforeMeeting = trae.filter((r) => !(r.opp === 'ATL' && r.team === 'WSH'));
  assert.equal(formerTeamFact(beforeMeeting, p, 'WSH', 'ATL', 'x2', later, true).kind, 'FIRST_MEETING');
  // never played for them -> nothing
  assert.equal(formerTeamFact(trae, p, 'WSH', 'BOS', 'x2', later, false), null);
});
