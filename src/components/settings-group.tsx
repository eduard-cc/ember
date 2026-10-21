import type {HTMLAttributes, ReactNode} from 'react';

import {cn} from '../utils/cn';

/**
 * A titled settings group: a small heading and optional one-line
 * context above the group's content. Gym Log adds `action`, a control on the title row (Add weight,
 * Import CSV), so a long description keeps the full width under it. `titleAs` is the title's
 * heading level: `h3` inside the Settings dialog, whose own title is an `h2`.
 */
export function SettingsGroup({
  id,
  title,
  titleAs: Title = 'h2',
  description,
  action,
  children,
}: {
  id: string;
  title: string;
  titleAs?: 'h2' | 'h3';
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <div className='mb-3 min-w-0'>
        <div className='flex items-center justify-between gap-3'>
          <Title id={id} className='min-w-0 text-card-title'>
            {title}
          </Title>
          {action && <div className='shrink-0'>{action}</div>}
        </div>
        {description && <p className='mt-1 text-sm text-muted-foreground'>{description}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * Rows of one group share a single bordered surface. `divide-border` and `border-border` are
 * explicit because Gym Log has no global border-color default; the radius is 0.
 */
export function SettingsList({
  as: Tag = 'div',
  className,
  ...props
}: HTMLAttributes<HTMLElement> & {as?: 'div' | 'ul'}) {
  return (
    <Tag
      className={cn('divide-y divide-border border border-border bg-card', className)}
      {...props}
    />
  );
}

/** One row's box. Exported for rows that are themselves a button. */
export const settingsRowClass = 'flex min-h-16 items-center justify-between gap-4 px-4 py-3';

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
