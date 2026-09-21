# Rolodex — Activity Tracker (PWA)

A card-catalog for your habits: rolodex + list views, tags & goals, monthly
consistency calendars, recommendations, and per-activity timers. Plain
HTML/CSS/JS, no build step, no framework, no account or server — everything
is stored on-device in `localStorage`.

## The watch dial

The main view is a watch dial anchored to the left edge: its centre sits
off-screen so you only see one side of the face, card names ride the rim, and
a fixed rust pointer at 3 o'clock marks the selection. The card at the pointer
shows its face — title and actions — flat to the right; full detail (tags,
streak, calendar) opens when you tap into the card.

Turn the dial by dragging vertically anywhere on it (up = next), with the
arrow keys, or the arrows below. Tap a name on the rim to jump straight to it.
Markup and label geometry live in `renderRolodex()` (js/app.js); the dial
face, ticks and pointer are the `.watch-dial` block in css/styles.css.

## Goals, tasks & tags

The model has three levels, all backed by the same storage:

- **Task** — the thing you do, stamp, and time. Stored in `db.activities`.
- **Goal** — a larger outcome you're working toward. Stored as a tag with
  `isGoal === true`; a task belongs to a goal when its `tags` array includes
  that goal's id.
- **Tag** — a lightweight label for filtering. A tag with `isGoal === false`.

The **Goals & Tags** view lists each goal with the tasks filed under it, a
**No goal** bucket for tasks with no goal, and a quick action to create a new
task already linked to a goal. In the task form a task takes **one primary
goal** (single-select) plus any number of plain tags — both are still stored
together in `activity.tags`, so storage is unchanged and existing data keeps
loading (a legacy task with several goal-tags shows its first as primary and
collapses to that one only if you re-save it). Team goals continue to mirror in
as goal-tags with a `teamGoalId`.

The **Teams** view is the home for creating or joining a team, setting your
teammate name, copying the team code, reviewing members, and adding team goals.
Team controls are kept separate from device preferences in Settings.

**Goals on the dial.** In the unfiltered **All** view, the Chronodo dial focuses
on goals that still have unfinished tasks today plus unfinished tasks that have
no goal. Tasks already filed under a goal do not also appear as separate dial
items. Goals are derived UI objects (from goal tags + activities) — never stored
as activities. Opening a goal jumps straight to its one remaining task, or shows
a small picker when several remain, where you stamp or time a child task. The
goal itself is never stamped; it drops off the dial once all its tasks are
stamped for the day. Goal and tag filters continue to show matching individual
tasks.

## Stamping past dates

Every stamp takes an explicit date, so you're not limited to today. In the
**Calendar** view, pick any day and use **Stamp another task** to stamp an
existing task on that date with optional minutes and a note — or unstamp it if
it's already stamped that day. Personal tasks go through `db.markDone` /
`db.unmarkDone`; shared team tasks route through `sync.js` and mirror into the
local log. The per-task detail calendar can also toggle any date directly.

## Reminders

Reminders come in two layers. **The first works today with no setup; the
second is a client-side foundation that still needs a backend to actually
deliver anything.**

### 1. In-app reminders (working now, no setup)

Settings → **Reminders**. Off by default. Preferences live under
`settings.reminders` in the same `localStorage` blob as everything else:

```js
reminders: {
  enabled: false,
  time: "19:00",              // 24h, this device's local time
  days: [0,1,2,3,4,5,6],      // 0=Sun .. 6=Sat
  onlyIfUnfinished: true,     // stay quiet on days you finish everything
  quietStart: "",             // "" = quiet hours off
  quietEnd: "",
}
```

When Chronodo opens — or returns to the foreground — it checks these and may
show an in-app banner with **Open Chronodo** / **Dismiss**. The rules:

- only on a selected weekday, and only at or after `time`
- at most **once per day** (the date of the last banner is kept in
  `localStorage` under `chronodo-reminder-last-v1`)
- suppressed inside quiet hours (a range that ends before it starts, e.g.
  `22:00`→`07:00`, wraps past midnight)
- with `onlyIfUnfinished`, shown only when tasks remain unstamped today. A goal
  counts as unfinished when it still has unfinished child tasks, which falls
  out of counting those tasks directly.
- never while a timer is running

**This layer only runs while Chronodo is open.** It cannot wake the app or
fire while the app is closed — that is what push below is for.

### 2. Web push setup (needs a Firebase key **and** a backend)

The client half is implemented in `js/notifications.js`: feature detection,
permission (requested only from the Settings button, never on load), service
worker registration, and — once configured — obtaining an FCM token. The
service worker handles generic `push` events and focuses Chronodo on click.

**To enable push you must supply a VAPID key.** In the Firebase console go to
Project settings → Cloud Messaging → Web configuration → **Web Push
certificates**, generate a key pair, and paste the public key into:

```js
// js/notifications.js
const VAPID_PUBLIC_KEY = '';   // <-- paste the Web Push certificate key here
```

It ships empty on purpose. Until it is set, Settings shows *"Push setup needs
a Firebase Web Push certificate/VAPID key."* and no push code runs.

### What still needs a backend

**A PWA cannot schedule its own future push notifications.** Nothing in this
repo can make a reminder appear while Chronodo is closed. Getting that working
requires server-side work that is *not* included here:

1. **Store device tokens** — send the FCM token from `getStoredToken()` to a
   server (a Firestore collection alongside the existing team rooms is the
   natural spot).
2. **Store reminder preferences** — `time`, `days`, quiet hours, and the
   device's timezone, so a job knows when to fire.
3. **Run a scheduler** — a Cloud Scheduler → Cloud Function (or any cron) that
   wakes every N minutes, finds devices whose reminder time just passed, and
4. **Sends the FCM message** to those tokens.

Because Chronodo is local-first, the server does not know what you have
stamped. Two ways to resolve that:

- **Generic push** *(no data leaves the device)* — always send the same copy,
  e.g. *"Open Chronodo to finish today's tasks."* The `onlyIfUnfinished`
  preference cannot be honoured server-side, so the app re-checks locally when
  you open it.
- **Cloud-synced task state** — sync per-day completion counts to the backend
  so it can skip devices that are already done and send precise copy like
  *"3 tasks still unstamped."* This trades away the local-only privacy
  property, so it should be opt-in.

### Known reliability limits

Even with a backend, push on mobile is best-effort, not an alarm clock:

- **Android battery optimisation / Doze** can delay or drop notifications for
  apps it considers idle; users may need to exempt Chronodo.
- **Installed-PWA requirement** — on Android, web push generally needs the app
  installed (or a TWA wrapper); notifications are blocked in some in-app
  browsers entirely.
- **iOS Safari** only supports web push for apps added to the Home Screen, on
  recent iOS versions.
- **Permission is revocable** at the OS or browser level at any time, and a
  denied permission cannot be re-requested from the page — the user has to
  re-enable it in browser/app settings.
- **FCM tokens rotate**; a real backend has to refresh and prune dead tokens.

If you need a hard guarantee that a reminder fires at a set time on Android,
a native alarm in a wrapper app is the reliable route — not web push.

## File map

```
index.html              app shell
css/styles.css           all styling (design tokens at the top)
js/storage.js            data model + localStorage persistence + backup snapshot
js/stats.js              streaks, monthly consistency %, recommendations
js/timer.js              stopwatch/countdown engine
js/notifications.js      permission, local notifications, FCM push client (needs a VAPID key)
js/app.js                views, rendering, forms, gestures — the controller
manifest.json             PWA metadata (name, icons, colors)
service-worker.js        offline caching
icons/                    app icons (192, 512, maskable 512)
```

## 1. Run it locally

No build step needed — just serve the folder (opening `index.html` directly
via `file://` will break the service worker and ES module imports):

```bash
cd rolodex
python3 -m http.server 8000
# visit http://localhost:8000
```

## 2. Editing

Everything is plain, readable JS — no compiling, no `node_modules`. Edit a
file, refresh the browser, see the change. A few common tweaks:

- **Colors / fonts** — all in the `:root` block at the top of `css/styles.css`.
- **Recommendation logic** — `js/stats.js`, `buildRecommendations()`.
- **What counts as "done"** — `js/storage.js`, `markDone()`.
- **Seeded example cards** — `seedIfEmpty()` near the top of `js/app.js`
  (only runs the very first time, before you've added anything — delete it
  if you don't want the sample "Morning run" etc. cards).

## 3. Host it (required before wrapping to an APK)

PWABuilder needs a **public HTTPS URL** to your `manifest.json` — it can't
package files straight off your computer. Any static host works; these are
free and take a couple of minutes:

- **GitHub Pages** — push this folder to a repo, enable Pages on the `main`
  branch in repo Settings, done.
- **Netlify Drop** — go to [app.netlify.com/drop](https://app.netlify.com/drop)
  and literally drag the `rolodex` folder in. Gives you a live HTTPS URL
  immediately, no account required.
- **Firebase Hosting / Vercel** — also fine, if you already use one of them.

## 4. Turn it into an APK

**Option A — PWABuilder (easiest, no coding, official Microsoft tool):**

1. Go to [pwabuilder.com](https://www.pwabuilder.com)
2. Paste your hosted URL (e.g. `https://yourname.github.io/rolodex/`)
3. It scores your manifest/service worker — should show green checks since
   both are already set up
4. Click **Package for Stores → Android**
5. Download the generated package. You'll get a `.aab` (for Play Store) and
   can also generate a signed `.apk` for direct install/testing
6. PWABuilder can auto-generate a signing key for you, or let you upload
   your own if you already have one for the Play Store

This produces a **Trusted Web Activity (TWA)** — a thin native wrapper that
loads your hosted site full-screen (no browser chrome). That's why editing
the hosted files later updates the installed app automatically, with no
rebuild needed.

**Option B — Bubblewrap CLI (Google's tool, more control):**

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest=https://yourname.github.io/rolodex/manifest.json
bubblewrap build
```

Walks you through the same TWA packaging from the command line and gives
you the signing keystore directly.

**Installing the APK on your phone:** transfer the `.apk` file to the device
and open it (you'll need to allow "install unknown apps" for whichever app
you use to open it). For the Play Store, you'll submit the `.aab` instead.

## Notes on the data

- Stored in `localStorage` under the key `rolodex-db-v1` as one JSON blob,
  mirrored to a `rolodex-db-v1-shadow` key on every write. If the primary
  key is ever missing or fails to parse (e.g. a write got interrupted),
  the app falls back to the shadow copy instead of starting empty.
- `navigator.storage.persist()` is requested on load, asking the browser
  not to evict this origin's storage under disk pressure. Best-effort —
  most browsers only grant it to installed PWAs, which a TWA qualifies as.
- Saves are debounced by 120ms while the app is in the foreground, but are
  flushed immediately on `visibilitychange`/`pagehide` (backgrounding, the
  OS reclaiming the app, etc.) so an edit right before that isn't lost.
- No automatic sync between devices — the backup below is opt-in.

## Backups

Settings → **Local backup** downloads a full JSON snapshot (every card,
goal, tag, log and note) and can restore from one — no account or network
needed, works entirely offline. This is the recommended way to move data to
a new device or recover from a wipe.

Cloud backup (Google Drive) is planned for a later version.
