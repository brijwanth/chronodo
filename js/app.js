import * as db from './storage.js';
import * as stats from './stats.js';
import * as timer from './timer.js';

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
const viewLabels = { rolodex: 'Chronodo', list: 'List', calendar: 'Calendar', tags: 'Tags', recommend: 'Suggested' };

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
function renderRolodex() {
  renderFilterBar(mainEl);
  const pool = filteredActivities();
  // On the dial, drop anything already accomplished today — it comes back tomorrow.
  const acts = pool.filter(a => !db.isDoneOn(a, db.todayStr()));
  if (pool.length === 0) {
    emptyState('No cards yet', 'Tap the + button to file your first activity in the drawer.');
    return;
  }
  if (acts.length === 0) {
    emptyState('All done for today', 'Every card here is stamped — they\u2019ll be back on the dial tomorrow.');
    return;
  }
  if (viewState.rolodexIndex >= acts.length) viewState.rolodexIndex = 0;

  const n = acts.length;
  const i = viewState.rolodexIndex;
  const at = k => ((k % n) + n) % n;

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

  const labels = acts.map((a, idx) => {
    const el = document.createElement('button');
    el.className = 'watch-label';
    el.type = 'button';
    el.innerHTML = '<span class="watch-label__txt"></span><span class="watch-label__tick"></span>';
    el.querySelector('.watch-label__txt').textContent = a.name;
    el.onclick = () => { if (idx === i) { openDetail(acts[idx].id); return; } viewState.rolodexIndex = idx; render(); };
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
  const openBtn = stage.querySelector('.watch-open');
  openBtn.innerHTML = `<span class="watch-open__name"></span><span class="watch-open__hint">Tap to open</span>`;
  openBtn.querySelector('.watch-open__name').textContent = acts[i].name;
  openBtn.onclick = () => openDetail(acts[i].id);

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
  nav.querySelector('#rolo-prev').onclick = () => stepRolodex(-1, acts);
  nav.querySelector('#rolo-next').onclick = () => stepRolodex(1, acts);
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
  node.querySelector('.card__stats').textContent =
    `${pct}% consistent this month \u00b7 ${since === null ? 'never logged' : since === 0 ? 'logged today' : `${since}d since last`}`;

  const doneToday = db.isDoneOn(activity, db.todayStr());
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

function toggleDone(activity) {
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
    return;
  }
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

// ---------------------------------------------------------------- tags & goals view
function renderTags() {
  const goals = db.getGoals();
  const plainTags = db.getTags().filter(t => !t.isGoal);

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

  const section = (title, list) => {
    const h = document.createElement('div');
    h.className = 'section-title';
    h.textContent = title;
    mainEl.appendChild(h);
    const wrap = document.createElement('div');
    wrap.className = 'taglist';
    if (list.length === 0) {
      const p = document.createElement('p');
      p.style.cssText = 'opacity:.6;font-size:12px;';
      p.textContent = 'None yet.';
      wrap.appendChild(p);
    }
    list.forEach(tag => {
      const count = db.getActivities().filter(a => a.tags.includes(tag.id)).length;
      const card = document.createElement('div');
      card.className = 'tag-card' + (tag.isGoal ? ' is-goal' : '');
      card.innerHTML = `<div class="tag-card__body"><div class="tag-card__name">${tag.isGoal ? '\u2605 ' : '#'}${tag.name}</div><div class="tag-card__count">${count} activit${count === 1 ? 'y' : 'ies'}</div></div><button class="tag-card__edit" aria-label="Edit">Edit</button>`;
      card.querySelector('.tag-card__body').onclick = () => {
        viewState.activeTagFilter = tag.id;
        viewState.view = 'list';
        tabs.forEach(t => { t.classList.toggle('is-active', t.dataset.view === 'list'); t.setAttribute('aria-selected', t.dataset.view === 'list' ? 'true' : 'false'); });
        render();
      };
      card.querySelector('.tag-card__edit').onclick = (e) => { e.stopPropagation(); openTagForm({ existing: tag }); };
      wrap.appendChild(card);
    });
    mainEl.appendChild(wrap);
  };
  section('Goals', goals);
  section('Tags', plainTags);
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
      <button class="btn btn--ghost" id="detail-edit">Edit</button>
      <button class="btn btn--text" id="detail-delete" style="color:#a8432d;">Delete card</button>
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
          el.onclick = () => {
            if (db.isDoneOn(activity, dateStr)) db.unmarkDone(activity.id, dateStr);
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
      sheet.querySelector('#log-save').onclick = () => {
        const mins = Math.max(1, parseInt(sheet.querySelector('#log-mins').value, 10) || 0);
        db.markDone(activity.id, { source: 'manual', seconds: mins * 60, note: logNote.value.trim() });
        logPanel.hidden = true;
        refreshDetail();
        render();
        toast(`Logged ${mins} min \u2014 stamped`);
      };
      sheet.querySelector('#opt-timer').onclick = () => { closeSheet(); openTimer(activity); };
      sheet.querySelector('#opt-cancel').onclick = closeSheet;
      sheet.querySelector('#detail-edit').onclick = () => openActivityForm(activity);
      sheet.querySelector('#detail-delete').onclick = () => {
        if (confirm(`Delete "${activity.name}"? This can't be undone.`)) {
          db.deleteActivity(activity.id);
          closeSheet();
          render();
          toast('Card removed');
        }
      };
    }
  });
}

// ---------------------------------------------------------------- add/edit activity form
function openActivityForm(existing = null) {
  const allTags = db.getTags();
  const selected = new Set(existing ? existing.tags : []);
  openSheet(`
    <div class="sheet__head">
      <h2 class="sheet__title">${existing ? 'Edit card' : 'New card'}</h2>
      <button class="sheet__close" aria-label="Close">&times;</button>
    </div>
    <div class="field">
      <label>Activity name</label>
      <input type="text" id="f-name" placeholder="e.g. Read 20 pages" value="${existing ? existing.name.replace(/"/g,'&quot;') : ''}">
    </div>
    <div class="field">
      <label>Tags &amp; goals</label>
      <div class="chip-toggle-group" id="f-tags"></div>
    </div>
    <div class="field">
      <label>New tag or goal (optional)</label>
      <div class="field-row">
        <input type="text" id="f-newtag" placeholder="Tag name">
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
    <button class="btn btn--primary btn--full" id="f-save" style="margin-top:6px;">${existing ? 'Save changes' : 'File this card'}</button>
  `, {
    onMount: (sheet) => {
      sheet.querySelector('.sheet__close').onclick = closeSheet;
      const tagWrap = sheet.querySelector('#f-tags');
      function renderTagChips() {
        tagWrap.innerHTML = '';
        db.getTags().forEach(tag => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'chip-toggle' + (selected.has(tag.id) ? ' is-on' : '');
          chip.textContent = (tag.isGoal ? '\u2605 ' : '#') + tag.name;
          chip.onclick = () => {
            if (selected.has(tag.id)) selected.delete(tag.id); else selected.add(tag.id);
            renderTagChips();
          };
          tagWrap.appendChild(chip);
        });
        if (allTags.length === 0 && db.getTags().length === 0) {
          const p = document.createElement('p');
          p.style.cssText = 'opacity:.6;font-size:12px;';
          p.textContent = 'No tags yet — add one below.';
          tagWrap.appendChild(p);
        }
      }
      renderTagChips();

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
        selected.add(tag.id);
        nameInput.value = '';
        renderTagChips();
      };

      sheet.querySelectorAll('input[name="f-timertype"]').forEach(r => {
        r.onchange = () => {
          const isCountdown = sheet.querySelector('input[name="f-timertype"]:checked').value === 'countdown';
          sheet.querySelector('#f-duration-field').style.display = isCountdown ? '' : 'none';
        };
      });

      sheet.querySelector('#f-save').onclick = () => {
        const name = sheet.querySelector('#f-name').value.trim();
        if (!name) { toast('Give it a name first'); return; }
        const timerType = sheet.querySelector('input[name="f-timertype"]:checked').value;
        const minutes = parseInt(sheet.querySelector('#f-duration').value, 10) || 15;
        const payload = {
          name,
          tags: Array.from(selected),
          timerType,
          timerDuration: minutes * 60,
          timesPerWeek: Math.max(1, Math.min(7, parseInt(sheet.querySelector('#f-perweek').value, 10) || 7)),
          preferredDays: Array.from(selectedDays).sort((a, b) => a - b),
        };
        if (existing) db.updateActivity(existing.id, payload);
        else db.createActivity(payload);
        closeSheet();
        render();
        toast(existing ? 'Card updated' : 'Card filed');
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
      overlay.querySelector('#timer-note-save').onclick = () => {
        const val = noteInput.value.trim();
        if (val) db.setLogNote(activity.id, db.todayStr(), val);
        done();
      };
      overlay.querySelector('#timer-skip').onclick = done;
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

render();
if (!localStorage.getItem('chronodo-welcomed')) showWelcome();
