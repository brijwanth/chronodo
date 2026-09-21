// storage.js — persistence + data model
const DB_KEY = 'rolodex-db-v1';
// Mirror of DB_KEY, written on every save. load() falls back to this if the
// primary key is missing or fails to parse (e.g. an interrupted write left
// it truncated) — cheap insurance against losing everything to one bad write.
const SHADOW_KEY = 'rolodex-db-v1-shadow';

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function defaultDB() {
  return {
    version: 1,
    activities: [],
    tags: [],
    settings: {
      recommendationPref: 'balanced', // 'gaps' | 'untouched' | 'balanced'
      autoStartTimer: true,
      // Reminder preferences. Device-local — never synced to a team room.
      reminders: {
        enabled: false,
        time: '19:00',                 // HH:MM, 24h, this device's local time
        days: [0, 1, 2, 3, 4, 5, 6],   // weekday indices, 0=Sun..6=Sat
        onlyIfUnfinished: true,
        quietStart: '',                // HH:MM, '' = quiet hours off
        quietEnd: '',
      },
    },
  };
}

// Merge a stored snapshot onto the defaults. settings — and the nested
// reminders block — merge key by key, so a DB written before a preference
// existed picks up that preference's default instead of undefined.
function coerce(parsed) {
  const defaults = defaultDB();
  const parsedSettings = parsed.settings || {};
  const settings = { ...defaults.settings, ...parsedSettings };
  settings.reminders = { ...defaults.settings.reminders, ...(parsedSettings.reminders || {}) };
  return { ...defaults, ...parsed, settings };
}

function load() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return coerce(JSON.parse(raw));
  } catch (e) {
    console.error('Primary DB corrupted, trying shadow copy', e);
  }
  try {
    const shadow = localStorage.getItem(SHADOW_KEY);
    if (shadow) return coerce(JSON.parse(shadow));
  } catch (e) {
    console.error('Shadow DB also corrupted, starting fresh', e);
  }
  return defaultDB();
}

let db = load();
let saveTimer = null;

// Ask the browser not to evict this origin's storage under disk pressure.
// Best-effort only — some browsers only grant this for installed PWAs,
// which a TWA-wrapped app qualifies as.
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

function writeDB(json) {
  try {
    localStorage.setItem(DB_KEY, json);
  } catch (e) {
    console.error('Failed to save DB', e);
    return;
  }
  try {
    localStorage.setItem(SHADOW_KEY, json);
  } catch (e) {
    // Non-fatal — the primary write above already succeeded.
  }
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeDB(JSON.stringify(db)), 120);
}

// Immediate, non-debounced save. The 120ms debounce above is fine while
// the app is in the foreground, but leaves a window where a kill/crash
// right after an edit loses that edit — this closes it.
function flushNow() {
  clearTimeout(saveTimer);
  writeDB(JSON.stringify(db));
}

// Last-chance save whenever the app backgrounds or the OS is about to
// kill it — visibilitychange/pagehide are the most reliable signals on
// Android/TWA; beforeunload is not.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushNow();
});
window.addEventListener('pagehide', flushNow);

// ---- Tags ----
// teamGoalId (Stage 4): when set, this tag mirrors a shared goal at
// rooms/{code}/goals/{teamGoalId} — null for an ordinary personal tag/goal.
function createTag({ name, isGoal = false, color = null, teamGoalId = null }) {
  const tag = { id: uid(), name: name.trim(), isGoal, color, teamGoalId };
  db.tags.push(tag);
  save();
  return tag;
}

function deleteTag(tagId) {
  db.tags = db.tags.filter(t => t.id !== tagId);
  db.activities.forEach(a => { a.tags = a.tags.filter(id => id !== tagId); });
  save();
}

function updateTag(tagId, patch) {
  const tag = db.tags.find(t => t.id === tagId);
  if (!tag) return null;
  if (patch.name !== undefined) tag.name = patch.name.trim();
  if (patch.isGoal !== undefined) tag.isGoal = patch.isGoal;
  if (patch.teamGoalId !== undefined) tag.teamGoalId = patch.teamGoalId;
  save();
  return tag;
}

function getTags() { return db.tags; }
function getGoals() { return db.tags.filter(t => t.isGoal); }

// ---- Activities ----
// teamId / teamActivityId (Stage 2): when set, this card mirrors a shared
// Firestore doc at rooms/{teamId}/activities/{teamActivityId} — null/null
// for an ordinary personal card. teamGoalId (Stage 4): which shared team
// goal (if any) this shared activity belongs to — used to reconcile the
// activity-tag link if the goal and activity happen to sync in either order.
function createActivity({ name, tags = [], timerType = 'stopwatch', timerDuration = 1500,
                         timesPerWeek = 7, preferredDays = [0, 1, 2, 3, 4, 5, 6],
                         teamId = null, teamActivityId = null, teamGoalId = null }) {
  const activity = {
    id: uid(),
    name: name.trim(),
    tags,
    timerType,          // 'stopwatch' | 'countdown'
    timerDuration,       // seconds, used for countdown
    timesPerWeek,        // how many times per week to do it (7 = daily)
    preferredDays,       // weekday indices 0=Sun..6=Sat
    teamId,              // room code this card is shared with, or null
    teamActivityId,       // Firestore doc id backing the shared card, or null
    teamGoalId,           // Firestore doc id of the shared goal it belongs to, or null
    createdAt: todayStr(),
    logs: {},            // { 'YYYY-MM-DD': { done: true, source: 'manual'|'timer', seconds: number } }
  };
  db.activities.push(activity);
  save();
  return activity;
}

function updateActivity(id, patch) {
  const a = db.activities.find(x => x.id === id);
  if (!a) return null;
  Object.assign(a, patch);
  save();
  return a;
}

function deleteActivity(id) {
  db.activities = db.activities.filter(a => a.id !== id);
  save();
}

function getActivities() { return db.activities; }
function getActivity(id) { return db.activities.find(a => a.id === id); }

// Wipe all cards + tags (used when a new installer imports their own CSV).
function clearAll() {
  db.activities = [];
  db.tags = [];
  save();
}

function markDone(activityId, { source = 'manual', seconds = 0, date = todayStr(), note } = {}) {
  const a = getActivity(activityId);
  if (!a) return;
  const existing = a.logs[date];
  a.logs[date] = {
    done: true,
    source,
    seconds: (existing?.seconds || 0) + seconds,
    note: note !== undefined ? note : (existing?.note || ''),
  };
  save();
}

// Set/replace the note on a given day's log (without changing seconds).
function setLogNote(activityId, date, note) {
  const a = getActivity(activityId);
  if (!a || !a.logs[date]) return;
  a.logs[date].note = note;
  save();
}

function unmarkDone(activityId, date = todayStr()) {
  const a = getActivity(activityId);
  if (!a) return;
  delete a.logs[date];
  save();
}

function isDoneOn(activity, date) {
  return !!(activity.logs[date] && activity.logs[date].done);
}

// ---- Settings ----
function getSettings() { return db.settings; }
function updateSettings(patch) {
  Object.assign(db.settings, patch);
  save();
}

// ---- Reminder preferences ----
// Kept behind their own accessors so a partial patch merges into the block
// rather than replacing it wholesale (as updateSettings would).
function getReminders() { return db.settings.reminders; }
function updateReminders(patch) {
  Object.assign(db.settings.reminders, patch);
  save();
  return db.settings.reminders;
}

// ---- Backup / restore (used by Settings' local backup) ----
// Snapshot everything (activities, tags, settings) for export.
function exportAll() {
  return JSON.parse(JSON.stringify(db));
}

// Replace the whole DB with a previously-exported snapshot and save
// immediately. Throws if the shape looks wrong rather than silently
// wiping data with garbage.
function importAll(data) {
  if (!data || !Array.isArray(data.activities) || !Array.isArray(data.tags)) {
    throw new Error('Backup file looks invalid — missing activities/tags.');
  }
  db = coerce(data);
  flushNow();
}

export {
  uid, todayStr,
  createTag, updateTag, deleteTag, getTags, getGoals,
  createActivity, updateActivity, deleteActivity, getActivities, getActivity,
  markDone, unmarkDone, isDoneOn, setLogNote,
  getSettings, updateSettings,
  getReminders, updateReminders,
  clearAll, exportAll, importAll,
};
