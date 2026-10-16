import * as Dialog from '@radix-ui/react-dialog';
import {X} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';

import {editableCopy, editedHistory} from '../domain/history-edit';
import type {Dataset, Workout} from '../domain/types';
import {useBackLayer} from '../state/back';
import {WorkoutView} from '../views/WorkoutView';
import {AddExercise} from './AddExercise';
import {Button} from './ui/button';
import {Input} from './ui/input';

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
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className='dialog-overlay' />
        <Dialog.Content
          className='settings-panel history-editor'
          onInteractOutside={(event) => event.preventDefault()}
        >
          <div className='section-heading'>
            <Dialog.Title>Edit workout</Dialog.Title>
            <Button aria-label='Close workout editor' variant='ghost' size='icon' onClick={close}>
              <X size={20} />
            </Button>
          </div>
          <Dialog.Description className='sr-only'>
            Change the name, start time, duration, exercises and sets of this finished workout.
          </Dialog.Description>
          <fieldset disabled={disabled || saving} className='content-fieldset'>
            <div className='history-editor-fields'>
              <label className='field-label' htmlFor='history-workout-name'>
                Workout name
              </label>
              <Input
                id='history-workout-name'
                value={draft.name}
                onChange={(e) => setDraft({...draft, name: e.target.value})}
              />
              <div className='history-editor-row'>
                <div>
                  <label className='field-label' htmlFor='history-workout-start'>
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
                        date:
                          e.target.value.length === 16 ? e.target.value + ':00' : e.target.value,
                      })
                    }
                  />
                </div>
                <div>
                  <label className='field-label' htmlFor='history-workout-duration'>
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
              nameField={false}
              workout={draft}
              dataset={dataset}
              onChange={(update) =>
                setDraft((current) => (typeof update === 'function' ? update(current) : update))
              }
              onDeletingChange={setDeletingSets}
              onSource={() => {}}
            />
            <AddExercise
              dataset={dataset}
              onAdd={(exercise) =>
                setDraft((current) => ({...current, exercises: [...current.exercises, exercise]}))
              }
            />
            {(error || (dirty && problem)) && (
              <p className='history-editor-problem' role='alert'>
                {error || problem}
              </p>
            )}
            {discardRequest ? (
              <div
                ref={discardPrompt}
                tabIndex={-1}
                className='inline-confirm'
                role='group'
                aria-label='Discard changes?'
              >
                <p>Discard your changes to this workout?</p>
                <Button onClick={() => setDiscardRequest(0)}>Keep editing</Button>
                <Button variant='danger' onClick={onClose}>
                  Discard changes
                </Button>
              </div>
            ) : (
              <div className='editor-footer'>
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
          </fieldset>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
