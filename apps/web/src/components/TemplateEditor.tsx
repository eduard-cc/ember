import {useRef, useState} from 'react';

import type {Dataset, Workout} from '../domain/types';
import {plural} from '../utils/plural';
import {WorkoutView} from '../views/WorkoutView';
import {AddExercise} from './AddExercise';
import {EditorPanel} from './EditorPanel';

export function TemplateEditor({
  workout,
  dataset,
  existing,
  disabled,
  onSave,
  onClose,
  onCloseAutoFocus,
}: {
  workout: Workout;
  dataset: Dataset;
  existing: boolean;
  disabled: boolean;
  onSave: (next: Workout) => Promise<boolean>;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const [draft, setDraft] = useState(() => ({
    ...workout,
    name: workout.name === 'Untitled workout' ? '' : workout.name,
  }));
  const [initial] = useState(() => JSON.stringify(draft));
  const [deletingSets, setDeletingSets] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const nameField = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(draft) !== initial;
  // Shown once Save is pressed, each where it is fixed, until it is.
  const missingName = attempt > 0 && (!draft.name.trim() || draft.name === 'Untitled workout');
  const missingExercises = attempt > 0 && !draft.exercises.length;
  const sets = draft.exercises.reduce((n, ex) => n + ex.sets.length, 0);
  const save = async () => {
    // An unchanged template has nothing to save; a new one always says what it still needs.
    if (existing && !dirty) return onClose();
    setAttempt((n) => n + 1);
    // This press's own problem replaces an earlier failure.
    setFailed(false);
    if (!draft.name.trim() || draft.name === 'Untitled workout') {
      nameField.current?.focus();
      return;
    }
    if (!draft.exercises.length) return;
    setSaving(true);
    const clean = {
      ...draft,
      exercises: draft.exercises.map((ex) => ({
        ...ex,
        sets: ex.sets.map((set) => ({...set, completed: false})),
      })),
    };
    const saved = await onSave(clean);
    setSaving(false);
    if (saved) onClose();
    else setFailed(true);
  };
  return (
    <EditorPanel
      title={existing ? 'Edit template' : 'New template'}
      description='Set a name, exercises and editable targets for this template.'
      className='template-editor'
      closeLabel='Close template editor'
      nameLabel='Template name'
      name={draft.name}
      namePlaceholder='Template name'
      nameProblem={missingName ? 'Enter a template name.' : undefined}
      nameRef={nameField}
      onNameChange={(name) => setDraft((current) => ({...current, name}))}
      meta={
        <span>
          <strong className='font-medium text-foreground'>
            {plural(draft.exercises.length, 'exercise')}
          </strong>{' '}
          · {plural(sets, 'set')}
        </span>
      }
      saveLabel='Save template'
      failed={failed}
      problem={failed ? 'Template not saved. Keep this editor open and retry.' : undefined}
      attempt={attempt}
      dirty={dirty}
      disabled={disabled}
      saveDisabled={deletingSets}
      busy={saving}
      discardItem={existing ? workout.name : 'this template'}
      onSave={() => void save()}
      onClose={onClose}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <WorkoutView
        targetsOnly
        exerciseScope='template'
        workout={draft}
        dataset={dataset}
        disabled={disabled || saving}
        onChange={setDraft}
        onDeletingChange={setDeletingSets}
      />
      {!draft.exercises.length && (
        <p className='px-4 pt-8 pb-2 text-center text-[14px]'>
          Add the exercises this template starts with.
        </p>
      )}
      <div className='flex flex-col gap-3 px-4 pt-[18px] pb-[30px]'>
        <AddExercise
          dataset={dataset}
          workoutName={draft.name}
          scope='template'
          existingNames={draft.exercises.map((ex) => ex.name)}
          onAdd={(exercise) =>
            setDraft((current) => ({...current, exercises: [...current.exercises, exercise]}))
          }
        />
        {missingExercises && (
          <p className='add-exercise-problem text-center text-[14px] text-destructive'>
            Add an exercise.
          </p>
        )}
      </div>
    </EditorPanel>
  );
}
