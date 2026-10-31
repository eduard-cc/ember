import {isTimed} from '../domain/sets';
import type {ExerciseType, SetRecord} from '../domain/types';

/** One actual set as written in History and Records: "60 kg × 8", "BW × 12", "45 s". */
export function setLabel(set: SetRecord, type: ExerciseType) {
  if (isTimed(type))
    return `${set.seconds ?? '—'} s${set.distance !== null ? ` · ${set.distance} km` : ''}`;
  if (type === 'bodyweight' || set.weight === null) return `BW × ${set.reps ?? '—'}`;
  return `${set.weight} kg${type === 'assisted' ? ' assist.' : ''} × ${set.reps ?? '—'}`;
}
