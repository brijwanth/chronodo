import * as db from './storage.js';
import * as stats from './stats.js';
import * as timer from './timer.js';
import * as sync from './sync.js';
import * as notify from './notifications.js';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}

const mainEl = document.getElementById('main');
const tabs = document.querySelectorAll('.drawer-tab');
const tplCard = document.getElementById('tpl-card');
const tplRow = document.getElementById('tpl-list-row');

let viewState = {
  view: 'rolodex',
  rolodexIndex: 0,
  activeTagFilter: null, // tag id or null
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth(),
  calSelected: db.todayStr(),
  recoMode: db.getSettings().recommendationPref === 'gaps' ? 'gaps'
           : db.getSettings().recommendationPref === 'untouched' ? 'untouched' : 'balanced',
};

// Unsubscribe handle for the live team-membership listener (Settings sheet).
// closeSheet() always tears this down, whichever way a sheet closes.
let teamUnsub = null;

// Unsubscribe handle for the live team-activities listener. Unlike
// teamUnsub above, this runs app-wide (not just while Settings is open) —
// shared cards should appear on the dial as soon as a teammate adds one.
let teamActivitiesUnsub = null;
function watchTeamActivities() {
  if (teamActivitiesUnsub) { teamActivitiesUnsub(); teamActivitiesUnsub = null; }
  teamActivitiesUnsub = sync.subscribeToTeamActivities(({ code, activities }) => {
    if (!code) return;
    let changed = false;
    activities.forEach((remote) => {
      const local = db.getActivities().find((a) => a.teamActivityId === remote.id);
      if (!local) {
        const goalTag = remote.teamGoalId ? db.getTags().find((t) => t.teamGoalId === remote.teamGoalId) : null;
        db.createActivity({
          name: remote.name,
          timerType: remote.timerType || 'stopwatch',
          timerDuration: remote.timerDuration || 1500,
          teamId: code,
          teamActivityId: remote.id,
          teamGoalId: remote.teamGoalId || null,
          tags: goalTag ? [goalTag.id] : [],
        });
        changed = true;
      } else {
        const remoteLogs = remote.logs || {};
        if (JSON.stringify(remoteLogs) !== JSON.stringify(local.logs || {})) {
          db.updateActivity(local.id, { logs: remoteLogs });
          changed = true;
        }
      }
    });
    if (changed) render();
  });
}

// Unsubscribe handle for the live team-goals listener. Mirrors shared goals
// into local db.tags (as goal-tags) and backfills the tag link onto any
// team activity that already synced before its goal did.
let teamGoalsUnsub = null;
function watchTeamGoals() {
  if (teamGoalsUnsub) { teamGoalsUnsub(); teamGoalsUnsub = null; }
  teamGoalsUnsub = sync.subscribeToTeamGoals(({ code, goals }) => {
    if (!code) return;
    let changed = false;
    goals.forEach((remote) => {
      let goalTag = db.getTags().find((t) => t.teamGoalId === remote.id);
      if (!goalTag) {
        goalTag = db.createTag({ name: remote.name, isGoal: true, teamGoalId: remote.id });
        changed = true;
      }
      db.getActivities().forEach((a) => {
        if (a.teamGoalId === remote.id && !a.tags.includes(goalTag.id)) {
          db.updateActivity(a.id, { tags: [...a.tags, goalTag.id] });
          changed = true;
        }
      });
    });
    if (changed) render();
  });
}

// ---------------------------------------------------------------- utilities
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('is-shown');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('is-shown'), 1600);
}

function activityTagObjs(activity) {
  return activity.tags.map(id => db.getTags().find(t => t.id === id)).filter(Boolean);
}

function filteredActivities() {
  const all = db.getActivities();
  if (!viewState.activeTagFilter) return all;
  return all.filter(a => a.tags.includes(viewState.activeTagFilter));
}

// ---------------------------------------------------------------- seed data
function seedIfEmpty() {
  if (db.getActivities().length > 0 || db.getTags().length > 0) return;
  const health = db.createTag({ name: 'Get Healthier', isGoal: true });
  const craft = db.createTag({ name: 'Learn Guitar', isGoal: true });
  const mindTag = db.createTag({ name: 'mind' });
  const bodyTag = db.createTag({ name: 'body' });
  db.createActivity({ name: 'Morning run', tags: [health.id, bodyTag.id], timerType: 'stopwatch' });
  db.createActivity({ name: 'Guitar practice', tags: [craft.id, mindTag.id], timerType: 'countdown', timerDuration: 900 });
  db.createActivity({ name: 'Meditate', tags: [health.id, mindTag.id], timerType: 'countdown', timerDuration: 600 });
  db.createActivity({ name: 'View Sunrise', tags: [mindTag.id], timerType: 'stopwatch' });
  db.createActivity({ name: 'Look outside the Phone', tags: [mindTag.id], timerType: 'stopwatch' });
}
seedIfEmpty();

// add the two new starter cards once to installs seeded before they existed
function topUpDefaults() {
  if (localStorage.getItem('rolodex-topup-v1')) return;
  const names = db.getActivities().map(a => a.name);
  ['View Sunrise', 'Look outside the Phone'].forEach(name => {
    if (!names.includes(name)) db.createActivity({ name, timerType: 'stopwatch' });
  });
  localStorage.setItem('rolodex-topup-v1', '1');
}
topUpDefaults();

// second batch of starter cards
function topUpMore() {
  if (localStorage.getItem('rolodex-topup-v2')) return;
  const names = db.getActivities().map(a => a.name);
  const extra = [
    { name: 'Read 20 pages', timerType: 'countdown', timerDuration: 1200 },
    { name: 'Drink water', timerType: 'stopwatch' },
    { name: 'Stretch', timerType: 'countdown', timerDuration: 300 },
    { name: 'Journal', timerType: 'stopwatch' },
    { name: 'Walk 10k steps', timerType: 'stopwatch' },
    { name: 'Cold shower', timerType: 'countdown', timerDuration: 120 },
    { name: 'Sketch', timerType: 'countdown', timerDuration: 900 },
    { name: 'Learn vocabulary', timerType: 'countdown', timerDuration: 600 },
    { name: 'Call a friend', timerType: 'stopwatch' },
    { name: 'Plan tomorrow', timerType: 'countdown', timerDuration: 300 },
  ];
  extra.forEach(t => { if (!names.includes(t.name)) db.createActivity(t); });
  localStorage.setItem('rolodex-topup-v2', '1');
}
topUpMore();

// ---------------------------------------------------------------- nav menu
const navPanel = document.getElementById('nav-panel');
const navScrim = document.getElementById('nav-scrim');
const btnMenu = document.getElementById('btn-menu');
const viewLabels = { rolodex: 'Chronodo', list: 'List', calendar: 'Calendar', tags: 'Goals & Tags', recommend: 'Suggested' };

function openMenu() {
  navPanel.classList.add('is-open');
  navPanel.setAttribute('aria-hidden', 'false');
  navScrim.hidden = false;
  requestAnimationFrame(() => navScrim.classList.add('is-open'));
  btnMenu.setAttribute('aria-expanded', 'true');
}
function closeMenu() {
  navPanel.classList.remove('is-open');
  navPanel.setAttribute('aria-hidden', 'true');
  navScrim.classList.remove('is-open');
  setTimeout(() => { navScrim.hidden = true; }, 220);
  btnMenu.setAttribute('aria-expanded', 'false');
}
btnMenu.addEventListener('click', () => {
  navPanel.classList.contains('is-open') ? closeMenu() : openMenu();
});
navScrim.addEventListener('click', closeMenu);

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => { t.classList.remove('is-active'); t.setAttribute('aria-selected', 'false'); });
    tab.classList.add('is-active'); tab.setAttribute('aria-selected', 'true');
    viewState.view = tab.dataset.view;
    viewState.rolodexIndex = 0;
    document.getElementById('brand-view').textContent = viewLabels[tab.dataset.view] || 'Chronodo';
    closeMenu();
    render();
  });
});

document.getElementById('btn-add').addEventListener('click', () => openActivityForm());
document.getElementById('btn-settings').addEventListener('click', () => openSettings());

// ---------------------------------------------------------------- render dispatch
function render() {
  mainEl.innerHTML = '';
  if (viewState.view === 'rolodex') renderRolodex();
  else if (viewState.view === 'list') renderList();
  else if (viewState.view === 'calendar') renderCalendarView();
  else if (viewState.view === 'tags') renderTags();
  else if (viewState.view === 'recommend') renderRecommend();
}

function emptyState(text, hint) {
  const div = document.createElement('div');
  div.className = 'empty';
  div.innerHTML = `<h3>${text}</h3><p>${hint}</p>`;
  mainEl.appendChild(div);
}

// ---------------------------------------------------------------- filter bar (shared by rolodex/list)
function renderFilterBar(container) {
  const bar = document.createElement('div');
  bar.className = 'rolodex-filterbar';
  const allPill = document.createElement('button');
  allPill.className = 'filter-pill' + (viewState.activeTagFilter === null ? ' is-active' : '');
  allPill.textContent = 'All';
  allPill.onclick = () => { viewState.activeTagFilter = null; viewState.rolodexIndex = 0; render(); };
  bar.appendChild(allPill);
  db.getTags().forEach(tag => {
    const pill = document.createElement('button');
    pill.className = 'filter-pill' + (viewState.activeTagFilter === tag.id ? ' is-active' : '');
    pill.textContent = (tag.isGoal ? '\u2605 ' : '#') + tag.name;
    pill.onclick = () => { viewState.activeTagFilter = tag.id; viewState.rolodexIndex = 0; render(); };
    bar.appendChild(pill);
  });
  container.appendChild(bar);
}

// ---------------------------------------------------------------- watch-dial view
// Build the ordered list of dial items: derived goal containers (only when
// unfiltered) followed by individual tasks. Goals are UI-only objects derived
// from goal tags + activities — never stored as activities. A goal appears
// only while it still has a task unstamped today, mirroring how a stamped task
// drops off the dial. "No goal" is never a dial item.
function dialItems() {
  const today = db.todayStr();
  const pool = filteredActivities();
  const tasks = pool.filter(a => !db.isDoneOn(a, today));
  const taskItems = tasks.map(a => ({ type: 'task', key: a.id, name: a.name, activity: a }));
  if (viewState.activeTagFilter !== null) return { pool, items: taskItems };
  const goalItems = db.getGoals().map(goal => {
    const unfinished = db.getActivities().filter(a => a.tags.includes(goal.id) && !db.isDoneOn(a, today));
    return { type: 'goal', key: 'goal:' + goal.id, name: goal.name, goal, tasks: unfinished };
  }).filter(g => g.tasks.length > 0);
  return { pool, items: [...goalItems, ...taskItems] };
}

// Open a goal from the dial: jump straight to its only unfinished task, or
// show a picker when several remain. The goal itself is never stamped.
function openGoalRun(goal) {
  const today = db.todayStr();
  const unfinished = db.getActivities().filter(a => a.tags.includes(goal.id) && !db.isDoneOn(a, today));
  if (unfinished.length === 0) { toast('All tasks in this goal are stamped today'); render(); return; }
  if (unfinished.length === 1) { openDetail(unfinished[0].id); return; }
  openGoalPicker(goal, unfinished);
}

function openGoalPicker(goal, tasks) {
  openSheet(`
    <div class="sheet__head">
      <h2 class="sheet__title">★ ${goal.name.replace(/</g, '&lt;')}</h2>
      <button class="sheet__close" aria-label="Close">&times;</button>
    </div>
    <p class="goals-intro">Tasks still to do today under this goal. Stamp one, run its timer, or open it.</p>
    <div class="goal-run-list" id="goal-run-list"></div>
  `, {
    onMount: (sheet) => {
      sheet.querySelector('.sheet__close').onclick = closeSheet;
      const list = sheet.querySelector('#goal-run-list');
      tasks.forEach(a => {
        const row = document.createElement('div');
        row.className = 'goal-run-row';
        row.innerHTML = `<span class="goal-run-row__name"></span>
          <div class="goal-run-row__actions">
            <button class="btn btn--stamp btn--sm" data-a="stamp">Stamp</button>
            <button class="btn btn--ghost btn--sm" data-a="timer">Timer</button>
            <button class="btn btn--text btn--sm" data-a="open">Open</button>
          </div>`;
        row.querySelector('.goal-run-row__name').textContent = a.name;
        row.querySelector('[data-a="stamp"]').onclick = async () => { await toggleDone(a); closeSheet(); };
        row.querySelector('[data-a="timer"]').onclick = () => { closeSheet(); openTimer(a); };
        row.querySelector('[data-a="open"]').onclick = () => openDetail(a.id);
        list.appendChild(row);
      });
    }
  });
}

function renderRolodex() {
  renderFilterBar(mainEl);
  const { pool, items } = dialItems();
  if (pool.length === 0) {
    emptyState('No cards yet', 'Tap the + button to file your first task in the drawer.');
    return;
  }
  if (items.length === 0) {
    emptyState('All done for today', 'Every card here is stamped — they\u2019ll be back on the dial tomorrow.');
    return;
  }
  if (viewState.rolodexIndex >= items.length) viewState.rolodexIndex = 0;

  const n = items.length;
  const i = viewState.rolodexIndex;
  const at = k => ((k % n) + n) % n;
  const openItem = (item) => { if (item.type === 'goal') openGoalRun(item.goal); else openDetail(item.activity.id); };

  // one step between neighbouring cards on the rim; tighten it as the drawer fills
  const step = Math.max(20, Math.min(34, 150 / n));

  const stage = document.createElement('div');
  stage.className = 'watch-stage';
  stage.innerHTML = `
    <div class="watch-dial" aria-hidden="true">
      <div class="watch-dial__ticks"></div>
      <div class="watch-dial__rotor"></div>
    </div>
    <div class="watch-pointer" aria-hidden="true"></div>
    <button class="watch-open" type="button"></button>
  `;
  mainEl.appendChild(stage);

  const rotor = stage.querySelector('.watch-dial__rotor');
  const baseR = -i * step; // 0deg = the 3-o'clock pointer

  // dial geometry in stage px — a tall superellipse (elongated rounded bracket)
  const RX = 175, RY = 205, CX = 260, CY = 310, NEXP = 3.4; // mirrors the CSS dial box
  const superPos = (rad) => {
    const c = Math.cos(rad), s = Math.sin(rad);
    return {
      x: CX + RX * Math.sign(c) * Math.pow(Math.abs(c), 2 / NEXP),
      y: CY + RY * Math.sign(s) * Math.pow(Math.abs(s), 2 / NEXP),
    };
  };

  const labels = items.map((item, idx) => {
    const el = document.createElement('button');
    el.className = 'watch-label' + (item.type === 'goal' ? ' watch-label--goal' : '');
    el.type = 'button';
    el.innerHTML = '<span class="watch-label__txt"></span><span class="watch-label__tick"></span>';
    el.querySelector('.watch-label__txt').textContent = (item.type === 'goal' ? '★ ' : '') + item.name;
    el.onclick = () => { if (idx === i) { openItem(items[idx]); return; } viewState.rolodexIndex = idx; render(); };
    rotor.appendChild(el);
    return el;
  });

  function paint(extra) {
    labels.forEach((el, idx) => {
      let off = idx - i;
      off = ((off % n) + n) % n;
      if (off > n / 2) off -= n;                     // shortest wrap distance
      let ang = off * step + extra;                  // degrees, 0 = pointer
      ang = ((ang + 180) % 360 + 360) % 360 - 180;  // -180..180
      const mag = Math.abs(ang);
      if (mag > step * 2.6) { el.style.opacity = '0'; el.style.pointerEvents = 'none'; return; }
      const rad = ang * Math.PI / 180;
      const p = superPos(rad);
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
      el.style.opacity = String(Math.max(0.22, 1 - mag / 110));
      el.style.pointerEvents = 'auto';
      el.classList.toggle('is-current', idx === i && Math.abs(extra) < step / 2);
    });
  }
  paint(0);

  // the selection read-off at the pointer — tap to open the card full-screen
  const current = items[i];
  const openBtn = stage.querySelector('.watch-open');
  const hint = current.type === 'goal'
    ? `Goal · ${current.tasks.length} to do · tap to run`
    : 'Tap to open';
  openBtn.innerHTML = `<span class="watch-open__name"></span><span class="watch-open__hint">${hint}</span>`;
  openBtn.querySelector('.watch-open__name').textContent = (current.type === 'goal' ? '★ ' : '') + current.name;
  openBtn.onclick = () => openItem(current);

  attachDialDrag(stage, step, extraDeg => {
    // select whichever card the drag brought round to the pointer
    const idxDelta = -Math.round(extraDeg / step);
    if (idxDelta !== 0) { viewState.rolodexIndex = at(i + idxDelta); render(); }
  }, extra => paint(extra));

  const nav = document.createElement('div');
  nav.className = 'rolodex-nav';
  nav.innerHTML = `
    <button class="rolodex-nav__btn" id="rolo-prev" aria-label="Previous card">&#8593;</button>
    <span class="rolodex-nav__count">${i + 1} / ${n}</span>
    <button class="rolodex-nav__btn" id="rolo-next" aria-label="Next card">&#8595;</button>
  `;
  mainEl.appendChild(nav);
  nav.querySelector('#rolo-prev').onclick = () => stepRolodex(-1, items);
  nav.querySelector('#rolo-next').onclick = () => stepRolodex(1, items);
}

// Turn the dial by dragging vertically anywhere on the stage; the rotor tracks
// the finger live and snaps to the nearest card at the pointer on release.
function attachDialDrag(stage, step, onSettle, onMove) {
  const DEG_PER_PX = step / 90; // ~90px of travel per card — gentle, one at a time
  let startY = 0, dy = 0, dragging = false;
  stage.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    dragging = true; startY = e.clientY; dy = 0;
    stage.classList.add('is-turning');
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', e => {
    if (!dragging) return;
    dy = e.clientY - startY;
    onMove(-dy * DEG_PER_PX); // px -> degrees, up advances
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove('is-turning');
    if (Math.abs(dy) > 6) stage.dataset.dragged = '1';
    onSettle(-dy * DEG_PER_PX);
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.tabIndex = 0;
  stage.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); onSettle(step); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); onSettle(-step); }
  });
}

function stepRolodex(dir, acts) {
  viewState.rolodexIndex = (viewState.rolodexIndex + dir + acts.length) % acts.length;
  render();
}

// Vertical drag: the wheel turns on a horizontal axle, so flicking the face
// card up brings the next one round, down brings the previous one back.
function attachWheelDrag(el, onNext, onPrev) {
  let startY = 0, startX = 0, dy = 0, dragging = false;
  el.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    dragging = true; startY = e.clientY; startX = e.clientX; dy = 0;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', e => {
    if (!dragging) return;
    dy = e.clientY - startY;
    if (Math.abs(dy) < Math.abs(e.clientX - startX)) return;
    el.style.animation = 'none';
    el.style.transform = `translateY(${dy * 0.45}px) rotateX(${-dy / 14}deg)`;
    el.style.opacity = String(Math.max(0.45, 1 - Math.abs(dy) / 300));
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    el.style.transform = '';
    el.style.opacity = '';
    el.style.animation = '';
    if (Math.abs(dy) > 6) el.dataset.dragged = '1';
    if (dy < -56) onNext();
    else if (dy > 56) onPrev();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); onPrev(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); onNext(); }
  });
}

// ---------------------------------------------------------------- card builder (shared: rolodex)
function buildCard(activity) {
  const node = tplCard.content.firstElementChild.cloneNode(true);
  node.querySelector('.card__title').textContent = activity.name;
  const tagsWrap = node.querySelector('.card__tags');
  if (activity.teamId) {
    const teamChip = document.createElement('span');
    teamChip.className = 'tag-chip is-team';
    teamChip.textContent = 'Team';
    tagsWrap.appendChild(teamChip);
  }
  activityTagObjs(activity).forEach(t => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip' + (t.isGoal ? ' is-goal' : '');
    chip.textContent = (t.isGoal ? '\u2605 ' : '') + t.name;
    tagsWrap.appendChild(chip);
  });
  const streakWrap = node.querySelector('.card__streak');
  stats.last7(activity).forEach(done => {
    const d = document.createElement('span');
    d.className = 'dot' + (done ? ' is-done' : '');
    streakWrap.appendChild(d);
  });
  const now = new Date();
  const pct = Math.round(stats.monthConsistency(activity, now.getFullYear(), now.getMonth()) * 100);
  const since = stats.daysSinceLastLog(activity);
  let statsText = `${pct}% consistent this month \u00b7 ${since === null ? 'never logged' : since === 0 ? 'logged today' : `${since}d since last`}`;
  const doneToday = db.isDoneOn(activity, db.todayStr());
  if (activity.teamId && doneToday) {
    const todayLog = activity.logs[db.todayStr()];
    const stampedByMe = todayLog && todayLog.by && todayLog.by === sync.getUid();
    statsText += stampedByMe ? ' \u00b7 stamped by you' : ' \u00b7 stamped by a teammate';
  }
  node.querySelector('.card__stats').textContent = statsText;
  const stampBtn = node.querySelector('[data-action="mark-done"]');
  stampBtn.textContent = doneToday ? 'Stamped \u2713' : 'Stamp today';
  stampBtn.classList.toggle('is-done', doneToday);
  stampBtn.onclick = (e) => { e.stopPropagation(); toggleDone(activity); };

  node.querySelector('[data-action="timer"]').onclick = (e) => { e.stopPropagation(); openTimer(activity); };
  node.querySelector('[data-action="open"]').onclick = (e) => { e.stopPropagation(); openDetail(activity.id); };
  node.addEventListener('click', (e) => {
    if (node.dataset.dragged === '1') { delete node.dataset.dragged; return; }
    if (!e.target.closest('button')) openDetail(activity.id);
  });
  return node;
}

// Overwrites (not accumulates) a single date's local log entry — used for
// team cards, where the shared doc is the source of truth and last write
// wins, unlike db.markDone's local accumulate-seconds behavior.
function setLocalLog(activity, date, logObj) {
  db.updateActivity(activity.id, { logs: { ...activity.logs, [date]: logObj } });
}

async function toggleDone(activity) {
  const date = db.todayStr();
  const currentlyDone = db.isDoneOn(activity, date);
  if (activity.teamId) {
    try {
      if (currentlyDone) {
        await sync.unmarkTeamActivityDone(activity.teamId, activity.teamActivityId, date);
        db.unmarkDone(activity.id, date);
        toast('Unstamped for the team');
      } else {
        await sync.markTeamActivityDone(activity.teamId, activity.teamActivityId, date, {});
        setLocalLog(activity, date, { done: true, source: 'manual', seconds: 0, note: '', by: sync.getUid() });
        toast('Stamped for the team');
      }
    } catch (err) {
      toast(err.message || 'Could not sync stamp \u2014 try again');
    }
    render();
    return;
  }
  if (db.isDoneOn(activity, db.todayStr())) {
    db.unmarkDone(activity.id);
    toast('Unstamped');
  } else {
    db.markDone(activity.id, { source: 'manual' });
    toast('Stamped for today');
  }
  render();
}

// ---------------------------------------------------------------- list view
function renderList() {
  renderFilterBar(mainEl);
  const acts = filteredActivities();
  if (acts.length === 0) {
    emptyState('Nothing filed here', 'Add an activity or clear the tag filter.');
    return;
  }
  const list = document.createElement('div');
  list.className = 'list';
  acts.forEach(activity => {
    const node = tplRow.content.firstElementChild.cloneNode(true);
    node.querySelector('.row__title').textContent = activity.name;
    const tagsWrap = node.querySelector('.row__tags');
    if (activity.teamId) {
      const teamChip = document.createElement('span');
      teamChip.className = 'tag-chip is-team';
      teamChip.textContent = 'Team';
      tagsWrap.appendChild(teamChip);
    }
    activityTagObjs(activity).forEach(t => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip' + (t.isGoal ? ' is-goal' : '');
      chip.textContent = (t.isGoal ? '\u2605 ' : '') + t.name;
      tagsWrap.appendChild(chip);
    });
    const streakWrap = node.querySelector('.row__streak');
    stats.last7(activity).forEach(done => {
      const d = document.createElement('span');
      d.className = 'dot' + (done ? ' is-done' : '');
      streakWrap.appendChild(d);
    });
    const doneToday = db.isDoneOn(activity, db.todayStr());
    const stampEl = node.querySelector('.row__stamp');
    stampEl.classList.toggle('is-done', doneToday);
    stampEl.onclick = () => toggleDone(activity);
    node.querySelector('.row__body').onclick = () => openDetail(activity.id);
    node.querySelector('[data-action="timer"]').onclick = () => openTimer(activity);
    list.appendChild(node);
  });
  mainEl.appendChild(list);
}

// ---------------------------------------------------------------- calendar view
function activitiesDoneOn(dateStr) {
  return db.getActivities().filter(a => db.isDoneOn(a, dateStr));
}

function renderCalendarView() {
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const y = viewState.calYear, m = viewState.calMonth;

  const wrap = document.createElement('div');
  wrap.className = 'calview';
  wrap.innerHTML = `
    <div class="month-nav month-nav--light">
      <button class="rolodex-nav__btn" id="cv-prev" aria-label="Previous month">&#8249;</button>
      <span class="month-nav__label" id="cv-label">${monthNames[m]} ${y}</span>
      <button class="rolodex-nav__btn" id="cv-next" aria-label="Next month">&#8250;</button>
    </div>
    <div class="calview__grid" id="cv-grid"></div>
    <div class="calview__day" id="cv-day"></div>
  `;
  mainEl.appendChild(wrap);

  const grid = wrap.querySelector('#cv-grid');
  ['S','M','T','W','T','F','S'].forEach(d => {
    const el = document.createElement('div'); el.className = 'calview__dow'; el.textContent = d;
    grid.appendChild(el);
  });
  const firstDow = new Date(y, m, 1).getDay();
  const totalDays = stats.daysInMonth(y, m);
  for (let i = 0; i < firstDow; i++) {
    const el = document.createElement('div'); el.className = 'calview__cell is-empty';
    grid.appendChild(el);
  }
  const todayS = db.todayStr();
  for (let d = 1; d <= totalDays; d++) {
    const dateStr = `${y}-${String(m + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const done = activitiesDoneOn(dateStr);
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'calview__cell'
      + (done.length ? ' has-done' : '')
      + (dateStr === todayS ? ' is-today' : '')
      + (dateStr === viewState.calSelected ? ' is-selected' : '');
    const dots = done.slice(0, 4).map(() => '<span class="calview__dot"></span>').join('');
    cell.innerHTML = `<span class="calview__daynum">${d}</span>`
      + (done.length ? `<span class="calview__dots">${dots}</span>` : '');
    cell.onclick = () => { viewState.calSelected = dateStr; render(); };
    grid.appendChild(cell);
  }

  renderCalDay(wrap.querySelector('#cv-day'));

  wrap.querySelector('#cv-prev').onclick = () => { viewState.calMonth--; if (viewState.calMonth < 0) { viewState.calMonth = 11; viewState.calYear--; } render(); };
  wrap.querySelector('#cv-next').onclick = () => { viewState.calMonth++; if (viewState.calMonth > 11) { viewState.calMonth = 0; viewState.calYear++; } render(); };
}

// Build a plain-text report of every day-note between two dates (inclusive).
// taskId '' means all tasks; otherwise limit to that one activity.
function exportNotes(from, to, taskId = '') {
  if (!from || !to) { toast('Pick both dates'); return; }
  if (from > to) { [from, to] = [to, from]; }
  let acts = db.getActivities();
  if (taskId) acts = acts.filter(a => a.id === taskId);
  const only = taskId ? acts[0] : null;
  const byDate = {};
  acts.forEach(a => {
    Object.entries(a.logs).forEach(([date, log]) => {
      if (date < from || date > to || !log || !log.done) return;
      const note = (log.note || '').trim();
      if (!note) return;
      (byDate[date] = byDate[date] || []).push({ name: a.name, note, mins: log.seconds ? Math.round(log.seconds / 60) : 0 });
    });
  });
  const dates = Object.keys(byDate).sort();
  const scope = only ? only.name : 'All tasks';
  let out = `Daily notes  ${from} to ${to}\nTask: ${scope}\n${'='.repeat(40)}\n\n`;
  if (dates.length === 0) {
    out += 'No notes in this range.\n';
  } else {
    dates.forEach(date => {
      out += `${date}\n${'-'.repeat(date.length)}\n`;
      byDate[date].forEach(({ name, note, mins }) => {
        out += `\u2022 ${name}${mins ? ` (${mins} min)` : ''}\n  ${note.replace(/\n/g, '\n  ')}\n`;
      });
      out += '\n';
    });
  }
  const slug = only ? only.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : 'all-tasks';
  const filename = `daily-notes_${slug}_${from}_to_${to}.txt`;
  showTextExport(filename, out);
  if (!dates.length) toast('No notes in this range');
}

// Stamp/unstamp a task on a given date from the Calendar view, routing team
// tasks through sync.js (last-write-wins) and personal tasks through storage.
// Returns a promise so callers can refresh once the write lands.
async function stampTaskOn(activity, dateStr, { seconds = 0, note = '' } = {}) {
  if (activity.teamId) {
    await sync.markTeamActivityDone(activity.teamId, activity.teamActivityId, dateStr, { seconds, note });
    setLocalLog(activity, dateStr, { done: true, source: 'manual', seconds, note, by: sync.getUid() });
  } else {
    db.markDone(activity.id, { source: 'manual', seconds, note, date: dateStr });
  }
}
async function unstampTaskOn(activity, dateStr) {
  if (activity.teamId) {
    await sync.unmarkTeamActivityDone(activity.teamId, activity.teamActivityId, dateStr);
    db.unmarkDone(activity.id, dateStr);
  } else {
    db.unmarkDone(activity.id, dateStr);
  }
}

function renderCalDay(container) {
  const dateStr = viewState.calSelected;
  const parts = dateStr.split('-').map(Number);
  const dObj = new Date(parts[0], parts[1] - 1, parts[2]);
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const monthShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const done = activitiesDoneOn(dateStr);
  const heading = `${dayNames[dObj.getDay()]}, ${monthShort[dObj.getMonth()]} ${dObj.getDate()}`;
  container.innerHTML = `<div class="calview__day-head"><span>${heading}</span><span class="calview__day-count">${done.length} accomplished</span></div>`;

  if (done.length === 0) {
    const p = document.createElement('p');
    p.className = 'calview__day-empty';
    p.textContent = 'Nothing stamped this day.';
    container.appendChild(p);
  } else {
    const listEl = document.createElement('div');
    listEl.className = 'calview__day-list';
    done.forEach(a => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'calview__done-row';
      const log = a.logs[dateStr];
      const mins = log && log.seconds ? Math.round(log.seconds / 60) : 0;
      const meta = mins > 0 ? `${mins} min` : (log && log.source === 'timer' ? 'timed' : 'stamped');
      const noteHtml = log && log.note ? `<span class="calview__done-note">${log.note.replace(/</g,'&lt;')}</span>` : '';
      row.innerHTML = `<span class="calview__done-dot"></span><span class="calview__done-main"><span class="calview__done-name">${a.name}</span>${noteHtml}</span><span class="calview__done-meta">${meta}</span>`;
      row.onclick = () => openDetail(a.id);
      listEl.appendChild(row);
    });
    container.appendChild(listEl);
  }

  renderCalStamper(container, dateStr);
}

// "Stamp another task" flow for the selected calendar date: pick any existing
// task, optionally add minutes and a note, and stamp it on that date — or
// unstamp it if it's already stamped that day. Works for past, present, or
// future dates since db.markDone/unmarkDone take an explicit date.
function renderCalStamper(container, dateStr) {
  const acts = db.getActivities();
  const wrap = document.createElement('div');
  wrap.className = 'cal-stamp';
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'btn btn--stamp cal-stamp__open';
  toggleBtn.textContent = '+ Stamp another task';
  wrap.appendChild(toggleBtn);

  const panel = document.createElement('div');
  panel.className = 'cal-stamp__panel';
  panel.hidden = true;
  if (acts.length === 0) {
    panel.innerHTML = '<p class="calview__day-empty">No tasks yet — create one first.</p>';
  } else {
    panel.innerHTML = `
      <label class="cal-stamp__label">Task
        <select class="cal-stamp__select" id="cst-task">
          ${acts.map(a => `<option value="${a.id}">${a.name.replace(/</g,'&lt;')}${a.teamId ? ' (team)' : ''}</option>`).join('')}
        </select>
      </label>
      <div class="cal-stamp__row">
        <label class="cal-stamp__label">Minutes (optional)
          <input type="number" id="cst-mins" min="0" max="600" placeholder="0">
        </label>
      </div>
      <label class="cal-stamp__label">Note (optional)
        <textarea id="cst-note" rows="2" placeholder="What you did, how it went…"></textarea>
      </label>
      <div class="cal-stamp__actions">
        <button class="btn btn--primary" id="cst-save">Stamp</button>
        <span class="cal-stamp__state" id="cst-state"></span>
      </div>`;
  }
  wrap.appendChild(panel);
  container.appendChild(wrap);

  toggleBtn.onclick = () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) syncPanelToTask();
  };

  if (acts.length === 0) return;

  const selectEl = panel.querySelector('#cst-task');
  const minsEl = panel.querySelector('#cst-mins');
  const noteEl = panel.querySelector('#cst-note');
  const saveEl = panel.querySelector('#cst-save');
  const stateEl = panel.querySelector('#cst-state');

  function currentTask() { return db.getActivity(selectEl.value); }

  // Reflect whether the chosen task is already stamped this day: prefill its
  // minutes/note and flip the button to Stamp vs. Unstamp.
  function syncPanelToTask() {
    const a = currentTask();
    if (!a) return;
    const log = a.logs[dateStr];
    const isDone = !!(log && log.done);
    if (isDone) {
      minsEl.value = log.seconds ? Math.round(log.seconds / 60) : '';
      noteEl.value = log.note || '';
      saveEl.textContent = 'Unstamp';
      saveEl.classList.add('is-unstamp');
      stateEl.textContent = 'Already stamped this day';
    } else {
      minsEl.value = '';
      noteEl.value = '';
      saveEl.textContent = 'Stamp';
      saveEl.classList.remove('is-unstamp');
      stateEl.textContent = '';
    }
  }
  selectEl.onchange = syncPanelToTask;
  syncPanelToTask();

  saveEl.onclick = async () => {
    const a = currentTask();
    if (!a) return;
    const isDone = db.isDoneOn(a, dateStr);
    saveEl.disabled = true;
    try {
      if (isDone) {
        await unstampTaskOn(a, dateStr);
        toast(a.teamId ? 'Unstamped for the team' : 'Unstamped');
      } else {
        const mins = Math.max(0, parseInt(minsEl.value, 10) || 0);
        const note = noteEl.value.trim();
        await stampTaskOn(a, dateStr, { seconds: mins * 60, note });
        toast(a.teamId ? 'Stamped for the team' : 'Stamped');
      }
    } catch (err) {
      toast(err.message || 'Could not sync — try again');
      saveEl.disabled = false;
      return;
    }
    render();
  };
}

// ---------------------------------------------------------------- goals & tags view
// A goal is a tag with isGoal === true; a task belongs to a goal when its
// tags include that goal's id. "No goal" collects tasks with no goal tag.
function activityGoalObjs(activity) {
  return activityTagObjs(activity).filter(t => t.isGoal);
}

function jumpToTagFilter(tagId) {
  viewState.activeTagFilter = tagId;
  viewState.view = 'list';
  tabs.forEach(t => { t.classList.toggle('is-active', t.dataset.view === 'list'); t.setAttribute('aria-selected', t.dataset.view === 'list' ? 'true' : 'false'); });
  document.getElementById('brand-view').textContent = viewLabels.list;
  render();
}

// A compact, tappable task row used under a goal (and under "No goal").
function buildGoalTaskRow(activity) {
  const row = document.createElement('div');
  row.className = 'goal-task';
  const doneToday = db.isDoneOn(activity, db.todayStr());
  const stamp = document.createElement('button');
  stamp.type = 'button';
  stamp.className = 'goal-task__stamp' + (doneToday ? ' is-done' : '');
  stamp.title = doneToday ? 'Stamped today' : 'Stamp today';
  stamp.setAttribute('aria-label', doneToday ? 'Unstamp today' : 'Stamp today');
  stamp.onclick = (e) => { e.stopPropagation(); toggleDone(activity); };
  const body = document.createElement('div');
  body.className = 'goal-task__body';
  const teamMark = activity.teamId ? '<span class="goal-task__team">Team</span>' : '';
  body.innerHTML = `<span class="goal-task__name">${activity.name.replace(/</g, '&lt;')}</span>${teamMark}`;
  body.onclick = () => openDetail(activity.id);
  row.appendChild(stamp);
  row.appendChild(body);
  return row;
}

function renderTags() {
  const goals = db.getGoals();
  const plainTags = db.getTags().filter(t => !t.isGoal);
  const allActs = db.getActivities();

  const addRow = document.createElement('div');
  addRow.className = 'card__actions';
  addRow.style.marginBottom = '4px';
  const addGoalBtn = document.createElement('button');
  addGoalBtn.className = 'btn btn--primary'; addGoalBtn.textContent = '+ New goal';
  addGoalBtn.onclick = () => openTagForm({ isGoal: true });
  const addTagBtn = document.createElement('button');
  addTagBtn.className = 'btn btn--ghost'; addTagBtn.style.borderColor = '#067647'; addTagBtn.style.color = '#067647';
  addTagBtn.textContent = '+ New tag';
  addTagBtn.onclick = () => openTagForm({ isGoal: false });
  addRow.appendChild(addGoalBtn); addRow.appendChild(addTagBtn);
  mainEl.appendChild(addRow);

  const intro = document.createElement('p');
  intro.className = 'goals-intro';
  intro.textContent = 'Goals are the outcomes you\u2019re working toward; the tasks below each one are the things you do and stamp. Tags are lightweight labels.';
  mainEl.appendChild(intro);

  // ---- Goals: each goal with its tasks, plus a "No goal" bucket ----
  const goalsHead = document.createElement('div');
  goalsHead.className = 'section-title';
  goalsHead.textContent = 'Goals';
  mainEl.appendChild(goalsHead);

  if (goals.length === 0) {
    const p = document.createElement('p');
    p.style.cssText = 'opacity:.6;font-size:12px;';
    p.textContent = 'No goals yet \u2014 add one to group your tasks toward an outcome.';
    mainEl.appendChild(p);
  }

  goals.forEach(goal => {
    const tasks = allActs.filter(a => a.tags.includes(goal.id));
    const group = document.createElement('div');
    group.className = 'goal-group';
    const head = document.createElement('div');
    head.className = 'goal-group__head';
    head.innerHTML = `
      <div class="goal-group__title"><span class="goal-group__star">\u2605</span>${goal.name.replace(/</g, '&lt;')}${goal.teamGoalId ? '<span class="goal-task__team">Team</span>' : ''}</div>
      <div class="goal-group__count">${tasks.length} task${tasks.length === 1 ? '' : 's'}</div>
      <button class="tag-card__edit" data-act="edit">Edit</button>`;
    head.querySelector('[data-act="edit"]').onclick = (e) => { e.stopPropagation(); openTagForm({ existing: goal }); };
    group.appendChild(head);

    const taskWrap = document.createElement('div');
    taskWrap.className = 'goal-group__tasks';
    if (tasks.length === 0) {
      const p = document.createElement('p');
      p.className = 'goal-group__empty';
      p.textContent = 'No tasks under this goal yet.';
      taskWrap.appendChild(p);
    } else {
      tasks.forEach(a => taskWrap.appendChild(buildGoalTaskRow(a)));
    }
    group.appendChild(taskWrap);

    const actions = document.createElement('div');
    actions.className = 'goal-group__actions';
    const newTask = document.createElement('button');
    newTask.className = 'btn btn--ghost btn--sm';
    newTask.style.cssText = 'border-color:#067647;color:#067647;';
    newTask.textContent = '+ New task in this goal';
    newTask.onclick = () => openActivityForm(null, { presetGoalId: goal.id });
    actions.appendChild(newTask);
    if (tasks.length) {
      const viewAll = document.createElement('button');
      viewAll.className = 'btn btn--text btn--sm';
      viewAll.textContent = 'View in list \u203a';
      viewAll.onclick = () => jumpToTagFilter(goal.id);
      actions.appendChild(viewAll);
    }
    group.appendChild(actions);
    mainEl.appendChild(group);
  });

  // "No goal" bucket \u2014 tasks with no goal tag at all.
  const orphanTasks = allActs.filter(a => activityGoalObjs(a).length === 0);
  const orphanGroup = document.createElement('div');
  orphanGroup.className = 'goal-group goal-group--nogoal';
  const orphanHead = document.createElement('div');
  orphanHead.className = 'goal-group__head';
  orphanHead.innerHTML = `
    <div class="goal-group__title">No goal</div>
    <div class="goal-group__count">${orphanTasks.length} task${orphanTasks.length === 1 ? '' : 's'}</div>`;
  orphanGroup.appendChild(orphanHead);
  const orphanWrap = document.createElement('div');
  orphanWrap.className = 'goal-group__tasks';
  if (orphanTasks.length === 0) {
    const p = document.createElement('p');
    p.className = 'goal-group__empty';
    p.textContent = 'Every task is linked to a goal.';
    orphanWrap.appendChild(p);
  } else {
    orphanTasks.forEach(a => orphanWrap.appendChild(buildGoalTaskRow(a)));
  }
  orphanGroup.appendChild(orphanWrap);
  const orphanActions = document.createElement('div');
  orphanActions.className = 'goal-group__actions';
  const newLoose = document.createElement('button');
  newLoose.className = 'btn btn--ghost btn--sm';
  newLoose.style.cssText = 'border-color:#067647;color:#067647;';
  newLoose.textContent = '+ New task';
  newLoose.onclick = () => openActivityForm();
  orphanActions.appendChild(newLoose);
  orphanGroup.appendChild(orphanActions);
  mainEl.appendChild(orphanGroup);

  // ---- Tags: lightweight labels, as compact cards ----
  const tagsHead = document.createElement('div');
  tagsHead.className = 'section-title';
  tagsHead.textContent = 'Tags';
  mainEl.appendChild(tagsHead);
  const tagWrap = document.createElement('div');
  tagWrap.className = 'taglist';
  if (plainTags.length === 0) {
    const p = document.createElement('p');
    p.style.cssText = 'opacity:.6;font-size:12px;';
    p.textContent = 'None yet.';
    tagWrap.appendChild(p);
  }
  plainTags.forEach(tag => {
    const count = allActs.filter(a => a.tags.includes(tag.id)).length;
    const card = document.createElement('div');
    card.className = 'tag-card';
    card.innerHTML = `<div class="tag-card__body"><div class="tag-card__name">#${tag.name.replace(/</g, '&lt;')}</div><div class="tag-card__count">${count} task${count === 1 ? '' : 's'}</div></div><button class="tag-card__edit" aria-label="Edit">Edit</button>`;
    card.querySelector('.tag-card__body').onclick = () => jumpToTagFilter(tag.id);
    card.querySelector('.tag-card__edit').onclick = (e) => { e.stopPropagation(); openTagForm({ existing: tag }); };
    tagWrap.appendChild(card);
  });
  mainEl.appendChild(tagWrap);
}

// ---------------------------------------------------------------- recommend view
function renderRecommend() {
  const toggle = document.createElement('div');
  toggle.className = 'reco-toggle';
  [['balanced', 'Balanced'], ['gaps', 'Close the gaps'], ['untouched', 'Revive dormant']].forEach(([key, label]) => {
    const btn = document.createElement('button');
    btn.className = 'filter-pill' + (viewState.recoMode === key ? ' is-active' : '');
    btn.textContent = label;
    btn.onclick = () => {
      viewState.recoMode = key;
      db.updateSettings({ recommendationPref: key });
      render();
    };
    toggle.appendChild(btn);
  });
  mainEl.appendChild(toggle);

  const { gaps, untouched } = stats.buildRecommendations(db.getActivities());
  const showGaps = viewState.recoMode === 'gaps' || viewState.recoMode === 'balanced';
  const showUntouched = viewState.recoMode === 'untouched' || viewState.recoMode === 'balanced';

  const group = (title, reason, items, describe) => {
    if (items.length === 0) return;
    const wrap = document.createElement('div');
    wrap.className = 'reco-group';
    const h = document.createElement('div');
    h.className = 'section-title'; h.textContent = title;
    const r = document.createElement('div');
    r.className = 'reco-reason'; r.textContent = reason;
    wrap.appendChild(h); wrap.appendChild(r);
    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<div class="row__stamp" style="border-color:#067647"></div>
        <div class="row__body"><div class="row__title">${item.activity.name}</div><div class="row__tags"><span class="tag-chip">${describe(item)}</span></div></div>`;
      row.querySelector('.row__stamp').onclick = () => toggleDone(item.activity);
      row.querySelector('.row__stamp').classList.toggle('is-done', db.isDoneOn(item.activity, db.todayStr()));
      row.querySelector('.row__body').onclick = () => openDetail(item.activity.id);
      wrap.appendChild(row);
    });
    mainEl.appendChild(wrap);
  };

  if (showGaps) group('Close the gap', 'In progress this month, but falling behind pace.', gaps,
    item => `${Math.round(item.consistency * 100)}% this month`);
  if (showUntouched) group('Revive', 'Filed away and gathering dust.', untouched,
    item => item.since === null ? 'never logged' : `${item.since}d untouched`);

  if ((!showGaps || gaps.length === 0) && (!showUntouched || untouched.length === 0)) {
    emptyState('All caught up', 'Nothing needs your attention right now \u2014 nicely done.');
  }
}

// ---------------------------------------------------------------- sheets (generic)
function openSheet(innerHTML, { onMount, fullscreen } = {}) {
  closeSheet();
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop' + (fullscreen ? ' sheet-backdrop--full' : '');
  backdrop.id = 'active-sheet';
  backdrop.innerHTML = `<div class="sheet">${innerHTML}</div>`;
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeSheet(); });
  document.body.appendChild(backdrop);
  onMount && onMount(backdrop.querySelector('.sheet'));
}
function closeSheet() {
  const el = document.getElementById('active-sheet');
  if (el) el.remove();
  if (teamUnsub) { teamUnsub(); teamUnsub = null; }
}

// A standalone overlay that shows generated text with Copy + Download actions.
// Layers above any open sheet (e.g. Settings) and works even where the browser
// blocks programmatic downloads — the user can always copy.
const SAMPLE_CSV = `name,tags,note,timerType,timerMinutes
Morning run,health;body,Easy 5k around the park,stopwatch,
Guitar practice,craft;mind,Warm up with scales then work one song,countdown,25
Meditate,health;mind,Focus on the breath; count to ten,countdown,10
Read Sanskrit,study;mind,One page daily; note new words in the margin,countdown,20
Cold shower,body,Two minutes; breathe slowly,stopwatch,
Journal,mind,"Three lines: what went well, what to fix, one gratitude",stopwatch,
`;

function showTextExport(filename, text) {
  const old = document.getElementById('text-export');
  if (old) old.remove();
  const overlay = document.createElement('div');
  overlay.className = 'sheet-backdrop';
  overlay.id = 'text-export';
  overlay.innerHTML = `
    <div class="sheet">
      <div class="sheet__head">
        <h2 class="sheet__title">${filename}</h2>
        <button class="sheet__close" aria-label="Close">&times;</button>
      </div>
      <textarea class="export-text" readonly rows="12"></textarea>
      <div class="card__actions" style="margin-top:14px;">
        <button class="btn btn--stamp" id="tx-copy">Copy text</button>
        <button class="btn btn--ghost" id="tx-download">Download file</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const ta = overlay.querySelector('.export-text');
  ta.value = text;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('.sheet__close').onclick = () => overlay.remove();
  overlay.querySelector('#tx-copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      ta.focus(); ta.select();
      try { document.execCommand('copy'); } catch (_) {}
    }
    toast('Copied to clipboard');
  };
  overlay.querySelector('#tx-download').onclick = () => {
    try {
      const blob = new Blob([text], { type: filename.endsWith('.csv') ? 'text/csv' : filename.endsWith('.json') ? 'application/json' : 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Download started');
    } catch (e) {
      toast('Download blocked here \u2014 use Copy text');
    }
  };
}

// ---------------------------------------------------------------- activity detail + calendar
function openDetail(activityId) {
  const activity = db.getActivity(activityId);
  if (!activity) return;
  const now = new Date();
  const view = { year: now.getFullYear(), month: now.getMonth() };
  let refreshDetail = () => {};

  openSheet(`
    <div class="sheet__head">
      <h2 class="sheet__title">${activity.name}</h2>
      <button class="sheet__close" aria-label="Close">&times;</button>
    </div>
    <div class="card__tags" id="detail-tags"></div>
    <div class="task-note">
      <label class="task-note__label" for="task-note-input">Notes on this task</label>
      <textarea class="task-note__input" id="task-note-input" rows="2" placeholder="What's required, how to do it, methods\u2026"></textarea>
    </div>
    <div class="detail-streak">
      <div class="detail-streak__num"><span id="streak-count">0</span><span class="detail-streak__label">day streak</span></div>
      <div class="detail-streak__dots" id="streak-dots" aria-label="Last 7 days"></div>
    </div>
    <div class="detail-options">
      <div class="section-title" style="margin:0 0 10px;">Add a session</div>
      <div class="detail-options__row">
        <button class="btn btn--stamp" id="opt-log">Log time</button>
        <button class="btn btn--ghost" id="opt-timer">Start timer</button>
        <button class="btn btn--text" id="opt-cancel">Cancel &amp; back</button>
      </div>
      <div class="log-panel" id="log-panel" hidden>
        <label>Minutes spent</label>
        <div class="field-row">
          <input type="number" id="log-mins" min="1" max="600" value="15">
        </div>
        <label style="margin-top:12px;">Note for today's log</label>
        <textarea class="log-note__input" id="log-note-input" rows="2" placeholder="How it went, what you covered\u2026"></textarea>
        <div class="field-row" style="margin-top:12px;">
          <button class="btn btn--primary" id="log-save">Log &amp; stamp</button>
        </div>
      </div>
    </div>
    <div class="section-title" style="margin-top:22px;">History</div>
    <div class="month-nav">
      <button class="rolodex-nav__btn" id="cal-prev">&#8249;</button>
      <span class="month-nav__label" id="cal-label"></span>
      <button class="rolodex-nav__btn" id="cal-next">&#8250;</button>
    </div>
    <div class="cal-grid" id="cal-grid"></div>
    <div class="consistency-bar">
      <div class="consistency-bar__label"><span>Consistency this view</span><span id="cons-pct"></span></div>
      <div class="consistency-track"><div class="consistency-fill" id="cons-fill"></div></div>
    </div>
    <div class="card__actions" style="margin-top:18px;">
      ${!activity.teamId && sync.getLocalTeam() ? '<button class="btn btn--ghost" id="detail-share-team" style="border-color:#067647;color:#067647;">Share with team</button>' : ''}
      ${activity.teamId ? '<button class="btn btn--ghost" id="detail-unshare-team">Unshare (keep for me)</button>' : ''}
      <button class="btn btn--ghost" id="detail-edit">Edit</button>
      <button class="btn btn--text" id="detail-delete" style="color:#a8432d;">Delete task</button>
    </div>
  `, {
    fullscreen: true,
    onMount: (sheet) => {
      sheet.querySelector('.sheet__close').onclick = closeSheet;

      const tagsWrap = sheet.querySelector('#detail-tags');
      activityTagObjs(activity).forEach(t => {
        const chip = document.createElement('span');
        chip.className = 'tag-chip' + (t.isGoal ? ' is-goal' : '');
        chip.textContent = (t.isGoal ? '\u2605 ' : '') + t.name;
        tagsWrap.appendChild(chip);
      });

      // Persistent task note (method / how-to) — saves on blur.
      const taskNote = sheet.querySelector('#task-note-input');
      taskNote.value = activity.note || '';
      taskNote.addEventListener('blur', () => {
        const val = taskNote.value.trim();
        if (val !== (activity.note || '')) {
          db.updateActivity(activity.id, { note: val });
          activity.note = val;
        }
      });

      function renderCalendar() {
        const label = sheet.querySelector('#cal-label');
        const grid = sheet.querySelector('#cal-grid');
        const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        label.textContent = `${monthNames[view.month]} ${view.year}`;
        grid.innerHTML = '';
        ['S','M','T','W','T','F','S'].forEach(d => {
          const el = document.createElement('div'); el.className = 'cal-dow'; el.textContent = d;
          grid.appendChild(el);
        });
        const firstDow = new Date(view.year, view.month, 1).getDay();
        const totalDays = stats.daysInMonth(view.year, view.month);
        for (let i = 0; i < firstDow; i++) {
          const el = document.createElement('div'); el.className = 'cal-cell is-empty';
          grid.appendChild(el);
        }
        const todayS = db.todayStr();
        for (let d = 1; d <= totalDays; d++) {
          const dateStr = `${view.year}-${String(view.month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
          const el = document.createElement('div');
          el.className = 'cal-cell' + (db.isDoneOn(activity, dateStr) ? ' is-done' : '') + (dateStr === todayS ? ' is-today' : '');
          el.textContent = d;
          el.onclick = async () => {
            const isDone = db.isDoneOn(activity, dateStr);
            if (activity.teamId) {
              try {
                if (isDone) await sync.unmarkTeamActivityDone(activity.teamId, activity.teamActivityId, dateStr);
                else await sync.markTeamActivityDone(activity.teamId, activity.teamActivityId, dateStr, {});
              } catch (err) {
                toast(err.message || 'Could not sync \u2014 try again');
              }
              if (isDone) db.unmarkDone(activity.id, dateStr);
              else setLocalLog(activity, dateStr, { done: true, source: 'manual', seconds: 0, note: '', by: sync.getUid() });
              renderCalendar();
              refreshStreak();
              return;
            }
            if (isDone) db.unmarkDone(activity.id, dateStr);
            else db.markDone(activity.id, { source: 'manual', date: dateStr });
            renderCalendar();
            refreshStreak();
          };
          grid.appendChild(el);
        }
        const pct = Math.round(stats.monthConsistency(activity, view.year, view.month) * 100);
        sheet.querySelector('#cons-pct').textContent = pct + '%';
        sheet.querySelector('#cons-fill').style.width = pct + '%';
      }
      sheet.querySelector('#cal-prev').onclick = () => { view.month--; if (view.month < 0) { view.month = 11; view.year--; } renderCalendar(); };
      sheet.querySelector('#cal-next').onclick = () => { view.month++; if (view.month > 11) { view.month = 0; view.year++; } renderCalendar(); };

      function refreshStreak() {
        sheet.querySelector('#streak-count').textContent = stats.currentStreak(activity);
        const dotsWrap = sheet.querySelector('#streak-dots');
        dotsWrap.innerHTML = '';
        stats.last7(activity).forEach(done => {
          const d = document.createElement('span');
          d.className = 'dot' + (done ? ' is-done' : '');
          dotsWrap.appendChild(d);
        });
      }
      refreshDetail = () => { renderCalendar(); refreshStreak(); };
      refreshDetail();

      const logPanel = sheet.querySelector('#log-panel');
      const logNote = sheet.querySelector('#log-note-input');
      sheet.querySelector('#opt-log').onclick = () => {
        const showing = !logPanel.hidden;
        logPanel.hidden = showing;
        if (!showing) {
          const existing = activity.logs[db.todayStr()];
          logNote.value = existing?.note || '';
          sheet.querySelector('#log-mins').focus();
        }
      };
      sheet.querySelector('#log-save').onclick = async () => {
        const mins = Math.max(1, parseInt(sheet.querySelector('#log-mins').value, 10) || 0);
        const date = db.todayStr();
        const note = logNote.value.trim();
        if (activity.teamId) {
          try {
            await sync.markTeamActivityDone(activity.teamId, activity.teamActivityId, date, { seconds: mins * 60, note });
          } catch (err) {
            toast(err.message || 'Could not sync \u2014 try again');
          }
          setLocalLog(activity, date, { done: true, source: 'manual', seconds: mins * 60, note, by: sync.getUid() });
        } else {
          db.markDone(activity.id, { source: 'manual', seconds: mins * 60, note });
        }
        logPanel.hidden = true;
        refreshDetail();
        render();
        toast(`Logged ${mins} min \u2014 stamped`);
      };
      sheet.querySelector('#opt-timer').onclick = () => { closeSheet(); openTimer(activity); };
      sheet.querySelector('#opt-cancel').onclick = closeSheet;
      const shareBtn = sheet.querySelector('#detail-share-team');
      if (shareBtn) {
        shareBtn.onclick = async () => {
          if (!confirm(`Share "${activity.name}" with your team? Your existing history comes along and becomes visible to everyone. Tags stay local-only for now.`)) return;
          try {
            const logsToShare = { ...activity.logs };
            const todayKey = db.todayStr();
            if (logsToShare[todayKey] && !logsToShare[todayKey].by) {
              logsToShare[todayKey] = { ...logsToShare[todayKey], by: sync.getUid() };
            }
            const result = await sync.createTeamActivity({
              name: activity.name,
              timerType: activity.timerType,
              timerDuration: activity.timerDuration,
              logs: logsToShare,
            });
            db.updateActivity(activity.id, { teamId: result.code, teamActivityId: result.id, logs: logsToShare });
            closeSheet();
            render();
            toast('Shared with team \u2014 history included');
          } catch (err) {
            toast(err.message || 'Could not share with team');
          }
        };
      }
      sheet.querySelector('#detail-edit').onclick = () => openActivityForm(activity);
      const unshareBtn = sheet.querySelector('#detail-unshare-team');
      if (unshareBtn) {
        unshareBtn.onclick = () => {
          if (!confirm(`Stop syncing "${activity.name}" with the team? It stays on your device as a personal card with its current history, but you won't see further updates from teammates. The team keeps seeing it as before.`)) return;
          sync.ignoreTeamActivity(activity.teamActivityId);
          db.updateActivity(activity.id, { teamId: null, teamActivityId: null });
          closeSheet();
          render();
          toast('Unlinked \u2014 now a personal card');
        };
      }
      sheet.querySelector('#detail-delete').onclick = async () => {
        const isTeam = !!activity.teamId;
        const msg = isTeam
          ? `Delete "${activity.name}" for the whole team? This can't be undone.`
          : `Delete "${activity.name}"? This can't be undone.`;
        if (!confirm(msg)) return;
        if (isTeam) {
          try { await sync.deleteTeamActivity(activity.teamActivityId); }
          catch (e) { /* Firestore doc may already be gone — local delete still proceeds. */ }
        }
        db.deleteActivity(activity.id);
        closeSheet();
        render();
        toast(isTeam ? 'Removed for the team' : 'Card removed');
      };
    }
  });
}

// ---------------------------------------------------------------- add/edit activity form
// presetGoalId (optional): preselect a goal when creating a new task from the
// Goals & Tags view's "New task in this goal" quick action.
function openActivityForm(existing = null, { presetGoalId = null } = {}) {
  // A task carries at most one primary goal plus any number of plain tags,
  // all stored together in activity.tags. Split the existing membership into
  // the single primary goal (first goal-tag found) and the plain tag set.
  const goalIds = new Set(db.getGoals().map(g => g.id));
  const existingTags = existing ? existing.tags : [];
  let primaryGoal = existingTags.find(id => goalIds.has(id)) || null;
  if (!existing && presetGoalId && goalIds.has(presetGoalId)) primaryGoal = presetGoalId;
  const selectedTags = new Set(existingTags.filter(id => !goalIds.has(id)));
  openSheet(`
    <div class="sheet__head">
      <h2 class="sheet__title">${existing ? 'Edit task' : 'New task'}</h2>
      <button class="sheet__close" aria-label="Close">&times;</button>
    </div>
    <div class="field">
      <label>Task name</label>
      <input type="text" id="f-name" placeholder="e.g. Read 20 pages" value="${existing ? existing.name.replace(/"/g,'&quot;') : ''}">
    </div>
    <div class="field form-goalbox">
      <label>Goal <span class="field-hint">the larger outcome this task works toward · pick one</span></label>
      <div class="chip-toggle-group" id="f-goals"></div>
    </div>
    <div class="field form-tagbox">
      <label>Tags <span class="field-hint">lightweight labels for filtering</span></label>
      <div class="chip-toggle-group" id="f-tags"></div>
    </div>
    <div class="field">
      <label>New tag or goal (optional)</label>
      <div class="field-row">
        <input type="text" id="f-newtag" placeholder="Name">
        <select id="f-newtag-type" style="max-width:120px;">
          <option value="tag">Tag</option>
          <option value="goal">Goal</option>
        </select>
      </div>
      <button class="btn btn--ghost" id="f-newtag-add" style="margin-top:8px;border-color:#067647;color:#067647;">+ Add</button>
    </div>
    <div class="field">
      <label>How often?</label>
      <div class="field-row" style="align-items:center;gap:8px;">
        <input type="number" id="f-perweek" min="1" max="7" value="${existing ? (existing.timesPerWeek || 7) : 7}" style="max-width:80px;">
        <span style="font-size:13px;opacity:.75;">times per week</span>
      </div>
      <label style="margin-top:10px;font-size:12px;opacity:.7;">Preferred days</label>
      <div class="chip-toggle-group" id="f-days"></div>
      <p style="font-size:11px;opacity:.55;margin-top:6px;">Default is daily — all days, 7× a week.</p>
    </div>
    <div class="field">
      <label>Timer type</label>
      <div class="radio-row">
        <label><input type="radio" name="f-timertype" value="stopwatch" ${(!existing || existing.timerType==='stopwatch') ? 'checked' : ''}> Stopwatch</label>
        <label><input type="radio" name="f-timertype" value="countdown" ${(existing && existing.timerType==='countdown') ? 'checked' : ''}> Countdown</label>
      </div>
    </div>
    <div class="field" id="f-duration-field" style="${(existing && existing.timerType==='countdown') ? '' : 'display:none;'}">
      <label>Countdown length (minutes)</label>
      <input type="number" id="f-duration" min="1" max="180" value="${existing ? Math.round((existing.timerDuration||1500)/60) : 15}">
    </div>
    ${!existing && sync.getLocalTeam() ? `
    <div class="switch-row">
      <div><div>Share with team</div><div style="font-size:11px;opacity:.6;">Everyone in your team will see this card, and stamping it marks it done for the whole team. Tags and schedule stay local for now.</div></div>
      <label class="switch"><input type="checkbox" id="f-team-share"><span class="switch__track"></span></label>
    </div>
    <div class="field" id="f-team-goal-field" style="display:none;margin-top:10px;">
      <label>Team goal (optional)</label>
      <select id="f-team-goal">
        <option value="">None</option>
        ${db.getTags().filter(t => t.teamGoalId).map(t => `<option value="${t.teamGoalId}">${t.name.replace(/</g,'&lt;')}</option>`).join('')}
      </select>
    </div>` : ''}
    <button class="btn btn--primary btn--full" id="f-save" style="margin-top:6px;">${existing ? 'Save changes' : 'Create task'}</button>
  `, {
    onMount: (sheet) => {
      sheet.querySelector('.sheet__close').onclick = closeSheet;
      const goalWrap = sheet.querySelector('#f-goals');
      const tagWrap = sheet.querySelector('#f-tags');
      function renderChips() {
        const goals = db.getGoals();
        const plainTags = db.getTags().filter(t => !t.isGoal);

        // Goals: single-select radio-style chips, plus an always-present
        // "No goal" option. Selecting one replaces the primary goal.
        goalWrap.innerHTML = '';
        const noneChip = document.createElement('button');
        noneChip.type = 'button';
        noneChip.className = 'chip-toggle chip-toggle--radio' + (primaryGoal === null ? ' is-on' : '');
        noneChip.textContent = 'No goal';
        noneChip.onclick = () => { primaryGoal = null; renderChips(); };
        goalWrap.appendChild(noneChip);
        goals.forEach(g => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'chip-toggle chip-toggle--radio' + (primaryGoal === g.id ? ' is-on' : '');
          chip.textContent = '\u2605 ' + g.name;
          chip.onclick = () => { primaryGoal = (primaryGoal === g.id ? null : g.id); renderChips(); };
          goalWrap.appendChild(chip);
        });

        // Tags: multi-select toggles.
        tagWrap.innerHTML = '';
        if (plainTags.length === 0) {
          const p = document.createElement('p');
          p.style.cssText = 'opacity:.6;font-size:12px;';
          p.textContent = 'No tags yet — add one below.';
          tagWrap.appendChild(p);
        } else {
          plainTags.forEach(t => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'chip-toggle' + (selectedTags.has(t.id) ? ' is-on' : '');
            chip.textContent = '#' + t.name;
            chip.onclick = () => {
              if (selectedTags.has(t.id)) selectedTags.delete(t.id); else selectedTags.add(t.id);
              renderChips();
            };
            tagWrap.appendChild(chip);
          });
        }
      }
      renderChips();

      // Frequency: preferred-day chips (default all days = daily)
      const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
      const selectedDays = new Set(existing && existing.preferredDays ? existing.preferredDays : [0, 1, 2, 3, 4, 5, 6]);
      const daysWrap = sheet.querySelector('#f-days');
      function renderDayChips() {
        daysWrap.innerHTML = '';
        dayLabels.forEach((lbl, idx) => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'chip-toggle' + (selectedDays.has(idx) ? ' is-on' : '');
          chip.textContent = lbl;
          chip.style.minWidth = '34px';
          chip.onclick = () => {
            if (selectedDays.has(idx)) selectedDays.delete(idx); else selectedDays.add(idx);
            renderDayChips();
          };
          daysWrap.appendChild(chip);
        });
      }
      renderDayChips();

      sheet.querySelector('#f-newtag-add').onclick = () => {
        const nameInput = sheet.querySelector('#f-newtag');
        const name = nameInput.value.trim();
        if (!name) return;
        const isGoal = sheet.querySelector('#f-newtag-type').value === 'goal';
        const tag = db.createTag({ name, isGoal });
        if (isGoal) primaryGoal = tag.id; else selectedTags.add(tag.id);
        nameInput.value = '';
        renderChips();
      };

      sheet.querySelectorAll('input[name="f-timertype"]').forEach(r => {
        r.onchange = () => {
          const isCountdown = sheet.querySelector('input[name="f-timertype"]:checked').value === 'countdown';
          sheet.querySelector('#f-duration-field').style.display = isCountdown ? '' : 'none';
        };
      });

      const shareToggle = sheet.querySelector('#f-team-share');
      const goalField = sheet.querySelector('#f-team-goal-field');
      if (shareToggle && goalField) {
        shareToggle.onchange = () => { goalField.style.display = shareToggle.checked ? '' : 'none'; };
      }

      sheet.querySelector('#f-save').onclick = async () => {
        const name = sheet.querySelector('#f-name').value.trim();
        if (!name) { toast('Give it a name first'); return; }
        const timerType = sheet.querySelector('input[name="f-timertype"]:checked').value;
        const minutes = parseInt(sheet.querySelector('#f-duration').value, 10) || 15;
        const shareEl = sheet.querySelector('#f-team-share');
        if (shareEl && shareEl.checked) {
          const goalEl = sheet.querySelector('#f-team-goal');
          const teamGoalId = (goalEl && goalEl.value) || null;
          try {
            await sync.createTeamActivity({ name, timerType, timerDuration: minutes * 60, teamGoalId });
          } catch (err) {
            toast(err.message || 'Could not share with team');
            return;
          }
          closeSheet();
          toast('Shared with team \u2014 appears on every device in a moment');
          return;
        }
        const payload = {
          name,
          tags: [...(primaryGoal ? [primaryGoal] : []), ...selectedTags],
          timerType,
          timerDuration: minutes * 60,
          timesPerWeek: Math.max(1, Math.min(7, parseInt(sheet.querySelector('#f-perweek').value, 10) || 7)),
          preferredDays: Array.from(selectedDays).sort((a, b) => a - b),
        };
        if (existing) db.updateActivity(existing.id, payload);
        else db.createActivity(payload);
        closeSheet();
        render();
        toast(existing ? 'Task updated' : 'Task created');
      };
    }
  });
}

function openTagForm({ isGoal = false, existing = null } = {}) {
  const editing = !!existing;
  const goal = editing ? existing.isGoal : isGoal;
  const kind = goal ? 'goal' : 'tag';
  openSheet(`
    <div class="sheet__head">
      <h2 class="sheet__title">${editing ? 'Edit ' + kind : (goal ? 'New goal' : 'New tag')}</h2>
      <button class="sheet__close" aria-label="Close">&times;</button>
    </div>
    <div class="field">
      <label>${goal ? 'Goal' : 'Tag'} name</label>
      <input type="text" id="tg-name" placeholder="${goal ? 'e.g. Run a 10K' : 'e.g. morning'}" value="${editing ? existing.name.replace(/"/g,'&quot;') : ''}">
    </div>
    <div class="field">
      <label>Type</label>
      <div class="radio-row">
        <label><input type="radio" name="tg-type" value="tag" ${goal ? '' : 'checked'}> Tag</label>
        <label><input type="radio" name="tg-type" value="goal" ${goal ? 'checked' : ''}> Goal</label>
      </div>
    </div>
    <button class="btn btn--primary btn--full" id="tg-save">${editing ? 'Save changes' : 'Save'}</button>
    ${editing ? '<button class="btn btn--text btn--full" id="tg-delete" style="color:#a8432d;margin-top:8px;">Delete</button>' : ''}
  `, {
    onMount: (sheet) => {
      sheet.querySelector('.sheet__close').onclick = closeSheet;
      sheet.querySelector('#tg-save').onclick = () => {
        const name = sheet.querySelector('#tg-name').value.trim();
        if (!name) return;
        const asGoal = sheet.querySelector('input[name="tg-type"]:checked').value === 'goal';
        if (editing) { db.updateTag(existing.id, { name, isGoal: asGoal }); }
        else { db.createTag({ name, isGoal: asGoal }); }
        closeSheet();
        render();
        toast(editing ? 'Saved' : (asGoal ? 'Goal' : 'Tag') + ' added');
      };
      if (editing) {
        sheet.querySelector('#tg-delete').onclick = () => {
          if (confirm(`Delete "${existing.name}"? It will be removed from all cards.`)) {
            db.deleteTag(existing.id);
            closeSheet();
            render();
            toast('Deleted');
          }
        };
      }
    }
  });
}

// ---------------------------------------------------------------- team sync panel (Settings)
// Renders either the create/join buttons or the joined-team info, and keeps
// membership live via sync.subscribeToTeam while the Settings sheet is open.
// closeSheet() (above) always tears the listener down, however the sheet closes.
// The name field is always shown (even before joining) so it's set before
// you create/join; the body below it swaps between join/joined states.
function mountTeamPanel(container) {
  container.innerHTML = `
    <div class="field" style="margin-bottom:14px;">
      <label>Your name</label>
      <input type="text" id="team-nickname" placeholder="Shown to teammates" maxlength="40" style="width:100%;background:var(--color-bg);border:1px solid var(--color-brass-dark);color:var(--color-cream);border-radius:7px;padding:10px 11px;font-family:var(--font-mono);font-size:13.5px;">
    </div>
    <div id="team-body"></div>
  `;
  const nicknameInput = container.querySelector('#team-nickname');
  nicknameInput.value = sync.getNickname();
  nicknameInput.addEventListener('blur', () => {
    const val = nicknameInput.value.trim();
    if (val !== sync.getNickname()) sync.setNickname(val);
  });
  const body = container.querySelector('#team-body');

  function renderJoinedState(info) {
    const sharedCount = db.getActivities().filter((a) => a.teamId === info.code).length;
    const myUid = sync.getUid();
    const memberRows = (info.members || []).map((m) => {
      const label = m.uid === myUid ? 'You' : (m.nickname || 'Teammate (no name set)');
      return `<div class="team-member">${label}</div>`;
    }).join('');
    const teamGoals = db.getTags().filter((t) => t.teamGoalId);
    const goalRows = teamGoals.map((g) => `<div class="team-goal-row">${g.name}</div>`).join('');
    body.innerHTML = `
      <div class="team-code">
        <div>
          <div class="team-code__label">Team code</div>
          <div class="team-code__value">${info.code}</div>
        </div>
        <button class="btn btn--sm btn--ghost" id="team-copy" style="border-color:#067647;color:#067647;">Copy</button>
      </div>
      <div class="team-status">${info.memberCount == null ? 'Syncing\u2026' : info.memberCount + (info.memberCount === 1 ? ' person synced' : ' people synced')} \u00b7 ${sharedCount} shared card${sharedCount === 1 ? '' : 's'}</div>
      <div class="team-member-list">${memberRows}</div>
      <div class="section-title" style="margin:16px 0 8px;">Team goals</div>
      <p style="font-size:11px;opacity:.6;margin:-4px 0 10px;line-height:1.5;">Groups shared cards, the same way personal goals group your own. Assign a card to one when sharing it.</p>
      <div class="field-row">
        <input type="text" id="team-goal-input" placeholder="e.g. Get Fit Together" style="flex:1;background:var(--color-bg);border:1px solid var(--color-brass-dark);color:var(--color-cream);border-radius:7px;padding:10px 11px;font-family:var(--font-mono);font-size:13.5px;">
        <button class="btn btn--ghost" id="team-goal-add" style="border-color:#067647;color:#067647;">Add</button>
      </div>
      <div class="team-goal-list">${goalRows || '<p style="opacity:.6;font-size:12px;margin-top:8px;">None yet.</p>'}</div>
      <button class="btn btn--text" id="team-leave" style="color:#a8432d;margin-top:14px;">Leave team</button>
    `;
    body.querySelector('#team-copy').onclick = async () => {
      try { await navigator.clipboard.writeText(info.code); toast('Code copied'); }
      catch (e) { toast('Could not copy \u2014 code is ' + info.code); }
    };
    body.querySelector('#team-goal-add').onclick = async () => {
      const goalInput = body.querySelector('#team-goal-input');
      const name = goalInput.value.trim();
      if (!name) return;
      try {
        await sync.createTeamGoal(name);
        toast('Team goal added');
        mountTeamPanel(container);
      } catch (err) {
        toast(err.message || 'Could not add team goal');
      }
    };
    body.querySelector('#team-leave').onclick = async () => {
      if (!confirm('Leave this team? You can rejoin later with the code.')) return;
      await sync.leaveTeam();
      mountTeamPanel(container);
      watchTeamActivities();
      watchTeamGoals();
    };
  }

  function renderJoinState() {
    body.innerHTML = `
      <div class="field-row">
        <button class="btn btn--stamp" id="team-create" style="flex:1;">Create a team</button>
        <button class="btn btn--ghost" id="team-join-btn" style="flex:1;">Join with code</button>
      </div>
      <div class="field-row" id="team-join-row" hidden style="margin-top:10px;">
        <input type="text" id="team-code-input" placeholder="e.g. 7K2P9Q" style="flex:1;background:var(--color-bg);border:1px solid var(--color-brass-dark);color:var(--color-cream);border-radius:7px;padding:10px 11px;font-family:var(--font-mono);font-size:13.5px;text-transform:uppercase;">
        <button class="btn btn--primary" id="team-join-go">Join</button>
      </div>
      <div class="team-status" id="team-status"></div>
    `;
    const statusEl = body.querySelector('#team-status');
    body.querySelector('#team-create').onclick = async (e) => {
      e.target.disabled = true;
      statusEl.style.color = '';
      statusEl.textContent = 'Creating team\u2026';
      try {
        await sync.createTeam();
        toast('Team created');
        mountTeamPanel(container);
        watchTeamActivities();
        watchTeamGoals();
      } catch (err) {
        statusEl.style.color = '#a8432d';
        statusEl.textContent = err.message || 'Could not create a team.';
        e.target.disabled = false;
      }
    };
    const joinRow = body.querySelector('#team-join-row');
    body.querySelector('#team-join-btn').onclick = () => {
      joinRow.hidden = !joinRow.hidden;
      if (!joinRow.hidden) body.querySelector('#team-code-input').focus();
    };
    body.querySelector('#team-join-go').onclick = async () => {
      const code = body.querySelector('#team-code-input').value;
      statusEl.style.color = '';
      statusEl.textContent = 'Joining\u2026';
      try {
        await sync.joinTeam(code);
        toast('Joined team');
        mountTeamPanel(container);
        watchTeamActivities();
        watchTeamGoals();
      } catch (err) {
        statusEl.style.color = '#a8432d';
        statusEl.textContent = err.message || 'Could not join that team.';
      }
    };
  }

  function startLiveUpdates() {
    if (teamUnsub) { teamUnsub(); teamUnsub = null; }
    teamUnsub = sync.subscribeToTeam((info) => {
      if (info) renderJoinedState(info);
      else renderJoinState();
    });
  }

  if (sync.getLocalTeam()) startLiveUpdates();
  else renderJoinState();
}

// ---------------------------------------------------------------- reminder settings panel
// Wires the Reminders block inside the Settings sheet. Every control writes
// straight through to db.updateReminders so preferences persist immediately.
function mountReminderPanel(sheet) {
  const body = sheet.querySelector('#rm-body');
  const enabled = sheet.querySelector('#rm-enabled');
  enabled.onchange = () => {
    db.updateReminders({ enabled: enabled.checked });
    body.hidden = !enabled.checked;
  };

  sheet.querySelector('#rm-time').onchange = (e) => {
    db.updateReminders({ time: e.target.value || '19:00' });
  };
  sheet.querySelector('#rm-unfinished').onchange = (e) => {
    db.updateReminders({ onlyIfUnfinished: e.target.checked });
  };
  sheet.querySelector('#rm-quiet-start').onchange = (e) => {
    db.updateReminders({ quietStart: e.target.value || '' });
  };
  sheet.querySelector('#rm-quiet-end').onchange = (e) => {
    db.updateReminders({ quietEnd: e.target.value || '' });
  };

  // Day chips — at least one day must stay selected.
  const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const daysWrap = sheet.querySelector('#rm-days');
  const chosen = new Set(db.getReminders().days || [0, 1, 2, 3, 4, 5, 6]);
  function renderDays() {
    daysWrap.innerHTML = '';
    dayLabels.forEach((lbl, idx) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip-toggle' + (chosen.has(idx) ? ' is-on' : '');
      chip.textContent = lbl;
      chip.style.minWidth = '34px';
      chip.onclick = () => {
        if (chosen.has(idx)) {
          if (chosen.size === 1) { toast('Pick at least one day'); return; }
          chosen.delete(idx);
        } else chosen.add(idx);
        db.updateReminders({ days: Array.from(chosen).sort((a, b) => a - b) });
        renderDays();
      };
      daysWrap.appendChild(chip);
    });
  }
  renderDays();

  // Notification permission + push status.
  const permEl = sheet.querySelector('#rm-perm');
  const pushEl = sheet.querySelector('#rm-push');
  const allowBtn = sheet.querySelector('#rm-allow');
  const testBtn = sheet.querySelector('#rm-test');

  function refreshPermission() {
    const status = notify.permissionStatus();
    const labels = {
      granted: 'Notifications allowed on this device.',
      denied: 'Notifications blocked — re-enable them in your browser or app settings.',
      default: 'Notifications not enabled yet.',
      unsupported: 'This browser doesn’t support notifications.',
    };
    permEl.textContent = labels[status] || labels.default;
    allowBtn.style.display = (status === 'default') ? '' : 'none';
    testBtn.style.display = (status === 'granted') ? '' : 'none';
    pushEl.textContent = notify.pushStatusMessage();
  }
  refreshPermission();

  // Permission is only ever requested from this click, never on load.
  allowBtn.onclick = async () => {
    allowBtn.disabled = true;
    const status = await notify.requestPermission();
    refreshPermission();
    allowBtn.disabled = false;
    if (status === 'granted') {
      toast('Notifications enabled');
      if (notify.isPushConfigured()) {
        const result = await notify.initMessaging();
        pushEl.textContent = result.ok
          ? 'Push token registered on this device. Sending scheduled reminders still needs a backend.'
          : notify.pushStatusMessage();
      }
    } else if (status === 'denied') {
      toast('Notifications blocked');
    }
  };

  testBtn.onclick = async () => {
    const pending = unfinishedTodayCount();
    const shown = await notify.showLocalNotification(
      'Chronodo',
      pending > 0
        ? `${pending} task${pending === 1 ? '' : 's'} still unstamped today.`
        : 'This is a test reminder — everything is stamped today.'
    );
    toast(shown ? 'Test notification sent' : 'Could not show a notification here');
  };
}

// ---------------------------------------------------------------- settings
function openSettings() {
  const s = db.getSettings();
  openSheet(`
    <div class="sheet__head">
      <h2 class="sheet__title">Settings</h2>
      <button class="sheet__close" aria-label="Close">&times;</button>
    </div>
    <div class="switch-row">
      <div><div>Auto-start timer</div><div style="font-size:11px;opacity:.6;">Begin timing the moment you open a card</div></div>
      <label class="switch"><input type="checkbox" id="s-autostart" ${s.autoStartTimer ? 'checked' : ''}><span class="switch__track"></span></label>
    </div>
    <div class="field" style="margin-top:16px;">
      <label>Default recommendation focus</label>
      <div class="radio-row">
        <label><input type="radio" name="s-reco" value="balanced" ${s.recommendationPref==='balanced'?'checked':''}> Balanced</label>
        <label><input type="radio" name="s-reco" value="gaps" ${s.recommendationPref==='gaps'?'checked':''}> Close gaps</label>
        <label><input type="radio" name="s-reco" value="untouched" ${s.recommendationPref==='untouched'?'checked':''}> Revive dormant</label>
      </div>
    </div>
    <div class="field" style="margin-top:20px;">
      <label>Team sync (beta)</label>
      <p style="font-size:11px;opacity:.6;margin:2px 0 10px;line-height:1.6;">Share select tasks and goals with a small team. Stamps sync in real time.</p>
      <div id="team-panel"></div>
    </div>
    <div class="field" style="margin-top:20px;">
      <label>Reminders</label>
      <p style="font-size:11px;opacity:.6;margin:2px 0 10px;line-height:1.6;">A nudge to come back and stamp your day. Runs on this device from your own data — shown when you open Chronodo.</p>
      <div class="switch-row">
        <div><div>Daily reminder</div><div style="font-size:11px;opacity:.6;">Off by default</div></div>
        <label class="switch"><input type="checkbox" id="rm-enabled" ${s.reminders.enabled ? 'checked' : ''}><span class="switch__track"></span></label>
      </div>
      <div id="rm-body" ${s.reminders.enabled ? '' : 'hidden'}>
        <div class="field" style="margin-top:12px;">
          <label>Remind me at</label>
          <input type="time" id="rm-time" value="${s.reminders.time || '19:00'}">
        </div>
        <div class="field">
          <label>Days</label>
          <div class="chip-toggle-group" id="rm-days"></div>
        </div>
        <div class="switch-row">
          <div><div>Only if tasks are unfinished</div><div style="font-size:11px;opacity:.6;">Stay quiet on days you finish everything</div></div>
          <label class="switch"><input type="checkbox" id="rm-unfinished" ${s.reminders.onlyIfUnfinished ? 'checked' : ''}><span class="switch__track"></span></label>
        </div>
        <div class="field" style="margin-top:12px;">
          <label>Quiet hours (optional)</label>
          <div class="field-row">
            <input type="time" id="rm-quiet-start" value="${s.reminders.quietStart || ''}">
            <input type="time" id="rm-quiet-end" value="${s.reminders.quietEnd || ''}">
          </div>
          <p style="font-size:11px;opacity:.55;margin-top:6px;">No reminder between these times. Leave both blank to switch off.</p>
        </div>
        <div class="field" style="margin-top:12px;">
          <label>Notifications</label>
          <div id="rm-perm" class="team-status"></div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;">
            <button class="btn btn--ghost" id="rm-allow" style="border-color:#067647;color:#067647;">Enable notifications</button>
            <button class="btn btn--text" id="rm-test">Send test reminder</button>
          </div>
          <div id="rm-push" style="font-size:11px;opacity:.6;margin-top:10px;line-height:1.6;"></div>
        </div>
      </div>
    </div>
    <div class="field" style="margin-top:20px;">
      <label>Import tasks from CSV</label>
      <p style="font-size:11px;opacity:.6;margin:2px 0 10px;line-height:1.6;">Columns: <b>name</b> (required), optional <b>tags</b> (semicolon-separated), <b>note</b>, <b>timerType</b> (stopwatch/countdown), <b>timerMinutes</b>. First row may be a header.</p>
      <input type="file" id="s-csv" accept=".csv,text/csv" hidden>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        <button class="btn btn--ghost" id="s-csv-btn">Choose CSV file</button>
        <button class="btn btn--text" id="s-sample-btn">View sample</button>
      </div>
      <div id="s-csv-status" style="font-size:12px;margin-top:10px;"></div>
    </div>
    <div class="field" style="margin-top:20px;">
      <label>Export daily notes</label>
      <p style="font-size:11px;opacity:.6;margin:2px 0 10px;line-height:1.6;">Download a text file of your session notes between two dates.</p>
      <div class="cal-export__row">
        <label>From <input type="date" id="exp-from"></label>
        <label>To <input type="date" id="exp-to"></label>
      </div>
      <label class="cal-export__task">Task
        <select id="exp-task">
          <option value="">All tasks</option>
          ${db.getActivities().map(a => `<option value="${a.id}">${a.name.replace(/</g,'&lt;')}</option>`).join('')}
        </select>
      </label>
      <button class="btn btn--stamp" id="exp-go" style="margin-top:12px;">Export as text</button>
    </div>
    <div class="field" style="margin-top:20px;">
      <label>Local backup</label>
      <p style="font-size:11px;opacity:.6;margin:2px 0 10px;line-height:1.6;">A full backup — every card, goal, tag, log and note — as a JSON file. Works offline, no account needed.</p>
      <input type="file" id="s-restore" accept=".json,application/json" hidden>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button class="btn btn--stamp" id="s-backup-download">Download backup</button>
        <button class="btn btn--ghost" id="s-restore-btn">Restore from file</button>
      </div>
      <div id="s-restore-status" style="font-size:12px;margin-top:10px;"></div>
    </div>
    <div class="field" style="margin-top:20px;">
      <label>Reset data</label>
      <p style="font-size:11px;opacity:.6;margin:2px 0 10px;line-height:1.6;">Delete every card, goal and tag on this device — then import your own CSV to start fresh. Back up first.</p>
      <button class="btn btn--text" id="s-reset" style="color:#a8432d;">Delete all cards, goals &amp; tags…</button>
    </div>
    <p style="font-size:11px;opacity:.55;margin-top:20px;line-height:1.6;">Chronodo stores everything locally on this device by default. Backups above are optional and never run automatically.</p>
  `, {
    onMount: (sheet) => {
      sheet.querySelector('.sheet__close').onclick = closeSheet;
      sheet.querySelector('#s-autostart').onchange = (e) => db.updateSettings({ autoStartTimer: e.target.checked });
      sheet.querySelectorAll('input[name="s-reco"]').forEach(r => {
        r.onchange = () => { db.updateSettings({ recommendationPref: r.value }); viewState.recoMode = r.value; };
      });
      mountReminderPanel(sheet);
      mountTeamPanel(sheet.querySelector('#team-panel'));
      const csvInput = sheet.querySelector('#s-csv');
      const csvStatus = sheet.querySelector('#s-csv-status');
      sheet.querySelector('#s-csv-btn').onclick = () => csvInput.click();
      sheet.querySelector('#s-sample-btn').onclick = () => showTextExport('sample-tasks.csv', SAMPLE_CSV);
      csvInput.onchange = () => {
        const file = csvInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const { added, skipped } = importTasksCsv(reader.result);
            csvStatus.style.color = '#067647';
            csvStatus.textContent = `Imported ${added} task${added===1?'':'s'}${skipped ? `, skipped ${skipped}` : ''}.`;
            render();
            toast(`Imported ${added} task${added===1?'':'s'}`);
          } catch (err) {
            csvStatus.style.color = '#a8432d';
            csvStatus.textContent = 'Could not read that file. Check the format.';
          }
          csvInput.value = '';
        };
        reader.readAsText(file);
      };
      const now = new Date();
      sheet.querySelector('#exp-from').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
      sheet.querySelector('#exp-to').value = db.todayStr();
      sheet.querySelector('#exp-go').onclick = () => {
        exportNotes(sheet.querySelector('#exp-from').value, sheet.querySelector('#exp-to').value, sheet.querySelector('#exp-task').value);
      };
      sheet.querySelector('#s-backup-download').onclick = () => {
        const json = JSON.stringify(db.exportAll(), null, 2);
        showTextExport(`chronodo-backup_${db.todayStr()}.json`, json);
      };
      const restoreInput = sheet.querySelector('#s-restore');
      const restoreStatus = sheet.querySelector('#s-restore-status');
      sheet.querySelector('#s-restore-btn').onclick = () => restoreInput.click();
      restoreInput.onchange = () => {
        const file = restoreInput.files[0];
        if (!file) return;
        if (!confirm('Restore from this backup? It will replace all cards, tags and settings currently on this device.')) {
          restoreInput.value = '';
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          try {
            db.importAll(JSON.parse(reader.result));
            restoreStatus.style.color = '#067647';
            restoreStatus.textContent = 'Backup restored.';
            render();
            toast('Backup restored');
          } catch (err) {
            restoreStatus.style.color = '#a8432d';
            restoreStatus.textContent = 'Could not restore — invalid backup file.';
          }
          restoreInput.value = '';
        };
        reader.readAsText(file);
      };

      sheet.querySelector('#s-reset').onclick = () => showResetWarning();
    }
  });
}

// ---------------------------------------------------------------- CSV import
// Minimal RFC-4180-ish parser: handles quoted fields, escaped quotes, commas
// and newlines inside quotes.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  text = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

function importTasksCsv(text) {
  let rows = parseCsv(text);
  if (!rows.length) return { added: 0, skipped: 0 };

  const known = ['name', 'tags', 'note', 'timertype', 'timerminutes'];
  const header = rows[0].map(h => h.trim().toLowerCase());
  const hasHeader = header.some(h => known.includes(h));
  let cols = { name: 0, tags: 1, note: 2, timertype: 3, timerminutes: 4 };
  if (hasHeader) {
    cols = {};
    header.forEach((h, i) => { cols[h] = i; });
    rows = rows.slice(1);
  }
  const cell = (r, key) => (cols[key] != null && r[cols[key]] != null ? r[cols[key]].trim() : '');

  // tag lookup by lowercased name so we reuse existing tags
  const tagByName = {};
  db.getTags().forEach(t => { tagByName[t.name.toLowerCase()] = t; });

  let added = 0, skipped = 0;
  rows.forEach(r => {
    const name = cell(r, 'name');
    if (!name) { skipped++; return; }
    const tagIds = cell(r, 'tags').split(';').map(s => s.trim()).filter(Boolean).map(tn => {
      const key = tn.toLowerCase();
      if (!tagByName[key]) tagByName[key] = db.createTag({ name: tn });
      return tagByName[key].id;
    });
    const type = cell(r, 'timertype').toLowerCase() === 'countdown' ? 'countdown' : 'stopwatch';
    const mins = parseInt(cell(r, 'timerminutes'), 10);
    const activity = db.createActivity({
      name, tags: tagIds, timerType: type,
      timerDuration: (type === 'countdown' && mins > 0) ? mins * 60 : 1500,
    });
    const note = cell(r, 'note');
    if (note) { db.updateActivity(activity.id, { note }); }
    added++;
  });
  return { added, skipped };
}

// ---------------------------------------------------------------- timer overlay
function openTimer(activity, { onDone } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'timer-overlay';
  overlay.id = 'timer-overlay';
  overlay.innerHTML = `
    <div class="timer-overlay__activity">${activity.name}</div>
    <div class="timer-face" id="timer-display">00:00</div>
    <div class="timer-actions">
      <button class="btn btn--ghost" id="timer-cancel" style="border-color:#ffffff;color:#ffffff;">Cancel</button>
      <button class="btn btn--stamp" id="timer-stop">Stop &amp; log</button>
    </div>
  `;
  document.body.appendChild(overlay);
  const display = overlay.querySelector('#timer-display');

  timer.start(activity, {
    onTick: ({ display: text }) => { display.textContent = text; },
    onComplete: ({ seconds, completed }) => {
      const mins = Math.round(seconds / 60);
      const actions = overlay.querySelector('.timer-actions');
      const face = overlay.querySelector('#timer-display');
      face.classList.add('is-logged');
      overlay.querySelector('.timer-overlay__activity').textContent =
        completed ? `${activity.name} \u2014 complete` : `${activity.name} \u2014 ${mins} min logged`;
      actions.outerHTML = `
        <div class="timer-note">
          <label class="timer-note__label" for="timer-note-input">Add a note for this session</label>
          <textarea class="timer-note__input" id="timer-note-input" rows="3" placeholder="How it went, what you covered\u2026"></textarea>
          <div class="timer-note__actions">
            <button class="btn btn--ghost" id="timer-skip" style="border-color:rgba(0,0,0,0.2);color:var(--color-ink);">Skip</button>
            <button class="btn btn--stamp" id="timer-note-save">Save note</button>
          </div>
        </div>
      `;
      const noteInput = overlay.querySelector('#timer-note-input');
      noteInput.focus();
      const done = () => {
        overlay.remove();
        render();
        toast(completed ? 'Countdown complete \u2014 logged & stamped' : `Logged ${mins} min \u2014 stamped`);
        onDone && onDone();
      };
      const syncIfTeam = async () => {
        if (!activity.teamId) return;
        const date = db.todayStr();
        const log = activity.logs[date] || { seconds, note: '' };
        try {
          await sync.markTeamActivityDone(activity.teamId, activity.teamActivityId, date, {
            seconds: log.seconds || seconds, note: log.note || '',
          });
          setLocalLog(activity, date, { done: true, source: 'timer', seconds: log.seconds || seconds, note: log.note || '', by: sync.getUid() });
        } catch (err) {
          toast(err.message || 'Could not sync \u2014 try again');
        }
      };
      overlay.querySelector('#timer-note-save').onclick = async () => {
        const val = noteInput.value.trim();
        if (val) db.setLogNote(activity.id, db.todayStr(), val);
        await syncIfTeam();
        done();
      };
      overlay.querySelector('#timer-skip').onclick = async () => {
        await syncIfTeam();
        done();
      };
    },
  });

  overlay.querySelector('#timer-stop').onclick = () => timer.stop();
  overlay.querySelector('#timer-cancel').onclick = () => {
    timer.stop({ save: false });
    overlay.remove();
  };
}

// Build a CSV of the current tasks (re-importable) — used as a backup before reset.
function currentTasksCsv() {
  const esc = (v) => {
    v = String(v == null ? '' : v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  const rows = ['name,tags,note,timerType,timerMinutes'];
  db.getActivities().forEach(a => {
    const tags = activityTagObjs(a).map(t => t.name).join(';');
    const mins = a.timerType === 'countdown' ? Math.round((a.timerDuration || 0) / 60) : '';
    rows.push([esc(a.name), esc(tags), esc(a.note || ''), esc(a.timerType || 'stopwatch'), esc(mins)].join(','));
  });
  return rows.join('\n') + '\n';
}

// Destructive reset with a backup-first warning.
function showResetWarning() {
  const overlay = document.createElement('div');
  overlay.className = 'sheet-backdrop';
  overlay.id = 'reset-overlay';
  overlay.innerHTML = `
    <div class="sheet">
      <div class="sheet__head">
        <h2 class="sheet__title">Delete everything?</h2>
        <button class="sheet__close" aria-label="Close">&times;</button>
      </div>
      <p style="font-size:13.5px;line-height:1.7;color:var(--color-ink-soft);margin:0 0 12px;">This removes <b>all cards, goals and tags</b> and their logs from this device. It can\u2019t be undone.</p>
      <p style="font-size:13.5px;line-height:1.7;color:var(--color-ink-soft);margin:0 0 16px;">Back up first \u2014 download a CSV of your current tasks so you can re-import them later.</p>
      <div class="card__actions">
        <button class="btn btn--primary" id="reset-backup">Back up to CSV</button>
        <button class="btn btn--text" id="reset-confirm" style="color:#a8432d;">Delete everything</button>
        <button class="btn btn--ghost" id="reset-cancel">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('.sheet__close').onclick = close;
  overlay.querySelector('#reset-cancel').onclick = close;
  overlay.querySelector('#reset-backup').onclick = () => showTextExport('chronodo-backup.csv', currentTasksCsv());
  overlay.querySelector('#reset-confirm').onclick = () => {
    db.clearAll();
    close();
    closeSheet();
    render();
    toast('All cards, goals & tags deleted');
  };
}

// First-run welcome: greets the user and offers to replace the sample cards
// with their own CSV before they start.
function showWelcome() {
  const overlay = document.createElement('div');
  overlay.className = 'sheet-backdrop';
  overlay.id = 'welcome-overlay';
  overlay.innerHTML = `
    <div class="sheet">
      <div class="sheet__head">
        <h2 class="sheet__title">Welcome to Chronodo</h2>
        <button class="sheet__close" aria-label="Close">&times;</button>
      </div>
      <p style="font-size:13.5px;line-height:1.7;color:var(--color-ink-soft);margin:0 0 10px;">Chronodo is your dial-driven habit tracker. Spin the dial on the home screen to pick an activity, open it to log time or run a timer, and stamp your day. Everything stays on this device \u2014 no account, no server.</p>
      <p style="font-size:13.5px;line-height:1.7;color:var(--color-ink-soft);margin:0 0 16px;">We\u2019ve added a few sample cards to get you started. Prefer your own list? Import a CSV now to <b>replace</b> the samples.</p>
      <input type="file" id="welcome-csv" accept=".csv,text/csv" hidden>
      <div class="card__actions">
        <button class="btn btn--primary" id="welcome-import">Import my CSV</button>
        <button class="btn btn--ghost" id="welcome-sample">View sample</button>
        <button class="btn btn--text" id="welcome-skip">Keep samples</button>
      </div>
      <div id="welcome-status" style="font-size:12px;margin-top:10px;"></div>
    </div>`;
  document.body.appendChild(overlay);
  const finish = () => { localStorage.setItem('chronodo-welcomed', '1'); overlay.remove(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(); });
  overlay.querySelector('.sheet__close').onclick = finish;
  overlay.querySelector('#welcome-skip').onclick = finish;
  overlay.querySelector('#welcome-sample').onclick = () => showTextExport('sample-tasks.csv', SAMPLE_CSV);
  const csv = overlay.querySelector('#welcome-csv');
  overlay.querySelector('#welcome-import').onclick = () => csv.click();
  csv.onchange = () => {
    const file = csv.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        db.clearAll();
        const { added, skipped } = importTasksCsv(reader.result);
        render();
        toast(`Imported ${added} task${added === 1 ? '' : 's'}${skipped ? `, skipped ${skipped}` : ''}`);
        finish();
      } catch (err) {
        const st = overlay.querySelector('#welcome-status');
        st.style.color = '#a8432d';
        st.textContent = 'Could not read that file. Check the format.';
      }
      csv.value = '';
    };
    reader.readAsText(file);
  };
}

// ---------------------------------------------------------------- reminders
// In-app reminders run entirely off local data: when Chronodo opens or comes
// back to the foreground we check the saved preferences and, at most once per
// day, show a banner. Nothing here can fire while the app is closed — that
// needs web push plus a backend scheduler (see README).
const REMINDER_LAST_KEY = 'chronodo-reminder-last-v1';

function reminderShownToday() {
  try { return localStorage.getItem(REMINDER_LAST_KEY) === db.todayStr(); }
  catch (e) { return false; }
}
function markReminderShown() {
  try { localStorage.setItem(REMINDER_LAST_KEY, db.todayStr()); } catch (e) { /* private mode */ }
}

function hhmmToMinutes(value) {
  const [h, m] = String(value || '').split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

// Quiet hours suppress the reminder. A range that ends before it starts
// (e.g. 22:00 → 07:00) wraps past midnight.
function inQuietHours(reminders, now) {
  const start = hhmmToMinutes(reminders.quietStart);
  const end = hhmmToMinutes(reminders.quietEnd);
  if (start === null || end === null || start === end) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  return start < end ? (mins >= start && mins < end) : (mins >= start || mins < end);
}

// Tasks still runnable today — the same "not stamped today" rule the dial uses.
// A goal counts as unfinished when it still has unfinished child tasks, which
// is implied by counting those tasks directly.
function unfinishedTodayCount() {
  const today = db.todayStr();
  return db.getActivities().filter(a => !db.isDoneOn(a, today)).length;
}

function maybeShowReminder() {
  const r = db.getReminders();
  if (!r || !r.enabled) return;
  if (timer.isRunning()) return;                       // never interrupt a session
  if (document.getElementById('reminder-banner')) return;
  if (reminderShownToday()) return;
  const now = new Date();
  if (!Array.isArray(r.days) || !r.days.includes(now.getDay())) return;
  const due = hhmmToMinutes(r.time);
  if (due === null || now.getHours() * 60 + now.getMinutes() < due) return;
  if (inQuietHours(r, now)) return;
  const pending = unfinishedTodayCount();
  if (r.onlyIfUnfinished && pending === 0) return;
  markReminderShown();
  showReminderBanner(pending);
}

function showReminderBanner(pending) {
  const existing = document.getElementById('reminder-banner');
  if (existing) existing.remove();
  const banner = document.createElement('div');
  banner.className = 'reminder-banner';
  banner.id = 'reminder-banner';
  banner.setAttribute('role', 'status');
  const msg = pending > 0
    ? `${pending} task${pending === 1 ? '' : 's'} still unstamped today.`
    : 'Time for your daily check-in.';
  banner.innerHTML = `
    <div class="reminder-banner__body">
      <div class="reminder-banner__title">Chronodo reminder</div>
      <div class="reminder-banner__msg"></div>
    </div>
    <div class="reminder-banner__actions">
      <button class="btn btn--stamp btn--sm" id="reminder-open">Open Chronodo</button>
      <button class="btn btn--text btn--sm" id="reminder-dismiss">Dismiss</button>
    </div>`;
  banner.querySelector('.reminder-banner__msg').textContent = msg;
  document.body.appendChild(banner);
  banner.querySelector('#reminder-dismiss').onclick = () => banner.remove();
  banner.querySelector('#reminder-open').onclick = () => {
    banner.remove();
    viewState.view = 'rolodex';
    viewState.rolodexIndex = 0;
    tabs.forEach(t => {
      const on = t.dataset.view === 'rolodex';
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.getElementById('brand-view').textContent = viewLabels.rolodex;
    render();
  };
}

// A push that lands while Chronodo is open is shown as the same in-app banner
// rather than an OS notification, which browsers suppress in the foreground.
notify.onForegroundMessage(() => {
  if (document.getElementById('reminder-banner')) return;
  showReminderBanner(unfinishedTodayCount());
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') maybeShowReminder();
});

render();
watchTeamActivities();
watchTeamGoals();
if (!localStorage.getItem('chronodo-welcomed')) showWelcome();
maybeShowReminder();
// If push was already set up on a previous visit, re-register quietly so the
// token stays fresh. No-ops (and never throws) until a VAPID key is configured.
if (notify.permissionStatus() === 'granted' && notify.isPushConfigured()) {
  notify.initMessaging();
}
