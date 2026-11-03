import {useEffect, useRef, useState} from 'react';

import {editableCopy, editedHistory} from '../domain/history-edit';
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

/** Edit finished history with its original identity and evidence, never completion toggles. */
export function HistoryEditor({
  workout,
  dataset,
  disabled,
  onSave,
  onClose,
  onCloseAutoFocus,
}: {
  workout: Workout;
  dataset: Dataset;
  disabled: boolean;
  onSave: (base: Workout, next: Workout) => Promise<boolean>;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const [draft, setDraft] = useState(() => editableCopy(workout));
  const [initial] = useState(() => JSON.stringify(draft));
  const [deletingSets, setDeletingSets] = useState(false);
  const [discardRequest, setDiscardRequest] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const saveError = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) saveError.current?.focus({preventScroll: true});
  }, [error]);
  const discardPrompt = useRef<HTMLDivElement>(null);
  const lastField = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (discardRequest) discardPrompt.current?.focus({preventScroll: true});
  }, [discardRequest]);
  const dirty = JSON.stringify(draft) !== initial;
  const {workout: next, problem} = editedHistory(workout, draft);
  const close = () => {
    if (saving) return;
    if (dirty) setDiscardRequest((n) => n + 1);
    else onClose();
  };
  useBackLayer(true, close);
  return (
    <EditorPanel
      title='Edit workout'
      description='Change the name, start time, duration, exercises and sets of this finished workout.'
      className='history-editor [--row-bg:hsl(var(--card))]'
      closeLabel='Close workout editor'
      onClose={close}
      onCloseAutoFocus={onCloseAutoFocus}
      busy={saving}
      footer={
        discardRequest ? (
          <div
            ref={discardPrompt}
            tabIndex={-1}
            role='group'
            aria-label='Discard changes?'
            className='focus-visible:outline-none'
          >
            <p className='mb-2'>Discard your changes to this workout?</p>
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
            {(error || (dirty && problem)) && (
              <p
                ref={saveError}
                tabIndex={-1}
                className='mb-2 text-[14px] text-destructive'
                role='alert'
              >
                {error || problem}
              </p>
            )}
            <div className='flex gap-2.5'>
              <Button disabled={saving} onClick={close}>
                Cancel
              </Button>
              <Button
                className='min-h-12 flex-1'
                variant='primary'
                disabled={disabled || saving || !dirty || !!problem || deletingSets}
                onClick={async () => {
                  if (disabled || saving || deletingSets || problem) return;
                  setSaving(true);
                  setError('');
                  const saved = await onSave(workout, next);
                  setSaving(false);
                  if (saved) onClose();
                  else
                    setError(
                      'Workout not saved. Retry, or close and reopen if it changed on another device.',
                    );
                }}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </>
        )
      }
    >
      <ContentFieldset
        disabled={disabled || saving}
        onFocusCapture={(event) => {
          if (
            event.target instanceof HTMLInputElement &&
            event.currentTarget.contains(event.target)
          )
            lastField.current = event.target;
        }}
      >
        <section className='mb-5 border-b border-border pb-5' aria-label='Finished workout'>
          <p className='mb-3 text-[12px] font-medium'>Finished workout</p>
          <div className='grid gap-3'>
            <div className='grid gap-2'>
              <label className={fieldLabelClass} htmlFor='history-workout-name'>
                Workout name
              </label>
              <Input
                id='history-workout-name'
                value={draft.name}
                onChange={(e) => setDraft({...draft, name: e.target.value})}
              />
            </div>
            <div className='grid gap-3 min-[480px]:grid-cols-[minmax(0,1fr)_8rem]'>
              <div className='grid min-w-0 gap-2'>
                <label className={fieldLabelClass} htmlFor='history-workout-start'>
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
              <div className='grid min-w-0 gap-2'>
                <label className={fieldLabelClass} htmlFor='history-workout-duration'>
                  Duration (min)
                </label>
                <Input
                  id='history-workout-duration'
                  type='number'
                  inputMode='numeric'
                  min={0}
                  step={1}
                  value={Number.isNaN(draft.duration) ? '' : draft.duration}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      duration: e.target.value === '' ? NaN : Number(e.target.value),
                    })
                  }
                />
              </div>
            </div>
          </div>
        </section>
        <p className='mb-3 text-[12px] tabular-nums'>
          {plural(draft.exercises.length, 'exercise')} ·{' '}
          {plural(
            draft.exercises.reduce((n, ex) => n + ex.sets.length, 0),
            'set',
          )}
        </p>
        <WorkoutView
          targetsOnly
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
            existingNames={draft.exercises.map((exercise) => exercise.name)}
            onAdd={(exercise) =>
              setDraft((current) => ({...current, exercises: [...current.exercises, exercise]}))
            }
          />
        </div>
      </ContentFieldset>
    </EditorPanel>
  );
}
