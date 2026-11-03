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
