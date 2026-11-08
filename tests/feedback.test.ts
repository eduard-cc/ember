import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const key = 'ember:feedback:v1';

function memoryStorage(initial: Record<string, string> = {}, {denyWrites = false} = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => {
      if (denyWrites) throw new DOMException('Denied', 'SecurityError');
      values.set(name, value);
    },
  };
}

// Module state (the loaded preferences, the audio context) is per import.
const load = async () => {
  vi.resetModules();
  return {
    ...(await import('../src/feedback/preferences')),
    ...(await import('../src/feedback')),
  };
};

beforeEach(() => {
  vi.stubGlobal('window', {addEventListener: vi.fn(), removeEventListener: vi.fn()});
  vi.stubGlobal('matchMedia', () => ({matches: false}));
});
afterEach(() => vi.unstubAllGlobals());

describe('feedback preferences', () => {
  it('accept only a valid version 1 record and otherwise turn sounds and haptics on', async () => {
    const {parseFeedback} = await load();
    const on = {version: 1, sound: true, haptics: true};
    expect(parseFeedback(null)).toEqual(on);
    expect(parseFeedback('not json')).toEqual(on);
    expect(parseFeedback(JSON.stringify({version: 2, sound: false, haptics: false}))).toEqual(on);
    expect(parseFeedback(JSON.stringify({version: 1, sound: 'no', haptics: false}))).toEqual(on);
    expect(
      parseFeedback(JSON.stringify({version: 1, sound: false, haptics: true, extra: 1})),
    ).toEqual({version: 1, sound: false, haptics: true});
  });

  it('read the stored choice, save each change under the versioned device key and keep a denied write for the tab', async () => {
    const storage = memoryStorage({
      [key]: JSON.stringify({version: 1, sound: false, haptics: true}),
    });
    vi.stubGlobal('localStorage', storage);
    const {feedbackPreferences, setFeedbackPreferences} = await load();
    expect(feedbackPreferences()).toEqual({version: 1, sound: false, haptics: true});
    expect(setFeedbackPreferences({haptics: false})).toBe(true);
    expect(JSON.parse(storage.values.get(key)!)).toEqual({
      version: 1,
      sound: false,
      haptics: false,
    });

    vi.stubGlobal('localStorage', memoryStorage({}, {denyWrites: true}));
    const denied = await load();
    expect(denied.setFeedbackPreferences({sound: false})).toBe(false);
    expect(denied.feedbackPreferences()).toEqual({version: 1, sound: false, haptics: true});
  });
});

describe('cue', () => {
  it('never throws when storage, Web Audio and vibration are all missing', async () => {
    vi.stubGlobal('localStorage', undefined);
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('navigator', {});
    const {cue} = await load();
    for (const name of ['start', 'set', 'unset', 'exercise', 'finish', 'pr', 'delete', 'tick'])
      expect(() => cue(name as Parameters<typeof cue>[0], 3)).not.toThrow();
  });

  it('never throws when the audio device or vibration fails', async () => {
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal(
      'AudioContext',
      vi.fn(() => {
        throw new Error('No audio device');
      }),
    );
    vi.stubGlobal('navigator', {
      vibrate: () => {
        throw new Error('Blocked');
      },
    });
    const {cue} = await load();
    expect(() => cue('start')).not.toThrow();
  });

  it('vibrates for every cue, sounds only for accomplishments and plays each only while switched on', async () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const vibrate = vi.fn(() => true);
    vi.stubGlobal('navigator', {vibrate});
    const audio = vi.fn(() => {
      throw new Error('stop after construction');
    });
    vi.stubGlobal('AudioContext', audio);
    const {cue, selectionHaptic, setFeedbackPreferences} = await load();

    // Small actions and removals are felt, not heard.
    for (const name of ['tick', 'unset', 'delete'] as const) cue(name);
    expect(vibrate.mock.calls).toEqual([[[6]], [[6]], [[24]]]);
    expect(audio).not.toHaveBeenCalled();

    cue('start');
    expect(vibrate).toHaveBeenLastCalledWith([18, 60, 10]);
    expect(audio).toHaveBeenCalledTimes(1);
    selectionHaptic([10]);
    expect(vibrate).toHaveBeenLastCalledWith([10]);

    setFeedbackPreferences({sound: false, haptics: false});
    cue('start');
    selectionHaptic([10]);
    expect(vibrate).toHaveBeenCalledTimes(5);
    expect(audio).toHaveBeenCalledTimes(1);
  });
});
