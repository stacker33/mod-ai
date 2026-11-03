// Hebrew team names as Sport5 writes them: [full, short]. Keys are ESPN abbreviations (plus NBA variants).
const TEAMS = {
  ATL: ['אטלנטה', 'אטלנטה'], BOS: ['בוסטון', 'בוסטון'], BKN: ['ברוקלין', 'ברוקלין'], CHA: ['שארלוט', 'שארלוט'],
  CHI: ['שיקגו', 'שיקגו'], CLE: ['קליבלנד', 'קליבלנד'], DAL: ['דאלאס', 'דאלאס'], DEN: ['דנבר', 'דנבר'],
  DET: ['דטרויט', 'דטרויט'], GS: ['גולדן סטייט', 'גולדן סטייט'], GSW: ['גולדן סטייט', 'גולדן סטייט'], HOU: ['יוסטון', 'יוסטון'],
  IND: ['אינדיאנה', 'אינדיאנה'], LAC: ["לוס אנג'לס קליפרס", 'הקליפרס'], LAL: ["לוס אנג'לס לייקרס", 'הלייקרס'],
  MEM: ['ממפיס', 'ממפיס'], MIA: ['מיאמי', 'מיאמי'], MIL: ['מילווקי', 'מילווקי'], MIN: ['מינסוטה', 'מינסוטה'],
  NO: ['ניו אורלינס', 'ניו אורלינס'], NOP: ['ניו אורלינס', 'ניו אורלינס'], NY: ['ניו יורק', 'הניקס'], NYK: ['ניו יורק', 'הניקס'],
  OKC: ['אוקלהומה סיטי', 'אוקלהומה סיטי'], ORL: ['אורלנדו', 'אורלנדו'], PHI: ['פילדלפיה', 'פילדלפיה'], PHX: ['פיניקס', 'פיניקס'],
  POR: ['פורטלנד', 'פורטלנד'], SAC: ['סקרמנטו', 'סקרמנטו'], SA: ['סן אנטוניו', 'סן אנטוניו'], SAS: ['סן אנטוניו', 'סן אנטוניו'],
  TOR: ['טורונטו', 'טורונטו'], UTAH: ['יוטה', 'יוטה'], UTA: ['יוטה', 'יוטה'], WSH: ['וושינגטון', 'וושינגטון'], WAS: ['וושינגטון', 'וושינגטון'],
};

export const heTeam = (abbr, full = false) => (TEAMS[abbr] ? TEAMS[abbr][full ? 0 : 1] : null);

// teams whose short name is a plural nickname ("הקליפרס ניצחו"); every other short name is a city (feminine)
const PLURAL = new Set(['LAC', 'LAL', 'NY', 'NYK']);
export const isPlural = (abbr) => PLURAL.has(abbr);
// the verb form that agrees with the team's short name: v(abbr, 'ניצחה', 'ניצחו')
export const v = (abbr, fem, plural) => (isPlural(abbr) ? plural : fem);
// "ל" + name ("לבוסטון", "לקליפרס")
export const withLamed = (name) => `ל${name.startsWith('ה') ? name.slice(1) : name}`;

// how Sport5 refers to a team besides its name (plural nicknames take plural verbs)
export const NICK_HE = {
  ATL: ['ההוקס'], BOS: ['הסלטיקס', 'הירוקים'], BKN: ['הנטס'], CHA: ['ההורנטס'], CHI: ['הבולס'], CLE: ['הקאבס', 'הקאבלירס'],
  DAL: ['המאבס', 'המאבריקס'], DEN: ['הנאגטס'], DET: ['הפיסטונס'], GS: ['הווריורס', 'הווריירס'], GSW: ['הווריורס', 'הווריירס'], HOU: ['הרוקטס'],
  IND: ['הפייסרס'], LAC: ['הקליפרס'], LAL: ['הלייקרס'], MEM: ['הגריזליס'], MIA: ['ההיט'], MIL: ['הבאקס'], MIN: ['הטימברוולבס', 'הזאבים', 'הוולבס'],
  NO: ['הפליקנס'], NOP: ['הפליקנס'], NY: ['הניקס'], NYK: ['הניקס'], OKC: ['הת\'אנדר'], ORL: ['המג\'יק'], PHI: ['הסיקסרס'], PHX: ['הסאנס'],
  POR: ['הבלייזרס', 'הטרייל בלייזרס'], SAC: ['הקינגס'], SA: ['הספרס'], SAS: ['הספרס'], TOR: ['הראפטורס', 'הקנדים'], UTAH: ['הג\'אז'], UTA: ['הג\'אז'],
  WSH: ['הוויזארדס'], WAS: ['הוויזארדס'],
};
