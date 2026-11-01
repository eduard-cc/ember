import {describe, expect, it} from 'vitest';

import {fullDateTime, monthLabel, relativeDay, weekdayLabel} from '../src/utils/date';

describe('History and template dates', () => {
  it('label months, weekdays and the full local date and time of a stored timestamp', () => {
    expect(monthLabel('2026-10-31T23:30:00')).toBe('October 2026');
    expect(weekdayLabel('2026-10-31T23:30:00')).toBe('Sat');
    expect(fullDateTime('2026-10-31T18:05:00')).toBe('Saturday, 31 October 2026 at 18:05');
    // A bare day has no time and never shifts to a neighbouring day.
    expect(fullDateTime('2026-10-31')).toBe('Saturday, 31 October 2026');
    expect(monthLabel('2026-11-01')).toBe('November 2026');
  });
  it('say how long ago a template was last done in days, then by date', () => {
    const now = new Date(2026, 10, 1, 0, 30);
    expect(relativeDay('2026-11-01T00:10:00', now)).toBe('today');
    expect(relativeDay('2026-10-31T23:50:00', now)).toBe('yesterday');
    expect(relativeDay('2026-10-26T12:00:00', now)).toBe('6 days ago');
    expect(relativeDay('2026-10-25T12:00:00', now)).toBe('25 Oct 2026');
  });
});
