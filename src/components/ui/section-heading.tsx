import type {HTMLAttributes} from 'react';

import {cn} from '../../utils/cn';

/** A title row with an action or a caption on the right. */
export function SectionHeading({className, ...props}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-[15px] [&>span]:text-[12px] [&>span]:text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
