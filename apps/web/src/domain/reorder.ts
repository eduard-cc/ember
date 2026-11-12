/** A copy of `items` with the item at `from` moved to `to`; out-of-range `to` is clamped. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= items.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(Math.min(Math.max(to, 0), next.length), 0, item);
  return next;
}

/**
 * Slot the dragged item would land in, from the dragged row's offset (px) from the first slot.
 * It changes slot once its centre crosses into a neighbour, like the finger expects.
 */
export function reorderTarget(offset: number, pitch: number, count: number) {
  return Math.min(Math.max(Math.round(offset / pitch), 0), count - 1);
}

/** How many slots another item shifts (−1 up, +1 down, 0 stays) while one moves from→to. */
export function reorderShift(index: number, from: number, to: number) {
  if (from < to && index > from && index <= to) return -1;
  if (to < from && index >= to && index < from) return 1;
  return 0;
}
