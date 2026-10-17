import * as Dialog from '@radix-ui/react-dialog';
import {Plus, X} from 'lucide-react';
import {type ReactNode, useState} from 'react';

import {exerciseTypeFor} from '../catalog/catalog';
import type {Dataset, ExerciseLog, ExerciseType} from '../domain/types';
import {useBackLayer} from '../state/back';
import {ExerciseList} from './ExerciseList';
import {ThumbFrame} from './ExerciseThumb';
import {ExerciseRowText, exerciseRowClass} from './exercise-row';
import {Button} from './ui/button';
import {Chip, ChipRow} from './ui/chip';
import {ListLabel} from './ui/list-label';
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
          /* Every `!` here beats the unlayered shared .dialog-content (styles.css); drop them when
             .dialog-content ports (PR 5). That includes the scoped EmptyState overrides, which beat
             `.dialog-content h2 { padding-right }` and `.dialog-content p { margin-top }`. */
          className='dialog-content exercise-picker inset-0! h-dvh max-h-none! w-full! transform-none! border-0! px-[max(18px,calc((100vw-900px)/2))]! py-6! shadow-none! [&_.empty-state_h2]:pr-0! [&_.empty-state_p]:mt-2!'
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <div className='section-heading sticky -top-6 z-1 mb-6 bg-card py-3'>
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
                <section className='custom-exercise mt-3' aria-label='New exercise'>
                  <ListLabel>Type for {query}</ListLabel>
                  <ChipRow className='flex-wrap' role='group' aria-label='Exercise type'>
                    {types.map(([type, label]) => (
                      <Chip key={type} onClick={() => pick(query, type)}>
                        {label}
                      </Chip>
                    ))}
                  </ChipRow>
                </section>
              ) : (
                <ul className='custom-exercise mt-3'>
                  <li>
                    <button
                      className={exerciseRowClass}
                      aria-label={`Create "${query}"`}
                      onClick={() => setCustom(query)}
                    >
                      <ThumbFrame>
                        <Plus size={18} />
                      </ThumbFrame>
                      <ExerciseRowText title={`Create "${query}"`} subtitle='Custom exercise' />
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
        <Button className='add-exercise-button w-full [.history-editor>.content-fieldset>&]:my-4 [.template-editor>&]:my-4'>
          <Plus size={16} /> Add exercise
        </Button>
      }
    />
  );
}
