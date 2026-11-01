import {topSet} from '../domain/finish-summary';
import {isTimed} from '../domain/sets';
import type {ExerciseLog, ExerciseType, SetRecord} from '../domain/types';
import {plural} from './plural';

/** One actual set as written in Records and Exercise details: "60 kg × 8", "BW × 12", "45 s". */
export function setLabel(set: SetRecord, type: ExerciseType) {
  if (isTimed(type))
    return `${set.seconds ?? '—'} s${set.distance !== null ? ` · ${set.distance} km` : ''}`;
  if (type === 'bodyweight' || set.weight === null) return `BW × ${set.reps ?? '—'}`;
  return `${set.weight} kg${type === 'assisted' ? ' assist.' : ''} × ${set.reps ?? '—'}`;
}

/** What a row shows, and what a screen reader hears when the shown text abbreviates it. */
export interface SetText {
  text: string;
  spoken?: string;
}

/** "5:00", keeping a recorded fraction of a second to the millisecond ("4:59.5"). */
function clock(seconds: number) {
  // Whole milliseconds, so the split into minutes carries no float noise.
  const ms = Math.round(seconds * 1000);
  const rest = (ms % 60_000) / 1000;
  return `${Math.floor(ms / 60_000)}:${rest < 10 ? '0' : ''}${rest}`;
}

/**
 * One set in a History row or the workout drawer: "75 kg × 8", "12 reps", "60 s",
 * "1.2 km · 5:00", and assistance as "−20 kg × 8" (spoken "20 kg assistance × 8").
 */
export function setText(set: SetRecord, type: ExerciseType): SetText {
  const reps = set.reps ?? '—';
  switch (type) {
    case 'duration':
      return {text: `${set.seconds ?? '—'} s`};
    case 'cardio': {
      const parts = [
        set.distance !== null ? `${set.distance} km` : '',
        set.seconds !== null ? clock(set.seconds) : '',
      ].filter(Boolean);
      return {text: parts.join(' · ') || '—'};
    }
    case 'bodyweight':
      return {text: `${reps} reps`};
    case 'assisted':
      return set.weight === null
        ? {text: `${reps} reps`}
        : {
            text: `${set.weight > 0 ? '−' : ''}${set.weight} kg × ${reps}`,
            spoken: `${set.weight} kg assistance × ${reps}`,
          };
    case 'weighted':
      return set.weight === null ? {text: `${reps} reps`} : {text: `${set.weight} kg × ${reps}`};
  }
}

/** A History row: the session's top set over its set count. */
export function performedLine(exercise: ExerciseLog): {top: SetText; sub: string} {
  const top = topSet(exercise);
  return {
    top: top ? setText(top, exercise.type) : {text: '—'},
    sub: plural(exercise.sets.length, 'set'),
  };
}

const same = (values: (number | null)[]) => values.every((v) => v === values[0]);

/**
 * A template row: the prescription Start will prefill. One load reads "72.5 kg" over
 * "3 × 8 reps" (or "8 · 8 · 6 reps"); varied loads show the top target set over the set count,
 * so a load is never shown next to reps it isn't paired with.
 */
export function plannedLine(exercise: ExerciseLog): {top: SetText; sub: string} {
  const {sets, type} = exercise;
  const count = plural(sets.length, 'set');
  const bare = {top: {text: count}, sub: ''};
  if (!sets.length) return bare;
  const reps = sets.map((set) => set.reps);
  const repsLabel = reps.every((r) => r !== null)
    ? same(reps)
      ? `${sets.length} × ${reps[0]} reps`
      : `${reps.join(' · ')} reps`
    : null;
  if (type === 'duration') {
    const seconds = sets.map((set) => set.seconds).filter((s): s is number => s !== null);
    if (!seconds.length) return bare;
    const lo = Math.min(...seconds),
      hi = Math.max(...seconds);
    return {top: {text: lo === hi ? `${lo} s` : `${lo}–${hi} s`}, sub: count};
  }
  if (type === 'cardio') {
    const first = setText(sets[0], type);
    return first.text === '—' || first.text === '0 km' ? bare : {top: first, sub: count};
  }
  if (type === 'bodyweight') return {top: {text: 'Bodyweight'}, sub: repsLabel ?? count};
  const weights = sets.map((set) => set.weight);
  if (weights.every((w) => w === null)) return repsLabel ? {top: {text: repsLabel}, sub: ''} : bare;
  if (same(weights)) {
    const w = weights[0]!;
    const top: SetText =
      type === 'assisted'
        ? {text: `${w > 0 ? '−' : ''}${w} kg`, spoken: `${w} kg assistance`}
        : {text: `${w} kg`};
    return {top, sub: repsLabel ?? count};
  }
  return performedLine(exercise);
}
