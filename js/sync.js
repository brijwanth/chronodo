// sync.js — Stage 1: Firebase-backed team sync.
// Anonymous auth (no email/password) + a short room code that a small team
// shares to join the same Firestore "room" doc. This stage only proves
// membership syncs live across devices — no task/goal data is synced yet.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, deleteField,
  collection, addDoc, onSnapshot, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

// Not a secret — Firebase's web config is meant to be public in client code.
// Access control lives in Firestore's security rules, not in hiding this key.
const firebaseConfig = {
  apiKey: 'AIzaSyD3NjHMRLp5GhghaYj6BucTC4T3Uy_UtPo',
  authDomain: 'chronodo-2026.firebaseapp.com',
  projectId: 'chronodo-2026',
  storageBucket: 'chronodo-2026.firebasestorage.app',
  messagingSenderId: '912854379231',
  appId: '1:912854379231:web:5a07a2d702b28e7f3e176a',
};

const TEAM_KEY = 'rolodex-team-v1';
// This device's display name, shown to teammates in the member list and in
// "stamped by ___". Purely cosmetic, never used for access control.
const NICKNAME_KEY = 'rolodex-nickname-v1';
// Doc ids this device has deliberately unlinked from (Stage 2.5's "un-share,
// just for me") — the live watcher below filters these out so they don't
// silently get re-created moments after being removed.
const IGNORED_KEY = 'rolodex-team-ignored-v1';
// No 0/O/1/I — avoids codes that look ambiguous when read aloud or handwritten.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const dbFs = getFirestore(app);

let currentUid = null;
const authReady = new Promise((resolve) => {
  onAuthStateChanged(auth, (user) => {
    if (user) { currentUid = user.uid; resolve(user.uid); }
  });
  signInAnonymously(auth).catch((err) => console.error('Anonymous sign-in failed', err));
});

async function waitForAuth() {
  if (currentUid) return currentUid;
  return authReady;
}

function loadLocalTeam() {
  try {
    const raw = localStorage.getItem(TEAM_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
function saveLocalTeam(team) {
  if (team) localStorage.setItem(TEAM_KEY, JSON.stringify(team));
  else localStorage.removeItem(TEAM_KEY);
}

function loadIgnored() {
  try {
    const raw = localStorage.getItem(IGNORED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}
function saveIgnored(list) {
  localStorage.setItem(IGNORED_KEY, JSON.stringify(list));
}

function getNickname() {
  try {
    return localStorage.getItem(NICKNAME_KEY) || '';
  } catch (e) {
    return '';
  }
}

// Sets this device's display name locally, and — if already in a team —
// pushes the update live so teammates see the new name immediately.
async function setNickname(name) {
  const clean = (name || '').trim().slice(0, 40);
  localStorage.setItem(NICKNAME_KEY, clean);
  const team = loadLocalTeam();
  if (!team) return;
  const uid = await waitForAuth();
  try {
    await updateDoc(doc(dbFs, 'rooms', team.code), {
      [`members.${uid}.nickname`]: clean,
    });
  } catch (e) {
    // Best-effort — local name is already saved even if this push fails.
  }
}

// Permanently stop mirroring one shared activity to this device (this
// device's local copy is expected to already be detached/converted by the
// caller — this just keeps the watcher from re-creating it).
function ignoreTeamActivity(teamActivityId) {
  const list = loadIgnored();
  if (!list.includes(teamActivityId)) {
    list.push(teamActivityId);
    saveIgnored(list);
  }
}

function randomCode() {
  const arr = new Uint32Array(CODE_LENGTH);
  (window.crypto || window.msCrypto).getRandomValues(arr);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[arr[i] % CODE_ALPHABET.length];
  return code;
}

// Create a new room and join it, retrying on the rare code collision.
async function createTeam() {
  const uid = await waitForAuth();
  const nickname = getNickname();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const ref = doc(dbFs, 'rooms', code);
    const existing = await getDoc(ref);
    if (existing.exists()) continue;
    await setDoc(ref, {
      createdAt: serverTimestamp(),
      members: { [uid]: { nickname, joinedAt: Date.now() } },
    });
    saveLocalTeam({ code });
    return { code, memberCount: 1 };
  }
  throw new Error('Could not generate a free team code \u2014 try again.');
}

// Reads member info from a room doc, supporting both the current map shape
// ({ members: { uid: { nickname } } }) and the original flat array shape
// ({ memberUids: [uid, ...] }) from before nicknames existed, so any room
// created before this update still reads correctly.
function memberListFrom(data) {
  if (data.members) {
    return Object.entries(data.members).map(([uid, info]) => ({
      uid, nickname: (info && info.nickname) || '',
    }));
  }
  return (data.memberUids || []).map((uid) => ({ uid, nickname: '' }));
}

// Join an existing room by its code.
async function joinTeam(rawCode) {
  const uid = await waitForAuth();
  const nickname = getNickname();
  const code = (rawCode || '').trim().toUpperCase();
  if (!code) throw new Error('Enter a team code.');
  const ref = doc(dbFs, 'rooms', code);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('No team found with that code.');
  await updateDoc(ref, { [`members.${uid}`]: { nickname, joinedAt: Date.now() } });
  saveLocalTeam({ code });
  const updated = await getDoc(ref);
  const members = memberListFrom(updated.data());
  return { code, memberCount: members.length };
}

// Leave the currently joined room, if any. Safe to call when not in a team.
async function leaveTeam() {
  const team = loadLocalTeam();
  if (!team) return;
  try {
    const uid = await waitForAuth();
    await updateDoc(doc(dbFs, 'rooms', team.code), { [`members.${uid}`]: deleteField() });
  } catch (e) {
    // Room may already be gone — clearing local state below is still correct.
  }
  saveLocalTeam(null);
}

// The team this device is locally recorded as belonging to, or null.
function getLocalTeam() {
  return loadLocalTeam();
}

// Live member-count updates for the currently joined room. Calls back
// immediately and on every membership change. Returns an unsubscribe
// function; calls back with null (and unsubscribes nothing further to do)
// if this device isn't in a team.
function subscribeToTeam(callback) {
  const team = loadLocalTeam();
  if (!team) {
    callback(null);
    return () => {};
  }
  const ref = doc(dbFs, 'rooms', team.code);
  return onSnapshot(ref, (snap) => {
    if (!snap.exists()) { callback(null); return; }
    const members = memberListFrom(snap.data());
    callback({ code: team.code, memberCount: members.length, members });
  }, (err) => {
    console.error('Team listener error', err);
    callback({ code: team.code, memberCount: null, members: [] });
  });
}

// ---------------------------------------------------------------- Stage 2:
// shared activities (existence + definition only — no stamps/logs yet).
// Each is a doc at rooms/{code}/activities/{id}: { name, timerType,
// timerDuration, createdBy, createdAt }.

// Create a shared activity in the joined room. Throws if not in a team.
// `logs`, if given, seeds the shared doc's starting history — used when
// converting an existing personal card so its past stamps carry over.
async function createTeamActivity({ name, timerType, timerDuration, logs = {}, teamGoalId = null }) {
  const team = loadLocalTeam();
  if (!team) throw new Error('Join a team first.');
  const uid = await waitForAuth();
  const colRef = collection(dbFs, 'rooms', team.code, 'activities');
  const docRef = await addDoc(colRef, {
    name,
    timerType,
    timerDuration,
    logs,
    teamGoalId,
    createdBy: uid,
    createdAt: serverTimestamp(),
  });
  return { id: docRef.id, code: team.code };
}

// Remove a shared activity for everyone in the room. Safe to call when not
// in a team (no-op).
async function deleteTeamActivity(teamActivityId) {
  const team = loadLocalTeam();
  if (!team || !teamActivityId) return;
  await waitForAuth();
  await deleteDoc(doc(dbFs, 'rooms', team.code, 'activities', teamActivityId));
}

// Live list of the joined room's shared activities. Calls back on every
// add/remove/change with { code, activities }. If not in a team, calls back
// once with { code: null, activities: [] } and returns a no-op unsubscribe.
function subscribeToTeamActivities(callback) {
  const team = loadLocalTeam();
  if (!team) {
    callback({ code: null, activities: [] });
    return () => {};
  }
  const colRef = collection(dbFs, 'rooms', team.code, 'activities');
  return onSnapshot(colRef, (snap) => {
    const ignored = loadIgnored();
    const activities = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((a) => !ignored.includes(a.id));
    callback({ code: team.code, activities });
  }, (err) => {
    console.error('Team activities listener error', err);
    callback({ code: team.code, activities: [] });
  });
}

// ---------------------------------------------------------------- Stage 4:
// team goals — a shared grouping label, separate from personal tags/goals
// (which stay local, per Stage 2's scope). Mirrored locally as ordinary
// goal-tags by app.js, so the existing Tags/Goals view and filter bar work
// unmodified — this only supplies the shared source of truth.

// Create a shared goal in the joined room. Throws if not in a team.
async function createTeamGoal(name) {
  const team = loadLocalTeam();
  if (!team) throw new Error('Join a team first.');
  const uid = await waitForAuth();
  const colRef = collection(dbFs, 'rooms', team.code, 'goals');
  const docRef = await addDoc(colRef, {
    name: (name || '').trim(),
    createdBy: uid,
    createdAt: serverTimestamp(),
  });
  return { id: docRef.id, code: team.code };
}

// Live list of the joined room's shared goals. Same calling convention as
// subscribeToTeamActivities.
function subscribeToTeamGoals(callback) {
  const team = loadLocalTeam();
  if (!team) {
    callback({ code: null, goals: [] });
    return () => {};
  }
  const colRef = collection(dbFs, 'rooms', team.code, 'goals');
  return onSnapshot(colRef, (snap) => {
    const goals = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback({ code: team.code, goals });
  }, (err) => {
    console.error('Team goals listener error', err);
    callback({ code: team.code, goals: [] });
  });
}
// shared checkbox stamping. Whoever stamps a shared activity marks it done
// for the whole team — this overwrites the date's log entry rather than
// accumulating (last write wins), matching the multi-editor nature of a
// small free-tier sync backend.

// Mark a shared activity done for a date, for everyone in the room.
async function markTeamActivityDone(code, teamActivityId, date, { seconds = 0, note = '' } = {}) {
  const uid = await waitForAuth();
  const ref = doc(dbFs, 'rooms', code, 'activities', teamActivityId);
  await updateDoc(ref, {
    [`logs.${date}`]: { done: true, by: uid, seconds, note, at: Date.now() },
  });
}

// Undo a shared stamp for a date, for everyone in the room.
async function unmarkTeamActivityDone(code, teamActivityId, date) {
  await waitForAuth();
  const ref = doc(dbFs, 'rooms', code, 'activities', teamActivityId);
  await updateDoc(ref, { [`logs.${date}`]: deleteField() });
}

// This device's current uid, for "stamped by you" vs. "by a teammate" — null
// until anonymous sign-in resolves (briefly, on cold load).
function getUid() {
  return currentUid;
}

export {
  createTeam, joinTeam, leaveTeam, getLocalTeam, subscribeToTeam, waitForAuth,
  createTeamActivity, deleteTeamActivity, subscribeToTeamActivities,
  markTeamActivityDone, unmarkTeamActivityDone, getUid, ignoreTeamActivity,
  getNickname, setNickname, createTeamGoal, subscribeToTeamGoals,
};
