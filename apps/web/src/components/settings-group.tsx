import type {HTMLAttributes, ReactNode} from 'react';

import {cn} from '../utils/cn';

/**
 * A titled settings group: a small heading and optional one-line
 * context above the group's content. `titleAs` is the title's heading level: `h3` inside the
 * Settings dialog, whose own title is an `h2`.
 */
export function SettingsGroup({
  id,
  title,
  titleAs: Title = 'h2',
  description,
  children,
}: {
  id: string;
  title: string;
  titleAs?: 'h2' | 'h3';
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <div className='mb-3 min-w-0'>
        <Title id={id} className='min-w-0 text-card-title'>
          {title}
        </Title>
        {description && <p className='mt-1 text-sm text-muted-foreground'>{description}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * Rows of one group share a single bordered surface. `divide-border` and `border-border` are
 * explicit because Ember has no global border-color default.
 */
export function SettingsList({
  as: Tag = 'div',
  className,
  ...props
}: HTMLAttributes<HTMLElement> & {as?: 'div' | 'ul'}) {
  return (
    <Tag
      className={cn('divide-y divide-border rounded-card border border-border bg-card', className)}
      {...props}
    />
  );
}

/** One row's box. Exported for rows that are themselves a button. */
export const settingsRowClass = 'flex min-h-16 items-center justify-between gap-4 px-4 py-3';

/** The drawn switch inside a row that is itself the `role='switch'` button. */
export function SwitchTrack({on}: {on: boolean}) {
  return (
    <span
      aria-hidden='true'
      className={cn(
        'relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200',
        // Off keeps a muted-foreground outline and knob, so its shape stays above 3:1.
        on ? 'bg-primary' : 'bg-muted shadow-[inset_0_0_0_1px_hsl(var(--muted-foreground))]',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 size-6 rounded-full shadow-sm transition-transform duration-200 ease-(--ease-out)',
          on ? 'translate-x-5 bg-background' : 'bg-muted-foreground',
        )}
      />
    </span>
  );
}

/** On a phone a long label and value take the full width and the action drops below them. */
export function SettingsRow({
  label,
  value,
  action,
}: {
  label: ReactNode;
  value?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={cn(settingsRowClass, 'flex-wrap')}>
      <div className='min-w-0 flex-[1_1_12rem]'>
        <p className='text-sm font-medium text-foreground'>{label}</p>
        {value && <p className='mt-0.5 text-sm wrap-break-word text-muted-foreground'>{value}</p>}
      </div>
      {action && <div className='shrink-0'>{action}</div>}
    </div>
  );
}
