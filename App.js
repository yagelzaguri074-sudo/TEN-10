import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  StatusBar,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  Platform,
  Dimensions,
  TextInput,
  Animated,
  Easing,
  Alert,
  Vibration,
  I18nManager,
  PanResponder,
  Keyboard,
  AppState,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

/* On a Hebrew-locale phone React Native flips layout automatically, so
   'row-reverse' reverses a SECOND time and words come out backwards.
   ROW_RTL always resolves to "first child on the right". */
const ROW_RTL = I18nManager.isRTL ? 'row' : 'row-reverse';
/* Latin wordmarks must read left to right whatever the phone's locale does. */
const ROW_LTR = I18nManager.isRTL ? 'row-reverse' : 'row';

/* An RTL phone also mirrors absolute left/right, so a child pinned with
   right: 0 comes out on the physical left. EDGE_LEFT / EDGE_RIGHT name the
   style key that lands on the side you actually mean. Minus/plus controls
   keep their universal order (− left, + right) whatever the locale is. */
const MIRRORS_EDGES = I18nManager.isRTL && I18nManager.doLeftAndRightSwapInRTL;
const EDGE_LEFT = MIRRORS_EDGES ? 'right' : 'left';
const EDGE_RIGHT = MIRRORS_EDGES ? 'left' : 'right';

/* Local calendar date. new Date().toISOString() is UTC, so after midnight
   Israel time it returns yesterday and planner keys stop matching the log. */
function localIso(d = new Date()) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];

/** Sunday of the week, shifted by whole weeks. Saturday is never shown. */
function weekStart(offsetWeeks = 0) {
  const x = new Date();
  x.setHours(12, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay() + offsetWeeks * 7);
  return x;
}

/* ═══════════════════════════════════════════════════════════
   NATIVE MODULES — loaded defensively.
   If expo-notifications / expo-device are missing from the build,
   the app must still run. A hard import here kills the app on
   launch with no visible error.
   ═══════════════════════════════════════════════════════════ */
let Notifications = null;
let Device = null;
let NavigationBar = null;
let BlurView = null;
let AsyncStorage = null;
let SafeAreaProvider = null;
let SafeAreaView = null;
let useSafeAreaInsets = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
let NATIVE_ERROR = null;

try {
  Notifications = require('expo-notifications');
} catch (e) {
  NATIVE_ERROR = 'expo-notifications: ' + (e && e.message ? e.message : e);
}
try {
  Device = require('expo-device');
} catch (e) {
  NATIVE_ERROR = (NATIVE_ERROR || '') + ' | expo-device: ' + (e && e.message ? e.message : e);
}
try {
  NavigationBar = require('expo-navigation-bar');
} catch (e) {
  NATIVE_ERROR = (NATIVE_ERROR || '') + ' | expo-navigation-bar: ' + (e && e.message ? e.message : e);
}
try {
  BlurView = require('expo-blur').BlurView;
} catch (e) {
  NATIVE_ERROR = (NATIVE_ERROR || '') + ' | expo-blur: ' + (e && e.message ? e.message : e);
}
try {
  AsyncStorage = require('@react-native-async-storage/async-storage').default;
} catch (e) {
  NATIVE_ERROR = (NATIVE_ERROR || '') + ' | async-storage: ' + (e && e.message ? e.message : e);
}
try {
  const sac = require('react-native-safe-area-context');
  SafeAreaProvider = sac.SafeAreaProvider;
  SafeAreaView = sac.SafeAreaView;
  if (typeof sac.useSafeAreaInsets === 'function') useSafeAreaInsets = sac.useSafeAreaInsets;
} catch (e) {
  NATIVE_ERROR = (NATIVE_ERROR || '') + ' | safe-area-context: ' + (e && e.message ? e.message : e);
  SafeAreaProvider = ({ children }) => children;
  // NOTE: SafeAreaView was removed from react-native core in newer versions,
  // so this can be undefined. Rendering undefined throws "Element type is
  // invalid" and takes the whole app down — fall back to a plain View.
  const rnSafe = require('react-native').SafeAreaView;
  SafeAreaView = rnSafe || require('react-native').View;
}

// Last line of defence: never render an undefined component.
if (!SafeAreaView) SafeAreaView = require('react-native').View;
if (!SafeAreaProvider) SafeAreaProvider = ({ children }) => children;


/* Hide both system bars before the first frame. Android deliberately
   reveals them after an edge swipe, keyboard or system dialog, so the
   AppInner effect re-asserts this whenever the app becomes interactive
   again. Every call is feature-detected for SDK 54/57 compatibility. */
function hideSystemUI() {
  try {
    StatusBar.setHidden(true, 'none');
  } catch (e) {
    /* web and some host shells do not expose an imperative status bar */
  }
  if (!NavigationBar || Platform.OS !== 'android') return;
  try {
    if (NavigationBar.setHidden) NavigationBar.setHidden(true);
    else if (NavigationBar.setVisibilityAsync) NavigationBar.setVisibilityAsync('hidden').catch(() => {});
    if (NavigationBar.setBehaviorAsync) NavigationBar.setBehaviorAsync('overlay-swipe').catch(() => {});
    if (NavigationBar.setPositionAsync) NavigationBar.setPositionAsync('absolute').catch(() => {});
  } catch (e) {
    /* edge-to-edge builds may refuse this; never fatal */
  }
}
hideSystemUI();

const NOTIF_OK = !!(Notifications && typeof Notifications.scheduleNotificationAsync === 'function');

if (NOTIF_OK) {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldShowAlert: true,
      }),
    });
  } catch (e) {
    NATIVE_ERROR = String(e && e.message ? e.message : e);
  }
}

const CHANNEL_ID = 'tenmin-training';

async function ensureChannel() {
  if (!NOTIF_OK || Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'TEN 10',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 220, 180, 220],
    lightColor: '#D4B26A',
    sound: 'default',
  });
}

async function requestPermission() {
  if (!NOTIF_OK) return false;
  if (Device && Device.isDevice === false) return false;
  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  if (status !== 'granted') {
    const asked = await Notifications.requestPermissionsAsync();
    status = asked.status;
  }
  return status === 'granted';
}

async function fireTestReminder() {
  if (!NOTIF_OK) throw new Error('expo-notifications לא קיים בבילד הזה');
  await ensureChannel();
  return Notifications.scheduleNotificationAsync({
    content: {
      title: 'בדיקת התראות',
      body: 'ההתראות עובדות. מכאן זה רץ לבד.',
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 3,
      channelId: CHANNEL_ID,
    },
  });
}

const WORKOUT_HOUR = 18;
const WORKOUT_MIN = 30;

/* Water is nudged on every round hour, but only while you are awake. */
const WATER_FROM = 9;
const WATER_TO = 21;

/* Everything is booked date by date rather than as a repeating daily
   alarm, because a repeating alarm cannot be told to sit out a single
   day — and sitting out the days you have already finished is the whole
   point. The cost is that the queue has to be rebuilt periodically, so
   it only runs a few days ahead: iOS keeps at most 64 pending
   notifications per app and silently drops the rest. */
const REMINDER_HORIZON = 3;

/** true when this slot is still worth firing on the given day */
function slotStillOpen(id, state, isToday) {
  if (!state || !isToday) return true;
  /* Future days are always open — the day has not happened yet. Only
     today's queue is filtered against what you have already done. */
  if (id === 'water') return state.water < TARGETS.water;
  return reminderOpen(id, state);
}

let scheduleGen = 0;

async function scheduleDailyReminders(hiddenDays = {}, plan = {}, state = null) {
  if (!NOTIF_OK) throw new Error('expo-notifications לא קיים בבילד הזה');
  /* Each rebuild cancels everything and then adds. Without a generation
     stamp two rebuilds can cancel, then both add — and you get two of
     every reminder. Anything that is not the latest rebuild aborts. */
  const gen = ++scheduleGen;
  await ensureChannel();
  if (gen !== scheduleGen) return;
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (gen !== scheduleGen) return;

  const now = new Date();
  const today = localIso();

  const book = async (when, title, body) => {
    if (gen !== scheduleGen) return false;
    const id = await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: 'default' },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: when,
        channelId: CHANNEL_ID,
      },
    });
    /* A newer rebuild may have cancelled the queue while this native
       scheduling call was in flight. Remove the late result explicitly
       so two overlapping rebuilds can never leave duplicate reminders. */
    if (gen !== scheduleGen) {
      if (id && Notifications.cancelScheduledNotificationAsync) {
        await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
      }
      return false;
    }
    return true;
  };

  /* Nobody has ever drunk a glass of water because a phone said "אל
     תשכח". A line that states a fact and leaves is read as information;
     a line that nags is read as a chore, and a chore gets swiped off the
     lock screen without being read at all. None of these need a gendered
     form either — nothing here is addressed to the person, it is said
     about the day. */
  const fixed = [
    ['lunch', 13, 30, 'צהריים', 'חלבון עכשיו, לא בערב.'],
    ['dinner', 20, 30, 'ארוחת ערב', 'השריר נבנה בלילה. מהחומר הזה.'],
    ['sleep', 23, 15, 'מסכים כבים', 'שבע שעות. כל השאר תלוי בהן.'],
  ];
  const waterBody = 'עוד כוס. הגוף לא מתלונן, הוא פשוט מאט.';

  for (let i = 0; i < REMINDER_HORIZON; i++) {
    if (gen !== scheduleGen) return;
    const day = new Date();
    day.setDate(now.getDate() + i);
    const iso = localIso(day);
    const isToday = iso === today;

    for (let hour = WATER_FROM; hour <= WATER_TO; hour++) {
      if (gen !== scheduleGen) return;
      const when = new Date(day);
      when.setHours(hour, 0, 0, 0);
      if (when <= now) continue;
      if (!slotStillOpen('water', state, isToday)) continue;
      if (!(await book(when, 'זמן למים', waterBody))) return;
    }

    for (const [id, hour, minute, title, body] of fixed) {
      if (gen !== scheduleGen) return;
      const when = new Date(day);
      when.setHours(hour, minute, 0, 0);
      if (when <= now) continue;
      if (!slotStillOpen(id, state, isToday)) continue;
      if (!(await book(when, title, body))) return;
    }

    const when = new Date(day);
    when.setHours(WORKOUT_HOUR, WORKOUT_MIN, 0, 0);
    if (when <= now) continue;
    if (when.getDay() === 6) continue;        // Saturday
    if (hiddenDays[iso]) continue;            // a day you removed
    if (!plan[iso]) continue;                 // rest / unassigned day
    if (!slotStillOpen('workout', state, isToday)) continue;
    if (!(await book(when, 'עשר דקות. עכשיו.', 'עשר דקות וזה מאחוריך.'))) return;
  }
}

/* ═══════════════════════════════════════════════════════════
   FEEDBACK — haptics only. Deliberately no audio library.

   expo-av is deprecated and is a prime suspect for release-build
   crashes on the new React Native architecture. Vibration ships
   inside React Native itself: no native module, no asset, no
   network, no permission surprises. It also works with the phone
   face-down on the floor mid-pushup, which audio on silent does not.

   Timing: silence for most of the rest, ticks in the last 5s,
   stronger pulses for the final 3. That is what tells the body
   "get up" without looking at the screen.
   ═══════════════════════════════════════════════════════════ */
function safeVibrate(pattern) {
  try {
    Vibration.vibrate(pattern);
  } catch (e) {
    /* feedback must never break the timer */
  }
}

function buzzTick() {
  safeVibrate(35);
}
function buzzFinal() {
  safeVibrate(70);
}
function buzzRoundEnd() {
  safeVibrate([0, 120, 90, 120]);
}
function buzzWorkoutDone() {
  safeVibrate([0, 90, 70, 90, 70, 260]);
}

/* ═══════════════════════════════════════════════════════════
   DESIGN TOKENS — Obsidian / Midnight + Champagne Gold
   ═══════════════════════════════════════════════════════════ */
const T = {
  bg: '#080B10',
  /* A card is a surface, not a pane of glass. At four per cent white on
     a near-black page there was nothing to see: the text floated and
     the eye had no edge to hold on to. The surface is opaque now and
     every tint washes over it, so a card reads as a card first. */
  card: '#161C26',
  glass: '#161C26',
  hairline: 'rgba(255,255,255,0.14)',
  hairlineSoft: 'rgba(255,255,255,0.08)',
  gold: '#D4B26A',
  goldSoft: 'rgba(212,178,106,0.16)',
  goldEdge: 'rgba(212,178,106,0.32)',
  emerald: '#3FA98A',
  copper: '#C2764A',
  rosewood: '#9A5B4C',
  sage: '#A8BE7E',
  crimson: '#D45C4B',
  text: '#F2EFE8',
  textDim: '#A9B0BB',
  /* the quiet tone still has to be readable on a card, and at #5C636E
     it was under three to one against the new surface */
  textFaint: '#7C8492',
};

/* ═══════════════════════════════════════════════════════════
   PALETTES & VOICE
   The interface has two skins. T is mutated in place so every
   component picks the new colours up on the next render.
   ═══════════════════════════════════════════════════════════ */
const PALETTE_M = {
  bg: '#080B10',
  card: '#161C26',
  glass: '#161C26',
  gold: '#D4B26A',
  goldSoft: 'rgba(212,178,106,0.16)',
  goldEdge: 'rgba(212,178,106,0.32)',
  emerald: '#3FA98A',
  copper: '#C2764A',
  rosewood: '#9A5B4C',
  sage: '#A8BE7E',
  crimson: '#D45C4B',
};

const PALETTE_F = {
  bg: '#120A11',
  card: '#241A24',
  glass: '#241A24',
  gold: '#E39BB2',
  goldSoft: 'rgba(227,155,178,0.16)',
  goldEdge: 'rgba(227,155,178,0.34)',
  emerald: '#79C2A4',
  copper: '#D9899B',
  rosewood: '#A86A80',
  sage: '#C9A8D8',
  crimson: '#E0708A',
};

let GENDER = 'm';
const isF = () => GENDER === 'f';
/** pick the right wording: w(male, female) */
const w = (m, f) => (isF() ? f : m);
/* Hebrew does not survive `${n} אימונים`. At one it comes out "עוד 1
   אימונים", which is exactly the sentence nobody proofread — and it is
   the sentence that shows on the day it matters most, when there is one
   thing left. nHe(1, 'אימון', 'אימונים') → "אימון אחד". */
const nHe = (count, one, many, fem) =>
  (count === 1 ? `${one} ${fem ? 'אחת' : 'אחד'}` : `${count} ${many}`);

function applyGender(g) {
  GENDER = g === 'f' ? 'f' : 'm';
  Object.assign(T, isF() ? PALETTE_F : PALETTE_M);
  styles = makeStyles();
}

/* ── name → likely gender ───────────────────────────────────
   Heuristic, not a lookup service. Known names win; otherwise
   Hebrew feminine endings are a decent signal. Anything on the
   ambiguous list, or anything the rules can't call, returns null
   and the app simply asks. */
const NAMES_F = new Set(
  'שרה רבקה רחל לאה מרים אסתר חנה נועה מיה תמר יעל אביגיל אורית גלית סיגל מיכל דנה שירה אדווה הילה עדי ליאת מאיה רוני נטלי ספיר שני אלינור קרן ענבל שקד יובלה אנה מור טליה ליהי אביב הודיה אושרת עינב רותם דניאלה יסמין לינוי אלה נגה אורלי ציפי בת אביבה חוה זהבה סמדר עידית ריקי מלכה שירן אביטל דורית ליאור הדס אמה לירון תהילה נעמי אילנית ורד'.split(' ')
);
const NAMES_M = new Set(
  'יגאל יגאל דוד משה יוסף אברהם יצחק יעקב איתי איתן אורי אלון עומר ניר גיא רון עידן ליאם נועם אריאל דור אסף אלירן יונתן ערן תומר בן אדם מתן ניב עמית שגיא רועי אמיר יאיר גדי חיים אלי מאור עידו אביחי ישי נדב שלום רם אופיר יובל רותם שחר טל אור עדן גל שי אלמוג יגל'.split(' ')
);
/* names used by everyone — never guess these */
const NAMES_ANY = new Set('יובל רותם שחר טל אור עדן גל שי אלמוג נועם ליאור אביב רוני עמית ניב אריאל'.split(' '));

function guessGender(raw) {
  const name = String(raw || '').trim().split(/\s+/)[0];
  if (!name) return null;
  if (NAMES_ANY.has(name)) return null;
  if (NAMES_F.has(name)) return 'f';
  if (NAMES_M.has(name)) return 'm';
  if (/(ית|ילה|אלה|ינה)$/.test(name)) return 'f';
  if (/[הת]$/.test(name)) return 'f';
  return null;
}

const PROFILE_KEY = 'tenmin:profile';

/* The name and gender survive closing the app, swiping it out of the
   recents list, and rebooting the phone. They only disappear when the
   app itself is uninstalled. */
async function loadProfile() {
  if (!AsyncStorage) return null;
  try {
    const raw = await AsyncStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && p.name ? p : null;
  } catch (e) {
    return null;
  }
}

function clearProfile() {
  if (!AsyncStorage) return;
  AsyncStorage.removeItem(PROFILE_KEY).catch(() => {});
}

const STATE_KEY = 'tenmin:state';

/* What survives a restart and what does not.
   Daily counters reset on a new calendar day; everything with a history
   attached — the plan, the log, the streak — carries over. */
const DAILY_FIELDS = ['workoutDone', 'water', 'sleep', 'meals'];
const DAY_MS = 86400000;

/** whole days between two yyyy-mm-dd strings */
function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
}
const FRESH_DAY = {
  workoutDone: false,
  water: 0,
  waterAt: null,
  sleep: '',
  meals: { breakfast: false, lunch: false, dinner: false },
};

const INITIAL_STATE = {
  cycle: 0,
  streak: 0,
  lastDone: null,
  workoutDone: false,
  water: 0,
  waterAt: null,
  sleep: '',
  reminders: true,
  plan: {},
  hiddenDays: {},
  graceUsed: null,
  history: [],
  meals: { breakfast: false, lunch: false, dinner: false },
  swaps: { breakfast: 0, lunch: 0, dinner: 0 },
  log: [],
  measures: [],
};

async function loadState() {
  if (!AsyncStorage) return { kind: 'empty' };
  try {
    const raw = await AsyncStorage.getItem(STATE_KEY);
    if (!raw) return { kind: 'empty' };
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return { kind: 'empty' };

    const today = localIso();
    const base = {
      ...INITIAL_STATE,
      ...(saved.state || {}),
      meals: { ...INITIAL_STATE.meals, ...((saved.state && saved.state.meals) || {}) },
      swaps: { ...INITIAL_STATE.swaps, ...((saved.state && saved.state.swaps) || {}) },
    };

    /* same day → everything back exactly as it was */
    if (saved.day === today) return { kind: 'ok', day: today, state: base };

    /* only roll forward. A clock set backwards used to wipe the day
       a second time and burn the streak grace. */
    if (saved.day && daysBetween(saved.day, today) < 0) {
      return { kind: 'ok', day: saved.day, state: base };
    }

    return { kind: 'ok', day: today, state: rollState(base, saved.day || today, today) };
  } catch (e) {
    /* A read failure is not "no save". Returning empty here used to
       overwrite a good file with the blank initial state on the next
       persist. The app keeps running without writing until the next
       clean launch. */
    return { kind: 'error' };
  }
}

function persistState(s, day = localIso()) {
  if (!AsyncStorage) return;
  AsyncStorage.setItem(STATE_KEY, JSON.stringify({ day, state: s })).catch(() => {});
}

function saveProfile(p) {
  if (!AsyncStorage) return;
  AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(p)).catch(() => {});
}

const R = { sm: 14, md: 20, lg: 28 };
const SPACE = { xs: 8, sm: 12, md: 18, lg: 26, xl: 36 };

/* A ramp that reads as progress, not as a warning: rosewood at the
   start, through copper and champagne, to emerald when the target is
   met. Same five steps for water and for sleep.

   Green is the day's verdict, so it is kept for the day. While the day
   is still open the ramp stays inside the house metals — rosewood,
   copper, champagne — and a full glass reads gold rather than green;
   after ten at night the green tiers come back. Every other caller
   still gets the original ramp, which is what the default is for. */
function tierColor(p, afterClose = true) {
  if (p >= 1) return afterClose ? T.emerald : T.gold;
  if (p >= 0.75) return afterClose ? T.sage : T.gold;
  if (p >= 0.5) return afterClose ? T.gold : T.copper;
  if (p >= 0.25) return T.copper;
  return T.rosewood;
}

/* Sleep is not a ramp. Six and a half hours is not "nearly there", it is
   a short night, and colouring it almost-green would congratulate a
   miss. Anything under the target reads as a shortfall; the target
   itself is gold during the day and green once the day is closed. */
function sleepColor(hours, afterClose = true) {
  if (hours < TARGETS.sleep) return T.copper;
  return afterClose ? T.sage : T.gold;
}

/* ═══════════════════════════════════════════════════════════
   PROGRAM DATA
   ═══════════════════════════════════════════════════════════ */
const SESSIONS = [
  {
    id: 'A',
    title: 'חזה + יד אחורית',
    rounds: 4,
    rest: 45,
    superset: [
      { move: 'שכיבות סמיכה', detail: 'רגליים על הספה', target: 'עד כשל', failure: true },
      { move: 'הרחקת טרייספס מעל הראש', detail: 'משקולת 10 ק״ג', target: '12–20 חזרות' },
    ],
    finisher: null,
  },
  {
    id: 'B',
    title: 'כתפיים + יד קדמית',
    rounds: 3,
    rest: 45,
    superset: [
      { move: 'לחיצת כתפיים', detail: 'זוג 6 ק״ג', target: '15–25 חזרות' },
      { move: 'כפיפת מרפק', detail: 'זוג 6 ק״ג', target: '15–25 חזרות' },
    ],
    finisher: { move: 'הרחקות צד', detail: 'זוג 6 ק״ג', target: 'סט אחד עד כשל', failure: true },
  },
  {
    id: 'C',
    title: 'חזה + יד קדמית',
    rounds: 3,
    rest: 45,
    superset: [
      { move: 'לחיצת חזה על הרצפה', detail: 'זוג 6 ק״ג', target: '15–25 חזרות' },
      { move: 'כפיפת מרפק', detail: 'משקולת 10 ק״ג', target: '10–16 לכל יד' },
    ],
    finisher: { move: 'שכיבות סמיכה רגילות', detail: 'משקל גוף', target: 'סט אחד עד כשל', failure: true },
  },
  {
    id: 'D',
    title: 'רגליים + גב',
    rounds: 3,
    rest: 45,
    superset: [
      { move: 'סקוואט גובלט', detail: 'משקולת 10 ק״ג', target: '15–25 חזרות' },
      { move: 'חתירה יד אחת', detail: 'משקולת 10 ק״ג', target: '12–20 לכל צד' },
    ],
    finisher: { move: 'מספריים בולגרי', detail: 'רגל אחורית על הספה', target: '15 לכל רגל' },
  },
];

const TARGETS = { kcal: 2550, protein: 125, carbs: 355, fat: 70, water: 10, sleep: 7 };

const MEALS = {
  breakfast: [
    { t: '3 ביצים + יוגורט יווני 200 גר׳ + מלפפון', p: 38, c: 14, f: 22, kcal: 410 },
    { t: 'חביתת 2 ביצים + 2 פרוסות לחם + קוטג׳ 5% 150 גר׳', p: 35, c: 42, f: 20, kcal: 490 },
    { t: 'שייק: סקופ אבקה + חלב 300 מ״ל + בננה + שקדים', p: 36, c: 48, f: 16, kcal: 480 },
    { t: 'יוגורט יווני 200 גר׳ + גרנולה 40 גר׳ + 2 ביצים קשות', p: 39, c: 34, f: 21, kcal: 480 },
    { t: 'טוסט גבינה צהובה + ביצה + יוגורט 150 גר׳', p: 34, c: 38, f: 24, kcal: 505 },
  ],
  lunch: [
    { t: 'חזה עוף 200 גר׳ + אורז 200 גר׳ מבושל + סלט', p: 62, c: 60, f: 12, kcal: 610 },
    { t: 'פסטה 200 גר׳ + 2 קופסאות טונה + עגבניות', p: 48, c: 62, f: 10, kcal: 530 },
    { t: 'שניצל אפוי 180 גר׳ + פירה + סלט', p: 45, c: 55, f: 18, kcal: 570 },
    { t: 'קציצות בקר 200 גר׳ + אורז + ירקות מוקפצים', p: 46, c: 58, f: 22, kcal: 620 },
    { t: 'כרעיים עוף 250 גר׳ + תפו״א בתנור + סלט', p: 50, c: 45, f: 26, kcal: 615 },
  ],
  dinner: [
    { t: '2 לחמים + 3 פרוסות גבינה צהובה + חביתה + סלט', p: 35, c: 40, f: 24, kcal: 520 },
    { t: 'שייק חלבון + טוסט גבינה בולגרית + סלט', p: 33, c: 38, f: 16, kcal: 430 },
    { t: 'קוטג׳ 250 גר׳ + 2 לחמים + ביצה קשה + סלט', p: 34, c: 38, f: 17, kcal: 445 },
    { t: 'יוגורט יווני 200 גר׳ + סקופ אבקה + אגוזים', p: 45, c: 20, f: 18, kcal: 425 },
    { t: 'טונה + 2 לחמים + ביצה + סלט עם טחינה', p: 38, c: 40, f: 20, kcal: 490 },
  ],
};

const MEAL_KEYS = ['breakfast', 'lunch', 'dinner'];
/* After this minute-of-day an unmarked meal drops off the menu until tomorrow. */
const MEAL_CUTOFF = { breakfast: 11 * 60, lunch: 16 * 60, dinner: 23 * 60 };

function minuteOfDay(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes();
}

/** Did `ts` happen inside the same clock hour of the same day as `now`? */
function sameHour(ts, now = new Date()) {
  if (!ts) return false;
  const t = new Date(ts);
  return t.getHours() === now.getHours() && localIso(t) === localIso(now);
}

function mealVisible(key, meals, now = new Date()) {
  if (meals && meals[key]) return false;
  return minuteOfDay(now) < MEAL_CUTOFF[key];
}
/* "אלוף" is what an uncle says at a bar mitzvah. A word that simply
   states what happened — it is in, it is logged, that is one more —
   is the one still believed on the fortieth day, because it cannot be
   caught lying. Most of these describe the task rather than the person,
   which is also why they read the same in both skins. */
const PRAISE_M = ['בפנים', 'נרשם', 'עוד אחד'];
const PRAISE_F = ['בפנים', 'נרשם', 'עוד אחת'];
/* One time in seven the word is one you have barely seen. A reward that
   is always the same stops registering; a reward you cannot predict
   keeps its pull long after the novelty of the first one is gone. */
const RARE_M = ['ברזל', 'קר רוח', 'בלי רעש', 'חיה'];
const RARE_F = ['ברזל', 'קרת רוח', 'בלי רעש', 'חיה'];
const praise = () => (isF() ? PRAISE_F : PRAISE_M);
/* Never the same word twice running. With three common words a repeat
   lands one time in three on chance alone, and a reward you have just
   seen is not a reward — it is wallpaper. */
let lastPraise = null;
const praiseWord = () => {
  const pool = Math.random() < 0.14 ? (isF() ? RARE_F : RARE_M) : praise();
  const fresh = pool.filter((x) => x !== lastPraise);
  const from = fresh.length ? fresh : pool;
  lastPraise = from[Math.floor(Math.random() * from.length)];
  return lastPraise;
};
/* Said as a noun so it drops into a sentence in either skin:
   "מה שחסר ליום מושלם", "ואז יום מושלם". */
const ultraWord = () => 'יום מושלם';
/* The headline on the four-out-of-four screen. One word, struck like a
   stamp — the line above it already says what happened. */
const ULTRA_WORD = 'נסגר';

/** Four daily tasks. All four earns the rare screen. */
/** The four daily tasks as plain booleans, in a fixed order. */
function taskFlags(s) {
  const sleep = parseFloat(s.sleep) || 0;
  const meals = s.meals || {};
  return [
    !!s.workoutDone,
    s.water >= TARGETS.water,
    sleep >= TARGETS.sleep,
    MEAL_KEYS.every((k) => !!meals[k]),
  ];
}

function taskState(s) {
  const sleep = parseFloat(s.sleep) || 0;
  const meals = s.meals || {};
  const glasses = Math.max(0, TARGETS.water - (s.water || 0));
  const mealsLeft = MEAL_KEYS.filter((k) => !meals[k]).length;
  /* Every one of these is a status, not an accusation. "לא סיימת" is a
     finger pointed at you and gets closed; "עוד פתוח" is a fact about
     the day, and a fact is the only one of the two anyone acts on. */
  const why = [
    'האימון של היום עוד פתוח',
    glasses === 1 ? 'נשארה עוד כוס מים' : `נשארו ${glasses} כוסות מים`,
    sleep ? `${sleep} שעות שינה מתוך ${TARGETS.sleep}` : 'שעות השינה עוד לא סומנו',
    mealsLeft === 1 ? 'ארוחה אחת עוד לא סומנה' : `${mealsLeft} ארוחות עוד לא סומנו`,
  ];
  const list = taskFlags(s).map((ok, i) => ({ ok, why: why[i] }));
  return { done: list.filter((t) => t.ok).length, total: list.length, missing: list.filter((t) => !t.ok) };
}

/* Archive one finished day and open a fresh one. Used both when the
   app starts on a new calendar day and when midnight passes while the
   app is still open — without the second path yesterday's counters
   stay on screen and get written under today's date. */
function rollState(prev, fromDay, toDay = localIso()) {
  const safe = {
    ...INITIAL_STATE,
    ...prev,
    meals: { ...INITIAL_STATE.meals, ...(prev && prev.meals) },
    swaps: { ...INITIAL_STATE.swaps, ...(prev && prev.swaps) },
  };
  const t = taskState(safe);
  const entry = {
    d: fromDay,
    done: t.done,
    workout: !!safe.workoutDone,
    water: safe.water || 0,
    sleep: parseFloat(safe.sleep) || 0,
    meals: MEAL_KEYS.filter((k) => safe.meals[k]).length,
  };
  const history = [...(safe.history || []).filter((h) => h.d !== entry.d), entry].slice(-40);
  const next = { ...safe, history, ...FRESH_DAY, meals: { ...FRESH_DAY.meals } };
  const gap = next.lastDone ? daysBetween(next.lastDone, toDay) : null;
  if (gap === null || gap <= 1) return next;
  if (gap === 2 && !next.graceUsed) return { ...next, graceUsed: toDay };
  return { ...next, streak: 0, graceUsed: null };
}

const MEAL_META = {
  breakfast: { label: 'בוקר', icon: 'sunny-outline', time: '08:00' },
  lunch: { label: 'צהריים', icon: 'restaurant-outline', time: '13:30' },
  dinner: { label: 'ערב', icon: 'moon-outline', time: '20:30' },
};

/* ═══════════════════════════════════════════════════════════
   MOTION HOOKS
   ═══════════════════════════════════════════════════════════ */
/** Staggered entrance: fade + rise, driven natively. */
function useEnter(delay = 0) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.delay(delay),
      Animated.spring(v, { toValue: 1, useNativeDriver: true, friction: 9, tension: 46 }),
    ]).start();
  }, [v, delay]);
  return {
    /* opacity resolves faster than the spring so nothing lingers faint */
    opacity: v.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 1, 1] }),
    transform: [
      { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) },
      { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
    ],
  };
}

function Enter({ delay = 0, children, style }) {
  const anim = useEnter(delay);
  return <Animated.View style={[anim, style]}>{children}</Animated.View>;
}

/** Eases a raw number toward its target so dials and counters never snap. */
function useEased(target, duration = 700) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  const raf = useRef(null);

  useEffect(() => {
    const start = Date.now();
    const a = from.current;
    const b = target;
    if (raf.current) clearInterval(raf.current);
    raf.current = setInterval(() => {
      const t = Math.min(1, (Date.now() - start) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      const val = a + (b - a) * e;
      setShown(val);
      from.current = val;
      if (t >= 1) {
        clearInterval(raf.current);
        raf.current = null;
      }
    }, 16);
    return () => {
      if (raf.current) clearInterval(raf.current);
    };
  }, [target, duration]);

  return shown;
}

/* ═══════════════════════════════════════════════════════════
   PRIMITIVES
   ═══════════════════════════════════════════════════════════ */
/* Every colour a caller asks for is treated as a wash laid over the
   card rather than as the card itself. Callers pass translucent golds
   and greens to say "this one is live", and against the page those
   washes were all there was — a seven per cent gold over near-black is
   near-black. Over an opaque surface the same wash finally tints
   something, and the card keeps its own weight underneath. */
function Glass({ children, style, tint }) {
  const flat = StyleSheet.flatten(style) || {};
  const { backgroundColor, borderRadius, ...rest } = flat;
  const radius = borderRadius === undefined ? R.lg : borderRadius;
  const wash = tint || backgroundColor;

  return (
    <View
      style={[
        {
          backgroundColor: T.card,
          borderRadius: radius,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: T.hairline,
          padding: SPACE.md,
          shadowColor: '#000',
          shadowOpacity: 0.5,
          shadowRadius: 22,
          shadowOffset: { width: 0, height: 10 },
          elevation: 6,
        },
        rest,
      ]}
    >
      {wash ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: wash, borderRadius: radius }]}
        />
      ) : null}
      {children}
    </View>
  );
}

function Eyebrow({ children, color }) {
  return (
    <Text style={{ color: color || T.textFaint, fontSize: 13, letterSpacing: 0.6, fontWeight: '600', textAlign: 'right' }}>
      {children}
    </Text>
  );
}

/** Segmented dial, pure Views. Fills smoothly and shimmers the leading tick. */
function Dial({ size = 168, progress = 0, color = T.gold, segments = 56, tick = 13, thickness = 3.5, animate = true, children }) {
  /* A dial that is being dragged wants no easing at all, and asking for
     it anyway was not free: every half hour started a fresh sixteen
     millisecond timer that re-rendered all forty segments on the way to
     a figure the dial then threw away. That is the jitter you feel
     under the finger. Feeding the easing a target it never has to chase
     leaves it idle. */
  const eased = useEased(animate ? Math.max(0, Math.min(1, progress)) : 0, 900);
  const p = animate ? eased : Math.max(0, Math.min(1, progress));
  const lit = p * segments;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [glow]);

  const items = [];
  for (let i = 0; i < segments; i++) {
    const on = i < Math.floor(lit);
    const leading = i === Math.floor(lit) && lit % 1 > 0.05;
    items.push(
      <View
        key={i}
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: size / 2 - thickness / 2,
          top: 0,
          width: thickness,
          height: size,
          transform: [{ rotate: `${(i / segments) * 360}deg` }],
        }}
      >
        <Animated.View
          style={{
            width: thickness,
            height: leading ? tick + 3 : tick,
            borderRadius: thickness,
            backgroundColor: on || leading ? color : 'rgba(255,255,255,0.08)',
            opacity: leading ? glow.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }) : 1,
          }}
        />
      </View>
    );
  }

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {items}
      <View style={{ alignItems: 'center', justifyContent: 'center' }}>{children}</View>
    </View>
  );
}

function Bar({ progress, color, height = 7 }) {
  const p = useEased(Math.max(0, Math.min(1, progress)), 750);
  return (
    <View style={{ height, borderRadius: height, backgroundColor: 'rgba(255,255,255,0.07)', overflow: 'hidden', width: '100%' }}>
      <View style={{ height: '100%', width: `${p * 100}%`, backgroundColor: color, borderRadius: height }} />
    </View>
  );
}

/* The bell in the top bar, with the count of things still owed on it.
   Four pips used to sit here saying how much of the day was done, which
   is the same fact read the other way round and said in a language you
   had to learn first. A number on a bell needs no explaining, and it is
   the one place every app on the phone has trained the eye to check. */
const BADGE_RED = '#F0413F';

/* Stable for the whole day, varied from one day to the next. "מושלם"
   occupies one slot out of twenty, so it stays a genuinely rare reward
   rather than becoming another label the eye stops seeing. Short words
   only: this sits beside the streak in a header that has a date and a
   title to fit as well. */
function closedPraise(day = localIso()) {
  let hash = 0;
  for (let i = 0; i < day.length; i++) hash = (hash * 31 + day.charCodeAt(i)) >>> 0;
  const words = [
    'סגור', 'נקי', 'שקט', 'סגור', 'נקי',
    'שקט', 'סגור', 'נקי', 'שקט', 'סגור',
    'נקי', 'שקט', 'סגור', 'נקי', 'שקט',
    'סגור', 'נקי', 'שקט', 'סגור', 'מושלם',
  ];
  return words[hash % words.length];
}

function NotifBell({ count, open, onPress, afterClose }) {
  const lit = count > 0;
  /* Nothing left to do is the interface's own colour, not a green tick.
     Green is saved for the closed day, so the praise only goes green
     after ten at night. */
  const doneTone = afterClose ? T.sage : T.gold;
  /* Ten is the whole day. Every reminder still waiting takes one off it,
     so the number in the circle is what is left rather than what is owed. */
  const left = Math.max(0, 10 - count);
  const pop = useRef(new Animated.Value(0)).current;

  /* the badge lands rather than appears, and again whenever the pending
     count changes — a quiet tick that nobody notices has gone up */
  useEffect(() => {
    if (!lit) return;
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, friction: 5, tension: 140 }).start();
  }, [count, lit, pop]);

  return (
    <TouchableOpacity
      onPress={lit ? onPress : undefined}
      activeOpacity={lit ? 0.7 : 1}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={{ alignItems: 'center' }}
    >
      {/* The circle sits beside a streak drawn at twenty-six points in
          the lightest weight there is. At forty across with an extra-bold
          seventeen inside it, this was the heaviest mark in the header
          and the eye went to it before the date or the title. Thirty-four
          across with a plain bold sixteen puts it level with the streak
          instead of over it, and the badge comes down with it so the
          proportion of dot to circle stays where it was. */}
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: lit ? T.goldSoft : 'transparent',
          borderWidth: 1,
          borderColor: lit ? T.goldEdge : T.hairline,
        }}
      >
        <Text
          style={{
            color: lit ? T.gold : doneTone,
            fontSize: 16,
            fontWeight: '700',
            letterSpacing: -0.5,
          }}
        >
          {left}
        </Text>
        {lit ? (
          <Animated.View
            style={{
              position: 'absolute',
              top: -1,
              /* RTL puts the corner badge on the left, where the eye
                 already goes first on this page */
              left: -1,
              width: 9.5,
              height: 9.5,
              borderRadius: 5,
              backgroundColor: BADGE_RED,
              borderWidth: 1.5,
              borderColor: T.bg,
              transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
            }}
          />
        ) : null}
      </View>
      <Text style={{ color: lit ? T.textFaint : doneTone, fontSize: 11, letterSpacing: 1.5, marginTop: 6 }}>
        {lit ? 'התראות' : closedPraise()}
      </Text>
    </TouchableOpacity>
  );
}

/* Somewhere to be climbing to. The gaps widen on purpose: the first
   rank arrives fast enough to feel earned, the last one is a year of
   showing up. */
const RANKS = [
  { at: 0, name: 'מתחיל', nameF: 'מתחילה' },
  { at: 4, name: 'קבוע', nameF: 'קבועה' },
  { at: 12, name: 'רציני', nameF: 'רצינית' },
  { at: 26, name: 'ותיק', nameF: 'ותיקה' },
  { at: 48, name: 'חזק', nameF: 'חזקה' },
  { at: 80, name: 'אגדה', nameF: 'אגדה' },
];

function rankFor(total) {
  let i = 0;
  for (let k = 0; k < RANKS.length; k++) if (total >= RANKS[k].at) i = k;
  const cur = RANKS[i];
  const next = RANKS[i + 1] || null;
  return {
    name: isF() ? cur.nameF : cur.name,
    next: next ? (isF() ? next.nameF : next.name) : null,
    left: next ? next.at - total : 0,
    progress: next ? (total - cur.at) / (next.at - cur.at) : 1,
  };
}

/** Button that physically responds to touch. */
function GoldButton({ label, icon, onPress, subtle, tone, disabled, loading }) {
  const press = useRef(new Animated.Value(0)).current;
  const bg = subtle ? 'transparent' : tone || T.gold;
  const fg = subtle ? tone || T.gold : '#0A0D12';

  const to = (v) =>
    Animated.spring(press, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 4 }).start();

  return (
    <Animated.View style={{ transform: [{ scale: press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.96] }) }] }}>
      <Pressable
        onPressIn={() => to(1)}
        onPressOut={() => to(0)}
        onPress={onPress}
        disabled={disabled || loading}
        style={{
          backgroundColor: bg,
          borderRadius: R.md,
          paddingVertical: 16,
          paddingHorizontal: 22,
          flexDirection: ROW_RTL,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: subtle ? StyleSheet.hairlineWidth * 2 : 0,
          borderColor: tone ? tone : T.goldEdge,
          opacity: disabled ? 0.55 : 1,
          shadowColor: tone || T.gold,
          shadowOpacity: subtle ? 0 : 0.32,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
          elevation: subtle ? 0 : 5,
        }}
      >
        {icon ? <Ionicons name={icon} size={19} color={fg} style={{ marginLeft: 9 }} /> : null}
        <Text style={{ color: fg, fontSize: 16, fontWeight: '700', letterSpacing: 0.4 }}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

/** Plus and minus stay invisible until you press a side: minus on the
    physical left, plus on the physical right, RTL phone or not. */
function GhostStepper({ value, onChange, unit, tone }) {
  const plus = useRef(new Animated.Value(0)).current;
  const minus = useRef(new Animated.Value(0)).current;
  const hide = useRef({ plus: null, minus: null });

  useEffect(
    () => () => {
      Object.values(hide.current).forEach((id) => id && clearTimeout(id));
    },
    []
  );

  const flash = (side) => {
    const v = side === 'plus' ? plus : minus;
    if (hide.current[side]) clearTimeout(hide.current[side]);
    Animated.spring(v, { toValue: 1, useNativeDriver: true, friction: 6, tension: 90 }).start();
    hide.current[side] = setTimeout(() => {
      Animated.timing(v, { toValue: 0, duration: 210, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, 360);
  };

  const float = (v) => ({
    opacity: v,
    transform: [
      { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, -6] }) },
      { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
    ],
  });

  return (
    <View style={{ width: '100%', minHeight: 44, justifyContent: 'center' }}>
      <Text style={{ color: T.text, fontSize: 17, fontWeight: '600', textAlign: 'center' }}>
        {value} {unit}
      </Text>
      <Pressable
        onPress={() => {
          flash('plus');
          safeVibrate(18);
          onChange(value + 1);
        }}
        style={{ position: 'absolute', top: 0, bottom: 0, [EDGE_RIGHT]: 0, width: '42%', alignItems: 'center', justifyContent: 'center' }}
      >
        <Animated.View style={float(plus)}>
          <Ionicons name="add" size={22} color={tone || T.gold} />
        </Animated.View>
      </Pressable>
      <Pressable
        onPress={() => {
          flash('minus');
          safeVibrate(18);
          onChange(Math.max(0, value - 1));
        }}
        style={{ position: 'absolute', top: 0, bottom: 0, [EDGE_LEFT]: 0, width: '42%', alignItems: 'center', justifyContent: 'center' }}
      >
        <Animated.View style={float(minus)}>
          <Ionicons name="remove" size={22} color={tone || T.gold} />
        </Animated.View>
      </Pressable>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════
   SLEEP DIAL — drag around the ring, tap the middle to commit.

   One scale, used for everything: a full turn is EIGHT hours and
   the filled arc is exactly where your thumb is. Putting a thumb
   anywhere on the ring sets the hour under it there and then, and
   sliding on carries the value round from where it landed — there
   is nothing to wind up first. Dragging only moves a draft;
   nothing reaches the app state until you tap the centre. That is
   what stops the praise screen from jumping in while you are
   still choosing.
   ═══════════════════════════════════════════════════════════ */
const SLEEP_MAX = 8;
const SLEEP_SIZE = 112;
/* Everything from here out to the edge is ring. It clears the confirm
   button in the middle by a few points, so a thumb resting on that
   button can drift a little without the ring snatching the press. */
const SLEEP_RING_IN = 36;

function SleepDial({ value, onChange, onReset, onGestureChange, afterClose }) {
  const [draft, setDraft] = useState(value);

  /* follow the parent when it changes from the outside (a reset) */
  useEffect(() => {
    setDraft(value);
  }, [value]);

  /* PanResponder is created once, so the setter goes through a ref
     or it would keep calling the very first render's closure. */
  const draftRef = useRef(setDraft);
  draftRef.current = setDraft;
  const draftValueRef = useRef(draft);
  draftValueRef.current = draft;
  const last = useRef(null);
  const gestureRef = useRef(onGestureChange);
  gestureRef.current = onGestureChange;

  /* The dial used to read locationX/locationY, which are measured against
     whichever view the finger is over at that instant. A finger crossing
     the ring passes over several of the tick views a turn, so the same
     spot on the glass reported wildly different angles and the number
     jittered. The dial's own centre in window coordinates is the one
     frame of reference that does not move under the finger. */
  const box = useRef(null);
  const centre = useRef(null);
  const measure = () => {
    box.current?.measureInWindow?.((x, y, wd, ht) => {
      if (!wd) return;
      centre.current = { x: x + wd / 2, y: y + ht / 2 };
    });
  };

  const reach = (e) => {
    if (!centre.current) return null;
    const dx = e.nativeEvent.pageX - centre.current.x;
    const dy = e.nativeEvent.pageY - centre.current.y;
    return { dx, dy, r: Math.sqrt(dx * dx + dy * dy) };
  };

  /* zero at the top, growing clockwise */
  const angleOf = (dx, dy) => {
    const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    return deg < 0 ? deg + 360 : deg;
  };

  /* The measurement goes stale the moment the page scrolls, so it is
     taken again on every touch-down. The capture phase is used only to
     get in early enough for the reading to land before the finger
     moves; it never claims anything.

     A reading that puts the finger outside the dial can only be a stale
     centre, and rather than guess from the touch's offset within its
     own view — which is the confirm button as often as the dial, and
     was quietly turning half that button into ring — the drag simply is
     not claimed until the fresh measurement arrives a frame later. */
  const plausible = (p) => !!p && p.r <= SLEEP_SIZE * 0.72;

  /* Where the touch lands, worked out from the touch itself. The view
     carrying this responder is exactly the dial box — the confirm
     button in the middle answers its own touches before this is ever
     asked — so the offset within the touched view is the offset within
     the dial, and no measurement has to have arrived yet. */
  const seat = (e) => {
    const { pageX, pageY, locationX, locationY } = e.nativeEvent;
    centre.current = { x: pageX - locationX + SLEEP_SIZE / 2, y: pageY - locationY + SLEEP_SIZE / 2 };
  };

  const isRingTouch = (e) => {
    const p = reach(e);
    return plausible(p) && p.r > SLEEP_RING_IN;
  };

  const lastDeg = useRef(null);
  const turned = useRef(0);
  /* whether this touch has already found the ring */
  const aimed = useRef(false);

  const hoursAt = (deg) => Math.round((deg / 360) * SLEEP_MAX * 2) / 2;

  const show = (h) => {
    if (h === last.current) return;
    last.current = h;
    safeVibrate(9);
    draftRef.current(h === 0 ? '' : String(h));
  };

  /* The first touch of a drag points the ring at the finger. It used to
     do nothing but remember the angle, so the hour only started moving
     once you had turned the dial a little, and putting a thumb on six
     o'clock and lifting it left the value where it was — you had to
     wind it round instead of just saying where you meant.

     If the measurement is stale — which it is the moment the page has
     scrolled — the touch is used to place the dial instead of waiting
     for a fresh reading. Waiting is what made a touch land on nothing
     and need repeating. */
  const aim = (e) => {
    let p = reach(e);
    if (!plausible(p)) {
      seat(e);
      p = reach(e);
    }
    if (!plausible(p) || p.r < SLEEP_RING_IN) return;
    const deg = angleOf(p.dx, p.dy);
    lastDeg.current = deg;
    turned.current = deg;
    aimed.current = true;
    show(hoursAt(deg));
  };

  /* Once the ring is under the finger, hours follow how far it has
     travelled around rather than where it points. Reading the absolute
     angle every frame meant any stray sample threw the value across the
     dial and the wrap at the top needed guarding; adding up small
     differences cannot jump, so no rate limit or per-step cap is needed
     to keep it calm. */
  const fromTouch = (e) => {
    if (!aimed.current) {
      aim(e);
      return;
    }

    const p = reach(e);
    if (!p) return;
    const deg = angleOf(p.dx, p.dy);

    /* angle is meaningless within a thumb's width of the middle */
    if (p.r < SLEEP_RING_IN || lastDeg.current === null) {
      lastDeg.current = deg;
      return;
    }

    let step = deg - lastDeg.current;
    if (step > 180) step -= 360;
    if (step < -180) step += 360;
    lastDeg.current = deg;

    turned.current = Math.max(0, Math.min(360, turned.current + step));
    show(hoursAt(turned.current));
  };

  /* Everything a finished touch has to put back, in one place, so no
     ending can quietly skip a part of it. */
  const release = () => {
    last.current = null;
    lastDeg.current = null;
    aimed.current = false;
    gestureRef.current?.(false);
  };

  const pan = useRef(
    PanResponder.create({
      /* Claim the ring on touch-down, before the parent ScrollView can
         interpret the same finger as a vertical scroll. The centre stays
         free for its confirm button. */
      onStartShouldSetPanResponderCapture: () => {
        measure();
        return false;
      },
      /* Every touch that gets this far is a touch on the ring, because
         the only other thing inside the dial is the confirm button and
         it takes its own presses first. So there is nothing to work out
         and nothing to check: a finger on the ring is turning the ring.
         Testing the radius here meant a touch landing before the fresh
         measurement arrived was dropped on the floor, which is why the
         dial sometimes had to be touched twice. */
      onStartShouldSetPanResponder: () => true,
      /* No distance to travel before the ring is claimed. A finger that
         went down on the ring is turning the ring, and the page under
         it stays put for as long as it is down; waiting for a couple of
         points of movement was the other half of why the dial felt like
         it had to be wound up before it would answer. */
      onMoveShouldSetPanResponder: (e) => isRingTouch(e),
      onMoveShouldSetPanResponderCapture: (e) => isRingTouch(e),
      onPanResponderGrant: (e) => {
        last.current = parseFloat(draftValueRef.current) || 0;
        aimed.current = false;
        /* claiming the ring is also what stops the page moving under the
           thumb: onShouldBlockNativeResponder below takes the touch away
           from the scroll view for as long as the ring holds it */
        gestureRef.current?.(true);
        aim(e);
      },
      onPanResponderMove: (e) => {
        gestureRef.current?.(true);
        fromTouch(e);
      },
      onPanResponderRelease: release,
      onPanResponderTerminate: release,
      /* Every way a touch can finish, not just the two that usually do,
         so the hint always comes back and the ring never keeps aiming
         from a finger that has already gone. */
      onPanResponderEnd: release,
      onPanResponderReject: release,
      onPanResponderTerminationRequest: () => false,
      /* Android: nothing native underneath may take the touch back */
      onShouldBlockNativeResponder: () => true,
    })
  ).current;

  const num = parseFloat(draft) || 0;
  const dirty = String(draft || '') !== String(value || '');

  const commit = () => {
    if (!dirty) return;
    safeVibrate([0, 30, 50, 30]);
    onChange(draft);
  };

  /* The ring stays the size it is drawn at. It used to swell and ride
     into the middle of the screen while it was turned, which moved the
     thing you were aiming at out from under the thumb already aiming at
     it; the frost behind it does the same job of clearing the page
     without laying a hand on the dial. The ring still sits above that
     frost, which is all the stacking is for. */
  return (
    <View ref={box} collapsable={false} onLayout={measure} {...pan.panHandlers} style={{ zIndex: 40 }}>
      <Dial
        size={SLEEP_SIZE}
        /* the arc and the thumb share one scale: eight hours a turn */
        progress={num / SLEEP_MAX}
        /* colour still answers a different question: are you at the target */
        color={sleepColor(num, afterClose)}
        segments={40}
        tick={9}
        thickness={3}
        animate={false}
      >
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={commit}
          onLongPress={() => {
            safeVibrate(45);
            onReset();
          }}
          delayLongPress={500}
          style={{
            width: 62,
            height: 62,
            borderRadius: 31,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: dirty ? T.goldSoft : 'transparent',
            borderWidth: dirty ? 1 : 0,
            borderColor: T.goldEdge,
          }}
        >
          <Text style={{ color: T.text, fontSize: 21, fontWeight: '300' }}>{draft || '—'}</Text>
          <Text style={{ color: dirty ? T.gold : T.textFaint, fontSize: 10, fontWeight: dirty ? '700' : '400' }}>
            שעות שינה
          </Text>
        </TouchableOpacity>
      </Dial>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════
   ONBOARDING — name, gender if unclear, then a launch
   ═══════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════
   TITLE SEQUENCE — nine seconds of TEN 10, then the app.

   Borrowed wholesale from how fashion houses and film titles
   open: an almost empty black frame, one metal against one
   neutral, hairline rules, letters that track apart and draw
   together, a single light passing over the mark, and long
   still beats where nothing happens at all. Everything that was
   decorative — drifting specks, glowing haloes, bouncing
   letters — is gone. Confidence is what reads as expensive, and
   confidence is slow and almost empty.

   The whole thing is one pun performed rather than explained.
   TEN read as Hebrew is "תן", give. So the mark is not replaced
   by the sentence: the very same two words fly out of the logo
   and land in it. There is no second copy and no crossfade —
   the TEN you read at the top is the TEN you read in the line,
   and the 10 shrinks out of the huge numeral and turns gold on
   the way down. The Hebrew surfaces around them, the finished
   line rides up into the middle of the emptied frame, and the
   bars open.

   Two master values run in step: one on the native driver for
   transforms and opacity, one on the JS driver for tracking and
   colour, which the native driver cannot animate. A view may
   only be driven by one of them, so the flying words are a
   native-driven shell around a JS-driven letter.

   The time came out of the parts that were waiting rather than
   the parts that were performing. The letters still track apart
   and draw together over the same long breath, the two words
   still take a beat over a second each to cross the frame, and
   the sentence still holds still before it rises. What went is
   the slack: the mark used to take a second and a half just to
   appear, the light took over a second to cross a frame it
   could cross in three quarters, and a second of nothing sat
   between the last word and the bars.

   The one wait that was bought back is the last one. Once the
   sentence has arrived in the middle of an emptied frame it is
   the only thing left to read, and the frame simply stops there
   for a second before the bars move. The beat is not part of
   the eight seconds — the master value is run to the top of the
   rise, held, and then let go — so every mark, flight and word
   before it keeps exactly the timing it had.
   ═══════════════════════════════════════════════════════════ */
const TITLE_MS = 8000;
/* how long the finished sentence sits still before the bars open */
const TITLE_HOLD_MS = 1000;

/* the sentence, and where the two words of the mark sit in it */
const TITLE_LINE = [
  { text: 'TEN', hero: true },
  { text: 'לזה', at: 0.62 },
  { text: '10', hero: true },
  { text: 'דקות', at: 0.695 },
  { text: 'צ׳אנס', at: 0.745 },
];

const LINE_FS = 22;
const MARK_FS = 46;
const BIG_FS = 132;
const LINE_TRACK = 2.5;

/* everything is placed against the centre of the frame */
const MARK_Y = -168;
const RULE_Y = -112;
const BIG_Y = -18;
const LINE_Y = 142;
/* how far under the middle of the sentence its rule is drawn */
const LINE_RULE_Y = 42;

const HERO = {
  TEN: { y: MARK_Y, zoom: MARK_FS / LINE_FS, flies: [0.47, 0.62] },
  10: { y: BIG_Y, zoom: BIG_FS / LINE_FS, flies: [0.545, 0.695] },
};

/* the sentence lifts into the middle of the emptied frame */
const RISE = [0.845, 0.92];

/* A straight line between two beats moves at one speed and stops dead.
   Sampling an ease along the way costs nothing and is the difference
   between a thing being moved and a thing arriving. */
const GLIDE = [0, 0.12, 0.25, 0.4, 0.55, 0.7, 0.85, 1];

function TitleSequence({ onDone }) {
  const t = useRef(new Animated.Value(0)).current;
  const tj = useRef(new Animated.Value(0)).current;

  /* Where each word of the sentence ends up. The flying words are laid
     out over the line rather than in it, so the line keeps an unseen
     copy of each to hold its place, and the flight aims at wherever
     that place turned out to be. */
  const [row, setRow] = useState(0);
  const [spot, setSpot] = useState({});

  useEffect(() => {
    /* one tap as the mark lands, one as each half of it arrives in the
       sentence, one as the sentence closes */
    const beats = [
      setTimeout(() => safeVibrate(18), 620),
      setTimeout(() => safeVibrate([0, 40, 60, 120]), 1800),
      setTimeout(() => safeVibrate(26), 4960),
      setTimeout(() => safeVibrate(26), 5560),
      setTimeout(() => safeVibrate([0, 30, 50, 110]), RISE[1] * TITLE_MS),
    ];
    /* Both masters run to the top of the rise, wait there, and then
       run out. Everything downstream is written against the same
       fractions as before; only the clock pauses. */
    const run = (v, native) =>
      Animated.sequence([
        Animated.timing(v, {
          toValue: RISE[1],
          duration: TITLE_MS * RISE[1],
          easing: Easing.linear,
          useNativeDriver: native,
        }),
        Animated.timing(v, {
          toValue: 1,
          delay: TITLE_HOLD_MS,
          duration: TITLE_MS * (1 - RISE[1]),
          easing: Easing.linear,
          useNativeDriver: native,
        }),
      ]);

    run(tj, false).start();
    run(t, true).start(() => onDone());
    return () => beats.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const at = (from, to, out, extra) =>
    t.interpolate({ inputRange: [from, to], outputRange: [out, extra], extrapolate: 'clamp' });

  const glide = (from, to, out, extra) =>
    t.interpolate({
      inputRange: GLIDE.map((p) => from + (to - from) * p),
      outputRange: GLIDE.map((p) => out + (extra - out) * (1 - Math.pow(1 - p, 3))),
      extrapolate: 'clamp',
    });

  const lineText = {
    fontSize: LINE_FS,
    fontWeight: '300',
    letterSpacing: LINE_TRACK,
    marginHorizontal: 6,
  };

  return (
    <Animated.View
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: -SPACE.lg,
        right: -SPACE.lg,
        backgroundColor: T.bg,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: t.interpolate({ inputRange: [0, 0.965, 1], outputRange: [1, 1, 0], extrapolate: 'clamp' }),
      }}
    >
      {/* A frame that closes on the mark over the whole sequence,
          slowly enough that you never catch it moving. */}
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ scale: at(0, 1, 1.06, 1) }],
        }}
      >
        {/* the rule the mark is built on, drawn out from nothing and
            taken away again once the mark has been spent */}
        <Animated.View
          style={{
            position: 'absolute',
            width: 232,
            height: StyleSheet.hairlineWidth * 2,
            backgroundColor: T.gold,
            opacity: t.interpolate({
              inputRange: [0.12, 0.2, 0.44, 0.5],
              outputRange: [0, 0.55, 0.55, 0],
              extrapolate: 'clamp',
            }),
            transform: [{ translateY: RULE_Y }, { scaleX: glide(0.12, 0.27, 0, 1) }],
          }}
        />

        {/* The sentence. The two words of the mark are not written here
            — an unseen copy of each holds its place in the row, and the
            real one flies in from the logo and lands on it.

            Nothing but the row may live in here. An absolute view with
            no top or bottom is centred on its own height, so a rule
            sitting under the words in the flow pushed the words up off
            that centre — while the two flying words, which are centred
            the same way but on their own height alone, kept aiming at
            it. Half the gap under the line was the amount the mark
            landed low by, and it showed most once the finished sentence
            rode up into the middle. The rule is its own thing below. */}
        <Animated.View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            alignItems: 'center',
            transform: [{ translateY: glide(RISE[0], RISE[1], LINE_Y, 0) }],
          }}
        >
          <View
            style={{ flexDirection: ROW_RTL, alignItems: 'center' }}
            onLayout={(e) => setRow(e.nativeEvent.layout.width)}
          >
            {TITLE_LINE.map((word) =>
              word.hero ? (
                <Text
                  key={word.text}
                  style={[lineText, { color: T.gold, opacity: 0 }]}
                  onLayout={(e) => {
                    const { x, width } = e.nativeEvent.layout;
                    setSpot((s) => (s[word.text]?.x === x ? s : { ...s, [word.text]: { x, width } }));
                  }}
                >
                  {word.text}
                </Text>
              ) : (
                <Animated.Text
                  key={word.text}
                  style={[lineText, { color: T.textDim, opacity: at(word.at, word.at + 0.07, 0, 1) }]}
                >
                  {word.text}
                </Animated.Text>
              )
            )}
          </View>
        </Animated.View>

        {/* the rule under the sentence, carried up with it */}
        <Animated.View
          style={{
            position: 'absolute',
            width: 190,
            height: StyleSheet.hairlineWidth * 2,
            backgroundColor: T.gold,
            opacity: at(0.87, 0.93, 0, 0.45),
            transform: [
              { translateY: glide(RISE[0], RISE[1], LINE_Y + LINE_RULE_Y, LINE_RULE_Y) },
              { scaleX: glide(0.87, 0.95, 0, 1) },
            ],
          }}
        />

        {/* The mark itself: the same two words, in flight. */}
        {TITLE_LINE.filter((word) => word.hero).map((word) => {
          const h = HERO[word.text];
          const seat = spot[word.text];
          const dx = seat && row ? seat.x + seat.width / 2 - row / 2 : 0;
          const isTen = word.text === 'TEN';
          const show = isTen ? [0.03, 0.13] : [0.22, 0.33];

          return (
            <Animated.View
              key={word.text}
              style={{
                position: 'absolute',
                opacity: at(show[0], show[1], 0, 1),
                transform: [
                  {
                    translateY: Animated.add(
                      glide(h.flies[0], h.flies[1], h.y, LINE_Y),
                      glide(RISE[0], RISE[1], 0, -LINE_Y)
                    ),
                  },
                  { translateX: glide(h.flies[0], h.flies[1], 0, dx) },
                  { scale: glide(h.flies[0], h.flies[1], h.zoom, 1) },
                ],
              }}
            >
              {/* Tracking is the whole look: the letters stand far apart
                  and draw together as the mark settles. It cannot go
                  through the native driver, which is why it sits on its
                  own view inside the one that flies. */}
              <Animated.Text
                style={{
                  fontSize: LINE_FS,
                  fontWeight: '300',
                  color: isTen
                    ? T.gold
                    : tj.interpolate({
                        inputRange: h.flies,
                        outputRange: [T.text, T.gold],
                        extrapolate: 'clamp',
                      }),
                  letterSpacing: tj.interpolate({
                    inputRange: isTen ? [0.03, 0.24, h.flies[0], h.flies[1]] : [0, 0.22, h.flies[0], h.flies[1]],
                    outputRange: isTen ? [13, 5.5, 5.5, LINE_TRACK] : [-0.9, -0.9, -0.9, LINE_TRACK],
                    extrapolate: 'clamp',
                  }),
                }}
              >
                {word.text}
              </Animated.Text>
            </Animated.View>
          );
        })}
      </Animated.View>

      {/* one light passing over the mark, and only one */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', width: SCREEN_W, height: 420, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}
      >
        <Animated.View
          style={{
            position: 'absolute',
            width: 90,
            height: 640,
            backgroundColor: 'rgba(255,255,255,0.10)',
            opacity: t.interpolate({
              inputRange: [0.34, 0.365, 0.405, 0.43],
              outputRange: [0, 1, 1, 0],
              extrapolate: 'clamp',
            }),
            transform: [{ rotate: '14deg' }, { translateX: glide(0.34, 0.43, -SCREEN_W * 0.8, SCREEN_W * 0.8) }],
          }}
        />
      </View>

      {/* letterbox bars close over the reveal and open again at the end */}
      {[0, 1].map((i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            height: 74,
            [i ? 'bottom' : 'top']: 0,
            backgroundColor: '#000',
            transform: [
              {
                translateY: t.interpolate({
                  inputRange: [0, 0.055, 0.955, 1],
                  outputRange: i ? [74, 0, 0, 74] : [-74, 0, 0, -74],
                  extrapolate: 'clamp',
                }),
              },
            ],
          }}
        />
      ))}
    </Animated.View>
  );
}

function GenderButton({ label, female, onPress }) {
  const p = useRef(new Animated.Value(0)).current;
  const float = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 1700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 1700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, [float]);

  const to = (v) => Animated.spring(p, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  const tint = female ? '#E39BB2' : '#7FA9D4';

  return (
    <Animated.View
      style={{
        flex: 1,
        transform: [
          { scale: p.interpolate({ inputRange: [0, 1], outputRange: [1, 0.94] }) },
          { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) },
        ],
      }}
    >
      <Pressable
        onPressIn={() => to(1)}
        onPressOut={() => to(0)}
        onPress={onPress}
        style={{
          alignItems: 'center',
          paddingVertical: SPACE.lg,
          borderRadius: R.lg,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: tint,
          backgroundColor: female ? 'rgba(227,155,178,0.09)' : 'rgba(127,169,212,0.09)',
        }}
      >
        <View
          style={{
            width: 62,
            height: 62,
            borderRadius: 31,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1.5,
            borderColor: tint,
            marginBottom: SPACE.sm,
          }}
        >
          <Ionicons name={female ? 'female' : 'male'} size={28} color={tint} />
        </View>
        <Text style={{ color: T.text, fontSize: 17, fontWeight: '600' }}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

function Onboarding({ onFinish }) {
  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <TitleSequence onDone={onFinish} />
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════
   CELEBRATION — covers the screen for a beat when a task lands.
   Three common words rotate. Completing all four daily tasks
   earns the rare screen and a three-second vibration.
   ═══════════════════════════════════════════════════════════ */
const REASON_MS = 2000;

/** One reason, faded in on mount. Remounted per step via key. */
function Reason({ text }) {
  const f = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(f, { toValue: 1, useNativeDriver: true, friction: 8, tension: 44 }).start();
  }, [f]);
  return (
    <Animated.View
      style={{
        flexDirection: ROW_RTL,
        alignItems: 'center',
        opacity: f,
        transform: [{ translateY: f.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
      }}
    >
      <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: T.crimson, marginHorizontal: 8 }} />
      <Text style={{ color: T.text, fontSize: 16, textAlign: 'center' }}>{text}</Text>
    </Animated.View>
  );
}

function Celebration({ payload, onDone }) {
  const v = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const ultra = payload.ultra;
  const reasons = payload.missing;
  const [step, setStep] = useState(0);

  /* advance through the reasons, one every two seconds */
  useEffect(() => {
    if (ultra || reasons.length <= 1) return undefined;
    const id = setInterval(() => setStep((s) => Math.min(s + 1, reasons.length - 1)), REASON_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    safeVibrate(ultra ? 1600 : [0, 45, 70, 45]);
    Animated.parallel([
      Animated.spring(v, { toValue: 1, useNativeDriver: true, friction: 7, tension: 46 }),
      Animated.timing(ring, {
        toValue: 1,
        duration: ultra ? 2000 : 1400,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    /* every panel holds for two seconds, then the next one takes over.
       When the last one is spent the whole thing closes by itself. */
    const hold = ultra ? REASON_MS : Math.max(1, reasons.length) * REASON_MS;
    const t = setTimeout(() => {
      Animated.timing(v, { toValue: 0, duration: 300, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(
        () => onDone()
      );
    }, hold);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tone = ultra ? T.emerald : T.gold;

  return (
    <Animated.View
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: 'rgba(8,11,16,0.94)',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: SPACE.xl,
        opacity: v,
        zIndex: 99,
      }}
    >
      {/* expanding ring */}
      <Animated.View
        style={{
          position: 'absolute',
          width: 200,
          height: 200,
          borderRadius: 100,
          borderWidth: 1.5,
          borderColor: tone,
          opacity: ring.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.5, 0] }),
          transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.3, 2.6] }) }],
        }}
      />
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: 200,
          height: 200,
          borderRadius: 100,
          backgroundColor: tone,
          opacity: ring.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.16, 0] }),
          transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1.9] }) }],
        }}
      />

      <Animated.View
        pointerEvents="none"
        style={{
          alignItems: 'center',
          transform: [
            { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.62, 1] }) },
            { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['-5deg', '0deg'] }) },
          ],
        }}
      >
        {ultra ? <Eyebrow color={T.emerald}>ארבע מתוך ארבע</Eyebrow> : null}
        <Text
          style={{
            color: T.text,
            fontSize: ultra ? 58 : 66,
            fontWeight: '200',
            letterSpacing: -1.5,
            marginTop: ultra ? SPACE.sm : 0,
          }}
        >
          {payload.word}
        </Text>
        <View style={{ height: 1.5, width: 88, backgroundColor: tone, marginTop: SPACE.md }} />

        {ultra ? (
          <Text style={{ color: T.textDim, fontSize: 14, textAlign: 'center', marginTop: SPACE.lg, lineHeight: 24 }}>
            אימון, מים, שינה וארוחות. יום מושלם.
          </Text>
        ) : (
          <View style={{ marginTop: SPACE.lg, alignItems: 'center', minHeight: 96 }}>
            <Text style={{ color: T.textFaint, fontSize: 13, letterSpacing: 2, marginBottom: SPACE.md }}>
              מה שחסר ל{ultraWord()}
            </Text>

            {reasons.length ? <Reason key={step} text={reasons[step].why} /> : null}

            {reasons.length > 1 ? (
              <View style={{ flexDirection: ROW_RTL, marginTop: SPACE.md }}>
                {reasons.map((r, i) => (
                  <View
                    key={r.why}
                    style={{
                      width: i === step ? 16 : 5,
                      height: 5,
                      borderRadius: 3,
                      marginHorizontal: 3,
                      backgroundColor: i === step ? T.gold : 'rgba(255,255,255,0.14)',
                    }}
                  />
                ))}
              </View>
            ) : null}
          </View>
        )}
      </Animated.View>
    </Animated.View>
  );
}

/* ═══════════════════════════════════════════════════════════
   SUMMARY — a full screen that walks the day one task at a time.
   Two seconds each, done and missed alike, so the gap is felt
   rather than skimmed.
   ═══════════════════════════════════════════════════════════ */
const EDGE_GRAB = 28;

/** iOS-style back, from the right edge, with a quick cinematic glide. */
function EdgeDismiss({ onClose, children }) {
  const x = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const finish = () => {
    if (closing.current) return;
    closing.current = true;
    safeVibrate(18);
    Animated.timing(x, {
      toValue: -SCREEN_W,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => onCloseRef.current());
  };

  const claim = (e, g) =>
    e.nativeEvent.pageX > SCREEN_W - EDGE_GRAB && g.dx < -10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.1;

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: claim,
      onMoveShouldSetPanResponderCapture: claim,
      onPanResponderMove: (_, g) => {
        if (g.dx < 0) x.setValue(g.dx);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx < -72 || g.vx < -0.35) finish();
        else Animated.spring(x, { toValue: 0, useNativeDriver: true, friction: 8, tension: 42 }).start();
      },
      onPanResponderTerminate: () => {
        if (!closing.current) Animated.spring(x, { toValue: 0, useNativeDriver: true, friction: 8, tension: 42 }).start();
      },
    })
  ).current;

  return (
    <Animated.View
      style={{
        flex: 1,
        transform: [
          { translateX: x },
          { scale: x.interpolate({ inputRange: [-SCREEN_W, 0], outputRange: [0.94, 1], extrapolate: 'clamp' }) },
        ],
        opacity: x.interpolate({ inputRange: [-SCREEN_W, -SCREEN_W * 0.35, 0], outputRange: [0.2, 1, 1], extrapolate: 'clamp' }),
      }}
      {...pan.panHandlers}
    >
      {children}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: '18%',
          bottom: '18%',
          right: 4,
          width: 5,
          borderRadius: 3,
          backgroundColor: T.gold,
          opacity: 0.28,
        }}
      />
    </Animated.View>
  );
}

function SummaryScreen({ state, mode, onClose }) {
  return (
    <EdgeDismiss onClose={onClose}>
      {mode === 'week' ? <WeekSummary state={state} /> : <DaySummary state={state} />}
    </EdgeDismiss>
  );
}

/** The day, walked one task at a time. Every tap advances it. */
function DaySummary({ state }) {
  const insets = useSafeAreaInsets();
  const rows = [
    { label: 'אימון', ok: !!state.workoutDone, note: state.workoutDone ? 'הושלם' : 'לא בוצע' },
    {
      label: 'מים',
      ok: state.water >= TARGETS.water,
      note: `${state.water} מתוך ${TARGETS.water} כוסות`,
    },
    {
      label: 'שינה',
      ok: (parseFloat(state.sleep) || 0) >= TARGETS.sleep,
      note: `${parseFloat(state.sleep) || 0} מתוך ${TARGETS.sleep} שעות`,
    },
    {
      label: 'ארוחות',
      ok: MEAL_KEYS.every((k) => state.meals[k]),
      note: `${MEAL_KEYS.filter((k) => state.meals[k]).length} מתוך 3 סומנו`,
    },
  ];
  const doneCount = rows.filter((r) => r.ok).length;

  const [i, setI] = useState(0);
  const v = useRef(new Animated.Value(0)).current;
  const finished = i >= rows.length - 1;

  useEffect(() => {
    Animated.spring(v, { toValue: 1, useNativeDriver: true, friction: 8, tension: 44 }).start();
  }, [v]);

  const next = () => {
    if (finished) return;
    safeVibrate(18);
    setI((x) => x + 1);
  };

  const row = rows[i];

  return (
    <Animated.View style={{ flex: 1, backgroundColor: T.bg, opacity: v }}>
      <View style={styles.glowTop} pointerEvents="none" />
      <View style={styles.glowBottom} pointerEvents="none" />

      {/* the whole screen is the button */}
      <Pressable style={{ flex: 1 }} onPress={next}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACE.xl, paddingTop: insets.top, paddingBottom: insets.bottom }}>
          <Eyebrow color={T.gold}>סיכום היום</Eyebrow>
          <Text style={{ color: T.text, fontSize: 52, fontWeight: '200', marginTop: SPACE.sm }}>
            {doneCount} / {rows.length}
          </Text>
          <View style={{ width: 150, marginTop: SPACE.md }}>
            <Bar progress={doneCount / rows.length} color={tierColor(doneCount / rows.length)} height={4} />
          </View>

          <SummaryRow key={i} row={row} />

          <View style={{ flexDirection: ROW_RTL, marginTop: SPACE.lg }}>
            {rows.map((r, k) => (
              <View
                key={r.label}
                style={{
                  width: k === i ? 18 : 6,
                  height: 6,
                  borderRadius: 3,
                  marginHorizontal: 3,
                  backgroundColor: k === i ? (r.ok ? T.emerald : T.crimson) : 'rgba(255,255,255,0.14)',
                }}
              />
            ))}
          </View>

          {finished ? (
            <View style={{ width: '100%', marginTop: SPACE.lg }}>
              <Text style={{ color: T.textDim, fontSize: 14, textAlign: 'center', lineHeight: 23, marginBottom: SPACE.md }}>
                {doneCount === rows.length
                  ? 'ארבע מתוך ארבע. היום נסגר מושלם.'
                  : `עוד ${nHe(rows.length - doneCount, 'משימה', 'משימות', true)} ל${ultraWord()}.`}
              </Text>
              <Text style={{ color: T.textFaint, fontSize: 11, letterSpacing: 1.4, textAlign: 'center' }}>
                החלקה מהקצה הימני לחזרה
              </Text>
            </View>
          ) : (
            <Text style={{ color: T.textFaint, fontSize: 11, letterSpacing: 1.4, marginTop: SPACE.lg }}>
              נגיעה במסך להמשך
            </Text>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** Sunday to Friday, built from the archived days plus today.
    Days you removed from the planner are removed here too. */
function WeekSummary({ state }) {
  const insets = useSafeAreaInsets();
  const start = weekStart(0);
  const today = localIso();
  const t = taskState(state);
  const v = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(v, { toValue: 1, useNativeDriver: true, friction: 8, tension: 44 }).start();
  }, [v]);

  const days = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return { d, i, key: localIso(d) };
  })
    .filter((x) => !state.hiddenDays[x.key])
    .map((x) => {
      if (x.key === today) return { ...x, done: t.done, isToday: true };
      const h = (state.history || []).find((r) => r.d === x.key);
      return { ...x, done: h ? h.done : null, isToday: false };
    });

  const scored = days.filter((x) => x.done !== null);
  const perfect = scored.filter((x) => x.done === 4).length;
  const workouts = days.filter((x) => state.log.some((l) => l.d === x.key)).length;
  const avg = scored.length ? scored.reduce((a, x) => a + x.done, 0) / scored.length : 0;
  const target = Math.min(WEEK_TARGET, days.length);

  return (
    <Animated.View style={{ flex: 1, backgroundColor: T.bg, opacity: v }}>
      <View style={styles.glowTop} pointerEvents="none" />
      <View style={styles.glowBottom} pointerEvents="none" />

      <View style={{ flex: 1, paddingHorizontal: SPACE.lg, paddingTop: Math.max(48, insets.top + 24), paddingBottom: Math.max(SPACE.lg, insets.bottom + 12) }}>
        <View style={{ alignItems: 'center' }}>
          <Eyebrow color={T.gold}>סיכום השבוע</Eyebrow>
          <Text style={{ color: T.text, fontSize: 40, fontWeight: '200', marginTop: SPACE.xs }}>
            {avg.toFixed(1)} <Text style={{ fontSize: 20, color: T.textFaint }}>ממוצע ליום</Text>
          </Text>
          <Text style={{ color: T.textFaint, fontSize: 12, marginTop: 4 }}>
            {days.length} ימים פעילים השבוע
          </Text>
        </View>

        <View style={{ flexDirection: ROW_RTL, marginTop: SPACE.lg, justifyContent: 'space-between' }}>
          {days.map((x) => {
            const p = x.done === null ? 0 : x.done / 4;
            const col = x.done === null ? 'rgba(255,255,255,0.10)' : tierColor(p);
            return (
              <View key={x.key} style={{ alignItems: 'center', flex: 1 }}>
                <View
                  style={{
                    width: 26,
                    height: 96,
                    borderRadius: 13,
                    backgroundColor: 'rgba(255,255,255,0.06)',
                    justifyContent: 'flex-end',
                    overflow: 'hidden',
                    borderWidth: x.isToday ? 1 : 0,
                    borderColor: T.goldEdge,
                  }}
                >
                  <View style={{ height: `${Math.max(4, p * 100)}%`, backgroundColor: col }} />
                </View>
                <Text style={{ color: x.isToday ? T.gold : T.textFaint, fontSize: 11, marginTop: 6 }}>
                  {HE_DAYS[x.i].slice(0, 3)}
                </Text>
                <Text style={{ color: T.textFaint, fontSize: 10 }}>{x.done === null ? '—' : x.done}</Text>
              </View>
            );
          })}
        </View>

        <Glass style={{ marginTop: SPACE.lg }}>
          {[
            ['אימונים שבוצעו', `${workouts} מתוך ${target}`, workouts >= target],
            ['ימים מושלמים', String(perfect), perfect > 0],
            ['רצף נוכחי', `${state.streak}${state.graceUsed ? ' · חסד' : ''}`, state.streak > 0],
          ].map(([k, val, good], idx) => (
            <View
              key={k}
              style={{
                flexDirection: ROW_RTL,
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingVertical: 11,
                borderBottomWidth: idx < 2 ? StyleSheet.hairlineWidth * 2 : 0,
                borderBottomColor: T.hairlineSoft,
              }}
            >
              <Text style={{ color: T.textDim, fontSize: 15 }}>{k}</Text>
              <Text style={{ color: good ? T.emerald : T.textFaint, fontSize: 15, fontWeight: '600' }}>{val}</Text>
            </View>
          ))}
        </Glass>

        {scored.length < 2 ? (
          <Text style={{ color: T.textFaint, fontSize: 12, textAlign: 'right', lineHeight: 20, marginTop: SPACE.md }}>
            העמודות מתמלאות יום אחרי יום. עוד כמה ימים ורואים כאן איפה השבוע
            נשבר ואיפה הוא החזיק.
          </Text>
        ) : null}

        <View style={{ flex: 1 }} />
        <Text style={{ color: T.textFaint, fontSize: 11, letterSpacing: 1.4, textAlign: 'center' }}>
          החלקה מהקצה הימני לחזרה
        </Text>
      </View>
    </Animated.View>
  );
}

/** One task, faded in on mount. Remounted per step via key. */
function SummaryRow({ row }) {
  const f = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(f, { toValue: 1, useNativeDriver: true, friction: 8, tension: 42 }).start();
  }, [f]);

  return (
    <Animated.View
      style={{
        alignItems: 'center',
        marginTop: SPACE.lg,
        minHeight: 148,
        opacity: f,
        transform: [
          { translateY: f.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) },
          { scale: f.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
        ],
      }}
    >
      <View
        style={{
          width: 74,
          height: 74,
          borderRadius: 37,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1.5,
          borderColor: row.ok ? T.emerald : T.crimson,
          backgroundColor: row.ok ? 'rgba(63,169,138,0.10)' : 'rgba(212,92,75,0.10)',
        }}
      >
        <Ionicons name={row.ok ? 'checkmark' : 'close'} size={34} color={row.ok ? T.emerald : T.crimson} />
      </View>
      <Text style={{ color: T.text, fontSize: 26, fontWeight: '300', marginTop: SPACE.md }}>{row.label}</Text>
      <Text style={{ color: row.ok ? T.emerald : T.crimson, fontSize: 15, marginTop: 6 }}>{row.note}</Text>
    </Animated.View>
  );
}

/* ═══════════════════════════════════════════════════════════
   MONOGRAM — the TEN 10 mark.

   A struck-metal medallion rather than a spinner: a fixed outer
   bezel, one slow gold arc tracking round it, and the wordmark
   locked dead centre. A sheen crosses the face every few seconds,
   which is what sells thin gold on a dark ground as metal instead
   of as a yellow line.
   ═══════════════════════════════════════════════════════════ */
function Monogram({ spin = 7000, size = 132 }) {
  const rotate = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const build = useRef(new Animated.Value(0)).current;
  const bloom = useRef(new Animated.Value(0)).current;
  const sheen = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(build, { toValue: 1, useNativeDriver: true, friction: 8, tension: 34 }).start();
    Animated.timing(bloom, {
      toValue: 1,
      duration: 1600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [build, bloom]);

  useEffect(() => {
    Animated.loop(
      Animated.timing(rotate, { toValue: 1, duration: spin, easing: Easing.linear, useNativeDriver: true })
    ).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 2100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 2100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
    Animated.loop(
      Animated.sequence([
        Animated.delay(1400),
        Animated.timing(sheen, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
        Animated.timing(sheen, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    ).start();
  }, [rotate, breathe, sheen, spin]);

  const spinDeg = rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const counterDeg = rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-360deg'] });
  const pulse = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] });
  const r = size / 2;

  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: build,
        transform: [{ scale: build.interpolate({ inputRange: [0, 1], outputRange: [0.78, 1] }) }],
      }}
    >
      {/* one-shot bloom behind the mark */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: r,
          backgroundColor: 'rgba(212,178,106,0.20)',
          opacity: bloom.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 0.5, 0] }),
          transform: [{ scale: bloom.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.4] }) }],
        }}
      />

      {/* outer bezel, fixed */}
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: r,
          borderWidth: 1,
          borderColor: T.goldEdge,
        }}
      />
      {/* inner hairline, breathing */}
      <Animated.View
        style={{
          position: 'absolute',
          width: size * 0.86,
          height: size * 0.86,
          borderRadius: size * 0.43,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: 'rgba(212,178,106,0.22)',
          transform: [{ scale: pulse }],
        }}
      />
      {/* the one moving part */}
      <Animated.View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: r,
          borderWidth: 1.6,
          borderColor: 'transparent',
          borderTopColor: T.gold,
          transform: [{ rotate: spinDeg }],
        }}
      />
      <Animated.View
        style={{
          position: 'absolute',
          width: size * 0.72,
          height: size * 0.72,
          borderRadius: size * 0.36,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: 'transparent',
          borderBottomColor: 'rgba(212,178,106,0.45)',
          transform: [{ rotate: counterDeg }],
        }}
      />

      {/* face: TEN over a rule over 10 */}
      <View style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Text
          style={{
            color: T.gold,
            fontSize: size * 0.085,
            fontWeight: '600',
            letterSpacing: size * 0.055,
            marginRight: -size * 0.055,
            marginBottom: size * 0.028,
          }}
        >
          TEN
        </Text>
        <View style={{ width: size * 0.30, height: StyleSheet.hairlineWidth * 2, backgroundColor: T.goldEdge }} />
        <Text
          style={{
            color: T.text,
            fontSize: size * 0.30,
            fontWeight: '200',
            letterSpacing: -size * 0.014,
            marginTop: size * 0.012,
          }}
        >
          10
        </Text>
      </View>

      {/* sheen crossing the face */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', width: size, height: size, borderRadius: r, overflow: 'hidden' }}
      >
        <Animated.View
          style={{
            position: 'absolute',
            top: -size * 0.5,
            left: 0,
            width: size * 0.26,
            height: size * 2,
            backgroundColor: 'rgba(255,255,255,0.10)',
            opacity: sheen.interpolate({ inputRange: [0, 0.1, 0.9, 1], outputRange: [0, 1, 1, 0] }),
            transform: [
              { rotate: '18deg' },
              { translateX: sheen.interpolate({ inputRange: [0, 1], outputRange: [-size * 0.6, size * 1.2] }) },
            ],
          }}
        />
      </View>
    </Animated.View>
  );
}

/* ═══════════════════════════════════════════════════════════
   WORKOUT RUNNER
   ═══════════════════════════════════════════════════════════ */
function Runner({ session, onFinish, onExit }) {
  const insets = useSafeAreaInsets();
  const [round, setRound] = useState(1);
  const [phase, setPhase] = useState('work');
  const [rest, setRest] = useState(session.rest);
  const [elapsed, setElapsed] = useState(0);
  const pulse = useRef(new Animated.Value(0)).current;
  const flip = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (phase !== 'rest') return undefined;
    if (rest <= 0) {
      buzzRoundEnd();
      setPhase('work');
      setRest(session.rest);
      return undefined;
    }
    if (rest <= 3) buzzFinal();
    else if (rest <= 5) buzzTick();
    const id = setTimeout(() => setRest((r) => r - 1), 1000);
    return () => clearTimeout(id);
  }, [phase, rest, session.rest]);

  useEffect(() => {
    flip.setValue(0);
    Animated.timing(flip, { toValue: 1, duration: 420, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: true }).start();
  }, [phase, round, flip]);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, [pulse]);

  const phaseStyle = {
    opacity: flip,
    transform: [{ translateY: flip.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
  };
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const over = elapsed > 600;

  const advance = () => {
    if (round < session.rounds) {
      setRound((r) => r + 1);
      setRest(session.rest);
      setPhase('rest');
    } else if (session.finisher) {
      setPhase('finisher');
    } else {
      buzzWorkoutDone();
      onFinish(elapsed);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: SPACE.md, paddingBottom: 140 + insets.bottom }} showsVerticalScrollIndicator={false}>
      <Enter>
        <View style={{ flexDirection: ROW_RTL, justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: SPACE.md }}>
          <View>
            <Eyebrow color={T.gold}>אימון {session.id}</Eyebrow>
            <Text style={styles.h1}>{session.title}</Text>
          </View>
          <Text style={{ color: over ? T.crimson : T.text, fontSize: 34, fontWeight: '200', letterSpacing: 1 }}>
            {mm}:{ss}
          </Text>
        </View>
        <Bar progress={Math.min(1, elapsed / 600)} color={over ? T.crimson : T.gold} height={3} />
      </Enter>

      {over ? (
        <Text style={{ color: T.crimson, textAlign: 'right', fontSize: 13, marginTop: SPACE.sm }}>
          {w('עברת את עשר הדקות. תסגור את הסבב הזה וזהו.', 'עברת את עשר הדקות. תסגרי את הסבב הזה וזהו.')}
        </Text>
      ) : null}

      <Animated.View style={[phaseStyle, { marginTop: SPACE.md }]}>
        {phase === 'rest' ? (
          <Glass tint="rgba(63,169,138,0.09)" style={{ alignItems: 'center', paddingVertical: SPACE.xl }}>
            <Eyebrow color={T.emerald}>מנוחה</Eyebrow>
            <Dial size={190} progress={1 - rest / session.rest} color={rest <= 5 ? T.crimson : T.emerald} segments={45} animate={false}>
              <Text style={{ color: T.text, fontSize: 62, fontWeight: '200' }}>{rest}</Text>
            </Dial>
            <Text style={{ color: T.textDim, fontSize: 13, marginTop: SPACE.sm }}>
              סבב {round} מתוך {session.rounds} מתחיל מיד
            </Text>
            <View style={{ width: '100%', marginTop: SPACE.md }}>
              <GoldButton label={w('דלג על המנוחה', 'דלגי על המנוחה')} subtle tone={T.emerald} onPress={() => { setPhase('work'); setRest(session.rest); }} />
            </View>
          </Glass>
        ) : phase === 'finisher' ? (
          <Glass tint="rgba(212,92,75,0.09)">
            <Eyebrow color={T.crimson}>סט סיום</Eyebrow>
            <Text style={[styles.h2, { marginTop: 8 }]}>{session.finisher.move}</Text>
            <Text style={styles.sub}>{session.finisher.detail}</Text>
            <Text style={{ color: T.crimson, textAlign: 'right', fontSize: 15, fontWeight: '700', marginTop: 10 }}>
              {session.finisher.target}
            </Text>
            <View style={{ marginTop: SPACE.lg }}>
              <GoldButton
                label="סיימתי את האימון"
                icon="checkmark-circle-outline"
                tone={T.emerald}
                onPress={() => { buzzWorkoutDone(); onFinish(elapsed); }}
              />
            </View>
          </Glass>
        ) : (
          <>
            <View style={{ flexDirection: ROW_RTL, alignItems: 'center', marginBottom: SPACE.sm }}>
              <Text style={{ color: T.gold, fontSize: 13, fontWeight: '700' }}>
                סבב {round} / {session.rounds}
              </Text>
              <Text style={{ color: T.textFaint, fontSize: 13, marginRight: 10 }}>· בלי מנוחה בין שני התרגילים</Text>
            </View>

            {session.superset.map((ex, i) => (
              <Enter key={ex.move} delay={i * 90} style={{ marginBottom: SPACE.sm }}>
                <Animated.View style={{ transform: [{ scale: i === 0 ? scale : 1 }] }}>
                  <Glass>
                    <View style={{ flexDirection: ROW_RTL, alignItems: 'flex-start' }}>
                      <View style={styles.badge}>
                        <Text style={{ color: T.gold, fontSize: 13, fontWeight: '700' }}>{i + 1}</Text>
                      </View>
                      <View style={{ flex: 1, marginRight: SPACE.sm }}>
                        <Text style={styles.h2}>{ex.move}</Text>
                        <Text style={styles.sub}>{ex.detail}</Text>
                        <Text
                          style={{
                            textAlign: 'right',
                            marginTop: 8,
                            fontSize: 15,
                            fontWeight: ex.failure ? '800' : '600',
                            color: ex.failure ? T.crimson : T.gold,
                          }}
                        >
                          {ex.target}
                        </Text>
                      </View>
                    </View>
                  </Glass>
                </Animated.View>
              </Enter>
            ))}

            <Text style={{ color: T.textFaint, fontSize: 12, textAlign: 'right', lineHeight: 20, marginBottom: SPACE.md }}>
              {'הסט נגמר חזרה אחת לפני הכשל, לא רגע אחרי שנמאס. נמאס זה לא כשל.'}
            </Text>

            <GoldButton
              label={round < session.rounds ? `סיימתי סבב · מנוחה ${session.rest}` : session.finisher ? 'לסט הסיום' : 'סיימתי את האימון'}
              icon="arrow-back"
              onPress={advance}
            />
          </>
        )}
      </Animated.View>

      <TouchableOpacity onPress={onExit} style={{ marginTop: SPACE.lg, alignSelf: 'center' }}>
        <Text style={{ color: T.textFaint, fontSize: 13 }}>יציאה בלי לסמן</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

/* ═══════════════════════════════════════════════════════════
   SCREEN — WORKOUT
   ═══════════════════════════════════════════════════════════ */
/* Titles stay typographic. The gold vector icon already identifies each
   kind of reminder consistently across iOS, Android and the web. */
const REMINDER_CARDS = [
  { id: 'lunch', hour: 13, minute: 30, title: 'צהריים', icon: 'restaurant-outline' },
  { id: 'workout', hour: 18, minute: 30, title: 'עשר דקות. עכשיו.', icon: 'barbell-outline' },
  { id: 'dinner', hour: 20, minute: 30, title: 'ארוחת ערב', icon: 'moon-outline' },
  { id: 'sleep', hour: 23, minute: 15, title: 'מסכים כבים', icon: 'bed-outline' },
];
const REMINDER_CARD_TTL_MINUTES = 60;

function reminderOpen(id, state, now = new Date()) {
  if (id === 'water') {
    /* Two separate questions. The day's target closes water for good;
       a glass logged inside the current hour only answers this hour's
       nudge, and the next round hour asks again. */
    if (state.water >= TARGETS.water) return false;
    if (state.waterAt && sameHour(state.waterAt, now)) return false;
    return true;
  }
  if (id === 'lunch') return !state.meals.lunch;
  if (id === 'dinner') return !state.meals.dinner;
  if (id === 'sleep') return (parseFloat(state.sleep) || 0) < TARGETS.sleep;
  if (id === 'workout') {
    const today = localIso();
    if (state.workoutDone) return false;
    if (state.hiddenDays && state.hiddenDays[today]) return false;
    if (!state.plan || !state.plan[today]) return false;
    return true;
  }
  return false;
}

/* Every route that changes the glass count goes through here, so the
   hourly nudge is answered no matter where you logged the drink —
   the reminder card, the stepper, or the dial. */
function addWater(s, next) {
  const water = Math.max(0, Math.min(TARGETS.water, next));
  if (water === s.water) return s;
  return { ...s, water, waterAt: water > s.water ? Date.now() : s.waterAt };
}

function pendingReminderCards(state, now = new Date()) {
  const mins = minuteOfDay(now);
  const list = REMINDER_CARDS.filter((r) => {
    const due = r.hour * 60 + r.minute;
    return mins >= due && mins < due + REMINDER_CARD_TTL_MINUTES && reminderOpen(r.id, state, now);
  });
  const h = now.getHours();
  /* Water belongs to the current clock hour, so changing hour expires
     the old card and creates the next hour's nudge with a fresh due time. */
  if (h >= WATER_FROM && h <= WATER_TO && reminderOpen('water', state, now)) {
    list.push({ id: 'water', hour: h, minute: 0, title: 'זמן למים', icon: 'water-outline' });
  }
  return list.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
}

/* how far each card behind shows below the one in front, and how many
   of them are worth showing before the pile stops meaning anything.
   The cards are notification-sized now, so the edges showing under the
   front one are proportionally thinner. */
const DECK_PEEK = 9;
const DECK_SEEN = 3;
/* the deck is inset from the page so it floats over it rather than
   filling it, the way a notification does */
const DECK_INSET = SPACE.sm;

function ReminderStack({ state, setState, onStart, open = false }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const live = pendingReminderCards(state);
  const liveKey = live.map((r) => r.id).join('|');

  /* A card has to stay mounted until its fold-away has finished, and
     working that out in an effect was the whole problem: on the render
     where the card stopped being live it was already gone from the list,
     and only the effect afterwards put it back. So it vanished, came
     back, replayed its entrance and only then faded — that flicker is
     what shook the screen. The mounted set is therefore kept in a ref
     and updated while rendering, so a card is never briefly absent.
     Holding the card object rather than its id also preserves the hour
     the water card was raised at while it leaves. */
  const shown = useRef([]);
  const timers = useRef({});

  live.forEach((r) => {
    const i = shown.current.findIndex((c) => c.id === r.id);
    if (i === -1) shown.current.push(r);
    else shown.current[i] = r;
    if (timers.current[r.id]) {
      clearTimeout(timers.current[r.id]);
      delete timers.current[r.id];
    }
  });

  useEffect(() => {
    const ids = new Set(liveKey ? liveKey.split('|') : []);
    shown.current.forEach((c) => {
      if (ids.has(c.id) || timers.current[c.id]) return;
      timers.current[c.id] = setTimeout(() => {
        delete timers.current[c.id];
        shown.current = shown.current.filter((x) => x.id !== c.id);
        tick((n) => n + 1);
      }, 420);
    });
  }, [liveKey]);

  useEffect(
    () => () => {
      Object.values(timers.current).forEach(clearTimeout);
    },
    []
  );

  /* The cards are dealt as a deck rather than listed: one card is up,
     the rest sit behind it, and only their bottom edges show. A list of
     five things to do reads as a chore before you have read any of it;
     one card with a couple of edges behind it reads as one thing to do
     and a hint that there is more. Swiping the top card sends it to the
     back, so the deck can be gone through without answering anything. */
  const [rot, setRot] = useState(0);
  const depth = useRef({});
  const heights = useRef({});
  const deckH = useRef(new Animated.Value(0)).current;
  const settled = useRef(false);

  const liveIds = new Set(live.map((r) => r.id));
  const spin = live.length ? rot % live.length : 0;
  const ordered = live.slice(spin).concat(live.slice(0, spin));
  ordered.forEach((r, i) => {
    depth.current[r.id] = i;
  });

  /* The pile is as tall as whichever card is in front plus the edges
     showing under it. Null means the front card has not been measured
     yet, which is not the same as nothing to show — holding the current
     height through that frame is what keeps the deck from blinking. */
  const frontH = ordered.length ? heights.current[ordered[0].id] : 0;
  const behind = Math.max(0, Math.min(ordered.length - 1, DECK_SEEN - 1));
  const target = ordered.length && open ? (frontH ? frontH + behind * DECK_PEEK : null) : 0;

  useEffect(() => {
    if (target === null) return;
    /* The first height is taken rather than animated to, or a deck that
       starts folded would unfold itself the moment the page loads. */
    if (!settled.current) {
      settled.current = true;
      deckH.setValue(target);
      return;
    }
    Animated.timing(deckH, {
      toValue: target,
      duration: 300,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [target, deckH]);

  const visible = shown.current;

  if (!visible.length) return null;

  const measure = (id, h) => {
    if (!h || heights.current[id] === h) return;
    heights.current[id] = h;
    tick((n) => n + 1);
  };

  const act = (id) => {
    safeVibrate(22);
    if (id === 'water') setState((s) => addWater(s, s.water + 1));
    else if (id === 'lunch') setState((s) => ({ ...s, meals: { ...s.meals, lunch: true } }));
    else if (id === 'dinner') setState((s) => ({ ...s, meals: { ...s.meals, dinner: true } }));
    else if (id === 'workout' && onStart) onStart();
  };

  /* One line each. A notification that has to be read twice is not a
     notification, and the card is now the height of one. */
  const copy = {
    water: 'עוד כוס. הגוף מאט בלעדיה',
    lunch: 'חלבון עכשיו, לא בערב',
    workout: 'עשר דקות וזה מאחוריך',
    dinner: 'השריר נבנה בלילה',
    sleep: 'שבע שעות. כל השאר תלוי בהן',
  };
  const cta = {
    water: 'כוס',
    lunch: w('סמן', 'סמני'),
    workout: w('התחל', 'התחילי'),
    dinner: w('סמן', 'סמני'),
    sleep: null,
  };

  return (
    <Enter delay={60}>
      {/* No heading any more. These sit at the top of the page and look
          like what they are; announcing them as "reminders" first only
          made them read as a list of chores. */}
      {/* Clipped, so folding the deck shut under the bell takes the
          cards with it instead of leaving them stacked on the page. */}
      <Animated.View style={{ height: deckH, marginBottom: SPACE.xs, overflow: 'hidden' }}>
        {visible.map((r) => (
          <ReminderCard
            key={r.id}
            item={r}
            body={copy[r.id]}
            action={cta[r.id]}
            depth={depth.current[r.id] || 0}
            leaving={!liveIds.has(r.id)}
            canSwipe={ordered.length > 1 && liveIds.has(r.id) && depth.current[r.id] === 0}
            onSwipe={() => setRot((n) => n + 1)}
            onMeasure={(h) => measure(r.id, h)}
            onAction={() => act(r.id)}
          />
        ))}
      </Animated.View>

      {/* The pile says how deep it is the way an app badge does */}
      <Collapse open={open && ordered.length > 1}>
        <View style={{ flexDirection: ROW_RTL, alignItems: 'center', justifyContent: 'center', marginTop: 6, marginBottom: SPACE.xs }}>
          {ordered.map((r, i) => (
            <View
              key={r.id}
              style={{
                width: i === 0 ? 14 : 5,
                height: 5,
                borderRadius: 3,
                marginHorizontal: 2.5,
                backgroundColor: i === 0 ? T.gold : T.hairline,
              }}
            />
          ))}
          <Text style={{ color: T.textFaint, fontSize: 10, marginHorizontal: SPACE.xs }}>
            {w('החלק', 'החליקי')}
          </Text>
        </View>
      </Collapse>
    </Enter>
  );
}

/* Collapses its own height as it fades.

   The old card faded in place, held its full height for the whole
   animation, and was then unmounted in a single frame — so the page sat
   still while the card disappeared and only afterwards snapped upward.
   That snap is the jolt. Folding the height away as part of the same
   movement means everything below rides up with the card instead of
   catching up with it afterwards.

   Height cannot go through the native driver, so this view is animated
   on the JS side and the entrance transform stays on its own child. */
function Collapse({ open, children }) {
  const v = useRef(new Animated.Value(open ? 1 : 0)).current;
  const [h, setH] = useState(0);

  useEffect(() => {
    Animated.timing(v, {
      toValue: open ? 1 : 0,
      duration: open ? 240 : 320,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [open, v]);

  return (
    <Animated.View
      style={[
        { overflow: 'hidden', opacity: v },
        h ? { height: v.interpolate({ inputRange: [0, 1], outputRange: [0, h] }) } : null,
      ]}
    >
      <View
        onLayout={(e) => {
          const next = Math.round(e.nativeEvent.layout.height);
          if (next && next !== h) setH(next);
        }}
      >
        {children}
      </View>
    </Animated.View>
  );
}

function ReminderCard({ item, body, action, onAction, depth = 0, leaving, canSwipe, onSwipe, onMeasure }) {
  const enter = useRef(new Animated.Value(0)).current;
  const sink = useRef(new Animated.Value(depth)).current;
  const out = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, friction: 8, tension: 55 }).start();
  }, [enter]);

  useEffect(() => {
    Animated.spring(sink, { toValue: depth, useNativeDriver: true, friction: 10, tension: 62 }).start();
  }, [depth, sink]);

  /* An answered card is thrown off to the side instead of folding away.
     The one behind it is already in place, so it only has to come
     forward — nothing above or below has to move at all. */
  useEffect(() => {
    if (!leaving) return;
    Animated.timing(out, {
      toValue: 1,
      duration: 340,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [leaving, out]);

  const swipeRef = useRef(onSwipe);
  swipeRef.current = onSwipe;
  const armed = useRef(canSwipe);
  armed.current = canSwipe;

  const pan = useRef(
    PanResponder.create({
      /* A tap that drifts is still a tap. At twelve points the card was
         taking the touch off its own action button and then refusing to
         give it back, so a slightly loose press on "add a glass" did
         nothing at all. Nobody swipes a card thirty points by accident. */
      onMoveShouldSetPanResponder: (_, g) =>
        armed.current && Math.abs(g.dx) > 30 && Math.abs(g.dx) > Math.abs(g.dy) * 1.8,
      onPanResponderMove: (_, g) => drag.setValue(g.dx),
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dx) > 72) {
          Animated.timing(drag, {
            toValue: g.dx > 0 ? SCREEN_W : -SCREEN_W,
            duration: 190,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }).start(() => {
            safeVibrate(14);
            swipeRef.current?.();
            /* back of the deck now, and hidden behind the others, so it
               can be put back on its mark without anyone seeing it */
            requestAnimationFrame(() => drag.setValue(0));
          });
        } else {
          Animated.spring(drag, { toValue: 0, useNativeDriver: true, friction: 7 }).start();
        }
      },
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  const steps = [0, 1, 2, 3];
  const lift = sink.interpolate({
    inputRange: steps,
    outputRange: [0, DECK_PEEK, DECK_PEEK * 1.8, DECK_PEEK * 2.3],
    extrapolate: 'clamp',
  });
  const shrink = sink.interpolate({ inputRange: steps, outputRange: [1, 0.955, 0.925, 0.91], extrapolate: 'clamp' });
  const dim = sink.interpolate({ inputRange: steps, outputRange: [1, 0.7, 0.4, 0], extrapolate: 'clamp' });

  /* A slow ring breathing out of the icon. It is the one moving thing
     on a still page, which is the entire reason a notification in any
     of those apps catches the eye at all — and it only runs on the card
     that is actually asking for something. */
  const live = depth === 0 && !leaving;
  const beat = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!live) {
      beat.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(beat, { toValue: 1, duration: 1500, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.delay(900),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [live, beat]);

  return (
    <Animated.View
      {...pan.panHandlers}
      pointerEvents={depth === 0 && !leaving ? 'auto' : 'none'}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: leaving ? 20 : 10 - depth,
        opacity: Animated.multiply(
          Animated.multiply(enter.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }), dim),
          out.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })
        ),
        transform: [
          { translateY: lift },
          { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) },
          { translateX: drag },
          { translateX: out.interpolate({ inputRange: [0, 1], outputRange: [0, SCREEN_W * 0.7] }) },
          { rotate: out.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '6deg'] }) },
          { scale: shrink },
        ],
      }}
    >
      <View
        onLayout={(e) => onMeasure?.(Math.round(e.nativeEvent.layout.height))}
        style={{ marginHorizontal: DECK_INSET }}
      >
        <Glass
          style={{
            flexDirection: ROW_RTL,
            alignItems: 'center',
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: R.md,
            borderColor: T.goldEdge,
            backgroundColor: 'rgba(212,178,106,0.07)',
          }}
        >
          <View style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                width: 36,
                height: 36,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: T.gold,
                opacity: beat.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.5, 0] }),
                /* stays inside the card, which is clipped */
                transform: [{ scale: beat.interpolate({ inputRange: [0, 1], outputRange: [1, 1.55] }) }],
              }}
            />
            {/* Same gold icon visuals; when there is a mark CTA, the
               circle itself is the press target instead of a side pill. */}
            {action ? (
              <TouchableOpacity
                onPress={onAction}
                activeOpacity={0.75}
                hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: T.goldSoft,
                  borderWidth: 1,
                  borderColor: T.goldEdge,
                }}
              >
                <Ionicons name={item.icon} size={17} color={T.gold} />
              </TouchableOpacity>
            ) : (
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: T.goldSoft,
                  borderWidth: 1,
                  borderColor: T.goldEdge,
                }}
              >
                <Ionicons name={item.icon} size={17} color={T.gold} />
              </View>
            )}
          </View>

          <View style={{ flex: 1, marginHorizontal: 10 }}>
            <Text numberOfLines={1} style={{ color: T.text, fontSize: 14, fontWeight: '700', textAlign: 'right' }}>
              {item.title}
            </Text>
            {/* body and time on one line, the way every feed writes it */}
            <Text numberOfLines={1} style={{ color: T.textDim, fontSize: 11.5, textAlign: 'right', marginTop: 2 }}>
              {body} · {String(item.hour).padStart(2, '0')}:{String(item.minute).padStart(2, '0')}
            </Text>
          </View>

          {!action ? (
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: T.gold, opacity: 0.85 }} />
          ) : null}
        </Glass>
      </View>
    </Animated.View>
  );
}

/* Both cards in the metrics row are pinned to one height so the sleep
   card can carry absolutely positioned faces and still line up. */
const METRIC_H = 208;

/** Sleep: editable on the front, a settled tick on the back. */
function SleepCard({ value, onChange, onReset, onGestureChange, closed }) {
  const flip = useRef(new Animated.Value(value ? 1 : 0)).current;
  const [face, setFace] = useState(value ? 1 : 0);
  /* seven hours is the target */
  const hit = (parseFloat(value) || 0) >= TARGETS.sleep;
  /* A night at the target is gold while the day is still running and
     green only once the day has closed, so the two states never say the
     same thing at the same hour. A short night stays copper throughout. */
  const hitTone = sleepColor(parseFloat(value) || 0, closed);

  /* The instructions step back while the ring is being turned — there
     is nothing left to read once you are already doing the thing. */
  const hint = useRef(new Animated.Value(1)).current;
  /* The dial reports that it is still turning on every sample, so the
     fade is only restarted when the answer actually changes — otherwise
     a slow turn would start a fresh animation sixty times a second. */
  const hinting = useRef(false);
  const holdTurn = (on) => {
    if (hinting.current !== on) {
      hinting.current = on;
      Animated.timing(hint, {
        toValue: on ? 0 : 1,
        duration: on ? 140 : 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    }
    onGestureChange?.(on);
  };

  const turn = (to) => {
    setFace(to);
    Animated.spring(flip, { toValue: to, useNativeDriver: false, friction: 9, tension: 22 }).start();
  };

  /* confirming in the middle of the ring settles the card */
  const commit = (v) => {
    onChange(v);
    turn(1);
  };

  const faceBase = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: METRIC_H,
    backfaceVisibility: 'hidden',
    overflow: 'visible',
  };

  return (
    <View style={{ flex: 1, height: METRIC_H }}>
      <Animated.View
        style={[
          faceBase,
          {
            transform: [
              { perspective: 1200 },
              { rotateY: flip.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) },
            ],
          },
        ]}
        pointerEvents={face === 0 ? 'auto' : 'none'}
      >
        {/* Opening the editor by accident used to be a one-way door: the
            only way back to a settled card was to confirm all over again.
            A tap anywhere off the ring now puts the card back as it was.
            The dial keeps its own touches, so dragging still edits. */}
        <Pressable onPress={() => value && turn(1)}>
          <Glass
            style={{
              height: METRIC_H,
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: SPACE.md,
              overflow: 'visible',
            }}
          >
            {/* The page used to go dark behind the ring while it was
                being turned. Holding the page still is the whole of what
                was wanted; dimming it was answering a question nobody
                asked, and a screen that blacks out under your thumb
                reads as something going wrong. */}
            <SleepDial
              value={value}
              onChange={commit}
              onReset={onReset}
              onGestureChange={holdTurn}
              afterClose={closed}
            />
            <Animated.Text
              style={{
                color: T.textFaint,
                fontSize: 11,
                textAlign: 'center',
                marginTop: SPACE.sm,
                lineHeight: 17,
                opacity: hint,
              }}
            >
              {w('גרור עם כיוון השעון', 'גררי עם כיוון השעון')}{'\n'}
              {value ? 'לחיצה במרכז מאשרת · הקש בצד לביטול' : 'לחיצה במרכז מאשרת · סיבוב מלא = 8 שעות'}
            </Animated.Text>
          </Glass>
        </Pressable>
      </Animated.View>

      <Animated.View
        style={[
          faceBase,
          {
            transform: [
              { perspective: 1200 },
              { rotateY: flip.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] }) },
            ],
          },
        ]}
        pointerEvents={face === 1 ? 'auto' : 'none'}
      >
        <TouchableOpacity activeOpacity={0.85} onPress={() => turn(0)}>
          <Glass style={{ height: METRIC_H, alignItems: 'center', justifyContent: 'center', paddingVertical: SPACE.md }}>
            <View
              style={{
                width: 62,
                height: 62,
                borderRadius: 31,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1.2,
                borderColor: hit ? hitTone + '73' : 'rgba(194,118,74,0.45)',
                backgroundColor: hit ? hitTone + '1F' : 'rgba(194,118,74,0.12)',
              }}
            >
              {/* A tick would say "done" about a night that was too short.
                  The shortfall gets its own mark instead. */}
              <Ionicons name={hit ? 'checkmark' : 'arrow-up'} size={28} color={hit ? hitTone : T.copper} />
            </View>
            <Text style={{ color: T.textDim, fontSize: 20, fontWeight: '300', marginTop: SPACE.sm }}>
              {value || '—'} שעות
            </Text>
            <Text style={{ color: hit ? hitTone : T.copper, fontSize: 11, marginTop: 4 }}>
              {hit ? 'ביעד' : 'קצר מדי'}
            </Text>
            <Text style={{ color: T.textFaint, fontSize: 10, marginTop: SPACE.sm }}>הקש לעריכה</Text>
          </Glass>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

function WaterMetricCard({ state, setState, closed }) {
  const flip = useRef(new Animated.Value(closed ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(flip, {
      toValue: closed ? 1 : 0,
      duration: 620,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [closed, flip]);

  const score = state.water <= 5
    ? { label: 'רחוק מהיעד', color: T.copper }
    : state.water <= 7
    ? { label: 'כמעט', color: T.gold }
    : { label: 'סגור', color: T.emerald };

  const face = {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backfaceVisibility: 'hidden',
  };

  return (
    <View style={{ flex: 1, height: METRIC_H, marginLeft: SPACE.xs }}>
      <Animated.View
        pointerEvents={closed ? 'none' : 'auto'}
        style={[
          face,
          {
            transform: [
              { perspective: 1200 },
              { rotateY: flip.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) },
            ],
          },
        ]}
      >
        <Glass style={{ height: METRIC_H, alignItems: 'center', justifyContent: 'center', paddingVertical: SPACE.md }}>
          <TouchableOpacity
            activeOpacity={0.85}
            delayLongPress={500}
            onLongPress={() => {
              safeVibrate(45);
              setState((s) => ({ ...s, water: 0, waterAt: null }));
            }}
          >
            <Dial
              size={112}
              progress={state.water / TARGETS.water}
              color={tierColor(state.water / TARGETS.water, closed)}
              segments={40}
              tick={9}
              thickness={3}
            >
              <Text style={{ color: T.text, fontSize: 21, fontWeight: '300' }}>{(state.water * 0.25).toFixed(1)}</Text>
              <Text style={{ color: T.textFaint, fontSize: 10 }}>מתוך 2.5 ל׳</Text>
            </Dial>
          </TouchableOpacity>
          <View style={{ width: '100%', marginTop: SPACE.sm }}>
            <GhostStepper
              value={state.water}
              unit="כוסות"
              tone={tierColor(state.water / TARGETS.water, closed)}
              onChange={(v) => setState((s) => addWater(s, v))}
            />
          </View>
        </Glass>
      </Animated.View>

      <Animated.View
        pointerEvents={closed ? 'auto' : 'none'}
        style={[
          face,
          {
            transform: [
              { perspective: 1200 },
              { rotateY: flip.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] }) },
            ],
          },
        ]}
      >
        <Glass
          style={{
            height: METRIC_H,
            alignItems: 'center',
            justifyContent: 'center',
            borderColor: score.color + '66',
            backgroundColor: score.color + '12',
          }}
        >
          <Eyebrow color={T.textFaint}>סיכום מים</Eyebrow>
          <Text style={{ color: score.color, fontSize: 42, fontWeight: '200', marginTop: 8 }}>{state.water}</Text>
          <Text style={{ color: T.textDim, fontSize: 12 }}>מתוך {TARGETS.water} כוסות</Text>
          <Text style={{ color: score.color, fontSize: 16, fontWeight: '700', marginTop: SPACE.sm }}>{score.label}</Text>
        </Glass>
      </Animated.View>
    </View>
  );
}

function DailyWorkoutCard({ state, session, planned, onStart, onGoPlanner, closed }) {
  const flip = useRef(new Animated.Value(closed ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(flip, {
      toValue: closed ? 1 : 0,
      duration: 680,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [closed, flip]);

  const tasks = taskState(state);
  const score = Math.round((tasks.done / tasks.total) * 100);
  const meals = MEAL_KEYS.filter((k) => state.meals && state.meals[k]).length;
  const frontRotation = flip.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  const backRotation = flip.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] });

  return (
    <View>
      <Animated.View
        pointerEvents={closed ? 'none' : 'auto'}
        style={{ backfaceVisibility: 'hidden', transform: [{ perspective: 1200 }, { rotateY: frontRotation }] }}
      >
        {session ? (
          <Glass
            tint={state.workoutDone ? T.glass : 'rgba(212,178,106,0.07)'}
            style={{ padding: SPACE.lg, borderColor: state.workoutDone ? T.hairline : T.goldEdge }}
          >
            <Eyebrow color={state.workoutDone ? T.emerald : T.gold}>
              {state.workoutDone ? 'הושלם היום' : planned ? 'מתוכנן להיום' : 'האימון של היום'}
            </Eyebrow>
            <Text style={{ color: T.text, fontSize: 30, fontWeight: '300', textAlign: 'right', marginTop: 10, letterSpacing: -0.5 }}>
              אימון {session.id}
            </Text>
            <Text style={{ color: T.gold, fontSize: 19, fontWeight: '600', textAlign: 'right', marginTop: 2 }}>{session.title}</Text>
            <View style={{ height: StyleSheet.hairlineWidth * 2, backgroundColor: T.hairline, marginVertical: SPACE.md }} />
            {session.superset.map((ex) => (
              <View key={ex.move} style={{ flexDirection: ROW_RTL, justifyContent: 'space-between', marginBottom: 8 }}>
                <Text style={{ color: T.textDim, fontSize: 14, flex: 1, textAlign: 'right' }}>{ex.move}</Text>
                <Text style={{ color: ex.failure ? T.crimson : T.textFaint, fontSize: 13 }}>{ex.target}</Text>
              </View>
            ))}
            {session.finisher ? (
              <View style={{ flexDirection: ROW_RTL, justifyContent: 'space-between' }}>
                <Text style={{ color: T.textDim, fontSize: 14, flex: 1, textAlign: 'right' }}>{session.finisher.move}</Text>
                <Text style={{ color: T.crimson, fontSize: 13 }}>{session.finisher.target}</Text>
              </View>
            ) : null}
            <Text style={{ color: T.textFaint, fontSize: 13, textAlign: 'right', marginTop: SPACE.md, marginBottom: SPACE.md }}>
              {session.rounds} סבבים · {session.rest} שניות מנוחה
            </Text>
            <GoldButton
              label={state.workoutDone ? w('הרץ שוב', 'הריצי שוב') : w('התחל אימון', 'התחילי אימון')}
              icon={state.workoutDone ? 'refresh-outline' : 'flash-outline'}
              subtle={state.workoutDone}
              onPress={onStart}
            />
          </Glass>
        ) : (
          <Glass tint="rgba(255,255,255,0.03)" style={{ padding: SPACE.lg }}>
            <Eyebrow>מנוחה</Eyebrow>
            <Text style={{ color: T.text, fontSize: 28, fontWeight: '300', textAlign: 'right', marginTop: 10, letterSpacing: -0.5 }}>
              אין אימון להיום
            </Text>
            <Text style={{ color: T.textDim, fontSize: 14, textAlign: 'right', marginTop: 8, lineHeight: 22 }}>
              היום ריק בתכנון. {w('שבץ', 'שבצי')} A · B · C · D על התאריך הזה,
              והכרטיס יתמלא מעצמו.
            </Text>
            <View style={{ marginTop: SPACE.lg }}>
              <GoldButton label="לתכנון השבוע" icon="calendar-outline" subtle onPress={onGoPlanner} />
            </View>
          </Glass>
        )}
      </Animated.View>

      <Animated.View
        pointerEvents={closed ? 'auto' : 'none'}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          backfaceVisibility: 'hidden',
          transform: [{ perspective: 1200 }, { rotateY: backRotation }],
        }}
      >
        <Glass
          style={{
            height: '100%',
            padding: SPACE.lg,
            justifyContent: 'center',
            borderColor: score === 100 ? T.emerald + '66' : T.goldEdge,
          }}
        >
          <View style={{ flexDirection: ROW_RTL, alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ alignItems: 'flex-end' }}>
              <Eyebrow color={score === 100 ? T.emerald : T.gold}>סיכום יומי</Eyebrow>
              <Text style={{ color: T.text, fontSize: 24, fontWeight: '300', marginTop: 6 }}>
                {tasks.done} מתוך {tasks.total} משימות
              </Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: score === 100 ? T.emerald : T.gold, fontSize: 38, fontWeight: '200' }}>{score}</Text>
              <Text style={{ color: T.textFaint, fontSize: 10 }}>ציון היום</Text>
            </View>
          </View>
          <View style={{ height: 1, backgroundColor: T.hairline, marginVertical: SPACE.md }} />
          <View style={{ flexDirection: ROW_RTL, justifyContent: 'space-between' }}>
            {[
              ['barbell-outline', state.workoutDone ? 'בוצע' : 'לא בוצע', 'אימון'],
              ['water-outline', `${state.water}/${TARGETS.water}`, 'מים'],
              ['bed-outline', state.sleep ? `${state.sleep} ש׳` : '—', 'שינה'],
              ['nutrition-outline', `${meals}/3`, 'ארוחות'],
            ].map(([icon, value, label]) => (
              <View key={label} style={{ alignItems: 'center', flex: 1 }}>
                <Ionicons name={icon} size={18} color={T.gold} />
                <Text style={{ color: T.text, fontSize: 12, fontWeight: '700', marginTop: 5 }}>{value}</Text>
                <Text style={{ color: T.textFaint, fontSize: 10, marginTop: 2 }}>{label}</Text>
              </View>
            ))}
          </View>
        </Glass>
      </Animated.View>
    </View>
  );
}

function WorkoutScreen({ state, setState, session, planned, onStart, onResetProfile, onGoPlanner }) {
  const insets = useSafeAreaInsets();
  /* Nothing here holds the page still any more. The sleep ring claims the
     touch the moment a finger lands on it and blocks the native responder
     while it holds it, which is what actually keeps the page from sliding
     under the thumb. Turning scrollEnabled off on top of that added a
     second, slower switch for the same job — one that Android can be left
     sitting on if the gesture ends in a way the switch never hears about,
     and a page that cannot scroll says nothing until it is taller than the
     screen. One mechanism, owned by the thing being touched. */
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 15000);
    return () => clearInterval(id);
  }, []);
  const dayClosed = clock.getHours() >= 22;
  const sleepNum = parseFloat(state.sleep) || 0;
  const streakShown = Math.round(useEased(state.streak, 900));
  const tasks = taskState(state);
  const rank = rankFor((state.log || []).length);
  /* Evening, work still open, a streak on the line. Saying how many
     hours are left turns a vague intention into a deadline. */
  const hoursLeft = 24 - clock.getHours();
  const atRisk = state.streak > 0 && tasks.done < tasks.total && hoursLeft <= 5;

  /* The bell and the deck below it are the same thing seen twice, so
     they count from one place. The clock ticking every fifteen seconds
     is what brings a reminder's hour round. */
  const pending = pendingReminderCards(state, clock).length;
  /* The deck starts folded away. The page opens on the workout, and the
     reminders are there for whoever presses the circle to ask for them. */
  const [notifOpen, setNotifOpen] = useState(false);

  return (
    <ScrollView
      contentContainerStyle={{ padding: SPACE.md, paddingBottom: 150 + insets.bottom }}
      showsVerticalScrollIndicator={false}
    >
      <Enter>
        <View style={{ flexDirection: ROW_RTL, justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: SPACE.md }}>
          <TouchableOpacity activeOpacity={1} onLongPress={onResetProfile} delayLongPress={900}>
            <Eyebrow>{new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}</Eyebrow>
            <Text style={[styles.h1, { fontSize: 34, marginTop: 4 }]}>TEN 10</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: ROW_RTL, alignItems: 'center' }}>
            <NotifBell
              count={pending}
              open={notifOpen}
              onPress={() => setNotifOpen((v) => !v)}
              afterClose={dayClosed}
            />
            <View style={{ width: StyleSheet.hairlineWidth * 2, height: 34, backgroundColor: T.hairline, marginHorizontal: SPACE.md }} />
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: state.streak > 0 ? T.gold : T.textFaint, fontSize: 26, fontWeight: '200' }}>{streakShown}</Text>
              <Text style={{ color: state.graceUsed ? T.copper : T.textFaint, fontSize: 11, letterSpacing: 1.5, marginTop: 3 }}>
                {state.graceUsed ? 'רצף · חסד' : 'רצף'}
              </Text>
            </View>
          </View>
        </View>

        {/* One quiet line where three boxes used to be. Your standing and
            the thing at stake, said in words, with nothing to decode. */}
        <Text style={{ color: atRisk ? T.crimson : T.textFaint, fontSize: 14, textAlign: 'right', marginBottom: SPACE.lg, lineHeight: 22 }}>
          {atRisk
            ? `הרצף נגמר בחצות. ${hoursLeft === 1 ? 'נשארה שעה אחת' : `נשארו ${hoursLeft} שעות`}.`
            : rank.next
            ? `${rank.name} · עוד ${nHe(rank.left, 'אימון', 'אימונים')} ל${rank.next}`
            : `${rank.name} · אין דרגה מעל זו`}
        </Text>
      </Enter>

      {/* Anything still owed today is said before anything else. Under
          the workout card it was below the fold as often as not, which
          is a strange place to put the one part of the page that is
          asking you to do something. */}
      <ReminderStack open={notifOpen} state={state} setState={setState} onStart={session ? onStart : null} />

      <Enter delay={80}>
        <DailyWorkoutCard
          state={state}
          session={session}
          planned={planned}
          onStart={onStart}
          onGoPlanner={onGoPlanner}
          closed={dayClosed}
        />
      </Enter>

      {/* ── one task left: the loudest thing on the screen ── */}
      {(() => {
        const t = taskState(state);
        if (t.done !== t.total - 1) return null;
        return (
          <Enter delay={120}>
            <Glass
              style={{
                marginTop: SPACE.md,
                borderColor: T.gold,
                borderWidth: 1.2,
                backgroundColor: 'rgba(212,178,106,0.10)',
              }}
            >
              <View style={{ flexDirection: ROW_RTL, alignItems: 'center' }}>
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: T.goldSoft,
                    borderWidth: 1,
                    borderColor: T.goldEdge,
                  }}
                >
                  <Text style={{ color: T.gold, fontSize: 17, fontWeight: '800' }}>1</Text>
                </View>
                <View style={{ flex: 1, marginHorizontal: SPACE.sm }}>
                  <Text style={{ color: T.gold, fontSize: 16, fontWeight: '700', textAlign: 'right' }}>
                    נשארה משימה אחת
                  </Text>
                  <Text style={{ color: T.textDim, fontSize: 13, textAlign: 'right', marginTop: 2 }}>
                    {t.missing[0].why} · ואז {ultraWord()}
                  </Text>
                </View>
              </View>
            </Glass>
          </Enter>
        );
      })()}

      {/* ── מדדי היום ── */}
      <Enter delay={210}>
        <Text style={[styles.sectionTitle, { marginTop: SPACE.lg }]}>מים ושינה</Text>
        <View style={{ flexDirection: ROW_RTL, overflow: 'visible' }}>
          <WaterMetricCard state={state} setState={setState} closed={dayClosed} />

          <SleepCard
            value={state.sleep}
            onChange={(v) => setState((s) => ({ ...s, sleep: v }))}
            onReset={() => setState((s) => ({ ...s, sleep: '' }))}
            closed={dayClosed}
          />
        </View>
      </Enter>

      <Text style={{ color: T.textFaint, fontSize: 11, textAlign: 'center', marginTop: SPACE.xs }}>
        לחיצה ארוכה על עיגול מאפסת אותו
      </Text>

      {state.sleep && sleepNum < 6 ? (
        <Enter delay={80}>
          <Glass tint="rgba(194,118,74,0.08)" style={{ marginTop: SPACE.sm, borderColor: 'rgba(194,118,74,0.25)' }}>
            <Text style={{ color: T.copper, fontSize: 13, textAlign: 'right', lineHeight: 21 }}>
              פחות משש שעות. האימון הבא ירגיש כבד יותר, וזה לא מקרי —
              ההתאוששות קורית בשינה, לא באימון.
            </Text>
          </Glass>
        </Enter>
      ) : null}

    </ScrollView>
  );
}

/* ═══════════════════════════════════════════════════════════
   SCREEN — NUTRITION
   The menu is a wheel, exactly like the planner: one meal square-on
   at a time, the rest tipped away. Nothing else on the screen moves.
   ═══════════════════════════════════════════════════════════ */
const MEAL_CARD_H = 188;
const MEAL_ITEM = MEAL_CARD_H + SPACE.sm;
/* the dial gives up height on short phones so the wheel keeps a full slot */
const DIAL_N = SCREEN_H < 720 ? 128 : 152;

/* A tick, watched as it is drawn rather than judged after the fact.

   Only three things make a tick a tick: the finger goes down, it turns a
   corner, and it comes back up. Everything else — how steep the legs
   are, which way they lean, how long the stroke is — is handwriting, and
   handwriting differs every time. So the watcher keeps the deepest point
   the finger has reached and asks only how far it fell to get there and
   how far it has climbed since. The moment both are past the threshold
   the tick is done, under the finger, with nothing to lift or confirm. */
const TICK_DROP = 14;
const TICK_RISE = 14;
const TICK_SPAN = 12;

function tickWatch(p) {
  return { x0: p.x, y0: p.y, vy: p.y, minX: p.x, maxX: p.x };
}

function tickFeed(st, p) {
  if (p.y > st.vy) st.vy = p.y;
  if (p.x < st.minX) st.minX = p.x;
  if (p.x > st.maxX) st.maxX = p.x;

  const drop = st.vy - st.y0;
  const rise = st.vy - p.y;
  const span = st.maxX - st.minX;

  return drop >= TICK_DROP && rise >= TICK_RISE && span >= TICK_SPAN;
}

/* Marking a meal costs a gesture instead of a tap, and the gesture is
   drawn straight across the card with nothing to aim at. A tap is
   something you do without noticing; a tick you have to draw is a small
   act you have to mean. Nothing is painted while the finger moves — the
   only thing that answers is the card going green when it is accepted.

   Only the card at the centre listens. The ones tipped away answer a
   tap by turning to the front, which is also how the wheel moves. */
function MealCard({ mealKey, meal, active, onFocus, onEat, onSwap }) {
  const meta = MEAL_META[mealKey];
  const flash = useRef(new Animated.Value(0)).current;
  const watch = useRef(null);
  const fired = useRef(false);

  const doneRef = useRef(onEat);
  doneRef.current = onEat;
  const activeRef = useRef(active);
  activeRef.current = active;
  const swapRef = useRef(onSwap);
  swapRef.current = onSwap;
  const swapPress = useRef(new Animated.Value(0)).current;

  const complete = () => {
    if (fired.current) return;
    fired.current = true;
    safeVibrate([0, 25, 45, 30]);
    Animated.timing(flash, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => doneRef.current());
  };

  /* The swap button carries its own responder rather than a Touchable.
     The card's tick gesture claims the touch again on the first pixel of
     movement, and a Touchable hands the responder over the moment it is
     asked, so every tap that was not perfectly still was swallowed
     before it could fire. Holding on to the touch and refusing to give
     it up keeps the tap intact however much the finger drifts. */
  const swapPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        swapPress.setValue(1);
      },
      onPanResponderRelease: (_, g) => {
        swapPress.setValue(0);
        if (Math.abs(g.dx) < 22 && Math.abs(g.dy) < 22) {
          safeVibrate(10);
          swapRef.current();
        }
      },
      onPanResponderTerminate: () => {
        swapPress.setValue(0);
      },
    })
  ).current;

  /* Nothing competes for this gesture any more, so the card takes the
     touch the instant it lands and sees the whole stroke. Claiming late
     was the real fault before: the downstroke had already happened by
     the time the card started watching, so the corner was never in the
     path and the tick could not be found. */
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => activeRef.current,
      onMoveShouldSetPanResponder: () => activeRef.current,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (_, g) => {
        fired.current = false;
        watch.current = tickWatch({ x: g.x0, y: g.y0 });
      },
      onPanResponderMove: (_, g) => {
        if (fired.current || !watch.current) return;
        if (tickFeed(watch.current, { x: g.moveX, y: g.moveY })) complete();
      },
      onPanResponderTerminate: () => {
        watch.current = null;
      },
    })
  ).current;

  return (
    <View {...pan.panHandlers}>
      <Pressable onPress={active ? undefined : onFocus}>
      <Glass style={{ height: MEAL_CARD_H, paddingVertical: SPACE.sm, justifyContent: 'center' }}>
        <View style={{ flexDirection: ROW_RTL, alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: ROW_RTL, alignItems: 'center' }}>
            <Ionicons name={meta.icon} size={17} color={T.gold} />
            <Text style={{ color: T.text, fontSize: 17, fontWeight: '600', marginRight: 8 }}>{meta.label}</Text>
            <Text style={{ color: T.textFaint, fontSize: 11, letterSpacing: 1.4, marginRight: 8 }}>{meta.time}</Text>
          </View>
          <Text style={{ color: T.gold, fontSize: 13, fontWeight: '600' }}>{meal.p} גר׳ חלבון</Text>
        </View>

        <Text
          style={{ color: T.textDim, fontSize: 15, textAlign: 'right', lineHeight: 22, marginTop: 8 }}
          numberOfLines={2}
        >
          {meal.t}
        </Text>

        <Text style={{ color: T.textFaint, fontSize: 12, textAlign: 'right', marginTop: 8 }}>
          {meal.kcal} קק״ל · {meal.c} פחמ׳ · {meal.f} שומן
        </Text>

        <View style={{ flexDirection: ROW_RTL, alignItems: 'center', justifyContent: 'space-between', marginTop: SPACE.md }}>
          <Text style={{ color: T.textFaint, fontSize: 13 }}>
            {active ? w('צייר וי לסימון', 'ציירי וי לסימון') : 'הקש להביא לכאן'}
          </Text>
          {active ? (
            <Animated.View
              {...swapPan.panHandlers}
              style={{
                width: 40,
                height: 40,
                borderRadius: R.sm,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(255,255,255,0.05)',
                borderWidth: StyleSheet.hairlineWidth * 2,
                borderColor: T.hairline,
                opacity: swapPress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.55] }),
                transform: [{ scale: swapPress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.92] }) }],
              }}
            >
              <Ionicons name="shuffle-outline" size={19} color={T.gold} />
            </Animated.View>
          ) : null}
        </View>

        {/* the whole card answers in green the instant the tick lands */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderRadius: R.lg,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(63,169,138,0.18)',
            opacity: flash,
            transform: [{ scale: flash.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
          }}
        >
          <Ionicons name="checkmark-circle" size={44} color={T.emerald} />
        </Animated.View>
      </Glass>
      </Pressable>
    </View>
  );
}

function NutritionScreen({ state, setState }) {
  const insets = useSafeAreaInsets();
  /* the menu turns over at midnight, so the page has to come round with
     the clock and not only when a meal is marked */
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);
  const dayIdx = Math.floor(Date.parse(localIso()) / 86400000);
  const keys = ['breakfast', 'lunch', 'dinner'];
  const openKeys = keys.filter((k) => mealVisible(k, state.meals));
  const mealFor = (k) => MEALS[k][(dayIdx + state.swaps[k]) % MEALS[k].length];

  const totals = useMemo(
    () =>
      keys.reduce(
        (acc, k) => {
          if (!state.meals[k]) return acc;
          const m = mealFor(k);
          return { kcal: acc.kcal + m.kcal, p: acc.p + m.p, c: acc.c + m.c, f: acc.f + m.f };
        },
        { kcal: 0, p: 0, c: 0, f: 0 }
      ),
    /* the menu itself turns over at midnight, so the totals have to be
       recounted then too or the macros describe yesterday's food */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.meals, state.swaps, dayIdx]
  );

  const kcalShown = Math.round(useEased(totals.kcal, 900));

  const protein = {
    value: totals.p,
    target: TARGETS.protein,
    color: tierColor(totals.p / TARGETS.protein),
  };

  const wheel = useRef(new Animated.Value(0)).current;
  const [wheelH, setWheelH] = useState(MEAL_ITEM * 2);
  const [center, setCenter] = useState(0);

  const turnTo = (slot) => {
    safeVibrate(20);
    setCenter(slot);
    Animated.spring(wheel, {
      toValue: slot * MEAL_ITEM,
      useNativeDriver: true,
      friction: 9,
      tension: 46,
    }).start();
  };

  /* marking a meal removes it, so the wheel may be left pointing past
     the end of the list */
  const lastSlot = Math.max(0, openKeys.length - 1);
  useEffect(() => {
    if (center <= lastSlot) return;
    setCenter(lastSlot);
    wheel.setValue(lastSlot * MEAL_ITEM);
  }, [lastSlot, center, wheel]);

  /* Nothing on this screen scrolls except the wheel itself, so the dial
     never drifts out from under your thumb while you pick a meal. */
  return (
    <View style={{ flex: 1, padding: SPACE.md, paddingBottom: 88 + insets.bottom }}>
      <Enter>
        <View style={{ flexDirection: ROW_RTL, alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: SPACE.md }}>
          <View>
            <Eyebrow>תזונה</Eyebrow>
            <Text style={[styles.h1, { fontSize: 34, marginTop: 4 }]}>התפריט של היום</Text>
          </View>
        </View>
      </Enter>

      <Enter delay={70}>
        <Glass style={{ alignItems: 'center', paddingVertical: SPACE.md }}>
          <TouchableOpacity
            activeOpacity={0.85}
            delayLongPress={500}
            onLongPress={() => {
              safeVibrate(45);
              setState((s) => ({ ...s, meals: { breakfast: false, lunch: false, dinner: false } }));
            }}
          >
            <Dial
              size={DIAL_N}
              progress={totals.kcal / TARGETS.kcal}
              color={tierColor(totals.kcal / TARGETS.kcal)}
              segments={60}
              tick={15}
            >
              <Text style={{ color: T.text, fontSize: 36, fontWeight: '200' }}>{kcalShown}</Text>
              <Text style={{ color: T.textFaint, fontSize: 11, letterSpacing: 1 }}>מתוך {TARGETS.kcal} קק״ל</Text>
            </Dial>
          </TouchableOpacity>

          {/* Protein is the one number that decides whether the muscle
              stays, so it is the only one that gets a bar. The other two
              sit in a single faint line for anyone who wants them. */}
          <View style={{ width: '100%', marginTop: SPACE.md }}>
            <View style={{ flexDirection: ROW_RTL, justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={{ color: T.textDim, fontSize: 14, fontWeight: '600' }}>חלבון</Text>
              <Text style={{ color: protein.value >= protein.target ? T.emerald : T.textFaint, fontSize: 14 }}>
                {protein.value} מתוך {protein.target} גר׳
              </Text>
            </View>
            <Bar progress={protein.value / protein.target} color={protein.color} height={5} />
            <Text style={{ color: T.textFaint, fontSize: 12, textAlign: 'center', marginTop: SPACE.sm }}>
              פחמימה {totals.c} גר׳ · שומן {totals.f} גר׳
            </Text>
          </View>
        </Glass>
      </Enter>

      {/* The wheel turns on a tap, not on a scroll. A scroll view is a
          native gesture that runs alongside the responder system rather
          than inside it, so while you drew a tick it kept scrolling
          underneath your finger and no amount of claiming could stop it.
          Driving the position ourselves removes the race entirely and
          leaves every card free to be drawn on. */}
      <View style={{ flex: 1, marginTop: SPACE.md, overflow: 'hidden' }} onLayout={(e) => setWheelH(e.nativeEvent.layout.height)}>
        {openKeys.length ? (
          <Animated.View
            style={{
              paddingTop: Math.max(0, (wheelH - MEAL_ITEM) / 2),
              transform: [{ translateY: Animated.multiply(wheel, -1) }],
            }}
          >
            {openKeys.map((k, slot) => {
              const at = slot * MEAL_ITEM;
              const range = [at - MEAL_ITEM * 2, at - MEAL_ITEM, at, at + MEAL_ITEM, at + MEAL_ITEM * 2];
              return (
                <Animated.View
                  key={k}
                  style={{
                    height: MEAL_ITEM,
                    justifyContent: 'center',
                    opacity: wheel.interpolate({
                      inputRange: range,
                      outputRange: [0.3, 0.7, 1, 0.7, 0.3],
                      extrapolate: 'clamp',
                    }),
                    transform: [
                      { perspective: 900 },
                      {
                        rotateX: wheel.interpolate({
                          inputRange: range,
                          outputRange: ['-46deg', '-24deg', '0deg', '24deg', '46deg'],
                          extrapolate: 'clamp',
                        }),
                      },
                      {
                        scale: wheel.interpolate({
                          inputRange: range,
                          outputRange: [0.8, 0.91, 1, 0.91, 0.8],
                          extrapolate: 'clamp',
                        }),
                      },
                      {
                        translateY: wheel.interpolate({
                          inputRange: range,
                          outputRange: [MEAL_ITEM * 0.2, MEAL_ITEM * 0.09, 0, -MEAL_ITEM * 0.09, -MEAL_ITEM * 0.2],
                          extrapolate: 'clamp',
                        }),
                      },
                    ],
                  }}
                >
                  <MealCard
                    mealKey={k}
                    meal={mealFor(k)}
                    active={slot === center}
                    onFocus={() => turnTo(slot)}
                    onEat={() => setState({ ...state, meals: { ...state.meals, [k]: true } })}
                    onSwap={() => setState({ ...state, swaps: { ...state.swaps, [k]: state.swaps[k] + 1 } })}
                  />
                </Animated.View>
              );
            })}
          </Animated.View>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACE.lg }}>
            <Text style={{ color: T.textDim, fontSize: 15, textAlign: 'center', lineHeight: 25 }}>
              אין ארוחות פתוחות. מה שסומן, ומה שהשעה שלו עברה, חוזר מחר.
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════
   SCREEN — WEEK PLANNER
   Sunday to Friday, six cards. Saturday is never rendered.

   Gestures on a card:
     tap the card → flip it over and read the two exercises
     tap the pill → cycle A → B → C → D → rest, card stays put
     swipe right  → the day slides out and collapses away
   ═══════════════════════════════════════════════════════════ */
const PLAN_CYCLE = [null, 'A', 'B', 'C', 'D'];
const WEEK_TARGET = 4;
const CARD_H = 108;
const CARD_GAP = SPACE.sm;
const SWIPE_OUT = 78;
/* One slot per card. The container measures itself and pads by half its
   own height, so the first card centres on any screen size. */
const WHEEL_ITEM = CARD_H + CARD_GAP;

function DayCard({ date, index, session, done, isToday, onCycle, onRemove, onDrag }) {
  /* PanResponder is built once and never rebuilt, so a callback captured
     inside it would freeze the state from the FIRST render. Every later
     swipe would then write that stale state back and undo everything
     done since. Route through a ref that is refreshed each render. */
  const removeRef = useRef(onRemove);
  removeRef.current = onRemove;
  const dragRef = useRef(onDrag);
  dragRef.current = onDrag;
  const setDrag = (v) => {
    if (dragRef.current) dragRef.current(v);
  };

  const flip = useRef(new Animated.Value(0)).current;
  const x = useRef(new Animated.Value(0)).current;
  const box = useRef(new Animated.Value(CARD_H)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const [face, setFace] = useState(0);

  const turn = () => {
    const to = face === 0 ? 1 : 0;
    setFace(to);
    Animated.spring(flip, { toValue: to, useNativeDriver: false, friction: 9, tension: 22 }).start();
  };

  const vanish = () => {
    Animated.sequence([
      Animated.timing(x, { toValue: SCREEN_W, duration: 130, easing: Easing.out(Easing.quad), useNativeDriver: false }),
      Animated.parallel([
        Animated.timing(box, { toValue: 0, duration: 130, easing: Easing.out(Easing.quad), useNativeDriver: false }),
        Animated.timing(fade, { toValue: 0, duration: 90, useNativeDriver: false }),
      ]),
    ]).start(() => removeRef.current());
  };

  /* Capture beats the wheel's ScrollView, which would otherwise swallow
     the gesture the moment a finger moves. The wheel is told to stop
     scrolling for the duration so the two never fight. */
  const claim = (_, g) => g.dx > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2;

  const settle = () => {
    setDrag(false);
    Animated.spring(x, { toValue: 0, useNativeDriver: false, friction: 7, tension: 70 }).start();
  };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: claim,
      onMoveShouldSetPanResponderCapture: claim,
      onPanResponderGrant: () => setDrag(true),
      onPanResponderMove: (_, g) => {
        if (g.dx > 0) x.setValue(g.dx);
      },
      onPanResponderRelease: (_, g) => {
        setDrag(false);
        if (g.dx > SWIPE_OUT || g.vx > 0.35) vanish();
        else Animated.spring(x, { toValue: 0, useNativeDriver: false, friction: 7, tension: 70 }).start();
      },
      onPanResponderTerminate: settle,
    })
  ).current;

  const faceBase = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: CARD_H,
    backfaceVisibility: 'hidden',
  };
  const front = {
    transform: [
      { perspective: 1200 },
      { rotateY: flip.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) },
    ],
  };
  const back = {
    transform: [
      { perspective: 1200 },
      { rotateY: flip.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] }) },
    ],
  };

  const border = done ? 'rgba(63,169,138,0.4)' : isToday ? T.goldEdge : T.hairline;
  const bg = done ? 'rgba(63,169,138,0.06)' : isToday ? 'rgba(212,178,106,0.05)' : T.glass;

  return (
    <Animated.View style={{ height: box, opacity: fade, overflow: 'hidden' }}>
      <Animated.View
        {...pan.panHandlers}
        style={{
          height: CARD_H,
          transform: [
            { translateX: x },
            /* the card lifts slightly at the midpoint of the turn */
            { scale: flip.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.94, 1] }) },
          ],
        }}
      >
        {/* trailing hint revealed while dragging */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            bottom: CARD_GAP,
            left: 0,
            right: 0,
            borderRadius: R.lg,
            backgroundColor: 'rgba(212,92,75,0.10)',
            alignItems: 'flex-start',
            justifyContent: 'center',
            paddingHorizontal: SPACE.lg,
            opacity: x.interpolate({ inputRange: [0, SWIPE_OUT * 0.75], outputRange: [0, 1], extrapolate: 'clamp' }),
          }}
        >
          <Ionicons name="trash-outline" size={20} color={T.crimson} />
        </Animated.View>

        {/* Both faces sit on top of each other, and the back one is drawn
            last, so it owns every touch on the card even while it is
            turned away. backfaceVisibility hides it from the eye but not
            from the responder, which is why the selector kept flipping
            the card instead of firing. Only the face you can see may
            receive touches. */}
        <Animated.View style={[faceBase, front]} pointerEvents={face === 0 ? 'auto' : 'none'}>
          <Glass style={{ height: CARD_H, justifyContent: 'center', borderColor: border, backgroundColor: bg }}>
            <View style={{ flexDirection: ROW_RTL, alignItems: 'center' }}>
              <Pressable
                onPress={turn}
                style={{ flex: 1, flexDirection: ROW_RTL, alignItems: 'center' }}
              >
                <View style={{ alignItems: 'center', width: 52 }}>
                  <Text style={{ color: isToday ? T.gold : T.textDim, fontSize: 24, fontWeight: '300' }}>
                    {date.getDate()}
                  </Text>
                  <Text style={{ color: T.textFaint, fontSize: 11 }}>{HE_DAYS[index]}</Text>
                </View>

                <View style={{ flex: 1, paddingHorizontal: SPACE.sm }}>
                  {session ? (
                    <>
                      <Text style={{ color: T.text, fontSize: 16, fontWeight: '600', textAlign: 'right' }}>
                        אימון {session.id}
                      </Text>
                      <Text style={{ color: T.gold, fontSize: 13, textAlign: 'right', marginTop: 2 }}>
                        {session.title}
                      </Text>
                    </>
                  ) : (
                    <Text style={{ color: T.textFaint, fontSize: 15, textAlign: 'right' }}>
                      מנוחה · הכפתור משמאל משבץ אימון
                    </Text>
                  )}
                  {isToday ? (
                    <Text style={{ color: T.gold, fontSize: 10, letterSpacing: 1.5, textAlign: 'right', marginTop: 4 }}>
                      היום
                    </Text>
                  ) : null}
                </View>
              </Pressable>

              {/* one short tap moves through A · B · C · D · rest */}
              <Pressable
                onPress={onCycle}
                accessibilityLabel="החלף אימון"
                hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                style={({ pressed }) => ({
                  width: 52,
                  height: 38,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: ROW_RTL,
                  opacity: pressed ? 0.6 : 1,
                  backgroundColor: done ? T.emerald : session ? T.goldSoft : 'rgba(255,255,255,0.06)',
                  borderWidth: session || done ? 1.2 : StyleSheet.hairlineWidth * 2,
                  borderColor: done ? T.emerald : session ? T.gold : T.hairline,
                })}
              >
                <Text style={{ color: done ? '#0A0D12' : session ? T.gold : T.textFaint, fontWeight: '700', fontSize: 14 }}>
                  {session ? session.id : '—'}
                </Text>
                <Ionicons
                  name="chevron-back"
                  size={13}
                  color={done ? '#0A0D12' : session ? T.gold : T.textFaint}
                  style={{ marginRight: 3 }}
                />
              </Pressable>
            </View>
          </Glass>
        </Animated.View>

        {/* back */}
        <Animated.View style={[faceBase, back]} pointerEvents={face === 1 ? 'auto' : 'none'}>
          <Pressable onPress={turn}>
            <Glass
              style={{
                height: CARD_H,
                justifyContent: 'center',
                borderColor: T.goldEdge,
                backgroundColor: 'rgba(212,178,106,0.07)',
                paddingVertical: SPACE.sm,
              }}
            >
              {session ? (
                <>
                  <View style={{ flexDirection: ROW_RTL, justifyContent: 'space-between', marginBottom: 6 }}>
                    <Text style={{ color: T.gold, fontSize: 13, fontWeight: '700' }}>
                      {session.id} · {session.title}
                    </Text>
                    <Text style={{ color: T.textFaint, fontSize: 11 }}>{session.rounds} סבבים</Text>
                  </View>
                  {session.superset.map((ex) => (
                    <View key={ex.move} style={{ flexDirection: ROW_RTL, justifyContent: 'space-between', marginTop: 3 }}>
                      <Text style={{ color: T.textDim, fontSize: 12, flex: 1, textAlign: 'right' }} numberOfLines={1}>
                        {ex.move}
                      </Text>
                      <Text style={{ color: ex.failure ? T.crimson : T.textFaint, fontSize: 11, marginHorizontal: 6 }}>
                        {ex.target}
                      </Text>
                    </View>
                  ))}
                  {session.finisher ? (
                    <Text style={{ color: T.crimson, fontSize: 11, textAlign: 'right', marginTop: 4 }} numberOfLines={1}>
                      סיום · {session.finisher.move}
                    </Text>
                  ) : null}
                </>
              ) : (
                <Text style={{ color: T.textFaint, fontSize: 14, textAlign: 'center' }}>
                  אין אימון משובץ ליום הזה
                </Text>
              )}
            </Glass>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

/* Flip card: day summary on the front, week summary on the back. */
function SummaryPicker({ onOpen }) {
  const flip = useRef(new Animated.Value(0)).current;
  const [face, setFace] = useState(0);
  const faceRef = useRef(0);
  const turnRef = useRef(null);
  const suppressPress = useRef(false);
  const H = 68;

  const turn = () => {
    const to = faceRef.current === 0 ? 1 : 0;
    faceRef.current = to;
    setFace(to);
    safeVibrate(18);
    Animated.spring(flip, { toValue: to, useNativeDriver: true, friction: 9, tension: 22 }).start();
  };
  turnRef.current = turn;

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.25,
      onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.25,
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dx) < 28) return;
        suppressPress.current = true;
        turnRef.current();
        setTimeout(() => {
          suppressPress.current = false;
        }, 180);
      },
      onPanResponderTerminate: () => {
        suppressPress.current = false;
      },
    })
  ).current;

  const faceBase = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: H,
    backfaceVisibility: 'hidden',
  };

  const Face = ({ mode, label, icon }) => (
    <Pressable
      onPress={() => {
        if (!suppressPress.current) onOpen(mode);
      }}
    >
      <Glass
        style={{
          height: H,
          justifyContent: 'center',
          borderColor: T.goldEdge,
          backgroundColor: 'rgba(212,178,106,0.07)',
          paddingVertical: SPACE.xs,
        }}
      >
        <View style={{ alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ flexDirection: ROW_RTL, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={icon} size={18} color={T.gold} />
            <Text style={{ color: T.gold, fontSize: 16, fontWeight: '700', marginHorizontal: 10 }}>{label}</Text>
          </View>
          <Text style={{ color: T.textFaint, fontSize: 10, textAlign: 'center', marginTop: 3 }}>
            הקש לפתיחה · החלק להחלפה
          </Text>
        </View>
      </Glass>
    </Pressable>
  );

  return (
    <View {...pan.panHandlers} style={{ height: H, width: '88%', alignSelf: 'center' }}>
      <Animated.View
        style={[
          faceBase,
          {
            transform: [
              { perspective: 1200 },
              { rotateY: flip.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) },
            ],
          },
        ]}
        pointerEvents={face === 0 ? 'auto' : 'none'}
      >
        <Face mode="day" label="סיכום היום" icon="today-outline" />
      </Animated.View>
      <Animated.View
        style={[
          faceBase,
          {
            transform: [
              { perspective: 1200 },
              { rotateY: flip.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] }) },
            ],
          },
        ]}
        pointerEvents={face === 1 ? 'auto' : 'none'}
      >
        <Face mode="week" label="סיכום השבוע" icon="stats-chart-outline" />
      </Animated.View>
    </View>
  );
}

function PlannerScreen({ state, setState, onSummary }) {
  const insets = useSafeAreaInsets();
  const wheel = useRef(new Animated.Value(0)).current;
  /* The wheel takes whatever height is left over, so however tall the
     phone is the first card lands dead centre and as many slots as fit
     are shown. Measured rather than assumed. */
  const [wheelH, setWheelH] = useState(WHEEL_ITEM * 3);
  /* a horizontal drag on a card must not fight the vertical scroll */
  const [dragging, setDragging] = useState(false);
  /* Mounting resets to the current week. hiddenDays is keyed by date, so
     a week you have never touched always opens with all six cards,
     Sunday through Friday, and you pick your four from there. */
  const [offset, setOffset] = useState(0);

  const start = weekStart(offset);
  const allDays = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return { date: d, index: i, key: localIso(d) };
  });
  const today = localIso();
  const days = allDays.filter((d) => !state.hiddenDays[d.key] && d.key >= today);
  const hiddenHere = allDays.filter((d) => d.key >= today).length - days.length;
  const plannedCount = days.filter((d) => state.plan[d.key]).length;

  /* Every date has the same unrestricted selector:
     rest → A → B → C → D → rest. */
  const cycle = (key) => {
    const cur = state.plan[key] || null;
    const next = PLAN_CYCLE[(PLAN_CYCLE.indexOf(cur) + 1) % PLAN_CYCLE.length];
    safeVibrate(25);
    setState((s) => {
      const plan = { ...s.plan };
      if (next) plan[key] = next;
      else delete plan[key];
      return { ...s, plan };
    });
  };

  const remove = (key) => {
    setState((s) => {
      const plan = { ...s.plan };
      delete plan[key];
      return { ...s, plan, hiddenDays: { ...s.hiddenDays, [key]: true } };
    });
  };

  const restore = () => {
    const keys = allDays.map((d) => d.key);
    safeVibrate(25);
    setState((s) => {
      const hiddenDays = { ...s.hiddenDays };
      keys.forEach((k) => delete hiddenDays[k]);
      return { ...s, hiddenDays };
    });
  };

  /* Long press wipes the whole week back to six blank cards. Destructive
     and easy to trigger by accident while scrolling, so it asks first. */
  const wipeWeek = () => {
    const keys = allDays.map((d) => d.key);
    safeVibrate([0, 40, 60, 40]);
    Alert.alert('לאפס את השבוע?', 'כל השיבוצים והימים שהוסתרו יחזרו למצב התחלתי.', [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'אפס',
        style: 'destructive',
        onPress: () =>
          setState((s) => {
            const plan = { ...s.plan };
            const hiddenDays = { ...s.hiddenDays };
            keys.forEach((k) => {
              delete plan[k];
              delete hiddenDays[k];
            });
            return { ...s, plan, hiddenDays };
          }),
      },
    ]);
  };

  const label = `${start.getDate()}.${start.getMonth() + 1} – ${allDays[5].date.getDate()}.${allDays[5].date.getMonth() + 1}`;

  return (
    <View style={{ flex: 1, padding: SPACE.md, paddingBottom: 88 + insets.bottom }}>
      <Enter>
        <View
          style={{
            flexDirection: ROW_RTL,
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            marginBottom: SPACE.md,
          }}
        >
          <View>
            <Eyebrow>תכנון</Eyebrow>
            <Text style={[styles.h1, { fontSize: 34, marginTop: 4 }]}>השבוע</Text>
          </View>
          <View style={{ flexDirection: ROW_RTL, alignItems: 'center' }}>
            <TouchableOpacity
              onPress={restore}
              onLongPress={wipeWeek}
              delayLongPress={420}
              style={[styles.restoreBtn, hiddenHere > 0 && { borderColor: 'rgba(255,255,255,0.34)' }]}
              activeOpacity={0.6}
            >
              <Ionicons name="refresh" size={17} color={hiddenHere > 0 ? T.text : T.textDim} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ flexDirection: ROW_RTL, alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACE.md }}>
          <TouchableOpacity onPress={() => setOffset(offset - 1)} style={styles.stepBtn} activeOpacity={0.6}>
            <Ionicons name="chevron-forward" size={18} color={T.gold} />
          </TouchableOpacity>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: T.text, fontSize: 16, fontWeight: '600' }}>
              {offset === 0 ? 'השבוע הנוכחי' : offset === -1 ? 'שבוע שעבר' : offset === 1 ? 'שבוע הבא' : label}
            </Text>
            <Text style={{ color: T.textFaint, fontSize: 12, marginTop: 2 }}>{label}</Text>
          </View>
          <TouchableOpacity onPress={() => setOffset(offset + 1)} style={styles.stepBtn} activeOpacity={0.6}>
            <Ionicons name="chevron-back" size={18} color={T.gold} />
          </TouchableOpacity>
        </View>

        {/* One sentence, one bar. What is left to do, in words. */}
        <View style={{ marginBottom: SPACE.md }}>
          <Text style={{ color: plannedCount > WEEK_TARGET ? T.crimson : T.textDim, fontSize: 15, textAlign: 'right', marginBottom: 10 }}>
            {plannedCount > WEEK_TARGET
              ? 'מעל ארבעה אימונים בלי עוד שינה זה לא עוד שריר. זו עוד עייפות.'
              : plannedCount >= WEEK_TARGET
              ? 'השבוע סגור. ארבעה אימונים על הלוח.'
              : `נשאר לשבץ עוד ${nHe(WEEK_TARGET - plannedCount, 'אימון', 'אימונים')} השבוע.`}
          </Text>
          <Bar
            progress={plannedCount / WEEK_TARGET}
            color={plannedCount > WEEK_TARGET ? T.crimson : T.gold}
            height={5}
          />
        </View>
      </Enter>

      {/* A wheel, not a list. Cards away from the centre tip back on the
          X axis and shrink, so the front one reads as nearest to you.
          Snapping keeps exactly one card square-on at rest. */}
      <View
        style={{ flex: 1, marginBottom: SPACE.sm }}
        onLayout={(e) => setWheelH(e.nativeEvent.layout.height)}
      >
        {days.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACE.lg }}>
            <Text style={{ color: T.textDim, fontSize: 16, textAlign: 'center', lineHeight: 26 }}>
              הימים שעברו יורדים מהלוח. המספרים נשארים בסיכום השבועי,
              והכרטיסים חוזרים בשבוע הבא.
            </Text>
          </View>
        ) : (
        <Animated.ScrollView
          showsVerticalScrollIndicator={false}
          snapToInterval={WHEEL_ITEM}
          decelerationRate="fast"
          scrollEventThrottle={16}
          scrollEnabled={!dragging}
          /* The wheel has to stop while a card is being swiped sideways,
             and the card's own responder does not block the native one, so
             this switch is the only thing holding it. A switch is therefore
             kept on a leash: a card that swallows its own release must not
             leave the wheel unable to turn for the rest of the session. */
          onTouchEnd={() => setDragging(false)}
          onTouchCancel={() => setDragging(false)}
          contentContainerStyle={{ paddingVertical: Math.max(0, (wheelH - WHEEL_ITEM) / 2) }}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: wheel } } }], {
            useNativeDriver: true,
          })}
        >
          {days.map((d, slot) => {
            const at = slot * WHEEL_ITEM;
            const range = [at - WHEEL_ITEM * 2, at - WHEEL_ITEM, at, at + WHEEL_ITEM, at + WHEEL_ITEM * 2];
            return (
              <Animated.View
                key={d.key}
                style={{
                  height: WHEEL_ITEM,
                  justifyContent: 'center',
                  opacity: wheel.interpolate({
                    inputRange: range,
                    outputRange: [0.30, 0.70, 1, 0.70, 0.30],
                    extrapolate: 'clamp',
                  }),
                  transform: [
                    { perspective: 900 },
                    {
                      rotateX: wheel.interpolate({
                        inputRange: range,
                        outputRange: ['-46deg', '-24deg', '0deg', '24deg', '46deg'],
                        extrapolate: 'clamp',
                      }),
                    },
                    {
                      scale: wheel.interpolate({
                        inputRange: range,
                        outputRange: [0.80, 0.91, 1, 0.91, 0.80],
                        extrapolate: 'clamp',
                      }),
                    },
                    {
                      /* slots pull together as they tilt away, the way a
                         real wheel foreshortens */
                      translateY: wheel.interpolate({
                        inputRange: range,
                        outputRange: [WHEEL_ITEM * 0.20, WHEEL_ITEM * 0.09, 0, -WHEEL_ITEM * 0.09, -WHEEL_ITEM * 0.20],
                        extrapolate: 'clamp',
                      }),
                    },
                  ],
                }}
              >
                <DayCard
                  date={d.date}
                  index={d.index}
                  session={state.plan[d.key] ? SESSIONS.find((s) => s.id === state.plan[d.key]) : null}
                  done={state.log.some((l) => l.d === d.key)}
                  isToday={d.key === today}
                  onCycle={() => cycle(d.key)}
                  onRemove={() => remove(d.key)}
                  onDrag={setDragging}
                />
              </Animated.View>
            );
          })}
        </Animated.ScrollView>
        )}
      </View>

      <SummaryPicker onOpen={onSummary} />
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════
   TAB BAR — animated sliding indicator
   ═══════════════════════════════════════════════════════════ */
const TABS = [
  { key: 'workout', label: 'אימון', icon: 'barbell-outline', active: 'barbell' },
  { key: 'nutrition', label: 'תזונה', icon: 'nutrition-outline', active: 'nutrition' },
  { key: 'planner', label: 'תכנון', icon: 'calendar-outline', active: 'calendar' },
];
function TabBar({ active, onChange }) {
  const insets = useSafeAreaInsets();
  const idx = TABS.findIndex((t) => t.key === active);
  const slide = useRef(new Animated.Value(idx)).current;
  const tabW = SCREEN_W / TABS.length;

  useEffect(() => {
    Animated.spring(slide, { toValue: idx, useNativeDriver: true, speed: 16, bounciness: 6 }).start();
  }, [idx, slide]);

  return (
    <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 10 : 12) }]}>
      {/* The bar starts over the first tab and walks left one tab at a
          time, because the row always puts the first tab on the physical
          right — ROW_RTL sees to that in either locale. Two things had to
          be said properly for it to land there. The edge is named, since a
          plain right: 0 is mirrored on a Hebrew phone and put the bar over
          תכנון instead of אימון. And the range names every tab rather than
          just the first two, so the third is a value the curve was given
          instead of one it extrapolated past its end. */}
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          [EDGE_RIGHT]: 0,
          width: tabW,
          height: 2,
          backgroundColor: T.gold,
          transform: [
            {
              translateX: slide.interpolate({
                inputRange: TABS.map((_, i) => i),
                outputRange: TABS.map((_, i) => -i * tabW),
              }),
            },
          ],
        }}
      />
      {TABS.map((t) => {
        const on = active === t.key;
        return (
          <TouchableOpacity key={t.key} onPress={() => onChange(t.key)} activeOpacity={0.7} style={styles.tabItem}>
            <View style={[styles.tabIconWrap, on && { backgroundColor: T.goldSoft }]}>
              <Ionicons name={on ? t.active : t.icon} size={21} color={on ? T.gold : T.textFaint} />
            </View>
            <Text style={{ color: on ? T.gold : T.textFaint, fontSize: 11, marginTop: 5, fontWeight: on ? '700' : '500' }}>
              {t.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════
   ROOT
   ═══════════════════════════════════════════════════════════ */
function AppInner() {
  const [profile, setProfile] = useState(null);
  const [booting, setBooting] = useState(true);
  const [introDone, setIntroDone] = useState(false);
  const [tab, setTab] = useState('workout');
  const [running, setRunning] = useState(false);
  const [granted, setGranted] = useState(false);
  const [party, setParty] = useState(null);
  const [summary, setSummary] = useState(null);
  const doneRef = useRef(null);
  const [state, setState] = useState(() => ({ ...INITIAL_STATE }));
  /* Calendar day the in-memory state belongs to. Persist writes under
     this label, and a check against localIso() is what rolls midnight
     while the app is still open. */
  const dayRef = useRef(localIso());
  /* A failed read must not unlock the persist effect, or the blank
     initial state overwrites the file that failed to load. */
  const canPersist = useRef(true);

  /* One screen at a time, the way the working build did it. A side-by-side
     strip of absolutely positioned screens looked smoother, but on a
     Hebrew phone Yoga mirrors absolute left/right and Android then tests
     the finger against the wrong rectangle — so the ScrollView never
     received native scroll gestures, only taps. Mounting the active tab
     alone puts every ScrollView back under a normal flex layout. */
  const shift = useRef(new Animated.Value(1)).current;
  const dir = useRef(1);
  const drift = useRef(new Animated.Value(0)).current;
  /* eases the app in from black instead of cutting to it */
  const appIn = useRef(new Animated.Value(0)).current;

  /* Fire the celebration whenever the number of completed daily tasks
     goes UP. One place covers workout, water, sleep and meals. */
  useEffect(() => {
    /* while restoring, only record the baseline — a day loaded back from
       disk is not an achievement that just happened */
    if (booting) return;
    const { done, total, missing } = taskState(state);
    if (doneRef.current !== null && done > doneRef.current) {
      setParty({
        ultra: done === total,
        word: done === total ? ULTRA_WORD : praiseWord(),
        missing,
      });
    }
    doneRef.current = done;
  }, [state, booting]);

  /* restore a saved profile before deciding whether to onboard */
  useEffect(() => {
    (async () => {
      const p = await loadProfile();
      if (p) {
        applyGender(p.gender);
        setProfile(p);
      }
      const saved = await loadState();
      if (saved.kind === 'error') {
        canPersist.current = false;
      } else if (saved.kind === 'ok') {
        dayRef.current = saved.day;
        setState((s) => ({ ...s, ...saved.state }));
      } else {
        dayRef.current = localIso();
      }
      setBooting(false);
    })();
  }, []);

  /* Midnight while the app is open used to leave yesterday's water,
     meals and workout on screen, and the next persist wrote them under
     today's date — so the real day was lost forever. Check on resume
     and once a minute. */
  useEffect(() => {
    if (booting) return undefined;
    const check = () => {
      const today = localIso();
      if (today === dayRef.current) return;
      if (daysBetween(dayRef.current, today) < 0) return;
      const from = dayRef.current;
      dayRef.current = today;
      setState((s) => rollState(s, from, today));
      doneRef.current = null;
    };
    check();
    const id = setInterval(check, 60000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [booting]);

  const acceptProfile = (p) => {
    setProfile(p);
    saveProfile(p);
  };

  /* Removing a day from the week has to reach the notification queue,
     otherwise the workout nudge keeps firing on a day you cancelled. */
  const hiddenKey = JSON.stringify(state.hiddenDays);
  const planKey = JSON.stringify(state.plan);
  /* Which of today's reminders are still worth firing. Deliberately not
     the raw counters: this flips only when a task actually opens or
     closes, so logging a single glass does not rebuild the whole queue. */
  const openKey = [
    state.workoutDone,
    state.water >= TARGETS.water,
    (parseFloat(state.sleep) || 0) >= TARGETS.sleep,
    state.meals.lunch,
    state.meals.dinner,
  ].join('|');

  const scheduleRef = useRef(null);
  scheduleRef.current = () => scheduleDailyReminders(state.hiddenDays, state.plan, state).catch(() => {});

  useEffect(() => {
    if (booting || !granted) return;
    /* Switching reminders off has to empty the queue, not just stop
       adding to it — otherwise everything scheduled while it was on
       keeps arriving. */
    if (!state.reminders) {
      if (NOTIF_OK) Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
      return;
    }
    scheduleRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenKey, planKey, openKey, granted, state.reminders, booting]);

  /* The queue only reaches a few days out, and a day that rolls over
     while the app sits in the background leaves it stale. Rebuilding on
     every return keeps it current without a background task. */
  useEffect(() => {
    if (booting || !granted || !state.reminders) return undefined;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') scheduleRef.current();
    });
    return () => sub.remove();
  }, [booting, granted, state.reminders]);

  /* every change goes straight to disk — killing the app from the
     recents list must not cost you the day */
  useEffect(() => {
    if (booting || !canPersist.current) return;
    persistState(state, dayRef.current);
  }, [state, booting]);

  /* Re-assert immersive mode after mount, foreground and keyboard close.
     Expo Go owns parts of its host window, but native/dev builds can hide
     both bars fully with this plus the static app config. */
  useEffect(() => {
    hideSystemUI();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') hideSystemUI();
    });
    const keyboardSub = Keyboard.addListener('keyboardDidHide', hideSystemUI);
    return () => {
      sub.remove();
      keyboardSub.remove();
    };
  }, []);

  /* Permissions on load, and nothing else. This used to build the queue
     here as well, from the state as it stood on the very first render —
     which is the blank starting state, before anything has been read
     back from disk. So it scheduled a queue for an empty plan, ignored
     the fact that the user may have switched reminders off, and then
     raced the real scheduling effect: both cancel everything first and
     then add, so whichever finished second decided what you actually
     got. Granting permission is enough; the effect below owns the
     queue and only runs once the saved state is in. */
  useEffect(() => {
    (async () => {
      try {
        await ensureChannel();
        const ok = await requestPermission();
        setGranted(ok);
        /* reminders ship ON. If the permission is refused the switch
           flips itself off rather than lying about being active. */
        if (!ok) setState((s) => ({ ...s, reminders: false }));
      } catch (e) {
        setGranted(false);
        setState((s) => ({ ...s, reminders: false }));
      }
    })();
  }, []);

  /* fade the app in once the TEN 10 title sequence hands over */
  useEffect(() => {
    if (!introDone) return;
    Animated.timing(appIn, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [introDone, appIn]);

  /* ambient background drift */
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(drift, { toValue: 1, duration: 9000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(drift, { toValue: 0, duration: 9000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, [drift]);

  /* switchTab is handed to memoised screens, so it must never go stale.
     Reading the current tab from a ref keeps the function itself fixed
     for the life of the app. */
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const switchTab = useRef((k) => {
    if (k === tabRef.current) return;
    const from = TABS.findIndex((t) => t.key === tabRef.current);
    const to = TABS.findIndex((t) => t.key === k);
    dir.current = to > from ? 1 : -1;
    shift.setValue(0);
    setTab(k);
    Animated.spring(shift, { toValue: 1, useNativeDriver: true, friction: 11, tension: 62 }).start();
  }).current;

  /* Today's workout is whatever that date holds in the planner — never a rotating fallback. */
  const plannedToday = state.plan ? state.plan[localIso()] : null;
  const todaySession = plannedToday ? SESSIONS.find((s) => s.id === plannedToday) : null;

  /* Long press is the hidden skin switch. It also resets the app, but
     keeps the chosen skin in the saved profile so it survives restarts.
     A second long press toggles back and resets again. */
  const resetProfile = () => {
    const nextGender = GENDER === 'f' ? 'm' : 'f';
    const nextProfile = { ...(profile || { name: 'TEN 10' }), gender: nextGender };
    safeVibrate([0, 40, 60, 40]);
    Alert.alert(nextGender === 'f' ? 'לעבור לממשק הנשי?' : 'לעבור לממשק הגברי?', 'המעבר יאפס את כל נתוני האפליקציה.', [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'אפס והחלף',
        style: 'destructive',
        onPress: () => {
          applyGender(nextGender);
          saveProfile(nextProfile);
          setProfile(nextProfile);
          doneRef.current = null;
          const clean = { ...INITIAL_STATE };
          dayRef.current = localIso();
          canPersist.current = true;
          persistState(clean, dayRef.current);
          setState(clean);
          setRunning(false);
          setSummary(null);
          setParty(null);
          appIn.setValue(0);
          setIntroDone(false);
        },
      },
    ]);
  };

  /* All three screens live at once now, so without this a single tab tap
     would rebuild every one of them — three dials, each laying out
     dozens of segment views, plus both card wheels — on the very frame
     the slide starts. The animation runs natively and was never the
     problem; that rebuild was what ate the opening frames. Rebuild a
     screen only when its own data moves. */
  const resetRef = useRef(resetProfile);
  resetRef.current = resetProfile;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const screens = useMemo(
    () => ({
      workout: (
        <WorkoutScreen
          state={state}
          setState={setState}
          session={todaySession}
          planned={!!plannedToday}
          onStart={() => setRunning(true)}
          onResetProfile={() => resetRef.current()}
          onGoPlanner={() => switchTab('planner')}
        />
      ),
      nutrition: <NutritionScreen state={state} setState={setState} />,
      planner: <PlannerScreen state={state} setState={setState} onSummary={(mode) => setSummary(mode)} />,
    }),
    [state, todaySession, plannedToday, switchTab]
  );

  const finishWorkout = (secs) => {
    const today = localIso();
    setRunning(false);
    if (!todaySession) return;
    setState((s) => {
      /* Finishing the same planned workout twice must not inflate cycle
         or history. This can happen after returning to a still-mounted
         Runner, or after a rapid duplicate completion press. */
      if (s.workoutDone && s.lastDone === today) return s;
      return {
        ...s,
        workoutDone: true,
        cycle: s.cycle + 1,
        lastDone: today,
        streak: s.lastDone === today ? s.streak : s.streak + 1,
        /* the free miss refills once you string a week back together */
        graceUsed: s.graceUsed && daysBetween(s.graceUsed, today) >= 7 ? null : s.graceUsed,
        log: [...s.log, { d: today, id: todaySession.id, secs }],
      };
    });
  };

  /* a blank dark frame while the saved profile is read, so a returning
     user never sees the name question flash by */
  if (booting) {
    return (
      <View style={{ flex: 1, backgroundColor: T.bg }}>
        <StatusBar barStyle="light-content" backgroundColor={T.bg} hidden />
      </View>
    );
  }

  if (!introDone) {
    return (
      <View style={{ flex: 1, backgroundColor: T.bg }}>
        <StatusBar barStyle="light-content" backgroundColor={T.bg} hidden />
        <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: T.bg }}>
          <Onboarding
            onFinish={() => {
              if (!profile) acceptProfile({ name: 'TEN 10', gender: 'm' });
              setIntroDone(true);
            }}
          />
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
    <Animated.View style={{ flex: 1, backgroundColor: T.bg, opacity: appIn }}>
      <StatusBar barStyle="light-content" backgroundColor={T.bg} hidden />

      <Animated.View
        pointerEvents="none"
        style={[styles.glowTop, { transform: [{ translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [0, 40] }) }] }]}
      />
      <Animated.View
        pointerEvents="none"
        style={[styles.glowBottom, { transform: [{ translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [0, -36] }) }] }]}
      />

      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        {running && todaySession ? (
          <Runner session={todaySession} onFinish={finishWorkout} onExit={() => setRunning(false)} />
        ) : (
          /* Same pattern as the build that scrolled: render only the active
             tab. No absolute strip, no mirrored left edge, no ScrollView
             sitting outside Android's hit rectangle. */
          <Animated.View
            style={{
              flex: 1,
              opacity: shift.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1] }),
              transform: [
                { translateX: shift.interpolate({ inputRange: [0, 1], outputRange: [38 * dir.current, 0] }) },
                { scale: shift.interpolate({ inputRange: [0, 1], outputRange: [0.965, 1] }) },
              ],
            }}
          >
            {tab === 'workout'
              ? screens.workout
              : tab === 'nutrition'
              ? screens.nutrition
              : screens.planner}
          </Animated.View>
        )}

        {!(running && todaySession) ? <TabBar active={tab} onChange={switchTab} /> : null}
      </SafeAreaView>

      {summary ? (
        <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 90 }}>
          <SummaryScreen state={state} mode={summary} onClose={() => setSummary(null)} />
        </View>
      ) : null}

      {party ? <Celebration payload={party} onDone={() => setParty(null)} /> : null}
    </Animated.View>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════════ */
/* Styles are rebuilt when the palette changes, so they are a plain
   object rather than a frozen StyleSheet registration. */
function makeStyles() {
  return {
  h1: { color: T.text, fontSize: 26, fontWeight: '300', textAlign: 'right', letterSpacing: -0.4 },
  h2: { color: T.text, fontSize: 17, fontWeight: '600', textAlign: 'right' },
  sub: { color: T.textFaint, fontSize: 13, textAlign: 'right', marginTop: 2 },
  /* Section headings used to be tiny wide-tracked labels, which is the
     look of an internal tool. Read as plain words instead. */
  sectionTitle: {
    color: T.textDim,
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'right',
    marginBottom: SPACE.sm,
  },
  badge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.goldSoft,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: T.goldEdge,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: T.hairlineSoft,
  },
  pillText: { color: T.textDim, fontSize: 12, fontWeight: '500' },
  input: {
    color: T.text,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: R.sm,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: T.hairline,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    textAlign: 'right',
    marginTop: SPACE.sm,
    width: '100%',
  },
  restoreBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  stepBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: T.hairline,
  },
  tabBar: {
    flexDirection: ROW_RTL,
    backgroundColor: 'rgba(13,19,27,0.97)',
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderTopColor: T.hairline,
    paddingTop: 10,
    paddingBottom: 0,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  tabItem: { flex: 1, alignItems: 'center' },
  tabIconWrap: { width: 46, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  glowTop: {
    position: 'absolute',
    top: -SCREEN_W * 0.55,
    left: -SCREEN_W * 0.2,
    width: SCREEN_W * 1.4,
    height: SCREEN_W * 1.4,
    borderRadius: SCREEN_W * 0.7,
    backgroundColor: 'rgba(212,178,106,0.045)',
  },
  glowBottom: {
    position: 'absolute',
    bottom: -SCREEN_W * 0.7,
    right: -SCREEN_W * 0.35,
    width: SCREEN_W * 1.3,
    height: SCREEN_W * 1.3,
    borderRadius: SCREEN_W * 0.65,
    backgroundColor: 'rgba(63,169,138,0.05)',
  },
  };
}

let styles = makeStyles();


/* ═══════════════════════════════════════════════════════════
   ERROR BOUNDARY — turns a silent crash into a readable screen
   ═══════════════════════════════════════════════════════════ */
class Boundary extends React.Component {
  constructor(p) {
    super(p);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <View style={{ flex: 1, backgroundColor: T.bg, padding: 24, paddingTop: 70 }}>
        <Text style={{ color: T.crimson, fontSize: 20, fontWeight: '700', marginBottom: 14 }}>קריסה</Text>
        <ScrollView>
          <Text selectable style={{ color: T.text, fontSize: 13, lineHeight: 20 }}>
            {String(this.state.err && this.state.err.message)}
            {'\n\n'}
            {String(this.state.err && this.state.err.stack).slice(0, 1400)}
            {NATIVE_ERROR ? '\n\nNATIVE: ' + NATIVE_ERROR : ''}
          </Text>
        </ScrollView>
      </View>
    );
  }
}

export default function App() {
  return (
    <Boundary>
      <SafeAreaProvider>
        <AppInner />
      </SafeAreaProvider>
    </Boundary>
  );
}