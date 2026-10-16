import * as Dialog from '@radix-ui/react-dialog';
import {ArrowUpRight, X} from 'lucide-react';
import {useId, useMemo, useState} from 'react';

import {bestComparable, getHistory, nearestRecorded} from '../domain/model';
import type {Dataset, ExerciseLog, SetRecord} from '../domain/types';
import {useBackLayer} from '../state/back';
import {dateLabel} from '../views/WorkoutView';
import {Button} from './ui/button';

function recorded(set: SetRecord, type: ExerciseLog['type']) {
  if (type === 'duration' || type === 'cardio')
    return `${set.seconds ?? '—'} s${type === 'cardio' ? ` · ${set.distance ?? '—'} km` : ''}`;
  return `${type === 'bodyweight' ? 'BW' : `${set.weight ?? '—'} kg${type === 'assisted' ? ' assistance' : ''}`} × ${set.reps ?? '—'}`;
}

/** Only actual matching variant/type evidence, never an inferred equivalent. */
export function PreviousSet({
  dataset,
  exercise,
  set,
  index,
  onSource,
}: {
  dataset: Dataset;
  exercise: ExerciseLog;
  set: SetRecord;
  index: number;
  onSource: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  useBackLayer(open, () => setOpen(false));
  // Every row re-renders per keystroke: scan history once per dataset/exercise, not per render.
  const previous = useMemo(
    () => getHistory(dataset, exercise.name).find((session) => session.type === exercise.type),
    [dataset, exercise.name, exercise.type],
  );
  const previousSet = previous?.sets[index];
  const timed = exercise.type === 'duration' || exercise.type === 'cardio';
  // The exact-weight lookup is only needed while the evidence dialog is open.
  const comparable =
    open && !timed && (exercise.type === 'bodyweight' || set.weight !== null)
      ? bestComparable(
          {
            ...dataset,
            workouts: dataset.workouts.map((workout) => ({
              ...workout,
              exercises: workout.exercises.filter((ex) => ex.type === exercise.type),
            })),
          },
          exercise.name,
          exercise.type === 'bodyweight' ? null : set.weight,
        )
      : null;
  // Only when the chosen weight has no counted history: actual neighbours, never an estimate.
  const nearest =
    open && !comparable && set.weight !== null && Number.isFinite(set.weight)
      ? nearestRecorded(dataset, exercise.name, exercise.type, set.weight)
      : null;
  const nearestId = useId();
  const source = (id: string) => {
    setOpen(false);
    onSource(id);
  };
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          className='set-previous min-h-11 border-0 bg-transparent px-0.5 text-center text-[12px] leading-[1.3] text-muted-foreground tabular-nums'
          aria-label={`Previous for ${exercise.name} set ${index + 1}`}
        >
          {previousSet ? recorded(previousSet, exercise.type) : '—'}
          {previousSet?.suspicious ? ' · flagged' : ''}
          {previousSet?.excluded ? ' · excluded' : ''}
          {previousSet && (
            <span className='mt-[3px] block text-[11px]'>{dateLabel(previous.date)}</span>
          )}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className='dialog-overlay' />
        <Dialog.Content className='dialog-content source-dialog'>
          <Dialog.Title>
            {exercise.name} · set {index + 1}
          </Dialog.Title>
          <Dialog.Description>
            Recorded evidence for this set. No equivalent performance is inferred.
          </Dialog.Description>
          {!timed && (
            <section className='source-evidence mt-[22px] border-t border-border pt-[18px]'>
              <h3>
                {exercise.type === 'bodyweight'
                  ? 'Best at bodyweight'
                  : `Best at ${set.weight ?? '—'} kg${exercise.type === 'assisted' ? ' assistance' : ''}`}
              </h3>
              {comparable ? (
                <>
                  <p>
                    {recorded(comparable.set, exercise.type)}
                    {comparable.set.suspicious ? ' · flagged' : ''} · {dateLabel(comparable.date)}
                  </p>
                  <Button
                    variant='ghost'
                    aria-label={`View source workout ${comparable.workoutName}`}
                    onClick={() => source(comparable.workoutId)}
                  >
                    {comparable.workoutName}
                    <ArrowUpRight size={16} />
                  </Button>
                </>
              ) : (
                <p>
                  {exercise.type === 'bodyweight'
                    ? 'No exact-weight history'
                    : set.weight === null || !Number.isFinite(set.weight)
                      ? 'Enter a weight to compare'
                      : `No counted sets at ${set.weight} kg${exercise.type === 'assisted' ? ' assistance' : ''}`}
                </p>
              )}
            </section>
          )}
          {nearest && (nearest.below || nearest.above) && (
            <section
              className='source-evidence mt-[22px] border-t border-border pt-[18px]'
              aria-labelledby={`${nearestId}-title`}
            >
              <h3 id={`${nearestId}-title`}>Nearest recorded</h3>
              <p>
                These are actual sets at other weights, not an equivalent for {set.weight} kg
                {exercise.type === 'assisted' ? ' assistance' : ''}.
              </p>
              <ul className='nearest-list mt-3 grid gap-3.5 tabular-nums'>
                {(
                  [
                    [exercise.type === 'assisted' ? 'Less assistance' : 'Lighter', nearest.below],
                    [exercise.type === 'assisted' ? 'More assistance' : 'Heavier', nearest.above],
                  ] as const
                ).map(([label, entry]) =>
                  entry ? (
                    <li key={label} className='grid gap-0'>
                      <span>
                        <strong>{label}</strong> {recorded(entry.set, exercise.type)}
                        {entry.set.suspicious ? ' · flagged' : ''} · {dateLabel(entry.date)}
                      </span>
                      <Button
                        variant='ghost'
                        className='justify-self-start'
                        aria-label={`View source workout ${entry.workoutName} (${label.toLowerCase()})`}
                        onClick={() => source(entry.workoutId)}
                      >
                        {entry.workoutName}
                        <ArrowUpRight size={16} />
                      </Button>
                    </li>
                  ) : null,
                )}
              </ul>
            </section>
          )}
          <section className='source-evidence mt-[22px] border-t border-border pt-[18px]'>
            <h3>Previous session</h3>
            {previous ? (
              <>
                <p>
                  {dateLabel(previous.date)} · {previous.workoutName}
                </p>
                <ol className='source-set-list pl-5 text-[14px] text-muted-foreground tabular-nums'>
                  {previous.sets.map((record, i) => (
                    <li key={record.id}>
                      Set {i + 1}: {recorded(record, exercise.type)}
                      {record.suspicious ? ' · flagged' : ''}
                      {record.excluded ? ' · excluded' : ''}
                    </li>
                  ))}
                </ol>
                <Button
                  variant='ghost'
                  aria-label={`View source workout ${previous.workoutName}`}
                  onClick={() => source(previous.workoutId)}
                >
                  View source workout <ArrowUpRight size={16} />
                </Button>
              </>
            ) : (
              <p>No matching history yet. Your targets are not historical records.</p>
            )}
          </section>
          <Dialog.Close asChild>
            <Button
              variant='ghost'
              size='icon'
              className='dialog-close'
              aria-label='Close previous sets'
            >
              <X size={20} />
            </Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
