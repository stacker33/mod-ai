// Sport5 Hebrew formatting, done in code so the model never decides an order itself.
// The orders below are the editor's rules (2026-11-03); each context has exactly one function.
//
//   final result ("ניצחון 129:136", "הפסד 124:103")   subject's score LAST   -> pair()
//   partial scores: quarter, halftime, after three     subject's score FIRST  -> partialPair()
//     ("טורונטו ניצחה את הרבע הרביעי 47:27")
//   in-game moments and runs ("שלשה שקבעה 129:135", "ריצת 0:17")  subject LAST, as in Sport5 copy -> pair()
//   record in parentheses after a team name           WINS:LOSSES   ("ממפיס (6:1)")      -> formatRecord(..., 'standalone')
//   record after "עלה/עלתה/ירד/ירדה למאזן"            LOSSES:WINS   ("עלתה למאזן 1:6")   -> formatRecord(..., 'relative')

export const pair = (subject, other) => `${other}:${subject}`;
export const partialPair = (subject, other) => `${subject}:${other}`;

// "6-1" (ESPN) -> {wins: 6, losses: 1}
export function parseRecord(rec) {
  const m = String(rec || '').match(/^(\d+)-(\d+)$/);
  return m ? { wins: Number(m[1]), losses: Number(m[2]) } : null;
}

export function formatRecord(wins, losses, context) {
  if (context === 'standalone') return `${wins}:${losses}`;
  if (context === 'relative') return `${losses}:${wins}`;
  throw new Error(`formatRecord: context must be 'standalone' or 'relative', got ${context}`);
}

// everything the writer may say about a team's record, already in the right order for each context
export function recordForms(rec, won, female = true) {
  const r = parseRecord(rec);
  if (!r) return null;
  const verb = won ? (female ? 'עלתה' : 'עלו') : (female ? 'ירדה' : 'ירדו');
  return {
    wins: r.wins,
    losses: r.losses,
    standalone: formatRecord(r.wins, r.losses, 'standalone'),
    relative: formatRecord(r.wins, r.losses, 'relative'),
    in_parentheses: `(${formatRecord(r.wins, r.losses, 'standalone')})`,
    phrase: `${verb} למאזן ${formatRecord(r.wins, r.losses, 'relative')}`,
  };
}

export const PERIOD_HE = (p, final) => {
  if (p > 4) return p === 5 ? 'ההארכה' : `ההארכה ה-${p - 4}`;
  if (p === final && p === 4) return 'הרבע האחרון';
  return ['', 'הרבע הראשון', 'הרבע השני', 'הרבע השלישי', 'הרבע הרביעי'][p];
};

// a moment in the game, in Sport5 wording
export function whenHe(periodNumber, clock, finalPeriod) {
  if (periodNumber === finalPeriod) {
    const cs = clock.includes(':') ? null : Number(clock);
    if (cs != null) return `${clock} שניות לסיום`;
    return `${clock} דקות לסיום${periodNumber > 4 ? ' ההארכה' : ''}`;
  }
  return `${PERIOD_HE(periodNumber, finalPeriod)} (${clock} לסיומו)`;
}
export const periodNumber = (name) => (name.startsWith('OT') ? 4 + Number(name.slice(2)) : Number(name.slice(1)));

const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
// a game's US-Eastern date -> the Israeli night it was played in: "בין שני לשלישי"
export function nightHe(iso) {
  const et = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date(iso));
  const d = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(et);
  return `בין ${HE_DAYS[d]} ל${HE_DAYS[(d + 1) % 7]}`;
}

const shot = (x, what) => (x && x[1] > 0 ? `${x[0]} מ-${x[1]} ${what}` : null);
const pm = (n) => (n > 0 ? `${n}+` : n < 0 ? `${-n}-` : '0');
const one = (n, single, plural) => (n === 1 ? single : `${n} ${plural}`);

// the full line Sport5 uses for Avdija
export function fullLineHe(p) {
  const shots = [shot(p.fg, 'מהשדה'), shot(p.tp, 'משלוש'), shot(p.ft, 'מהעונשין')].filter(Boolean).join(', ');
  const parts = [`${p.pts} נקודות${shots ? ` (${shots})` : ''}`, `${p.reb} ריבאונדים`, `${p.ast} אסיסטים (${p.to} איבודים)`];
  if (p.stl) parts.push(one(p.stl, 'חטיפה', 'חטיפות'));
  if (p.blk) parts.push(one(p.blk, 'חסימה', 'חסימות'));
  const last = parts.pop();
  return `${parts.join(', ')}${parts.length ? ', ' : ''}${last} ומדד פלוס מינוס ${pm(p.plusMinus)} ב-${p.min} דקות`;
}

// the short line used in roundups: points plus the stats that matter
export function shortLineHe(p) {
  const bits = [`${p.pts} נקודות`];
  if (p.reb >= 6) bits.push(`${p.reb} ריבאונדים`);
  if (p.ast >= 5) bits.push(`${p.ast} אסיסטים`);
  if (p.stl >= 3) bits.push(`${p.stl} חטיפות`);
  if (p.blk >= 3) bits.push(`${p.blk} חסימות`);
  const last = bits.pop();
  return bits.length ? `${bits.join(', ')} ו-${last}` : last;
}

// who did what: the named player is the one who COMMITTED the foul / got the technical
export const KIND_HE = {
  technical: 'נשרקה לחובתו עבירה טכנית', 'flopping technical': 'נשרקה לחובתו עבירה טכנית על פלופינג (העמדת פנים)', 'double technical': 'עבירה טכנית כפולה (לו ולשחקן יריב בו זמנית)',
  'flagrant 1': 'ביצע עבירה פלגרנטית', 'flagrant 2': 'ביצע עבירה פלגרנטית 2 והורחק', ejection: 'הורחק מהמשחק',
  'challenge won': 'אתגר מאמן שהצליח', 'challenge lost': 'אתגר מאמן שנכשל', 'end-of-period buzzer basket': 'קלע סל עם הבאזר בסיום רבע',
};
