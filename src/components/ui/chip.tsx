import {forwardRef} from 'react';
import type {ButtonHTMLAttributes, HTMLAttributes} from 'react';

import {cn} from '../../utils/cn';

/** A horizontally scrolling row of filter chips. */
function ChipRow({className, ...props}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex [scrollbar-width:none] gap-2 overflow-x-auto pt-3 pb-0.5', className)}
      {...props}
    />
  );
}

/** A toggle chip; `aria-pressed` drives the selected look. */
const Chip = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  ({className, ...props}, ref) => (
    <button
      ref={ref}
      className={cn(
        'min-h-11 min-w-11 shrink-0 rounded-none border border-border bg-transparent px-3 text-xs font-medium text-muted-foreground hover:bg-accent aria-pressed:bg-secondary aria-pressed:font-semibold aria-pressed:text-secondary-foreground',
        className,
      )}
      {...props}
    />
  ),
);
Chip.displayName = 'Chip';

export {Chip, ChipRow};
