import type {FieldsetHTMLAttributes} from 'react';

import {cn} from '../../utils/cn';

/** A fieldset that only disables its content, with no frame. `content-fieldset` stays as a hook for descendant selectors. */
export function ContentFieldset({
  className,
  ...props
}: FieldsetHTMLAttributes<HTMLFieldSetElement>) {
  return (
    <fieldset
      className={cn('content-fieldset m-0 min-w-0 border-none p-0', className)}
      {...props}
    />
  );
}
