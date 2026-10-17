import type {HTMLAttributes} from 'react';

import {cn} from '../../utils/cn';

/** The small muted heading above a list or block ("Recent", "12 exercises"). */
export function ListLabel({className, ...props}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn('mt-[22px] mb-2.5 text-[12px] font-medium text-muted-foreground', className)}
      {...props}
    />
  );
}
