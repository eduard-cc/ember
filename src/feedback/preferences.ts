import {useSyncExternalStore} from 'react';

/**
 * Sounds and haptics are device preferences, separate from workout data like
 * `ember:appearance:v1`. Both default to on. A stored value that fails validation reads as the
 * defaults; a denied write keeps the choice for this tab and reports that it was not saved.
 */
export interface FeedbackPreferences {
  version: 1;
  sound: boolean;
  haptics: boolean;
}
export const feedbackKey = 'ember:feedback:v1';
const defaults: FeedbackPreferences = {version: 1, sound: true, haptics: true};

export function parseFeedback(raw: string | null): FeedbackPreferences {
  try {
    const value = JSON.parse(raw ?? 'null') as Partial<
      Record<keyof FeedbackPreferences, unknown>
    > | null;
    if (
      value?.version === 1 &&
      typeof value.sound === 'boolean' &&
      typeof value.haptics === 'boolean'
    )
      return {version: 1, sound: value.sound, haptics: value.haptics};
  } catch {
    /* Feedback is optional, not workout data. */
  }
  return defaults;
}

let current: FeedbackPreferences | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/** The current preferences, read from storage on first use. */
export function feedbackPreferences(): FeedbackPreferences {
  if (!current) {
    try {
      current = parseFeedback(localStorage.getItem(feedbackKey));
    } catch {
      current = defaults;
    }
  }
  return current;
}

/** Applies the change for this tab and returns whether it was saved on the device. */
export function setFeedbackPreferences(
  patch: Partial<Pick<FeedbackPreferences, 'sound' | 'haptics'>>,
): boolean {
  current = {...feedbackPreferences(), ...patch};
  notify();
  try {
    localStorage.setItem(feedbackKey, JSON.stringify(current));
    return true;
  } catch {
    return false;
  }
}

// Another tab changed the setting.
const onStorage = (event: StorageEvent) => {
  if (event.key !== feedbackKey) return;
  current = parseFeedback(event.newValue);
  notify();
};

function subscribe(listener: () => void) {
  if (!listeners.size) window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener('storage', onStorage);
  };
}

export const useFeedbackPreferences = () =>
  useSyncExternalStore(subscribe, feedbackPreferences, () => defaults);
