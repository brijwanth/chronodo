// notifications.js — notification permission, local notifications, and the
// Firebase Cloud Messaging (web push) client foundation.
//
// SCOPE: this file is only the *client* half of push. A PWA cannot schedule a
// notification that fires while it is closed — something has to send the push.
// Getting reminders delivered when Chronodo isn't open needs a backend that
// stores device tokens and sends on a schedule; see "Web push setup" and
// "What still needs a backend" in README.md.
//
// Everything here degrades quietly: on a browser with no Notification API, no
// service worker, or no PushManager, each call returns a harmless result
// instead of throwing, so the rest of the app is unaffected.

// Firebase Web Push certificate ("VAPID key pair" public key). Get it from the
// Firebase console → Project settings → Cloud Messaging → Web configuration →
// Web Push certificates, then paste the public key between the quotes.
// Deliberately empty: push stays off until a real key is configured, and we
// never ship a placeholder that looks valid.
const VAPID_PUBLIC_KEY = '';

// Must match the Firebase SDK version js/sync.js already loads, so both share
// one copy of the library and one initialized app.
const FIREBASE_VERSION = '12.18.0';
const TOKEN_KEY = 'chronodo-fcm-token-v1';

// ---------------------------------------------------------------- capability
function supportsNotifications() {
  return typeof window !== 'undefined' && 'Notification' in window;
}
function supportsServiceWorker() {
  return 'serviceWorker' in navigator;
}
function supportsPush() {
  return typeof window !== 'undefined' && 'PushManager' in window;
}
// True only when this browser could receive a real web push.
function supportsWebPush() {
  return supportsNotifications() && supportsServiceWorker() && supportsPush();
}
// Whether a VAPID key has been filled in above.
function isPushConfigured() {
  return VAPID_PUBLIC_KEY.trim().length > 0;
}

// 'default' | 'granted' | 'denied' | 'unsupported'
function permissionStatus() {
  if (!supportsNotifications()) return 'unsupported';
  return Notification.permission;
}

// Ask the browser for notification permission. Browsers require this to be
// called from a user gesture — the Settings button is the only caller.
async function requestPermission() {
  if (!supportsNotifications()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch (e) {
    // Older Safari used the callback form and can reject the promise version.
    return Notification.permission;
  }
}

// navigator.serviceWorker.ready never settles when registration failed or is
// blocked (private mode, disabled SWs), which would hang any await on it. Race
// it against a short timeout and treat "no registration" as a normal outcome.
async function swRegistrationOrNull(timeoutMs = 3000) {
  if (!supportsServiceWorker()) return null;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------- local notify
// Show a notification straight from this device (no server involved). Used by
// the Settings "Send test reminder" button. Prefers the service worker
// registration, which is what Android/TWA needs; falls back to the page-level
// Notification constructor on desktop browsers without an active SW.
async function showLocalNotification(title, body, data = {}) {
  if (permissionStatus() !== 'granted') return false;
  const options = {
    body,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: 'chronodo-reminder',
    data: { url: './index.html', ...data },
  };
  try {
    const reg = await swRegistrationOrNull();
    if (reg && reg.showNotification) {
      await reg.showNotification(title, options);
      return true;
    }
    new Notification(title, options);
    return true;
  } catch (e) {
    console.warn('Could not show notification', e);
    return false;
  }
}

// ---------------------------------------------------------------- FCM client
// Reuse the Firebase app js/sync.js already initialized rather than creating a
// second one (and without duplicating the config here). Returns null when the
// SDK never loaded — e.g. first run while offline.
async function firebaseAppOrNull() {
  try {
    const { getApps } = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`);
    const apps = getApps();
    return apps.length ? apps[0] : null;
  } catch (e) {
    return null;
  }
}

let foregroundHandler = null;
// Register a callback for pushes that arrive while Chronodo is in the
// foreground (FCM hands those to the page, not the service worker).
function onForegroundMessage(cb) { foregroundHandler = cb; }

// Obtain (and cache) this device's FCM registration token. A backend needs
// this token to target the device — storing it somewhere a server can read is
// the backend work described in the README.
//
// Resolves to { ok, token?, reason? } and never throws. reason is one of:
// 'unsupported' | 'permission' | 'no-vapid' | 'no-firebase' | 'no-token' | 'error'.
async function initMessaging() {
  if (!supportsWebPush()) return { ok: false, reason: 'unsupported' };
  if (permissionStatus() !== 'granted') return { ok: false, reason: 'permission' };
  if (!isPushConfigured()) return { ok: false, reason: 'no-vapid' };
  try {
    const app = await firebaseAppOrNull();
    if (!app) return { ok: false, reason: 'no-firebase' };
    const messagingMod = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-messaging.js`);
    const { getMessaging, getToken, onMessage, isSupported } = messagingMod;
    if (typeof isSupported === 'function' && !(await isSupported())) {
      return { ok: false, reason: 'unsupported' };
    }
    const registration = await swRegistrationOrNull();
    if (!registration) return { ok: false, reason: 'no-sw' };
    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey: VAPID_PUBLIC_KEY,
      serviceWorkerRegistration: registration,
    });
    if (!token) return { ok: false, reason: 'no-token' };
    try { localStorage.setItem(TOKEN_KEY, token); } catch (e) { /* private mode */ }
    onMessage(messaging, (payload) => {
      if (foregroundHandler) foregroundHandler(payload);
    });
    return { ok: true, token };
  } catch (err) {
    console.warn('FCM setup failed', err);
    return { ok: false, reason: 'error', error: err };
  }
}

// The last token we obtained, if any — handy for a future "register this
// device with the backend" step.
function getStoredToken() {
  try { return localStorage.getItem(TOKEN_KEY) || null; } catch (e) { return null; }
}

// One line describing push readiness, shown in Settings.
function pushStatusMessage() {
  if (!supportsWebPush()) return 'This browser can’t receive web push notifications.';
  if (!isPushConfigured()) return 'Push setup needs a Firebase Web Push certificate/VAPID key.';
  if (permissionStatus() !== 'granted') return 'Allow notifications to finish push setup.';
  return getStoredToken()
    ? 'Push token registered on this device. Sending scheduled reminders still needs a backend.'
    : 'Push is configured — registering this device…';
}

export {
  supportsNotifications, supportsServiceWorker, supportsPush, supportsWebPush,
  isPushConfigured, permissionStatus, requestPermission,
  showLocalNotification, initMessaging, onForegroundMessage,
  getStoredToken, pushStatusMessage,
};
