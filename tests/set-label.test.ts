import {describe, expect, it} from 'vitest';

import type {ExerciseType, SetRecord} from '../src/domain/types';
import {performedLine, plannedLine, setText} from '../src/utils/set-label';

// Synthetic sets only.
const set = (weight: number | null, reps: number | null, extra = {}): SetRecord => ({
  id: crypto.randomUUID(),
  weight,
  reps,
  seconds: null,
  distance: null,
  ...extra,
});
const log = (type: ExerciseType, sets: SetRecord[]) => ({name: 'Synthetic', type, sets});

describe('History exercise rows', () => {
  it('show the top set as an actual set over the set count, assistance spoken in full', () => {
    expect(performedLine(log('weighted', [set(60, 10), set(75, 6), set(75, 8)]))).toEqual({
      top: {text: '75 kg × 8'},
      sub: '3 sets',
    });
    expect(performedLine(log('assisted', [set(30, 10), set(20, 8)]))).toEqual({
      top: {text: '−20 kg × 8', spoken: '20 kg assistance × 8'},
      sub: '2 sets',
    });
    expect(performedLine(log('bodyweight', [set(null, 12)])).top).toEqual({text: '12 reps'});
    expect(performedLine(log('duration', [set(null, null, {seconds: 60})])).top).toEqual({
      text: '60 s',
    });
    expect(
      performedLine(log('cardio', [set(null, null, {seconds: 300, distance: 1.2})])).top,
    ).toEqual({text: '1.2 km · 5:00'});
    // Recorded fractions of a second are kept, never rounded into a 60th second.
    expect(setText(set(null, null, {seconds: 299.5, distance: 1.2}), 'cardio').text).toBe(
      '1.2 km · 4:59.5',
    );
    expect(setText(set(null, null, {seconds: 61.1, distance: null}), 'cardio').text).toBe('1:01.1');
    expect(setText(set(null, null, {seconds: 1800.1, distance: null}), 'cardio').text).toBe(
      '30:00.1',
    );
    expect(performedLine(log('weighted', []))).toEqual({top: {text: '—'}, sub: '0 sets'});
    // Every set in the workout drawer uses the same wording.
    expect(setText(set(52.5, 6), 'weighted')).toEqual({text: '52.5 kg × 6'});
  });
});

describe('Template exercise rows', () => {
  it('show the prescription: one load over its reps, or the top target when loads vary', () => {
    expect(plannedLine(log('weighted', [set(72.5, 8), set(72.5, 8), set(72.5, 8)]))).toEqual({
      top: {text: '72.5 kg'},
      sub: '3 × 8 reps',
    });
    expect(plannedLine(log('weighted', [set(60, 9), set(60, 9), set(60, 7)])).sub).toBe(
      '9 · 9 · 7 reps',
    );
    // Varied loads never sit next to reps they aren't paired with.
    expect(plannedLine(log('weighted', [set(60, 10), set(80, 6)]))).toEqual({
      top: {text: '80 kg × 6'},
      sub: '2 sets',
    });
    expect(plannedLine(log('assisted', [set(20, 8), set(20, 8)])).top).toEqual({
      text: '−20 kg',
      spoken: '20 kg assistance',
    });
    expect(plannedLine(log('bodyweight', [set(null, 12), set(null, 12)]))).toEqual({
      top: {text: 'Bodyweight'},
      sub: '2 × 12 reps',
    });
    expect(
      plannedLine(
        log('duration', [set(null, null, {seconds: 45}), set(null, null, {seconds: 60})]),
      ),
    ).toEqual({top: {text: '45–60 s'}, sub: '2 sets'});
    // Blank targets (no history, nothing planned) show only the set count.
    expect(plannedLine(log('weighted', [set(null, null), set(null, null)]))).toEqual({
      top: {text: '2 sets'},
      sub: '',
    });
    expect(plannedLine(log('cardio', [set(null, null, {distance: 0})]))).toEqual({
      top: {text: '1 set'},
      sub: '',
    });
  });
});
