import {Plus, X} from 'lucide-react';
import {type ReactNode, useState} from 'react';

import {exerciseTypeFor} from '../catalog/catalog';
import type {Dataset, ExerciseLog} from '../domain/types';
import {useBackLayer} from '../state/back';
import {ExerciseList} from './ExerciseList';
import {Button} from './ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import {SectionHeading} from './ui/section-heading';
import {historyTargets} from './workout-targets';

/** The picker's list labels are dialog-title size, with room for the close button. */
const pickerLabelClass = 'pr-7 text-[18px]';

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
    <Dialog open={open} onOpenChange={toggle}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent
        variant='fullscreen'
        className='exercise-picker'
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <SectionHeading className='sticky -top-6 z-1 mb-6 flex-wrap bg-card py-3'>
          <DialogTitle>{title}</DialogTitle>
          <DialogClose asChild>
            <Button variant='ghost' size='icon' aria-label='Close exercise picker'>
              <X size={20} />
            </Button>
          </DialogClose>
          {error && (
            /* mt-3.5 restates the old `.dialog-content p` margin. */
            <p role='alert' className='mt-3.5 w-full text-[14px] text-destructive'>
              {error}
            </p>
          )}
        </SectionHeading>
        <DialogDescription srOnly>{description}</DialogDescription>
        <ExerciseList labelClassName={pickerLabelClass} dataset={dataset} onSelect={pick} />
      </DialogContent>
    </Dialog>
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
