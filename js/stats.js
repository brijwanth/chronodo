// stats.js — derived data: streaks, consistency, recommendations
import { todayStr, isDoneOn } from './storage.js';

function last7(activity) {
  const out = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    out.push(isDoneOn(activity, todayStr(d)));
  }
  return out;
}

function daysInMonth(year, monthIdx) {
  return new Date(year, monthIdx + 1, 0).getDate();
}

// consistency = doneDays / elapsedDaysInMonth (elapsed = days up to today if current month, else full month)
function monthConsistency(activity, year, monthIdx) {
  const now = new Date();
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() === monthIdx;
  const totalDays = daysInMonth(year, monthIdx);
  const elapsed = isCurrentMonth ? now.getDate() : totalDays;
  let done = 0;
  for (let d = 1; d <= elapsed; d++) {
    const date = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (isDoneOn(activity, date)) done++;
  }
  return elapsed === 0 ? 0 : done / elapsed;
}

function daysSinceLastLog(activity) {
  const dates = Object.keys(activity.logs).filter(d => activity.logs[d].done).sort();
  if (dates.length === 0) return null;
  const last = new Date(dates[dates.length - 1]);
  const now = new Date();
  const diff = Math.floor((now - last) / (1000 * 60 * 60 * 24));
  return diff;
}

function totalLoggedDays(activity) {
  return Object.values(activity.logs).filter(l => l.done).length;
}

// Current streak: consecutive completed days ending today. If today isn't
// stamped yet the run through yesterday still counts as the live streak.
function currentStreak(activity) {
  let count = 0;
  const d = new Date();
  if (!isDoneOn(activity, todayStr(d))) d.setDate(d.getDate() - 1);
  while (isDoneOn(activity, todayStr(d))) {
    count++;
    d.setDate(d.getDate() - 1);
  }
  return count;
}

// Recommendations: two lists.
// "gaps" — activities being actively worked on (logged at least once this month)
//          but with the lowest consistency %, i.e. closest to falling off pace.
// "untouched" — activities never logged, or not logged in 14+ days.
function buildRecommendations(activities) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();

  const gaps = activities
    .map(a => ({ activity: a, consistency: monthConsistency(a, y, m), logged: totalLoggedDays(a) }))
    .filter(x => x.logged > 0 && x.consistency < 1)
    .sort((a, b) => a.consistency - b.consistency)
    .slice(0, 5);

  const untouched = activities
    .map(a => ({ activity: a, since: daysSinceLastLog(a) }))
    .filter(x => x.since === null || x.since >= 14)
    .sort((a, b) => (b.since ?? 9999) - (a.since ?? 9999))
    .slice(0, 5);

  return { gaps, untouched };
}

export { last7, daysInMonth, monthConsistency, daysSinceLastLog, totalLoggedDays, currentStreak, buildRecommendations };
