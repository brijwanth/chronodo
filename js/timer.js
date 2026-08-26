// timer.js — stopwatch / countdown engine
import { markDone } from './storage.js';

let interval = null;
let state = null; // { activityId, type, startedAt, elapsed, duration, onTick, onComplete }

function fmt(seconds) {
  seconds = Math.max(0, Math.round(seconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function isRunning() { return !!state; }
function current() { return state; }

function start(activity, { onTick, onComplete } = {}) {
  stop({ save: false }); // clear any previous
  state = {
    activityId: activity.id,
    type: activity.timerType || 'stopwatch',
    startedAt: Date.now(),
    duration: activity.timerDuration || 1500,
    onTick,
    onComplete,
  };
  interval = setInterval(tick, 250);
  tick();
}

function tick() {
  if (!state) return;
  const elapsedSec = (Date.now() - state.startedAt) / 1000;
  let display, remaining = null;
  if (state.type === 'countdown') {
    remaining = state.duration - elapsedSec;
    display = fmt(remaining);
    if (remaining <= 0) {
      finish();
      return;
    }
  } else {
    display = fmt(elapsedSec);
  }
  state.onTick && state.onTick({ display, elapsedSec, remaining, type: state.type });
}

function finish() {
  if (!state) return;
  const elapsedSec = (Date.now() - state.startedAt) / 1000;
  const activityId = state.activityId;
  const cb = state.onComplete;
  clearInterval(interval);
  interval = null;
  const wasCountdown = state.type === 'countdown';
  state = null;
  const seconds = Math.round(elapsedSec);
  if (seconds >= 1) markDone(activityId, { source: 'timer', seconds });
  cb && cb({ seconds, completed: wasCountdown });
}

// Manual stop (user taps stop) — same as finish, just explicit.
function stop({ save = true } = {}) {
  if (!state) return null;
  if (!save) {
    clearInterval(interval);
    interval = null;
    state = null;
    return null;
  }
  const elapsedSec = (Date.now() - state.startedAt) / 1000;
  finish();
  return elapsedSec;
}

export { start, stop, isRunning, current, fmt };
