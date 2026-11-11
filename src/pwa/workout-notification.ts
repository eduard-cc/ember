import {useSyncExternalStore} from 'react';

/**
 * One calm, device-local notification while a workout is active: "Workout active", the start
 * time and "Tap to resume", never exercise names or loads (it shows on the lock screen). Shown
 * through the service worker, so it needs no push server. On by default; the OS permission is
 * asked for once, from a Start workout tap, and Settings can ask again or turn it off.
 *
 * Shown at most once per visit: a visit starts when Ember opens or is brought back to the
 * foreground. A notification swiped away stays away for the rest of that visit and while Ember is
 * in the background; the next open or return shows it again. One still shown for the workout is
 * left alone. Settings is the way to turn it off for good.
 */
export interface NotificationPreferences {
  version: 1;
  enabled: boolean;
  /** The automatic request on Start already happened once on this device. */
  asked: boolean;
}
export const notificationKey = 'ember:workout-notification:v1';
export const notificationTag = 'ember-active-workout';
const defaults: NotificationPreferences = {version: 1, enabled: true, asked: false};

export function parseNotificationPreferences(raw: string | null): NotificationPreferences {
  try {
    const value = JSON.parse(raw ?? 'null') as Partial<
      Record<keyof NotificationPreferences, unknown>
    > | null;
    if (
      value?.version === 1 &&
      typeof value.enabled === 'boolean' &&
      typeof value.asked === 'boolean'
    )
      return {version: 1, enabled: value.enabled, asked: value.asked};
  } catch {
    /* A device preference, not workout data. */
  }
  return defaults;
}

/** `install`: an iPhone or iPad Safari tab, where only the Home Screen app can notify. */
export type NotificationSupport = 'supported' | 'install' | 'unsupported';

export function notificationSupport(): NotificationSupport {
  if (
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    typeof Notification !== 'undefined' &&
    typeof ServiceWorkerRegistration !== 'undefined' &&
    'showNotification' in ServiceWorkerRegistration.prototype
  )
    return 'supported';
  const apple =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as {standalone?: boolean}).standalone === true;
  return apple && !installed ? 'install' : 'unsupported';
}

export interface NotificationState {
  preferences: NotificationPreferences;
  permission: NotificationPermission | 'unsupported';
  /** The last request or show failure; cleared by the next success. */
  error: string;
  /** Counts returns to the foreground, so the owner tab reconciles on each one. */
  visit: number;
}

let preferences: NotificationPreferences | null = null;
// Kept apart so a later show pass does not clear the request error Settings offers a retry for.
let requestError = '';
let showError = '';
let snapshot: NotificationState | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  snapshot = null;
  listeners.forEach((listener) => listener());
};

function currentPreferences(): NotificationPreferences {
  if (!preferences) {
    try {
      preferences = parseNotificationPreferences(localStorage.getItem(notificationKey));
    } catch {
      preferences = defaults;
    }
  }
  return preferences;
}

function permission(): NotificationState['permission'] {
  return notificationSupport() === 'supported' ? Notification.permission : 'unsupported';
}

export function notificationState(): NotificationState {
  const next = {
    preferences: currentPreferences(),
    permission: permission(),
    error: requestError || showError,
    visit,
  };
  // Permission can change outside the app (system settings), so it is read on every snapshot.
  if (
    !snapshot ||
    snapshot.preferences !== next.preferences ||
    snapshot.permission !== next.permission ||
    snapshot.error !== next.error ||
    snapshot.visit !== next.visit
  )
    snapshot = next;
  return snapshot;
}

/** Applies the change for this tab and returns whether it was saved on the device. */
function save(patch: Partial<Omit<NotificationPreferences, 'version'>>): boolean {
  preferences = {...currentPreferences(), ...patch};
  notify();
  try {
    localStorage.setItem(notificationKey, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}

// The workout it was shown for in this visit; a new page or a return to the foreground clears it.
let visit = 0;
let postedWorkout: string | null = null;

function setRequestError(message: string) {
  requestError = message;
  notify();
}
function setShowError(message: string) {
  if (showError === message) return;
  showError = message;
  notify();
}

/** Asks the OS. Must run inside the tap that wants it: browsers drop requests without one. */
export async function requestNotificationPermission(): Promise<NotificationPermission | null> {
  try {
    const result = await Notification.requestPermission();
    setRequestError('');
    return result;
  } catch {
    setRequestError('Couldn’t ask for permission. Try again.');
    return null;
  }
}

/**
 * Called synchronously from a Start workout tap. Asks once per device, and only while the
 * feature is on and the OS has not been asked; the workout starts whatever the answer.
 */
export function askOnStart() {
  if (notificationSupport() !== 'supported') return;
  const {enabled, asked} = currentPreferences();
  if (!enabled || asked || Notification.permission !== 'default') return;
  save({asked: true});
  void requestNotificationPermission();
}

/** The Settings switch. Turning it on shows the notification again for a running workout. */
export function setNotificationsEnabled(enabled: boolean): boolean {
  const saved = save({enabled});
  if (enabled && notificationSupport() === 'supported' && Notification.permission === 'default')
    void requestNotificationPermission();
  return saved;
}

export interface ActiveWorkout {
  id: string;
  /** Local wall time `YYYY-MM-DDTHH:MM:SS`. */
  date: string;
}

const startTime = (date: string) =>
  new Date(date).toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit'});

let desired: ActiveWorkout | null = null;
let running: Promise<void> | null = null;
let again = false;

async function apply(workout: ActiveWorkout | null) {
  const registration = await navigator.serviceWorker.ready;
  const shown = await registration.getNotifications({tag: notificationTag});
  const {enabled} = currentPreferences();
  if (!workout || !enabled || Notification.permission !== 'granted') {
    for (const item of shown) item.close();
    // Turning it back on, or the next workout, shows it again in this visit.
    postedWorkout = null;
    return;
  }
  // Still shown, or shown and dismissed in this visit; in the background it waits for the return.
  if (shown.some((item) => (item.data as {workout?: unknown} | null)?.workout === workout.id))
    postedWorkout = workout.id;
  if (postedWorkout === workout.id || document.visibilityState === 'hidden') return;
  await registration.showNotification('Workout active', {
    body: `Started at ${startTime(workout.date)} · Tap to resume`,
    tag: notificationTag,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    silent: true,
    data: {workout: workout.id},
  });
  postedWorkout = workout.id;
}

/**
 * Brings the shown notification in line with the active workout. Only the tab that owns the
 * draft calls it, after hydration. Passes run one at a time against the latest workout, and a
 * failure never reaches the logger.
 */
export function reconcileWorkoutNotification(workout: ActiveWorkout | null): Promise<void> {
  desired = workout;
  if (notificationSupport() !== 'supported') return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      const target = desired;
      try {
        await apply(target);
        setShowError('');
      } catch {
        if (target) setShowError('Couldn’t show the workout notification.');
      }
    } while (again);
    running = null;
  })();
  return running;
}

// Another tab changed the setting, or the owner changed the permission and came back.
const onStorage = (event: StorageEvent) => {
  if (event.key !== notificationKey) return;
  preferences = parseNotificationPreferences(event.newValue);
  notify();
};
// Back in the foreground: a new visit, which may show it again.
const onVisible = () => {
  if (document.visibilityState !== 'visible') return;
  visit++;
  postedWorkout = null;
  notify();
};

export function subscribeNotificationState(listener: () => void) {
  if (!listeners.size) {
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
    }
  };
}

const serverState: NotificationState = {
  preferences: defaults,
  permission: 'unsupported',
  error: '',
  visit: 0,
};
export const useNotificationState = () =>
  useSyncExternalStore(subscribeNotificationState, notificationState, () => serverState);

/** On a tap the worker asks which window owns the draft, then asks that one to show the logger. */
export const ownerQuery = 'EMBER_WORKOUT_OWNER';
export const resumeMessage = 'EMBER_RESUME_WORKOUT';
