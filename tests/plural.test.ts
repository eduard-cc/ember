import {describe, expect, it} from 'vitest';

import {plural} from '../src/components/ui';

describe('count labels', () => {
  it('uses the singular only for exactly one', () => {
    expect(plural(1, 'set')).toBe('1 set');
    expect(plural(0, 'set')).toBe('0 sets');
    expect(plural(3, 'EXERCISE')).toBe('3 EXERCISES');
    expect(plural(1, 'EXERCISE')).toBe('1 EXERCISE');
  });
});
