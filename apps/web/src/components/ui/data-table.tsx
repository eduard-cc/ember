import type {ButtonHTMLAttributes} from 'react';

import {cn} from '../../utils/cn';

/** A compact exact-value table: muted medium headers, hairline rows, tabular numbers. */
export const dataTableClass =
  'w-full border-collapse text-left tabular-nums [&_td]:border-b [&_td]:border-border [&_td]:px-1 [&_td]:py-2 [&_td]:text-[12px] [&_th]:border-b [&_th]:border-border [&_th]:px-1 [&_th]:py-2 [&_th]:text-[12px] [&_th]:font-medium [&_th]:text-muted-foreground';

/** A small primary-coloured inline button for "view the source workout" links inside tables. */
export function TextAction({className, ...props}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        'text-action inline-flex min-h-11 items-center gap-1 border-none bg-transparent px-0 py-2 text-[12px] text-primary',
        className,
      )}
      {...props}
    />
  );
}
