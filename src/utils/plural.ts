/** `1 set`, `2 sets`; keeps the noun's case (`1 EXERCISE`, `3 EXERCISES`). */
export const plural = (count: number, noun: string) =>
  `${count} ${count === 1 ? noun : noun + (noun === noun.toUpperCase() ? 'S' : 's')}`;
