import type {HTMLAttributes} from 'react';

import {cn} from '../../utils/cn';

/** A short error or status message in a tinted box. The caller sets the top margin, which differs by site. */
export function InlineError({className, ...props}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn('rounded-md bg-destructive-foreground p-3 text-destructive', className)}
      {...props}
    />
  );
}
