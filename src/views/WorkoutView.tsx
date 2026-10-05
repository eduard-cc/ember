import {Check, Plus, Trash2} from 'lucide-react';
import {useCallback, useRef, useState} from 'react';

import {ExerciseThumb} from '../components/ExerciseThumb';
import {PreviousSet} from '../components/PreviousSet';
import {SetRow} from '../components/SetRow';
import {Button, Input, plural} from '../components/ui';
import type {Dataset, ExerciseLog, ExerciseType, SetRecord, Workout} from '../domain/types';

export function dateLabel(date: string) {
  return new Date(date.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
export function validSet(set: SetRecord, type: ExerciseType) {
  const bounded = (value: number | null, min: number, max: number) =>
    value !== null && Number.isFinite(value) && value >= min && value <= max;
  if (type === 'duration' || type === 'cardio')
    return bounded(set.seconds, 1, 86400) && (type !== 'cardio' || bounded(set.distance, 0, 1000));
  return (
    bounded(set.reps, 1, 1000) &&
    Number.isInteger(set.reps) &&
    (type === 'bodyweight' || bounded(set.weight, 0, 2000))
  );
}
export function WorkoutView({
  workout,
  dataset,
  onChange,
  onSource,
  onDeletingChange,
  targetsOnly = false,
}: {
  workout: Workout;
  dataset: Dataset;
  onChange: (update: Workout | ((current: Workout) => Workout)) => void;
  onSource: (id: string) => void;
  onDeletingChange: (deleting: boolean) => void;
  targetsOnly?: boolean;
}) {
  // Save/Finish must wait for every exit, not just the first animated deletion.
  const deletingSets = useRef(new Set<string>());
  const setDeleting = useCallback(
    (id: string, deleting: boolean) => {
      if (deleting) deletingSets.current.add(id);
      else deletingSets.current.delete(id);
      onDeletingChange(deletingSets.current.size > 0);
    },
    [onDeletingChange],
  );
  const identities = useRef(new WeakMap<ExerciseLog, string>());
  const identity = (exercise: ExerciseLog) => {
    let id = identities.current.get(exercise);
    if (!id) {
      id = crypto.randomUUID();
      identities.current.set(exercise, id);
    }
    return id;
  };
  const changeExercise = (exercise: ExerciseLog, sets: SetRecord[]) => {
    const next = {...exercise, sets};
    identities.current.set(next, identity(exercise));
    return next;
  };
  const [removed, setRemoved] = useState<{
    workoutId: string;
    exerciseId: string;
    name: string;
    set: SetRecord;
    index: number;
    before?: string;
    after?: string;
  } | null>(null);
  const removeSet = (exercise: ExerciseLog, index: number) => {
    setRemoved({
      workoutId: workout.id,
      exerciseId: identity(exercise),
      name: exercise.name,
      set: exercise.sets[index],
      index,
      before: exercise.sets[index - 1]?.id,
      after: exercise.sets[index + 1]?.id,
    });
    const exerciseId = identity(exercise);
    const setId = exercise.sets[index].id;
    // Exits can finish in the same frame. Apply each deletion to the current draft.
    onChange((current) => ({
      ...current,
      exercises: current.exercises.map((ex) =>
        identity(ex) === exerciseId
          ? changeExercise(
              ex,
              ex.sets.filter((set) => set.id !== setId),
            )
          : ex,
      ),
    }));
  };
  // identity() reads a render-stable WeakMap cache of React keys; no React Compiler is in use.
  const canUndo =
    removed?.workoutId === workout.id &&
    // eslint-disable-next-line react-hooks/refs
    workout.exercises.some((ex) => identity(ex) === removed.exerciseId);
  const undo = () => {
    if (!removed || !canUndo) return;
    onChange({
      ...workout,
      exercises: workout.exercises.map((ex) => {
        if (identity(ex) !== removed.exerciseId) return ex;
        const sets = [...ex.sets];
        const after = sets.findIndex((set) => set.id === removed.after),
          before = sets.findIndex((set) => set.id === removed.before);
        sets.splice(
          after >= 0 ? after : before >= 0 ? before + 1 : Math.min(removed.index, sets.length),
          0,
          removed.set,
        );
        return changeExercise(ex, sets);
      }),
    });
    setRemoved(null);
  };
  const edit = (ei: number, si: number, patch: Partial<SetRecord>) =>
    onChange({
      ...workout,
      exercises: workout.exercises.map((ex, i) =>
        i !== ei
          ? ex
          : changeExercise(
              ex,
              ex.sets.map((set, j) =>
                j === si
                  ? {
                      ...set,
                      ...(Object.keys(patch).some((key) => key !== 'completed')
                        ? {completed: false}
                        : {}),
                      ...patch,
                    }
                  : set,
              ),
            ),
      ),
    });
  return (
    <div className='exercise-list'>
      {removed && canUndo && (
        <div className='set-undo' role='status'>
          Removed {removed.name} set {removed.index + 1}
          <Button onClick={undo}>Undo</Button>
        </div>
      )}
      {targetsOnly && (
        <div className='workout-name'>
          <label htmlFor='workout-name'>WORKOUT NAME</label>
          <Input
            id='workout-name'
            value={workout.name}
            onChange={(e) => onChange({...workout, name: e.target.value})}
          />
        </div>
      )}
      {/* eslint-disable-next-line react-hooks/refs -- identity() keys, see canUndo */}
      {workout.exercises.map((ex, ei) => {
        const timed = ex.type === 'cardio' || ex.type === 'duration';
        const checked = ex.sets.filter((set) => set.completed && validSet(set, ex.type)).length;
        const done = ex.sets.length > 0 && checked === ex.sets.length;
        return (
          <section className='exercise-card' key={identity(ex)}>
            <header className='exercise-heading'>
              <ExerciseThumb name={ex.name} />
              <div>
                <h2>{ex.name}</h2>
                {!targetsOnly && (
                  <span
                    role='status'
                    aria-label='Exercise completion'
                    className={done ? 'exercise-done' : 'exercise-count'}
                  >
                    {done ? (
                      <>
                        <Check size={14} />
                        Done
                      </>
                    ) : (
                      `${checked} / ${plural(ex.sets.length, 'set')}`
                    )}
                  </span>
                )}
                <p>
                  {ex.type === 'assisted'
                    ? 'Assistance in kg · less is better'
                    : ex.name.includes('Dumbbell')
                      ? 'Weight per dumbbell · kg'
                      : ex.type === 'bodyweight'
                        ? 'Bodyweight · no added load'
                        : ex.type === 'duration'
                          ? 'Duration in seconds'
                          : ex.type === 'cardio'
                            ? 'Duration in seconds · distance in km'
                            : 'Recorded weight · kg'}
                </p>
              </div>
              <Button
                size='icon'
                variant='ghost'
                aria-label={`Remove ${ex.name}`}
                onClick={() =>
                  onChange({...workout, exercises: workout.exercises.filter((_, i) => i !== ei)})
                }
              >
                <Trash2 size={17} />
              </Button>
            </header>
            <div className='set-table'>
              <div className='set-row set-head'>
                <span>Set</span>
                <span>Previous</span>
                <span>{timed ? 'Seconds' : ex.type === 'assisted' ? 'Assist. kg' : 'kg'}</span>
                <span>{ex.type === 'duration' ? '' : timed ? 'km' : 'Reps'}</span>
                <span>{targetsOnly ? '' : 'Done'}</span>
                <span className='desktop-remove' />
              </div>
              {ex.sets.map((set, si) => (
                <SetRow
                  completed={set.completed}
                  key={set.id}
                  number={si + 1}
                  label={`${ex.name} set ${si + 1}`}
                  onDelete={() => removeSet(ex, si)}
                  onDeletingChange={(deleting) => setDeleting(set.id, deleting)}
                >
                  {targetsOnly ? (
                    <span />
                  ) : (
                    <PreviousSet
                      dataset={dataset}
                      exercise={ex}
                      set={set}
                      index={si}
                      onSource={onSource}
                    />
                  )}
                  <Input
                    type='number'
                    onFocus={(event) => event.currentTarget.select()}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || targetsOnly) return;
                      event.preventDefault();
                      if (ex.type === 'duration') {
                        if (!set.completed && validSet(set, ex.type))
                          edit(ei, si, {completed: true});
                        event.currentTarget.blur();
                      } else {
                        const row = event.currentTarget.closest('.set-row');
                        row?.querySelectorAll('input')[1]?.focus();
                      }
                    }}
                    inputMode={timed ? 'numeric' : 'decimal'}
                    min={timed ? 1 : 0}
                    max={timed ? 86400 : 2000}
                    step={timed ? 1 : 0.5}
                    disabled={ex.type === 'bodyweight'}
                    aria-label={`${timed ? 'Seconds' : 'Weight'} for ${ex.name} set ${si + 1}`}
                    value={(timed ? set.seconds : set.weight) ?? ''}
                    onChange={(e) =>
                      edit(ei, si, {
                        [timed ? 'seconds' : 'weight']:
                          e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                  />
                  {ex.type === 'duration' ? (
                    <span className='duration-unit'>seconds</span>
                  ) : (
                    <Input
                      type='number'
                      onFocus={(event) => event.currentTarget.select()}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' || targetsOnly) return;
                        event.preventDefault();
                        if (!set.completed && validSet(set, ex.type))
                          edit(ei, si, {completed: true});
                        event.currentTarget.blur();
                      }}
                      inputMode={timed ? 'decimal' : 'numeric'}
                      min={timed ? 0 : 1}
                      max='1000'
                      step={timed ? '0.01' : '1'}
                      aria-label={`${timed ? 'Distance in km' : 'Reps'} for ${ex.name} set ${si + 1}`}
                      value={(timed ? set.distance : set.reps) ?? ''}
                      onChange={(e) =>
                        edit(ei, si, {
                          [timed ? 'distance' : 'reps']:
                            e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                    />
                  )}
                  {targetsOnly ? (
                    <span />
                  ) : (
                    <Button
                      size='icon'
                      className='set-check'
                      variant={set.completed ? 'primary' : 'secondary'}
                      aria-pressed={!!set.completed}
                      aria-label={`${set.completed ? 'Uncomplete' : 'Complete'} ${ex.name} set ${si + 1}`}
                      disabled={!set.completed && !validSet(set, ex.type)}
                      onClick={() => edit(ei, si, {completed: !set.completed})}
                    >
                      {set.completed ? (
                        <Check size={19} />
                      ) : (
                        <span className='unchecked-marker' aria-hidden='true' />
                      )}
                    </Button>
                  )}
                </SetRow>
              ))}
            </div>
            <Button
              variant='ghost'
              className='add-set'
              onClick={() =>
                onChange({
                  ...workout,
                  exercises: workout.exercises.map((x, i) =>
                    i !== ei
                      ? x
                      : changeExercise(x, [
                          ...x.sets,
                          {
                            ...(x.sets.at(-1) ?? {
                              weight: null,
                              reps: null,
                              seconds: null,
                              distance: null,
                            }),
                            id: crypto.randomUUID(),
                            completed: false,
                          },
                        ]),
                  ),
                })
              }
            >
              <Plus size={16} /> Add set
            </Button>
          </section>
        );
      })}
    </div>
  );
}
