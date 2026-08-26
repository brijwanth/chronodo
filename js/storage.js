// storage.js — persistence + data model
const DB_KEY = 'rolodex-db-v1';

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
    },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return defaultDB();
    const parsed = JSON.parse(raw);
    return { ...defaultDB(), ...parsed, settings: { ...defaultDB().settings, ...(parsed.settings || {}) } };
  } catch (e) {
    console.error('Failed to load DB, starting fresh', e);
    return defaultDB();
  }
}

let db = load();
let saveTimer = null;

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(db));
    } catch (e) {
      console.error('Failed to save DB', e);
    }
  }, 120);
}

// ---- Tags ----
function createTag({ name, isGoal = false, color = null }) {
  const tag = { id: uid(), name: name.trim(), isGoal, color };
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
  save();
  return tag;
}

function getTags() { return db.tags; }
function getGoals() { return db.tags.filter(t => t.isGoal); }

// ---- Activities ----
function createActivity({ name, tags = [], timerType = 'stopwatch', timerDuration = 1500 }) {
  const activity = {
    id: uid(),
    name: name.trim(),
    tags,
    timerType,          // 'stopwatch' | 'countdown'
    timerDuration,       // seconds, used for countdown
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

export {
  uid, todayStr,
  createTag, updateTag, deleteTag, getTags, getGoals,
  createActivity, updateActivity, deleteActivity, getActivities, getActivity,
  markDone, unmarkDone, isDoneOn, setLogNote,
  getSettings, updateSettings,
};
