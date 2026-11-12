import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const key = 'ember:workout-notification:v1';
const workout = {id: 'w1', date: '2026-11-11T18:05:00'};

function memoryStorage(initial: Record<string, string> = {}, {denyWrites = false} = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => {
      if (denyWrites) throw new DOMException('Denied', 'SecurityError');
      values.set(name, value);
    },
    removeItem: (name: string) => {
      if (denyWrites) throw new DOMException('Denied', 'SecurityError');
      values.delete(name);
    },
  };
}

/** The OS boundary: permission, the prompt and the worker registration's notification list. */
function device({
  permission = 'default',
  answer = 'granted',
  showFails = false,
  supported = true,
}: {
  permission?: NotificationPermission;
  answer?: NotificationPermission | Error;
  showFails?: boolean;
  supported?: boolean;
} = {}) {
  const shown: {title: string; options: NotificationOptions; close: () => void}[] = [];
  const registration = {
    showNotification: vi.fn(async (title: string, options: NotificationOptions) => {
      if (showFails) throw new TypeError('No active worker');
      const item = {
        title,
        options,
        data: options.data as unknown,
        close: () => shown.splice(shown.indexOf(item), 1),
      };
      // The OS replaces a notification with the same tag.
      shown.splice(0, shown.length, ...shown.filter((other) => other.options.tag !== options.tag));
      shown.push(item);
    }),
    getNotifications: vi.fn(async () => [...shown]),
  };
  const Notification = {
    permission,
    requestPermission: vi.fn(async () => {
      if (answer instanceof Error) throw answer;
      Notification.permission = answer;
      return answer;
    }),
  };
  vi.stubGlobal('window', {
    isSecureContext: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    matchMedia: () => ({matches: false}),
  });
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal(
    'navigator',
    supported
      ? {userAgent: 'Android', serviceWorker: {ready: Promise.resolve(registration)}}
      : {userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)', maxTouchPoints: 5},
  );
  if (supported) {
    vi.stubGlobal('Notification', Notification);
    vi.stubGlobal('ServiceWorkerRegistration', {prototype: {showNotification() {}}});
  }
  return {shown, registration, Notification};
}

const load = async () => {
  vi.resetModules();
  return import('../src/pwa/workout-notification');
};

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
afterEach(() => vi.unstubAllGlobals());

describe('workout notification preferences', () => {
  it('are on and not yet asked by default, and read only a valid version 1 record', async () => {
    device();
    const {parseNotificationPreferences} = await load();
    const fresh = {version: 1, enabled: true, asked: false};
    expect(parseNotificationPreferences(null)).toEqual(fresh);
    expect(parseNotificationPreferences('{')).toEqual(fresh);
    expect(parseNotificationPreferences(JSON.stringify({version: 1, enabled: 'no'}))).toEqual(
      fresh,
    );
    expect(
      parseNotificationPreferences(JSON.stringify({version: 1, enabled: false, asked: true})),
    ).toEqual({version: 1, enabled: false, asked: true});
  });
});

describe('notification support', () => {
  it('needs a secure service-worker notification API; an iPhone Safari tab is told to install', async () => {
    device();
    expect((await load()).notificationSupport()).toBe('supported');
    vi.unstubAllGlobals();
    device({supported: false});
    const tab = await load();
    expect(tab.notificationSupport()).toBe('install');
    expect(tab.notificationState().permission).toBe('unsupported');
    tab.askOnStart();
    await tab.reconcileWorkoutNotification(workout);
  });
});

describe('asking on Start', () => {
  it('asks the OS once per device, records the ask and never asks again after a dismissal', async () => {
    const os = device({answer: 'default'});
    const {askOnStart, notificationState} = await load();
    askOnStart();
    expect(os.Notification.requestPermission).toHaveBeenCalledOnce();
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({asked: true});
    await vi.waitFor(() => expect(notificationState().permission).toBe('default'));
    askOnStart();
    expect(os.Notification.requestPermission).toHaveBeenCalledOnce();
  });

  it('does not ask while turned off or once the OS has answered', async () => {
    const off = device();
    localStorage.setItem(key, JSON.stringify({version: 1, enabled: false, asked: false}));
    (await load()).askOnStart();
    expect(off.Notification.requestPermission).not.toHaveBeenCalled();
    vi.stubGlobal('localStorage', memoryStorage());
    const denied = device({permission: 'denied'});
    (await load()).askOnStart();
    expect(denied.Notification.requestPermission).not.toHaveBeenCalled();
  });

  it('reports a failed request and lets Settings ask again', async () => {
    const os = device({answer: new Error('blocked')});
    const {
      askOnStart,
      notificationState,
      reconcileWorkoutNotification,
      requestNotificationPermission,
    } = await load();
    expect(() => askOnStart()).not.toThrow();
    await vi.waitFor(() =>
      expect(notificationState().error).toBe('Couldn’t ask for permission. Try again.'),
    );
    // Reconciling the running workout keeps the request error for Settings.
    await reconcileWorkoutNotification(workout);
    expect(notificationState().error).toBe('Couldn’t ask for permission. Try again.');
    os.Notification.requestPermission.mockResolvedValueOnce('granted');
    expect(await requestNotificationPermission()).toBe('granted');
    expect(notificationState().error).toBe('');
  });
});

describe('the active-workout notification', () => {
  it('shows one silent, content-free notification per workout, keeps a dismissal for the visit and restores it on reopening', async () => {
    const os = device({permission: 'granted'});
    const app = await load();
    // App reconciles whenever the notification state changes (its effect).
    let pass = Promise.resolve();
    app.subscribeNotificationState(() => {
      pass = app.reconcileWorkoutNotification(workout);
    });
    const onVisibility = vi
      .mocked(document.addEventListener)
      .mock.calls.find(([type]) => type === 'visibilitychange')![1] as () => void;
    const switchTo = async (state: DocumentVisibilityState) => {
      (document as {visibilityState: DocumentVisibilityState}).visibilityState = state;
      onVisibility();
      await pass;
    };
    await app.reconcileWorkoutNotification(workout);
    await app.reconcileWorkoutNotification(workout);
    expect(os.registration.showNotification).toHaveBeenCalledOnce();
    expect(os.shown).toHaveLength(1);
    expect(os.shown[0].title).toBe('Workout active');
    expect(os.shown[0].options).toMatchObject({
      body: 'Started at 18:05 · Tap to resume',
      tag: 'ember-active-workout',
      badge: '/icons/badge-96.png',
      silent: true,
    });
    // Coming back while it is still shown leaves it alone.
    await switchTo('hidden');
    await switchTo('visible');
    expect(os.registration.showNotification).toHaveBeenCalledOnce();

    // Dismissed, it stays away for the rest of the visit and while Ember is in the background.
    os.shown[0].close();
    await app.reconcileWorkoutNotification(workout);
    await switchTo('hidden');
    await app.reconcileWorkoutNotification(workout);
    expect(os.shown).toHaveLength(0);
    // Bringing Ember back restores it once.
    await switchTo('visible');
    await app.reconcileWorkoutNotification(workout);
    expect(os.registration.showNotification).toHaveBeenCalledTimes(2);
    expect(os.shown).toHaveLength(1);

    // A relaunch keeps a notification that is still shown and restores a dismissed one.
    const relaunched = await load();
    await relaunched.reconcileWorkoutNotification(workout);
    expect(os.registration.showNotification).toHaveBeenCalledTimes(2);
    os.shown[0].close();
    const reopened = await load();
    await reopened.reconcileWorkoutNotification(workout);
    expect(os.registration.showNotification).toHaveBeenCalledTimes(3);
    await reopened.reconcileWorkoutNotification({id: 'w2', date: workout.date});
    expect(os.registration.showNotification).toHaveBeenCalledTimes(4);
    expect(os.shown).toHaveLength(1);
  });

  it('clears when the workout ends or the switch is turned off, and turning it on shows it again', async () => {
    const os = device({permission: 'granted'});
    const {reconcileWorkoutNotification, setNotificationsEnabled} = await load();
    await reconcileWorkoutNotification(workout);
    await reconcileWorkoutNotification(null);
    expect(os.shown).toHaveLength(0);
    await reconcileWorkoutNotification({id: 'w2', date: workout.date});
    expect(setNotificationsEnabled(false)).toBe(true);
    await reconcileWorkoutNotification({id: 'w2', date: workout.date});
    expect(os.shown).toHaveLength(0);
    setNotificationsEnabled(true);
    await reconcileWorkoutNotification({id: 'w2', date: workout.date});
    expect(os.shown).toHaveLength(1);
  });

  it('keeps an Off choice another tab saved while the notification was being shown', async () => {
    const os = device({permission: 'granted'});
    const {reconcileWorkoutNotification} = await load();
    os.registration.showNotification.mockImplementationOnce(async () => {
      localStorage.setItem(key, JSON.stringify({version: 1, enabled: false, asked: false}));
    });
    await reconcileWorkoutNotification(workout);
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({
      version: 1,
      enabled: false,
      asked: false,
    });
  });

  it('shows it again when another tab turns it off and on', async () => {
    const os = device({permission: 'granted'});
    const owner = await load();
    await owner.reconcileWorkoutNotification(workout);
    // The owner tab hears each write of the other tab in order, as storage events, and
    // reconciles when its state changes (App's effect).
    let pass = Promise.resolve();
    owner.subscribeNotificationState(() => {
      pass = owner.reconcileWorkoutNotification(workout);
    });
    const onStorage = vi
      .mocked(window.addEventListener)
      .mock.calls.find(([type]) => type === 'storage')![1] as (event: object) => void;
    const writes: {key: string; newValue: string | null}[] = [];
    const storage = localStorage as unknown as ReturnType<typeof memoryStorage>;
    const {setItem, removeItem} = storage;
    storage.setItem = (key, value) => (setItem(key, value), writes.push({key, newValue: value}));
    storage.removeItem = (key) => (removeItem(key), writes.push({key, newValue: null}));
    const other = await load();
    other.setNotificationsEnabled(false);
    other.setNotificationsEnabled(true);
    for (const write of writes) {
      onStorage(write);
      await pass;
    }
    expect(os.shown).toHaveLength(1);
    expect(os.registration.showNotification).toHaveBeenCalledTimes(2);
  });

  it('runs one pass at a time and settles on the latest workout', async () => {
    const os = device({permission: 'granted'});
    const {reconcileWorkoutNotification} = await load();
    const first = reconcileWorkoutNotification(workout);
    void reconcileWorkoutNotification(null);
    await first;
    expect(os.shown).toHaveLength(0);
  });

  it('shows nothing without permission and reports a failed show without throwing', async () => {
    const os = device({permission: 'denied'});
    const {reconcileWorkoutNotification} = await load();
    await reconcileWorkoutNotification(workout);
    expect(os.registration.showNotification).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', memoryStorage());
    device({permission: 'granted', showFails: true});
    const failing = await load();
    await expect(failing.reconcileWorkoutNotification(workout)).resolves.toBeUndefined();
    expect(failing.notificationState().error).toBe('Couldn’t show the workout notification.');
  });

  it('keeps a choice that could not be saved for this tab, also while a show is pending', async () => {
    vi.stubGlobal(
      'localStorage',
      memoryStorage(
        {[key]: JSON.stringify({version: 1, enabled: true, asked: true})},
        {denyWrites: true},
      ),
    );
    const os = device({permission: 'granted'});
    let finishShow = () => {};
    const show = os.registration.showNotification.getMockImplementation()!;
    os.registration.showNotification.mockImplementationOnce(
      (...args) => new Promise((resolve) => (finishShow = () => resolve(show(...args)))),
    );
    const {reconcileWorkoutNotification, setNotificationsEnabled, notificationState} = await load();
    const pass = reconcileWorkoutNotification(workout);
    await vi.waitFor(() => expect(os.registration.showNotification).toHaveBeenCalledOnce());
    expect(setNotificationsEnabled(false)).toBe(false);
    void reconcileWorkoutNotification(workout);
    finishShow();
    await pass;
    expect(notificationState().preferences.enabled).toBe(false);
    expect(os.shown).toHaveLength(0);
  });
});
