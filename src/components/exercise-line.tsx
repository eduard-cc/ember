import {type LucideIcon, Trophy} from 'lucide-react';
import type {ReactNode} from 'react';

import {bodyPartOf} from '../catalog/catalog';
import type {ExerciseLog} from '../domain/types';
import {cn} from '../utils/cn';
import {type SetText, performedLine, plannedLine} from '../utils/set-label';
import {ExerciseThumb} from './ExerciseThumb';

/** Shown text, with the spoken form for screen readers when the text abbreviates it. */
export function Spoken({value}: {value: SetText}) {
  if (!value.spoken) return value.text;
  return (
    <>
      <span aria-hidden='true'>{value.text}</span>
      <span className='sr-only'>{value.spoken}</span>
    </>
  );
}

/**
 * One exercise in a History, Templates or celebration list: the 40px drawing, the name (two
 * lines at most) and body part, and on the right in tabular numerals the work. Finished work
 * shows its top set over its set count; a plan (`planned`) shows what Start will prefill.
 */
export function ExerciseLine({
  exercise,
  planned = false,
  record = false,
  className,
}: {
  exercise: ExerciseLog;
  planned?: boolean;
  /** The exercise set a personal record in this workout. */
  record?: boolean;
  className?: string;
}) {
  const {top, sub} = planned ? plannedLine(exercise) : performedLine(exercise);
  return (
    <li className={cn('exercise-line flex min-h-13 items-center gap-3 py-1', className)}>
      <ExerciseThumb name={exercise.name} className='size-10' />
      <div className='min-w-0 flex-1'>
        <p className='line-clamp-2 text-sm leading-snug font-medium [overflow-wrap:anywhere] text-foreground'>
          {exercise.name}
        </p>
        <p className='text-[12px] text-muted-foreground'>{bodyPartOf(exercise.name)}</p>
      </div>
      <div className='shrink-0 text-right whitespace-nowrap'>
        <p className='flex items-center justify-end gap-1 text-sm font-semibold text-foreground tabular-nums'>
          {record && (
            <Trophy
              size={14}
              className='shrink-0 text-primary'
              aria-label='Personal record'
              role='img'
            />
          )}
          <span>
            <Spoken value={top} />
          </span>
        </p>
        {sub && <p className='text-[12px] text-muted-foreground tabular-nums'>{sub}</p>}
      </div>
    </li>
  );
}

/** A History or Templates card's stat: a 14px icon and a muted tabular value. */
export function Stat({
  icon: Icon,
  children,
  className,
}: {
  icon: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[12px] text-muted-foreground tabular-nums',
        className,
      )}
    >
      <Icon size={14} className='shrink-0' aria-hidden />
      {children}
    </span>
  );
}
