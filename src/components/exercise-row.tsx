import type {ReactNode} from 'react';

/** The shared exercise row: thumb, name and body part, optionally a count. */
export const exerciseRowClass =
  'exercise-row flex min-h-15 w-full items-center gap-3 border-0 border-b border-b-border bg-transparent px-1 py-2 text-left text-inherit';

export function ExerciseRowText({title, subtitle}: {title: ReactNode; subtitle: ReactNode}) {
  return (
    <span className='exercise-row-text flex min-w-0 flex-col gap-0.5'>
      {/* Long names wrap to two lines before truncating, so a 3-4 digit count never squeezes them. */}
      <strong className='line-clamp-2 text-[16px] leading-[1.25] font-medium [overflow-wrap:anywhere]'>
        {title}
      </strong>
      <small className='text-[12px] text-muted-foreground'>{subtitle}</small>
    </span>
  );
}
