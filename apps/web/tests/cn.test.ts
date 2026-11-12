import {describe, expect, it} from 'vitest';

import {cn} from '../src/utils/cn';

describe('cn', () => {
  it('lets a named type style replace a Tailwind font size', () => {
    expect(cn('text-sm', 'text-label')).toBe('text-label');
  });

  it('keeps a named type style beside a text colour', () => {
    expect(cn('text-label', 'text-muted-foreground')).toBe('text-label text-muted-foreground');
  });

  it('drops falsy inputs and keeps the last conflicting utility', () => {
    const wide = Boolean(0);
    expect(cn('px-2', wide && 'px-4', 'px-3')).toBe('px-3');
  });
});
