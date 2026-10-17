import type {LucideIcon} from 'lucide-react';
import type {ReactNode} from 'react';

import {cn} from '../../utils/cn';

/** The shared empty state. `empty-state` stays on the root as a test and selector hook. */
export function EmptyState({
  title,
  description,
  icon: Icon,
  tone = 'empty',
  framed = true,
  titleAs: Title = 'h2',
  children,
}: {
  title: string;
  description: string;
  icon?: LucideIcon;
  /** `error` marks a failed load: the icon takes the destructive colour. */
  tone?: 'empty' | 'error';
  /** Drop the card frame where the state already sits on a surface, such as a dialog. */
  framed?: boolean;
  /** The title's heading level; `h3` under a section that has its own `h2`. */
  titleAs?: 'h2' | 'h3';
  /** Action row. */
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'empty-state flex flex-col items-center px-6 text-center',
        // `rounded-card` is omitted: Gym Log's radius is 0. `border-border` is explicit
        // because Gym Log has no global border-color default.
        framed ? 'border border-border bg-card py-16' : 'py-10',
      )}
    >
      {Icon && (
        <Icon
          aria-hidden='true'
          className={cn(
            'mb-5 h-12 w-12',
            tone === 'error' ? 'text-destructive' : 'text-muted-foreground',
          )}
        />
      )}
      <Title className='text-section-title'>{title}</Title>
      <p className='mt-2 max-w-md text-sm text-muted-foreground'>{description}</p>
      {children && <div className='mt-6 flex flex-wrap justify-center gap-3'>{children}</div>}
    </div>
  );
}
