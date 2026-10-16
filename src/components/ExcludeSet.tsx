import {Ban, Undo2} from 'lucide-react';

import type {ExerciseType, SetRecord} from '../domain/types';
import {setLabel} from '../views/ExerciseDetail';
import {dateLabel} from '../views/WorkoutView';
import {Button} from './ui/button';

export type ExcludeSetHandler = (workoutId: string, setId: string, excluded: boolean) => void;

/** Reversible owner review: drop one recorded set out of analytics, or count it again. */
export function ExcludeSet({
  workoutId,
  date,
  exercise,
  set,
  number,
  type,
  onExclude,
}: {
  workoutId: string;
  date: string;
  exercise: string;
  set: SetRecord;
  number: number;
  type: ExerciseType;
  onExclude: ExcludeSetHandler;
}) {
  const label = `${exercise} set ${number} (${setLabel(set, type)}) on ${dateLabel(date)}`;
  return (
    <Button
      variant='ghost'
      className='exclude-set min-w-11 gap-[5px] justify-self-end px-2 text-[12px] leading-normal'
      aria-label={
        set.excluded ? `Include ${label} in analytics again` : `Exclude ${label} from analytics`
      }
      onClick={() => onExclude(workoutId, set.id, !set.excluded)}
    >
      {set.excluded ? <Undo2 size={15} /> : <Ban size={15} />}
      {set.excluded ? 'Include' : 'Exclude'}
    </Button>
  );
}
