import {X} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';

import {editableCopy, editedHistory} from '../domain/history-edit';
import type {Dataset, Workout} from '../domain/types';
import {useBackLayer} from '../state/back';
import {WorkoutView} from '../views/WorkoutView';
import {AddExercise} from './AddExercise';
import {Button} from './ui/button';
import {ContentFieldset} from './ui/content-fieldset';
import {Dialog, DialogContent, DialogDescription, DialogTitle} from './ui/dialog';
import {fieldLabelClass} from './ui/field-label';
import {Input} from './ui/input';
import {SectionHeading} from './ui/section-heading';

/**
 * Edit a finished or imported workout, Strong-style: name, start time, duration, exercises
 * and set values. Rows are targets-only (no completion toggles); everything saved stays
 * completed history. Unsaved changes are never dropped by a stray Escape or outside tap.
 */
export function HistoryEditor({
  workout,
  dataset,
  disabled,
  onSave,
  onClose,
}: {
  workout: Workout;
  dataset: Dataset;
  disabled: boolean;
  onSave: (base: Workout, next: Workout) => Promise<boolean>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => editableCopy(workout));
  const [initial] = useState(() => JSON.stringify(draft));
  const [deletingSets, setDeletingSets] = useState(false);
  const [discardRequest, setDiscardRequest] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const discardPrompt = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!discardRequest) return;
    // Every close attempt, including while the prompt is already open, brings it back into
    // view. Focus its group so Tab starts at the safe "Keep editing" choice.
    discardPrompt.current?.scrollIntoView({block: 'nearest'});
    discardPrompt.current?.focus({preventScroll: true});
  }, [discardRequest]);
  const dirty = JSON.stringify(draft) !== initial;
  const {workout: next, problem} = editedHistory(workout, draft);
  const close = () => (dirty ? setDiscardRequest((n) => n + 1) : onClose());
  // Unsaved changes stay open behind the discard prompt, like the close button.
  useBackLayer(true, close);
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        variant='panel'
        className='history-editor [--row-bg:hsl(var(--card))]'
        onInteractOutside={(event) => event.preventDefault()}
      >
        <SectionHeading className='mb-6'>
          <DialogTitle>Edit workout</DialogTitle>
          <Button aria-label='Close workout editor' variant='ghost' size='icon' onClick={close}>
            <X size={20} />
          </Button>
        </SectionHeading>
        <DialogDescription srOnly>
          Change the name, start time, duration, exercises and sets of this finished workout.
        </DialogDescription>
        <ContentFieldset disabled={disabled || saving}>
          <div className='mb-5 grid gap-2'>
            <label className={fieldLabelClass} htmlFor='history-workout-name'>
              Workout name
            </label>
            <Input
              id='history-workout-name'
              value={draft.name}
              onChange={(e) => setDraft({...draft, name: e.target.value})}
            />
            <div className='grid grid-cols-[minmax(0,1fr)_minmax(0,8rem)] gap-3'>
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
                      // Seconds are kept when unchanged; a picked time has whole minutes.
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
          <WorkoutView
            targetsOnly
            workout={draft}
            dataset={dataset}
            onChange={setDraft}
            onDeletingChange={setDeletingSets}
            onSource={() => {}}
          />
          <AddExercise
            dataset={dataset}
            existingNames={draft.exercises.map((exercise) => exercise.name)}
            onAdd={(exercise) =>
              setDraft((current) => ({...current, exercises: [...current.exercises, exercise]}))
            }
          />
          {(error || (dirty && problem)) && (
            <p className='mt-4 text-[14px] text-destructive' role='alert'>
              {error || problem}
            </p>
          )}
          {discardRequest ? (
            <div
              ref={discardPrompt}
              tabIndex={-1}
              className='inline-confirm mt-4 border-t border-border pt-4'
              role='group'
              aria-label='Discard changes?'
            >
              <p className='mb-2.5'>Discard your changes to this workout?</p>
              <Button className='mr-2' onClick={() => setDiscardRequest(0)}>
                Keep editing
              </Button>
              <Button variant='danger' className='mr-2' onClick={onClose}>
                Discard changes
              </Button>
            </div>
          ) : (
            <div className='mt-[18px] flex flex-wrap justify-end gap-2.5 border-t border-border pt-5'>
              <Button onClick={close}>Cancel</Button>
              <Button
                variant='primary'
                disabled={!dirty || !!problem || deletingSets}
                onClick={async () => {
                  if (deletingSets || problem) return;
                  setSaving(true);
                  setError('');
                  const saved = await onSave(workout, next);
                  setSaving(false);
                  if (saved) onClose();
                  else
                    setError(
                      'Not saved. The workout may have changed on another device; close and reopen it.',
                    );
                }}
              >
                Save changes
              </Button>
            </div>
          )}
        </ContentFieldset>
      </DialogContent>
    </Dialog>
  );
}
