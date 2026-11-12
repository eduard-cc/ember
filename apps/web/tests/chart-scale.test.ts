import {describe, expect, it} from 'vitest';

import {
  chartDomain,
  compactTick,
  initialRange,
  monthTicks,
  rangeStart,
} from '../src/domain/chart-scale';

describe('chart scales', () => {
  it('pads positive values with distinct round ticks, including small changes and flat series', () => {
    for (const values of [
      [100.01, 100.02],
      [100.00001, 100.00002],
      [75, 75],
      [0],
      [0, 2000],
      [1200, 1220],
      [20000.2, 20000.3],
      [149240, 180000],
    ]) {
      const {domain, ticks} = chartDomain(values);
      expect(domain[0]).toBeGreaterThanOrEqual(0);
      expect(domain[0]).toBeLessThanOrEqual(Math.min(...values));
      expect(domain[1]).toBeGreaterThan(Math.max(...values));
      expect(ticks.length).toBeGreaterThanOrEqual(3);
      expect(new Set(ticks).size).toBe(ticks.length);
      expect(new Set(ticks.map(compactTick)).size).toBe(ticks.length);
      expect(ticks.every((t) => t >= domain[0] && t <= domain[1])).toBe(true);
    }
  });
  it('uses calendar month ticks within the time range, with a tick for short histories', () => {
    const from = new Date(2026, 7, 12).getTime();
    const to = new Date(2026, 10, 4).getTime();
    expect(monthTicks(from, to).map((t) => new Date(t).getMonth())).toEqual([8, 9, 10]);
    expect(monthTicks(from, from)).toEqual([from]);
  });
  it('opens on the last three months, widening until two workouts fall inside the range', () => {
    const today = new Date(2026, 10, 9, 18);
    const at = (...dates: string[]) =>
      dates.map((date, i) => ({workoutId: `w${i}`, date: `${date}T18:00:00`}));
    expect(rangeStart('90', today)).toBe('2026-08-11');
    expect(rangeStart('all', today)).toBeNull();
    expect(initialRange(at('2026-11-02', '2026-10-26'), today)).toBe('90');
    expect(initialRange(at('2026-11-02', '2026-06-01'), today)).toBe('180');
    expect(initialRange(at('2026-03-08', '2026-03-01'), today)).toBe('365');
    expect(initialRange(at('2026-11-02', '2024-01-01'), today)).toBe('all');
    expect(initialRange([], today)).toBe('all');
    // Two blocks of one workout are one session on the chart.
    const repeated = {workoutId: 'repeat', date: '2026-11-02T18:00:00'};
    expect(
      initialRange([repeated, repeated, {workoutId: 'june', date: '2026-06-01T18:00:00'}], today),
    ).toBe('180');
  });
});
