import {ArrowLeft, Plus} from 'lucide-react';
import {type ReactNode, useEffect, useRef, useState} from 'react';

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
import {historyTargets} from './workout-targets';

/** Single-select library: existing names only, with latest-history targets on selection. */
export function ExercisePicker({
  dataset,
  open,
  onOpenChange,
  onPick,
  title,
  context,
  description,
  trigger,
  onCloseAutoFocus,
  existingNames = [],
  scope = 'workout',
}: {
  dataset: Dataset;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (exercise: ExerciseLog) => void;
  title: string;
  context: string;
  description: string;
  trigger?: ReactNode;
  onCloseAutoFocus?: (event: Event) => void;
  existingNames?: string[];
  scope?: 'workout' | 'template';
}) {
  const [error, setError] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;
    if (!viewport) return;
    const resize = () => {
      panel.current?.style.setProperty('--picker-height', `${viewport.height}px`);
      panel.current?.style.setProperty('--picker-top', `${viewport.offsetTop}px`);
    };
    resize();
    viewport.addEventListener('resize', resize);
    viewport.addEventListener('scroll', resize);
    return () => {
      viewport.removeEventListener('resize', resize);
      viewport.removeEventListener('scroll', resize);
    };
  }, [open]);
  const toggle = (next: boolean) => {
    onOpenChange(next);
    setError('');
  };
  useBackLayer(open, () => toggle(false));
  const pick = (name: string) => {
    if (existingNames.includes(name)) {
      setError(`${name} is already in this ${scope}.`);
      return;
    }
    onPick(historyTargets(dataset, name, exerciseTypeFor(name, dataset) ?? 'weighted'));
    toggle(false);
  };
  return (
    <Dialog open={open} onOpenChange={toggle}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent
        ref={panel}
        variant='fullscreen'
        className='exercise-picker flex min-h-0 flex-col overflow-hidden p-0 max-desk:top-[var(--picker-top,0px)] max-desk:bottom-auto max-desk:h-[var(--picker-height,100dvh)]'
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <header className='flex max-h-[35%] shrink-0 flex-col px-[max(18px,calc((100vw-900px)/2))] pt-[max(12px,env(safe-area-inset-top))] pb-3'>
          {/* Always opened from a workout or template, so its dismiss control goes back to it. */}
          <div className='mb-1 flex shrink-0 items-center gap-3'>
            <DialogClose asChild>
              <Button variant='ghost' size='icon' aria-label={`Back to ${scope}`}>
                <ArrowLeft size={20} />
              </Button>
            </DialogClose>
            <DialogTitle>{title}</DialogTitle>
          </div>
          <div className='min-h-0 overflow-y-auto overscroll-contain'>
            <p className='text-sm font-medium [overflow-wrap:anywhere]'>{context}</p>
            <DialogDescription className='mt-1 text-sm text-muted-foreground'>
              {description}
            </DialogDescription>
            {error && (
              <p role='alert' className='mt-2 text-sm [overflow-wrap:anywhere] text-destructive'>
                {error}
              </p>
            )}
          </div>
        </header>
        <ExerciseList
          dataset={dataset}
          onSelect={pick}
          existingNames={existingNames}
          scope={scope}
          contained
          onFilterChange={() => setError('')}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Add exercise opens the shared library over the unchanged logger or editor. */
export function AddExercise({
  dataset,
  existingNames,
  onAdd,
  workoutName,
  scope = 'workout',
}: {
  dataset: Dataset;
  onAdd: (exercise: ExerciseLog) => void;
  existingNames: string[];
  workoutName: string;
  scope?: 'workout' | 'template';
}) {
  const [open, setOpen] = useState(false);
  return (
    <ExercisePicker
      dataset={dataset}
      open={open}
      onOpenChange={setOpen}
      onPick={onAdd}
      existingNames={existingNames}
      scope={scope}
      title='Add exercise'
      context={`To: ${workoutName.trim() || `Untitled ${scope}`}`}
      description={`Choose one exercise to add to this ${scope}.`}
      trigger={
        <Button className='add-exercise-button w-full [.history-editor>.content-fieldset>&]:my-4 [.template-editor>&]:my-4'>
          <Plus size={16} /> Add exercise
        </Button>
      }
    />
  );
}
