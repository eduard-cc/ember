import {estimate1RM} from '../domain/model';
import type {ExerciseType, SetRecord} from '../domain/types';
import {cn} from '../utils/cn';
import {setText} from '../utils/set-label';
import {Spoken} from './exercise-line';

const valueHeading: Record<ExerciseType, string> = {
  weighted: 'Weight × reps',
  assisted: 'Assistance × reps',
  bodyweight: 'Reps',
  duration: 'Time',
  cardio: 'Distance · time',
};

/**
 * One exercise block's numbered sets, as the workout drawer shows them: the actual set, plus the
 * bounded Epley estimate for weighted work.
 */
export function RecordedSets({
  sets,
  type,
  className,
}: {
  sets: SetRecord[];
  type: ExerciseType;
  className?: string;
}) {
  const weighted = type === 'weighted';
  return (
    <table className={cn('recorded-sets w-full text-sm tabular-nums', className)}>
      <thead>
        <tr className='text-[11px] text-muted-foreground'>
          <th scope='col' className='w-12 py-1.5 text-left font-normal'>
            Set
          </th>
          <th scope='col' className='py-1.5 text-left font-normal'>
            {valueHeading[type]}
          </th>
          {weighted && (
            <th scope='col' className='py-1.5 text-right font-normal'>
              Est. 1RM
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {sets.map((set, j) => {
          const estimate = weighted ? estimate1RM(set, type) : null;
          return (
            <tr key={set.id} className='border-t border-border'>
              <td className='h-10 text-muted-foreground'>{j + 1}</td>
              <td className='font-semibold [overflow-wrap:anywhere]'>
                <Spoken value={setText(set, type)} />
              </td>
              {weighted && (
                <td className='text-right text-muted-foreground'>
                  {estimate === null ? '—' : `${Number(estimate.toFixed(1))} kg`}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
