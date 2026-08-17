#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════
   TEN 10 — copy pass.
   Rewrites the Hebrew wording inside App.js in place.

   Run it from the project folder:
       node ten10-copy.js
   or point it at the file:
       node ten10-copy.js .\App.js

   Writes App.js.bak first. Nothing is saved unless every single
   replacement found its target, so a half-patched file is not a
   state this script can leave you in.
   ═══════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const file = path.resolve(process.argv[2] || 'App.js');
const force = process.argv.includes('--force');

if (!fs.existsSync(file)) {
  console.error('לא נמצא קובץ: ' + file);
  process.exit(1);
}

let src = fs.readFileSync(file, 'utf8');

const EDITS = [
  {
    "label": "שם ערוץ ההתראות → TEN 10",
    "old": "    name: 'תזכורות אימון',",
    "new": "    name: 'TEN 10',"
  },
  {
    "label": "נוסח בדיקת ההתראות",
    "old": "      body: 'ההתראות עובדות. אפשר להדליק את התזכורות היומיות.',",
    "new": "      body: 'ההתראות עובדות. מכאן זה רץ לבד.',"
  },
  {
    "label": "גוף ההתראות היומיות — בלי \"אל תשכח\"",
    "old": "  const fixed = [\n    ['lunch', 13, 30, 'ארוחת צהריים', w('זמן לאכול חלבון. אל תשכח לסמן באפליקציה.', 'זמן לאכול חלבון. אל תשכחי לסמן באפליקציה.')],\n    ['dinner', 20, 30, 'ארוחת ערב', w('הדלק לרקומפוזיציה. אל תדלג.', 'הדלק לרקומפוזיציה. אל תדלגי.')],\n    ['sleep', 23, 15, 'לכבות מסכים', 'שבע שעות שינה זה מה שמחזיק את כל השאר.'],\n  ];\n  const waterBody = w('אל תשכח לעדכן כמה כוסות שתית עד עכשיו.', 'אל תשכחי לעדכן כמה כוסות שתית עד עכשיו.');",
    "new": "  /* Nobody has ever drunk a glass of water because a phone said \"אל\n     תשכח\". A line that states a fact and leaves is read as information;\n     a line that nags is read as a chore, and a chore gets swiped off the\n     lock screen without being read at all. None of these need a gendered\n     form either — nothing here is addressed to the person, it is said\n     about the day. */\n  const fixed = [\n    ['lunch', 13, 30, 'צהריים', 'חלבון עכשיו, לא בערב.'],\n    ['dinner', 20, 30, 'ארוחת ערב', 'השריר נבנה בלילה. מהחומר הזה.'],\n    ['sleep', 23, 15, 'מסכים כבים', 'שבע שעות. כל השאר תלוי בהן.'],\n  ];\n  const waterBody = 'עוד כוס. הגוף לא מתלונן, הוא פשוט מאט.';"
  },
  {
    "label": "גוף התראת האימון",
    "old": "    await book(when, 'עשר דקות. עכשיו.', 'האימון של היום מחכה לך באפליקציה.');",
    "new": "    await book(when, 'עשר דקות. עכשיו.', 'עשר דקות וזה מאחוריך.');"
  },
  {
    "label": "הוספת nHe — ספירה בעברית (1 → \"אימון אחד\")",
    "old": "const w = (m, f) => (isF() ? f : m);",
    "new": "const w = (m, f) => (isF() ? f : m);\n/* Hebrew does not survive `${n} אימונים`. At one it comes out \"עוד 1\n   אימונים\", which is exactly the sentence nobody proofread — and it is\n   the sentence that shows on the day it matters most, when there is one\n   thing left. nHe(1, 'אימון', 'אימונים') → \"אימון אחד\". */\nconst nHe = (count, one, many, fem) =>\n  (count === 1 ? `${one} ${fem ? 'אחת' : 'אחד'}` : `${count} ${many}`);"
  },
  {
    "label": "מילות השבח — מ\"אלוף/תותח/גיבור\" לניסוח יבש",
    "old": "const PRAISE_M = ['אלוף', 'תותח', 'גיבור'];\nconst PRAISE_F = ['אלופה', 'מלכה', 'גיבורה'];\n/* One time in seven the word is one you have barely seen. A reward that\n   is always the same stops registering; a reward you cannot predict\n   keeps its pull long after the novelty of the first one is gone. */\nconst RARE_M = ['מפלצת', 'בלתי נעצר', 'חיה', 'ברזל'];\nconst RARE_F = ['מפלצת', 'בלתי נעצרת', 'חיה', 'ברזל'];\nconst praise = () => (isF() ? PRAISE_F : PRAISE_M);\nconst praiseWord = () => {\n  const pool = Math.random() < 0.14 ? (isF() ? RARE_F : RARE_M) : praise();\n  return pool[Math.floor(Math.random() * pool.length)];\n};\nconst ultraWord = () => (isF() ? 'אשת חייל' : 'גבר על');",
    "new": "/* \"אלוף\" is what an uncle says at a bar mitzvah. A word that simply\n   states what happened — it is in, it is logged, that is one more —\n   is the one still believed on the fortieth day, because it cannot be\n   caught lying. Most of these describe the task rather than the person,\n   which is also why they read the same in both skins. */\nconst PRAISE_M = ['בפנים', 'נרשם', 'עוד אחד'];\nconst PRAISE_F = ['בפנים', 'נרשם', 'עוד אחת'];\n/* One time in seven the word is one you have barely seen. A reward that\n   is always the same stops registering; a reward you cannot predict\n   keeps its pull long after the novelty of the first one is gone. */\nconst RARE_M = ['ברזל', 'קר רוח', 'בלי רעש', 'חיה'];\nconst RARE_F = ['ברזל', 'קרת רוח', 'בלי רעש', 'חיה'];\nconst praise = () => (isF() ? PRAISE_F : PRAISE_M);\n/* Never the same word twice running. With three common words a repeat\n   lands one time in three on chance alone, and a reward you have just\n   seen is not a reward — it is wallpaper. */\nlet lastPraise = null;\nconst praiseWord = () => {\n  const pool = Math.random() < 0.14 ? (isF() ? RARE_F : RARE_M) : praise();\n  const fresh = pool.filter((x) => x !== lastPraise);\n  const from = fresh.length ? fresh : pool;\n  lastPraise = from[Math.floor(Math.random() * from.length)];\n  return lastPraise;\n};\n/* Said as a noun so it drops into a sentence in either skin:\n   \"מה שחסר ליום מושלם\", \"ואז יום מושלם\". */\nconst ultraWord = () => 'יום מושלם';\n/* The headline on the four-out-of-four screen. One word, struck like a\n   stamp — the line above it already says what happened. */\nconst ULTRA_WORD = 'נסגר';"
  },
  {
    "label": "הכיתוב מתחת לפעמון כשאין משימות פתוחות",
    "old": "/* Stable for the whole day, varied from one day to the next. \"גבריות\"\n   occupies one slot out of twenty, so it stays a genuinely rare reward\n   rather than becoming another label the eye stops seeing. */",
    "new": "/* Stable for the whole day, varied from one day to the next. \"מושלם\"\n   occupies one slot out of twenty, so it stays a genuinely rare reward\n   rather than becoming another label the eye stops seeing. Short words\n   only: this sits beside the streak in a header that has a date and a\n   title to fit as well. */"
  },
  {
    "label": "רשימת המילים של הפעמון",
    "old": "  const words = [\n    'מצויין', 'מעולה', 'אליפות', 'מצויין', 'מעולה',\n    'אליפות', 'מצויין', 'מעולה', 'אליפות', 'מצויין',\n    'מעולה', 'אליפות', 'מצויין', 'מעולה', 'אליפות',\n    'מצויין', 'מעולה', 'אליפות', 'מצויין', 'גבריות',\n  ];",
    "new": "  const words = [\n    'סגור', 'נקי', 'שקט', 'סגור', 'נקי',\n    'שקט', 'סגור', 'נקי', 'שקט', 'סגור',\n    'נקי', 'שקט', 'סגור', 'נקי', 'שקט',\n    'סגור', 'נקי', 'שקט', 'סגור', 'מושלם',\n  ];"
  },
  {
    "label": "סיבות החוסר — סטטוס במקום אצבע מאשימה",
    "old": "function taskState(s) {\n  const sleep = parseFloat(s.sleep) || 0;\n  const why = [\n    'לא סיימת את האימון של היום',\n    `חסרות ${Math.max(0, TARGETS.water - (s.water || 0))} כוסות מים`,\n    `ישנת ${sleep || 0} שעות במקום ${TARGETS.sleep}`,\n    'לא סימנת את שלוש הארוחות',\n  ];",
    "new": "function taskState(s) {\n  const sleep = parseFloat(s.sleep) || 0;\n  const meals = s.meals || {};\n  const glasses = Math.max(0, TARGETS.water - (s.water || 0));\n  const mealsLeft = MEAL_KEYS.filter((k) => !meals[k]).length;\n  /* Every one of these is a status, not an accusation. \"לא סיימת\" is a\n     finger pointed at you and gets closed; \"עוד פתוח\" is a fact about\n     the day, and a fact is the only one of the two anyone acts on. */\n  const why = [\n    'האימון של היום עוד פתוח',\n    glasses === 1 ? 'נשארה עוד כוס מים' : `נשארו ${glasses} כוסות מים`,\n    sleep ? `${sleep} שעות שינה מתוך ${TARGETS.sleep}` : 'שעות השינה עוד לא סומנו',\n    mealsLeft === 1 ? 'ארוחה אחת עוד לא סומנה' : `${mealsLeft} ארוחות עוד לא סומנו`,\n  ];"
  },
  {
    "label": "כותרת מסך ארבע-מתוך-ארבע",
    "old": "        word: done === total ? ultraWord() : praiseWord(),",
    "new": "        word: done === total ? ULTRA_WORD : praiseWord(),"
  },
  {
    "label": "הכיתוב מעל רשימת החוסרים",
    "old": "              עוד לא {ultraWord()} כי",
    "new": "              מה שחסר ל{ultraWord()}"
  },
  {
    "label": "שורת הסיום בסיכום היום",
    "old": "                {doneCount === rows.length\n                  ? `ארבע מתוך ארבע. זה ${ultraWord()}.`\n                  : `עוד ${rows.length - doneCount} כדי להגיע ל${ultraWord()} היום.`}",
    "new": "                {doneCount === rows.length\n                  ? 'ארבע מתוך ארבע. היום נסגר מושלם.'\n                  : `עוד ${nHe(rows.length - doneCount, 'משימה', 'משימות', true)} ל${ultraWord()}.`}"
  },
  {
    "label": "שורת \"ימים מושלמים\" בסיכום השבוע",
    "old": "            [`ימי ${ultraWord()}`, String(perfect), perfect > 0],",
    "new": "            ['ימים מושלמים', String(perfect), perfect > 0],"
  },
  {
    "label": "הסבר העמודות בסיכום השבוע",
    "old": "            העמודות מתמלאות יום אחרי יום. אחרי כמה ימים תראה כאן איפה השבוע נשבר\n            ואיפה הוא החזיק.",
    "new": "            העמודות מתמלאות יום אחרי יום. עוד כמה ימים ורואים כאן איפה השבוע\n            נשבר ואיפה הוא החזיק."
  },
  {
    "label": "כותרות כרטיסי התזכורת",
    "old": "const REMINDER_CARDS = [\n  { id: 'lunch', hour: 13, minute: 30, title: 'ארוחת צהריים', icon: 'restaurant-outline' },\n  { id: 'workout', hour: 18, minute: 30, title: 'עשר דקות. עכשיו.', icon: 'barbell-outline' },\n  { id: 'dinner', hour: 20, minute: 30, title: 'ארוחת ערב', icon: 'moon-outline' },\n  { id: 'sleep', hour: 23, minute: 15, title: 'לכבות מסכים', icon: 'bed-outline' },\n];",
    "new": "const REMINDER_CARDS = [\n  { id: 'lunch', hour: 13, minute: 30, title: 'צהריים', icon: 'restaurant-outline' },\n  { id: 'workout', hour: 18, minute: 30, title: 'עשר דקות. עכשיו.', icon: 'barbell-outline' },\n  { id: 'dinner', hour: 20, minute: 30, title: 'ארוחת ערב', icon: 'moon-outline' },\n  { id: 'sleep', hour: 23, minute: 15, title: 'מסכים כבים', icon: 'bed-outline' },\n];"
  },
  {
    "label": "שורת הגוף בכרטיסי התזכורת",
    "old": "  const copy = {\n    water: w('עדכן כמה כוסות שתית', 'עדכני כמה כוסות שתית'),\n    lunch: 'זמן לחלבון',\n    workout: 'האימון של היום מחכה',\n    dinner: 'הדלק לרקומפוזיציה',\n    sleep: 'שבע שעות מחזיקות את כל השאר',\n  };",
    "new": "  const copy = {\n    water: 'עוד כוס. הגוף מאט בלעדיה',\n    lunch: 'חלבון עכשיו, לא בערב',\n    workout: 'עשר דקות וזה מאחוריך',\n    dinner: 'השריר נבנה בלילה',\n    sleep: 'שבע שעות. כל השאר תלוי בהן',\n  };"
  },
  {
    "label": "תווית סיכום המים",
    "old": "  const score = state.water <= 5\n    ? { label: 'אפשר יותר', color: T.copper }\n    : state.water <= 7\n    ? { label: 'כמעט', color: T.gold }\n    : { label: 'מצוין', color: T.emerald };",
    "new": "  const score = state.water <= 5\n    ? { label: 'רחוק מהיעד', color: T.copper }\n    : state.water <= 7\n    ? { label: 'כמעט', color: T.gold }\n    : { label: 'סגור', color: T.emerald };"
  },
  {
    "label": "תווית כרטיס השינה",
    "old": "              {hit ? 'ביעד' : 'אפשר יותר'}",
    "new": "              {hit ? 'ביעד' : 'קצר מדי'}"
  },
  {
    "label": "הערת השינה הקצרה — סיבה במקום עידוד",
    "old": "              אפשר לשפר את השינה הלילה. עוד שעה אחת יכולה לשפר את האנרגיה, ההתאוששות והאימון הבא.",
    "new": "              פחות משש שעות. האימון הבא ירגיש כבד יותר, וזה לא מקרי —\n              ההתאוששות קורית בשינה, לא באימון."
  },
  {
    "label": "שורת הדרגה והרצף",
    "old": "          {atRisk\n            ? `הרצף שלך נגמר בחצות. נשארו ${hoursLeft} שעות.`\n            : rank.next\n            ? `${rank.name} · עוד ${rank.left} אימונים ל${rank.next}`\n            : `${rank.name} · הדרגה הגבוהה ביותר`}",
    "new": "          {atRisk\n            ? `הרצף נגמר בחצות. ${hoursLeft === 1 ? 'נשארה שעה אחת' : `נשארו ${hoursLeft} שעות`}.`\n            : rank.next\n            ? `${rank.name} · עוד ${nHe(rank.left, 'אימון', 'אימונים')} ל${rank.next}`\n            : `${rank.name} · אין דרגה מעל זו`}"
  },
  {
    "label": "כרטיס יום ללא אימון",
    "old": "              הכרטיס הזה מסונכרן עם התכנון. שבץ A · B · C · D ליום הזה כדי להתחיל.",
    "new": "              היום ריק בתכנון. {w('שבץ', 'שבצי')} A · B · C · D על התאריך הזה,\n              והכרטיס יתמלא מעצמו."
  },
  {
    "label": "אזהרת חריגה מעשר הדקות",
    "old": "          {w('עברת את עשר הדקות. סיים את הסבב הנוכחי ועצור.', 'עברת את עשר הדקות. סיימי את הסבב הנוכחי ועצרי.')}",
    "new": "          {w('עברת את עשר הדקות. תסגור את הסבב הזה וזהו.', 'עברת את עשר הדקות. תסגרי את הסבב הזה וזהו.')}"
  },
  {
    "label": "כלל הסט בתוך האימון",
    "old": "              {w('כל סט נגמר ב־0 עד 1 חזרות מהכשל. אם עצרת כי נמאס לך — הסט לא נספר.', 'כל סט נגמר ב־0 עד 1 חזרות מהכשל. אם עצרת כי נמאס לך — הסט לא נספר.')}",
    "new": "              {'הסט נגמר חזרה אחת לפני הכשל, לא רגע אחרי שנמאס. נמאס זה לא כשל.'}"
  },
  {
    "label": "שורת יעד האימונים בתכנון",
    "old": "            {plannedCount > WEEK_TARGET\n              ? 'יותר מארבעה אימונים בלי יותר שינה לא מייצרים יותר שריר.'\n              : plannedCount >= WEEK_TARGET\n              ? 'השבוע מסודר. ארבעה אימונים משובצים.'\n              : `נשאר לשבץ עוד ${WEEK_TARGET - plannedCount} אימונים השבוע.`}",
    "new": "            {plannedCount > WEEK_TARGET\n              ? 'מעל ארבעה אימונים בלי עוד שינה זה לא עוד שריר. זו עוד עייפות.'\n              : plannedCount >= WEEK_TARGET\n              ? 'השבוע סגור. ארבעה אימונים על הלוח.'\n              : `נשאר לשבץ עוד ${nHe(WEEK_TARGET - plannedCount, 'אימון', 'אימונים')} השבוע.`}"
  },
  {
    "label": "שורת יום מנוחה בכרטיס התכנון",
    "old": "                      מנוחה · נווט מהכפתור משמאל",
    "new": "                      מנוחה · הכפתור משמאל משבץ אימון"
  },
  {
    "label": "מסך שבוע ריק בתכנון",
    "old": "              הימים שעברו יורדים מכאן. הנתונים נשארים בסיכום השבועי, והכרטיסים יחזרו בשבוע הבא.",
    "new": "              הימים שעברו יורדים מהלוח. המספרים נשארים בסיכום השבועי,\n              והכרטיסים חוזרים בשבוע הבא."
  },
  {
    "label": "מסך תזונה בלי ארוחות פתוחות",
    "old": "              אין ארוחות פתוחות כרגע. מה שסומן או ששעת הארוחה עברה יחזור מחר.",
    "new": "              אין ארוחות פתוחות. מה שסומן, ומה שהשעה שלו עברה, חוזר מחר."
  }
];

let done = 0;
const missed = [];

for (const e of EDITS) {
  const hits = src.split(e.old).length - 1;
  if (hits === 1) {
    src = src.replace(e.old, () => e.new);
    console.log('  ✓  ' + e.label);
    done++;
  } else if (hits === 0) {
    console.log('  ✗  ' + e.label + '   (לא נמצא — כנראה כבר שונה)');
    missed.push(e.label);
  } else {
    console.log('  ✗  ' + e.label + '   (' + hits + ' התאמות — מדלג)');
    missed.push(e.label);
  }
}

console.log('');
console.log(done + ' מתוך ' + EDITS.length + ' שינויים הוחלו.');

if (missed.length && !force) {
  console.log('');
  console.log('לא נשמר כלום. שלח לי את השמות שלמעלה עם ה־✗ ואתאים אותם לקובץ שלך.');
  console.log('(להחיל בכל זאת רק את מה שנמצא: node ' + path.basename(process.argv[1]) + ' --force)');
  process.exit(2);
}

fs.writeFileSync(file + '.bak', fs.readFileSync(file));
fs.writeFileSync(file, src, 'utf8');
console.log('גיבוי: ' + path.basename(file) + '.bak');
console.log('נשמר: ' + path.basename(file));
