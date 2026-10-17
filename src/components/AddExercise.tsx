import * as Dialog from '@radix-ui/react-dialog';
import {Plus, X} from 'lucide-react';
import {type ReactNode, useState} from 'react';

import {exerciseTypeFor} from '../catalog/catalog';
import type {Dataset, ExerciseLog} from '../domain/types';
import {useBackLayer} from '../state/back';
import {ExerciseList} from './ExerciseList';
import {Button} from './ui/button';
import {historyTargets} from './workout-targets';

/**
 * The full-screen exercise library as a picker. Picking a row hands over the exercise with
 * targets prefilled from its latest history; Close or Escape picks nothing.
 */
export function ExercisePicker({
  dataset,
  open,
  onOpenChange,
  onPick,
  title,
  description,
  trigger,
  onCloseAutoFocus,
  existingNames = [],
}: {
  dataset: Dataset;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (exercise: ExerciseLog) => void;
  title: string;
  description: string;
  trigger?: ReactNode;
  onCloseAutoFocus?: (event: Event) => void;
  existingNames?: string[];
}) {
  const [error, setError] = useState('');
  const toggle = (next: boolean) => {
    onOpenChange(next);
    setError('');
  };
  useBackLayer(open, () => toggle(false));
  const pick = (name: string) => {
    if (existingNames.includes(name)) {
      setError(`${name} is already in this workout.`);
      return;
    }
    onPick(historyTargets(dataset, name, exerciseTypeFor(name, dataset) ?? 'weighted'));
    toggle(false);
  };
  return (
    <Dialog.Root open={open} onOpenChange={toggle}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className='dialog-overlay' />
        <Dialog.Content
          /* Every `!` here beats the unlayered shared .dialog-content (styles.css); drop them when
             .dialog-content ports (PR 5). That includes the scoped EmptyState overrides, which beat
             `.dialog-content h2 { padding-right }` and `.dialog-content p { margin-top }`. */
          className='dialog-content exercise-picker inset-0! h-dvh max-h-none! w-full! transform-none! border-0! px-[max(18px,calc((100vw-900px)/2))]! py-6! shadow-none! [&_.empty-state_h2]:pr-0! [&_.empty-state_p]:mt-2!'
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <div className='section-heading sticky -top-6 z-1 mb-6 flex-wrap bg-card py-3'>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant='ghost' size='icon' aria-label='Close exercise picker'>
                <X size={20} />
              </Button>
            </Dialog.Close>
            {error && (
              <p role='alert' className='w-full text-[14px] text-destructive'>
                {error}
              </p>
            )}
          </div>
          <Dialog.Description className='sr-only'>{description}</Dialog.Description>
          <ExerciseList dataset={dataset} onSelect={pick} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Add exercise opens the same library as the Exercises tab; picking a row adds it. */
export function AddExercise({
  dataset,
  existingNames,
  onAdd,
}: {
  dataset: Dataset;
  onAdd: (exercise: ExerciseLog) => void;
  existingNames: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <ExercisePicker
      dataset={dataset}
      open={open}
      onOpenChange={setOpen}
      onPick={onAdd}
      existingNames={existingNames}
      title='Add exercise'
      description='Search or filter the exercise library and choose one to add to this workout.'
      trigger={
        <Button className='add-exercise-button w-full [.history-editor>.content-fieldset>&]:my-4 [.template-editor>&]:my-4'>
          <Plus size={16} /> Add exercise
        </Button>
      }
    />
  );
}
