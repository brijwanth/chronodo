// sync.js — Stage 1: Firebase-backed team sync.
// Anonymous auth (no email/password) + a short room code that a small team
// shares to join the same Firestore "room" doc. This stage only proves
// membership syncs live across devices — no task/goal data is synced yet.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc,
  onSnapshot, arrayUnion, arrayRemove, serverTimestamp,
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
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const ref = doc(dbFs, 'rooms', code);
    const existing = await getDoc(ref);
    if (existing.exists()) continue;
    await setDoc(ref, { createdAt: serverTimestamp(), memberUids: [uid] });
    saveLocalTeam({ code });
    return { code, memberCount: 1 };
  }
  throw new Error('Could not generate a free team code \u2014 try again.');
}

// Join an existing room by its code.
async function joinTeam(rawCode) {
  const uid = await waitForAuth();
  const code = (rawCode || '').trim().toUpperCase();
  if (!code) throw new Error('Enter a team code.');
  const ref = doc(dbFs, 'rooms', code);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('No team found with that code.');
  await updateDoc(ref, { memberUids: arrayUnion(uid) });
  saveLocalTeam({ code });
  const updated = await getDoc(ref);
  const members = updated.data().memberUids || [];
  return { code, memberCount: members.length };
}

// Leave the currently joined room, if any. Safe to call when not in a team.
async function leaveTeam() {
  const team = loadLocalTeam();
  if (!team) return;
  try {
    const uid = await waitForAuth();
    await updateDoc(doc(dbFs, 'rooms', team.code), { memberUids: arrayRemove(uid) });
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
    const members = snap.data().memberUids || [];
    callback({ code: team.code, memberCount: members.length });
  }, (err) => {
    console.error('Team listener error', err);
    callback({ code: team.code, memberCount: null });
  });
}

export { createTeam, joinTeam, leaveTeam, getLocalTeam, subscribeToTeam, waitForAuth };
