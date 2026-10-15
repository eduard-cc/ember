import * as Dialog from '@radix-ui/react-dialog';
import {Plus, X} from 'lucide-react';
import {type ReactNode, useState} from 'react';

import {exerciseTypeFor} from '../catalog/catalog';
import type {Dataset, ExerciseLog, ExerciseType} from '../domain/types';
import {useBackLayer} from '../state/back';
import {ExerciseList} from './ExerciseList';
import {Button} from './ui';
import {historyTargets} from './workout-targets';

const types: [ExerciseType, string][] = [
  ['weighted', 'Weighted'],
  ['assisted', 'Assisted'],
  ['bodyweight', 'Bodyweight'],
  ['duration', 'Duration'],
  ['cardio', 'Cardio'],
];

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
}: {
  dataset: Dataset;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (exercise: ExerciseLog) => void;
  title: string;
  description: string;
  trigger?: ReactNode;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const [custom, setCustom] = useState<string | null>(null);
  const toggle = (next: boolean) => {
    onOpenChange(next);
    setCustom(null);
  };
  useBackLayer(open, () => toggle(false));
  const pick = (name: string, type = exerciseTypeFor(name, dataset) ?? 'weighted') => {
    onPick(historyTargets(dataset, name, type));
    toggle(false);
  };
  return (
    <Dialog.Root open={open} onOpenChange={toggle}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className='dialog-overlay' />
        <Dialog.Content
          className='dialog-content settings-panel exercise-picker'
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <div className='section-heading'>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant='ghost' size='icon' aria-label='Close exercise picker'>
                <X size={20} />
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className='sr-only'>{description}</Dialog.Description>
          <ExerciseList
            dataset={dataset}
            onSelect={(name) => pick(name)}
            extra={(query, names) => {
              const exact = names.some((name) => name.toLowerCase() === query.toLowerCase());
              if (!query || exact) return null;
              return custom === query ? (
                <section className='custom-exercise' aria-label='New exercise'>
                  <h2 className='list-label'>Type for {query}</h2>
                  <div className='chip-row type-choice' role='group' aria-label='Exercise type'>
                    {types.map(([type, label]) => (
                      <button key={type} className='chip' onClick={() => pick(query, type)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </section>
              ) : (
                <ul className='exercise-rows custom-exercise'>
                  <li>
                    <button
                      className='exercise-row'
                      aria-label={`Create "${query}"`}
                      onClick={() => setCustom(query)}
                    >
                      <span className='exercise-thumb' aria-hidden='true'>
                        <Plus size={18} />
                      </span>
                      <span className='exercise-row-text'>
                        <strong>{`Create "${query}"`}</strong>
                        <small>Custom exercise</small>
                      </span>
                    </button>
                  </li>
                </ul>
              );
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Add exercise opens the same library as the Exercises tab; picking a row adds it. */
export function AddExercise({
  dataset,
  onAdd,
}: {
  dataset: Dataset;
  onAdd: (exercise: ExerciseLog) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <ExercisePicker
      dataset={dataset}
      open={open}
      onOpenChange={setOpen}
      onPick={onAdd}
      title='Add exercise'
      description='Search or filter the exercise library and choose one to add to this workout.'
      trigger={
        <Button className='add-exercise-button'>
          <Plus size={16} /> Add exercise
        </Button>
      }
    />
  );
}
