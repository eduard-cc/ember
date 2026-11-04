import {useMemo, useRef, useState} from 'react';

import {LOCAL_TIME, editableCopy, editedHistory} from '../domain/history-edit';
import type {Dataset, Workout} from '../domain/types';
import {weekdayDateLabel} from '../utils/date';
import {plural} from '../utils/plural';
import {WorkoutView} from '../views/WorkoutView';
import {AddExercise} from './AddExercise';
import {EditorPanel} from './EditorPanel';
import {Input} from './ui/input';

const NAME_PROBLEM = 'Give the workout a name.';
const fieldLabel = 'text-[12px] font-medium text-muted-foreground';

/** Edit finished history with its original identity and evidence, never completion toggles. */
export function HistoryEditor({
  workout,
  dataset,
  disabled,
  onSave,
  onClose,
  onCloseAutoFocus,
  backLabel,
}: {
  workout: Workout;
  dataset: Dataset;
  disabled: boolean;
  onSave: (base: Workout, next: Workout) => Promise<boolean>;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
  /** Set while the workout's drawer is underneath: dismissing goes back to it. */
  backLabel?: string;
}) {
  const [draft, setDraft] = useState(() => editableCopy(workout));
  const [initial] = useState(() => JSON.stringify(draft));
  const [deletingSets, setDeletingSets] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const nameField = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(draft) !== initial;
  const {workout: next, problem} = editedHistory(workout, draft);
  // The stored sets, so changed values and added sets can be marked.
  const original = useMemo(
    () => new Map(workout.exercises.flatMap((ex) => ex.sets.map((set) => [set.id, set] as const))),
    [workout],
  );
  // Previous is the session before this one: this workout and later ones are not its evidence.
  const evidence = useMemo(
    () => ({
      ...dataset,
      workouts: dataset.workouts.filter((w) => w.id !== workout.id && w.date < workout.date),
    }),
    [dataset, workout.id, workout.date],
  );
  // Problems show once Save is pressed, then follow the edits until they are fixed.
  const shown = attempt > 0 && dirty ? problem : null;
  const sets = draft.exercises.reduce((n, ex) => n + ex.sets.length, 0);
  const save = async () => {
    if (!dirty) return onClose();
    setAttempt((n) => n + 1);
    // This press's own problem replaces an earlier failure.
    setFailed(false);
    if (problem) {
      if (problem === NAME_PROBLEM) nameField.current?.focus();
      return;
    }
    setSaving(true);
    const saved = await onSave(workout, next);
    setSaving(false);
    if (saved) onClose();
    else setFailed(true);
  };
  return (
    <EditorPanel
      title='Edit workout'
      description='Change the name, start time, duration, exercises and sets of this finished workout.'
      className='history-editor'
      closeLabel='Close workout editor'
      backLabel={backLabel}
      nameLabel='Workout name'
      name={draft.name}
      nameProblem={shown === NAME_PROBLEM ? shown : undefined}
      nameRef={nameField}
      onNameChange={(name) => setDraft((current) => ({...current, name}))}
      meta={
        <span>
          {weekdayDateLabel(LOCAL_TIME.test(draft.date) ? draft.date : workout.date)} ·{' '}
          <strong className='font-medium text-foreground'>
            {plural(draft.exercises.length, 'exercise')}
          </strong>{' '}
          · {plural(sets, 'set')}
        </span>
      }
      saveLabel='Save changes'
      failed={failed}
      problem={
        failed
          ? 'Workout not saved. Retry, or close and reopen if it changed on another device.'
          : shown && shown !== NAME_PROBLEM
            ? shown
            : undefined
      }
      attempt={attempt}
      dirty={dirty}
      disabled={disabled}
      saveDisabled={deletingSets}
      busy={saving}
      discardItem={workout.name}
      onSave={() => void save()}
      onClose={onClose}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <section
        aria-label='When'
        className='grid grid-cols-[minmax(0,1fr)_7.5rem] gap-3 border-b border-border px-4 pt-4 pb-5 desk:px-6 narrow:px-3'
      >
        <div className='grid min-w-0 gap-1.5'>
          <label className={fieldLabel} htmlFor='history-workout-start'>
            Start
          </label>
          <Input
            id='history-workout-start'
            type='datetime-local'
            step={60}
            value={draft.date}
            onChange={(e) =>
              setDraft({
                ...draft,
                // Untouched seconds stay exact; a picked time has whole minutes.
                date: e.target.value.length === 16 ? e.target.value + ':00' : e.target.value,
              })
            }
          />
        </div>
        <div className='grid min-w-0 gap-1.5'>
          <label className={fieldLabel} htmlFor='history-workout-duration'>
            Duration<span className='sr-only'> (min)</span>
          </label>
          <span className='relative'>
            <Input
              id='history-workout-duration'
              type='number'
              inputMode='numeric'
              min={0}
              step={1}
              className='pr-11 text-right'
              value={Number.isNaN(draft.duration) ? '' : draft.duration}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  duration: e.target.value === '' ? NaN : Number(e.target.value),
                })
              }
            />
            <span
              className='pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[14px] text-muted-foreground'
              aria-hidden='true'
            >
              min
            </span>
          </span>
        </div>
      </section>
      <WorkoutView
        targetsOnly
        workout={draft}
        dataset={dataset}
        evidence={evidence}
        original={original}
        disabled={disabled || saving}
        onChange={setDraft}
        onDeletingChange={setDeletingSets}
      />
      <div className='flex flex-col gap-3 px-4 pt-[18px] pb-[30px]'>
        <AddExercise
          dataset={dataset}
          workoutName={draft.name}
          existingNames={draft.exercises.map((exercise) => exercise.name)}
          onAdd={(exercise) =>
            setDraft((current) => ({...current, exercises: [...current.exercises, exercise]}))
          }
        />
      </div>
    </EditorPanel>
  );
}
