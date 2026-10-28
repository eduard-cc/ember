import type {HTMLAttributes} from 'react';

import {cn} from '../../utils/cn';

/** The flat bordered surface behind a block of content. `border-border` is explicit because Ember has no global border-color default. */
export const cardClass = 'min-w-0 border border-border bg-card p-5';

/** The shared card surface without `rounded-card`: Ember's radius is 0. Use `cardClass` where an element cannot be wrapped. */
export function Card({
  as: Tag = 'div',
  className,
  ...props
}: HTMLAttributes<HTMLElement> & {as?: 'div' | 'section'}) {
  return <Tag className={cn(cardClass, className)} {...props} />;
}
