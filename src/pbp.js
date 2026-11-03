// Who did what in a foul-type play. ESPN puts these in separate plays with different participant roles:
//   "Technical Foul" / "Flopping Technical" / "Hanging Technical Foul"  participants[0] = player charged
//                                                                         (participants[1], if any, drew it)
//   "Double Technical Foul"                                              participants[0] and [1] both charged
//   "Free Throw - Technical"                                              participants[0] = SHOOTER only, never charged
//   "Flagrant Foul Type 1|2"                                             participants[0] = committed it
//   "Free Throw - Flagrant n of m"                                       participants[0] = shooter (the fouled player)
//   "Ejection"                                                           participants[0] = ejected
//   "Defensive 3-Seconds Technical" / "Delay Technical"                  minor, team-type technicals
// Every caller goes through foulRole(); nothing else should regex the play type for "technical".

export function foulRole(type, text = '') {
  const t = String(type || '');
  if (/^free throw/i.test(t)) return { kind: /technical/i.test(t) ? 'technical-free-throw' : /flagrant/i.test(t) ? 'flagrant-free-throw' : 'free-throw', charged: [] };
  if (/defensive 3-seconds|delay technical|illegal defense/i.test(t)) return { kind: 'minor-technical', charged: [0] };
  if (/double technical/i.test(t)) return { kind: 'double-technical', charged: [0, 1] };
  if (/technical/i.test(t)) return { kind: /flop/i.test(t) ? 'flopping-technical' : 'technical', charged: [0] };
  if (/flagrant foul type 2/i.test(t)) return { kind: 'flagrant-2', charged: [0] };
  if (/flagrant foul/i.test(t)) return { kind: 'flagrant-1', charged: [0] };
  if (/ejection/i.test(t) || /\bejected\b/i.test(text)) return { kind: 'ejection', charged: [0] };
  return null;
}

// What kind of shot a scoring play was — from ESPN's play type, never guessed by the writer.
export function shotType(type = '', text = '', value = 0) {
  const t = `${type} ${text}`;
  if (/free throw/i.test(type)) return /technical/i.test(type) ? 'technical-free-throw' : /flagrant/i.test(type) ? 'flagrant-free-throw' : 'free-throw';
  if (Number(value) === 3 || /three point/i.test(text)) return 'three';
  if (/dunk/i.test(t)) return 'dunk';
  if (/layup|finger roll|tip shot|putback/i.test(t)) return 'layup';
  if (/hook/i.test(t)) return 'hook';
  if (/float/i.test(t)) return 'floater';
  if (/jump ?shot|jumper|fade/i.test(t)) return 'jumper';
  return 'field-goal';
}
export const isFreeThrow = (shot) => /free-throw/.test(shot || '');

// What a scoring play did to the score, for the side that scored. Deterministic labels:
//   tying     trailing before, level after          go-ahead  level or trailing before, leading after
//   extends   leading before, leading by more after  cuts      trailing before, still trailing after
export function classifyPlay(before, after, side) {
  const o = side === 'home' ? 'away' : 'home';
  const b = before[side] - before[o];
  const a = after[side] - after[o];
  if (a === 0 && b < 0) return 'tying';
  if (b <= 0 && a > 0) return 'go-ahead';
  if (b > 0 && a > b) return 'extends';
  if (a < 0 && a > b) return 'cuts';
  return 'other';
}
