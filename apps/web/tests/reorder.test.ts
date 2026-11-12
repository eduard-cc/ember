import {describe, expect, it} from 'vitest';

import {moveItem, reorderShift, reorderTarget} from '../src/domain/reorder';

describe('exercise reordering', () => {
  it('moves an item down, up, or nowhere without mutating the original', () => {
    const items = ['a', 'b', 'c', 'd'];
    expect(moveItem(items, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(items, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(items, 1, 1)).toEqual(items);
    expect(moveItem(items, 1, 99)).toEqual(['a', 'c', 'd', 'b']);
    expect(moveItem(items, 2, -5)).toEqual(['c', 'a', 'b', 'd']);
    expect(items).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps object identity, so per-exercise state follows the moved exercise', () => {
    const first = {name: 'Bench'};
    const second = {name: 'Row'};
    const moved = moveItem([first, second], 0, 1);
    expect(moved[1]).toBe(first);
    expect(moved[0]).toBe(second);
  });

  it('picks the slot whose centre the dragged row has crossed, clamped to the list', () => {
    expect(reorderTarget(0, 56, 5)).toBe(0);
    expect(reorderTarget(27, 56, 5)).toBe(0);
    expect(reorderTarget(29, 56, 5)).toBe(1);
    expect(reorderTarget(-200, 56, 5)).toBe(0);
    expect(reorderTarget(10_000, 56, 5)).toBe(4);
  });

  it('shifts only the items between the old and new slot', () => {
    // Moving 1 → 3: items 2 and 3 move up a slot.
    expect([0, 1, 2, 3, 4].map((i) => reorderShift(i, 1, 3))).toEqual([0, 0, -1, -1, 0]);
    // Moving 3 → 1: items 1 and 2 move down a slot.
    expect([0, 1, 2, 3, 4].map((i) => reorderShift(i, 3, 1))).toEqual([0, 1, 1, 0, 0]);
    expect([0, 1, 2].map((i) => reorderShift(i, 1, 1))).toEqual([0, 0, 0]);
  });
});
