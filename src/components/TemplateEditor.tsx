import {useEffect, useRef, useState} from 'react';

import type {Dataset, Workout} from '../domain/types';
import {useBackLayer} from '../state/back';
import {plural} from '../utils/plural';
import {WorkoutView} from '../views/WorkoutView';
import {AddExercise} from './AddExercise';
import {EditorPanel} from './EditorPanel';
import {Button} from './ui/button';
import {ContentFieldset} from './ui/content-fieldset';
import {fieldLabelClass} from './ui/field-label';
import {Input} from './ui/input';

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
  const [discardRequest, setDiscardRequest] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const prompt = useRef<HTMLDivElement>(null);
  const lastField = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (discardRequest) prompt.current?.focus({preventScroll: true});
  }, [discardRequest]);
  const close = () => {
    if (saving) return;
    if (JSON.stringify(draft) !== initial) setDiscardRequest((n) => n + 1);
    else onClose();
  };
  const [deletingSets, setDeletingSets] = useState(false);
  useBackLayer(true, close);
  const missingName = !draft.name.trim() || draft.name === 'Untitled workout';
  const missingExercises = !draft.exercises.length;
  const problem = missingName
    ? missingExercises
      ? 'Enter a name and add an exercise.'
      : 'Enter a template name.'
    : missingExercises
      ? 'Add an exercise.'
      : '';
  return (
    <EditorPanel
      title={existing ? 'Edit template' : 'Create a template'}
      description='Set a name, exercises and editable targets for this template.'
      className='template-editor [--row-bg:hsl(var(--card))]'
      onClose={close}
      onCloseAutoFocus={onCloseAutoFocus}
      busy={saving}
      footer={
        <>
          {discardRequest ? (
            <div
              ref={prompt}
              tabIndex={-1}
              role='group'
              aria-label='Discard changes?'
              className='focus-visible:outline-none'
            >
              <p className='mb-2'>Discard your changes to this template?</p>
              <div className='flex flex-wrap gap-2.5'>
                <Button
                  onClick={() => {
                    setDiscardRequest(0);
                    lastField.current?.focus({preventScroll: true});
                  }}
                >
                  Keep editing
                </Button>
                <Button variant='danger' onClick={onClose}>
                  Discard changes
                </Button>
              </div>
            </div>
          ) : (
            <>
              {error && (
                <p role='alert' className='mb-2 text-[14px] text-destructive'>
                  {error}
                </p>
              )}
              {problem && <p className='mb-2 text-[12px]'>{problem}</p>}
              <div className='flex gap-2.5'>
                <Button disabled={saving} onClick={close}>
                  Cancel
                </Button>
                <Button
                  className='min-h-12 flex-1'
                  variant='primary'
                  disabled={disabled || saving || deletingSets || !!problem}
                  onClick={async () => {
                    if (deletingSets || problem || disabled || saving) return;
                    setSaving(true);
                    setError('');
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
                    else setError('Template not saved. Keep this editor open and retry.');
                  }}
                >
                  {saving ? 'Saving…' : 'Save template'}
                </Button>
              </div>
            </>
          )}
        </>
      }
    >
      <ContentFieldset
        disabled={disabled || saving}
        onFocusCapture={(event) => {
          // Picker input events bubble through React portals, but are not editor fields.
          if (
            event.target instanceof HTMLInputElement &&
            event.currentTarget.contains(event.target)
          )
            lastField.current = event.target;
        }}
      >
        <div className='mb-4 grid gap-2'>
          <label className={fieldLabelClass} htmlFor='template-name'>
            Template name
          </label>
          <Input
            id='template-name'
            value={draft.name === 'Untitled workout' ? '' : draft.name}
            onChange={(e) => setDraft({...draft, name: e.target.value})}
            placeholder='e.g. Upper body B'
          />
          <p className='text-[12px] tabular-nums'>
            {plural(draft.exercises.length, 'exercise')} ·{' '}
            {plural(
              draft.exercises.reduce((n, ex) => n + ex.sets.length, 0),
              'set',
            )}
          </p>
        </div>
        <WorkoutView
          targetsOnly
          exerciseScope='template'
          workout={draft}
          dataset={dataset}
          disabled={disabled || saving}
          onChange={setDraft}
          onDeletingChange={setDeletingSets}
          onSource={() => {}}
        />
        <div className='mt-4'>
          <AddExercise
            dataset={dataset}
            workoutName={draft.name}
            scope='template'
            existingNames={draft.exercises.map((ex) => ex.name)}
            onAdd={(exercise) =>
              setDraft((current) => ({...current, exercises: [...current.exercises, exercise]}))
            }
          />
        </div>
      </ContentFieldset>
    </EditorPanel>
  );
}
