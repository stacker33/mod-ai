// Sport5 Hebrew formatting, done in code so the model never has to order numbers itself.
//
// Right-to-left score rule (see style/STYLE.md): in prose the subject's score is written LAST in the
// string, so it displays first — "ניצחון 129:136" (subject 136), "הפסד 124:103" (subject 103).
// Heading lines: "home (rec) - away (rec) away:home". Records: "(losses:wins)".

export const pair = (subject, other) => `${other}:${subject}`;

export function recordHe(rec) {
  const m = String(rec || '').match(/^(\d+)-(\d+)$/);
  return m ? `(${m[2]}:${m[1]})` : '';
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
