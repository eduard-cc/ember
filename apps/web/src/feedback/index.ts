/**
 * Sound and haptics, ported from the approved redesign prototype. Every cue has a haptic; only
 * accomplishments (start, a set check, an exercise done, finish, a PR) also make a sound.
 * Sounds are synthesised with Web Audio (no audio files), kept short, and mixed with the user's
 * music: the "ambient" audio session, where the browser supports it, never pauses a playlist and
 * respects the iPhone silent switch.
 *
 * Haptics: Android uses the Vibration API. iOS Safari has none; since iOS 18 a click on a hidden
 * `<input type="checkbox" switch>` plays the system selection tick, the only web haptic iPhones
 * offer, so patterns are emulated there with timed ticks.
 *
 * Feedback never throws and never blocks logging: every failure is swallowed.
 */
import {feedbackPreferences} from './preferences';

export {setFeedbackPreferences, useFeedbackPreferences} from './preferences';

export type Cue = 'start' | 'set' | 'unset' | 'exercise' | 'finish' | 'pr' | 'delete' | 'tick';

/* ---------- sound ---------- */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
function audio() {
  if (!ctx || !master) {
    const session = (navigator as Navigator & {audioSession?: {type: string}}).audioSession;
    if (session) session.type = 'ambient';
    ctx = new AudioContext({latencyHint: 'interactive'});
    master = ctx.createGain();
    master.gain.value = 0.55;
    // A ceiling, not a compressor: below -3 dBFS cues only get its small fixed makeup gain, and
    // only a stacked peak is caught.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.1;
    master.connect(limiter).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return ctx;
}

/** A soft bell: fundamental plus a quiet inharmonic partial, fast attack, exponential decay. */
function bell(out: AudioNode, freq: number, at: number, dur = 0.5, gain = 0.16) {
  const ctx = out.context;
  const t = ctx.currentTime + at;
  for (const [ratio, g] of [
    [1, 1],
    [2.01, 0.18],
    [3.0, 0.05],
  ] as const) {
    const o = ctx.createOscillator();
    const v = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq * ratio;
    v.gain.setValueAtTime(0, t);
    v.gain.linearRampToValueAtTime(gain * g, t + 0.006);
    v.gain.exponentialRampToValueAtTime(0.0001, t + dur * (ratio === 1 ? 1 : 0.5));
    o.connect(v).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}

/** The physical "tock" under a check: a short band-passed noise burst. */
function tock(out: AudioNode, at: number, freq = 1800, gain = 0.22) {
  const ctx = out.context;
  const t = ctx.currentTime + at;
  const len = Math.floor(ctx.sampleRate * 0.025);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 1.2;
  const v = ctx.createGain();
  v.gain.value = gain;
  src.connect(bp).connect(v).connect(out);
  src.start(t);
}

function swell(out: AudioNode, at: number) {
  const ctx = out.context;
  const t = ctx.currentTime + at;
  for (const [f0, f1, g] of [
    [146.8, 293.7, 0.09],
    [220, 440, 0.05],
  ] as const) {
    const o = ctx.createOscillator();
    const v = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + 0.32);
    v.gain.setValueAtTime(0, t);
    v.gain.linearRampToValueAtTime(g, t + 0.12);
    v.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    o.connect(v).connect(out);
    o.start(t);
    o.stop(t + 0.6);
  }
}

// A major pentatonic run, so each completed set in an exercise climbs one step and never
// clashes; sets past the tenth hold the top note.
const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760];

/**
 * Only accomplishments make a sound; every other cue is felt, not heard. Levels are in dB over
 * the voices' own gains, set so each cue carries over music at the same phone volume (streaming
 * plays near -14 LUFS): a set check lands near -20 LUFS, start, exercise and PR near -18, and
 * finish, the loudest, near -15.
 */
const LEVEL: Partial<Record<Cue, number>> = {set: 20, exercise: 12, start: 12, finish: 8, pr: 14};

function sound(cue: Cue, step: number) {
  const level = LEVEL[cue];
  if (level === undefined) return;
  const ctx = audio();
  const out = ctx.createGain();
  out.gain.value = Math.pow(10, level / 20);
  out.connect(master!);
  switch (cue) {
    case 'set':
      tock(out, 0);
      return bell(out, PENTA[Math.min(Math.max(step, 0), PENTA.length - 1)], 0.005, 0.32, 0.11);
    case 'exercise':
      bell(out, 659.25, 0, 0.5, 0.12);
      return bell(out, 987.77, 0.09, 0.7, 0.12);
    case 'start':
      swell(out, 0);
      bell(out, 587.33, 0.2, 0.5, 0.08);
      return bell(out, 880, 0.3, 0.7, 0.08);
    case 'finish':
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => bell(out, f, i * 0.085, 1.1, 0.13));
      bell(out, 1567.98, 0.42, 1.4, 0.05);
      return;
    case 'pr':
      [1567.98, 1975.53, 2349.32].forEach((f, i) => bell(out, f, i * 0.06, 0.45, 0.06));
      return;
  }
}

/* ---------- haptics ---------- */

const PATTERN: Record<Cue, number[]> = {
  tick: [6],
  set: [12],
  unset: [6],
  exercise: [12, 50, 18],
  start: [18, 60, 10],
  finish: [16, 70, 16, 70, 34],
  pr: [10, 40, 10, 40, 10],
  delete: [24],
};

let iosSwitch: HTMLLabelElement | null = null;
function iosTick() {
  try {
    if (!iosSwitch) {
      iosSwitch = document.createElement('label');
      iosSwitch.ariaHidden = 'true';
      iosSwitch.style.cssText = 'position:fixed;left:-100px;top:0;opacity:0;pointer-events:none';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.tabIndex = -1;
      iosSwitch.append(input);
      document.body.append(iosSwitch);
    }
    iosSwitch.click();
  } catch {
    /* Feedback must never break logging. */
  }
}

function play(pattern: number[]) {
  if (typeof navigator.vibrate === 'function') {
    navigator.vibrate(pattern);
    return;
  }
  // iPhone: one selection tick per pulse. Only touch devices, so a desktop browser without the
  // Vibration API never gets synthetic clicks.
  if (!matchMedia('(pointer: coarse)').matches) return;
  // The first tick runs inside the tap that caused it.
  iosTick();
  let t = pattern[0];
  pattern.slice(1).forEach((ms, i) => {
    if (i % 2 === 1) setTimeout(iosTick, t);
    t += ms;
  });
}

/**
 * A silent haptic for gestures (chart scrubbing, a swipe reaching delete, a reorder lift or
 * step), on the same preference-aware path as cues. Never throws.
 */
export function selectionHaptic(pattern: number[] = PATTERN.tick) {
  try {
    if (feedbackPreferences().haptics) play(pattern);
  } catch {
    /* Feedback must never break a gesture. */
  }
}

/** Fire a cue: its haptic and, for accomplishments, its sound, each respecting its own setting. */
export function cue(name: Cue, step = 0) {
  let preferences;
  try {
    preferences = feedbackPreferences();
  } catch {
    return;
  }
  if (preferences.haptics) {
    try {
      play(PATTERN[name]);
    } catch {
      /* Feedback must never break logging. */
    }
  }
  if (preferences.sound) {
    try {
      sound(name, step);
    } catch {
      /* Feedback must never break logging. */
    }
  }
}

/** A sample of one channel, so a switch turned on is heard or felt: the set check, or a tick. */
export function previewFeedback(channel: 'sound' | 'haptics') {
  try {
    if (channel === 'sound') sound('set', 0);
    else play(PATTERN.tick);
  } catch {
    /* Feedback must never break Settings. */
  }
}
