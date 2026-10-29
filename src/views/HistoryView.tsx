import {
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  History,
  Pencil,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import {useRef, useState} from 'react';

import {OptionsMenu} from '../components/ExerciseMenu';
import {HistoryEditor} from '../components/HistoryEditor';
import {Button} from '../components/ui/button';
import {
  Dialog,
  DialogActions,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../components/ui/dialog';
import {EmptyState} from '../components/ui/empty-state';
import {Input} from '../components/ui/input';
import {isTimed, setCount} from '../domain/sets';
import type {Dataset, Workout} from '../domain/types';
import {durationLabel} from '../domain/workout-duration';
import {useBackLayer} from '../state/back';
import {cn} from '../utils/cn';
import {dateLabel} from '../utils/date';
import {plural} from '../utils/plural';

function WorkoutDetails({workout}: {workout: Workout}) {
  return (
    <div className='workout-details mt-[18px] grid grid-cols-2 gap-5 border-t border-border pt-[18px] max-desk:grid-cols-1'>
      {workout.exercises.map((ex, i) => (
        <section key={`${ex.name}-${i}`}>
          <h3>{ex.name}</h3>
          <div className='recorded-sets mt-[9px] flex flex-col gap-[7px] text-[12px] text-muted-foreground tabular-nums'>
            {ex.sets.map((set, j) => (
              <div key={set.id} className='flex items-center justify-between gap-2'>
                <span>
                  Set {j + 1}:{' '}
                  {isTimed(ex.type)
                    ? `${set.seconds ?? '—'} seconds${set.distance !== null ? ` · ${set.distance} km` : ''}`
                    : `${set.weight === null ? 'Bodyweight' : `${set.weight} kg${ex.type === 'assisted' ? ' assistance' : ''}`} × ${set.reps ?? '—'} reps`}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
export function HistoryView({
  dataset,
  focusedId,
  onRepeat,
  onTemplate,
  onChange,
  disabled,
  locked,
}: {
  dataset: Dataset;
  focusedId: string | null;
  onRepeat: (workout: Workout) => void;
  onTemplate: (workout: Workout) => void;
  /** Save an edited workout (`next`) or delete it (`next` null). */
  onChange: (base: Workout, next: Workout | null) => Promise<boolean>;
  /** Mirrors the library's disabled fieldset, which the portaled editor sits outside of. */
  disabled: boolean;
  /** Sync is locked: portaled dialogs escape <main hidden>, so they must unmount. */
  locked: boolean;
}) {
  const workouts = dataset.workouts;
  const [editing, setEditing] = useState<Workout | null>(null);
  const [deleting, setDeleting] = useState<Workout | null>(null);
  const [deleteError, setDeleteError] = useState('');
  useBackLayer(!!deleting && !locked, () => setDeleting(null));
  const menus = useRef(new Map<string, HTMLButtonElement>());
  // Focus returns to the card's ⋯ after the editor or confirmation closes, if it still exists.
  const returnTo = useRef<string | null>(null);
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    const id = returnTo.current;
    returnTo.current = null;
    if (id) menus.current.get(id)?.focus({preventScroll: true});
  };
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(20);
  const filtered = workouts.filter(
    (w) =>
      !search ||
      `${w.name} ${w.date} ${w.exercises.map((x) => x.name).join(' ')}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const ordered = focusedId
    ? [...filtered].sort((a, b) =>
        a.id === focusedId ? -1 : b.id === focusedId ? 1 : b.date.localeCompare(a.date),
      )
    : filtered;
  return (
    <div className='history-list flex flex-col gap-4'>
      <div>
        <Input
          aria-label='Search workout history'
          placeholder='Search workouts, exercises or dates…'
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setLimit(20);
          }}
        />
        <span>{plural(filtered.length, 'session')}</span>
      </div>
      {ordered.slice(0, limit).map((workout) => {
        const open = expanded === workout.id || focusedId === workout.id;
        const count = setCount(workout);
        return (
          <article
            className={cn(
              'history-card min-w-0 border bg-card p-5',
              focusedId === workout.id ? 'focused-history border-primary' : 'border-border',
            )}
            key={workout.id}
          >
            <div className='flex justify-between gap-4'>
              <div className='min-w-0'>
                <span className='eyebrow block text-[12px] text-muted-foreground tabular-nums'>
                  {dateLabel(workout.date)}
                  {workout.duration ? ` · ${durationLabel(workout.duration)}` : ''}
                </span>
                <h2 className='my-2'>{workout.name}</h2>
                <p className='mt-[7px]'>{plural(count, 'completed set')}</p>
                <p className='mt-[7px]'>{workout.exercises.map((ex) => ex.name).join(' · ')}</p>
              </div>
              {/* The negative margin pulls the 44px ⋯ target into the card padding so its glyph sits at the content edge. */}
              <div className='-mr-[13px] flex min-w-0 shrink-0 items-start'>
                <Button
                  size='icon'
                  variant='ghost'
                  aria-label={`View sets for ${workout.name} ${dateLabel(workout.date)}`}
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : workout.id)}
                >
                  {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </Button>
                <OptionsMenu
                  label={`Workout options for ${workout.name} ${dateLabel(workout.date)}`}
                  ref={(node) => {
                    if (node) menus.current.set(workout.id, node);
                    else menus.current.delete(workout.id);
                  }}
                  items={[
                    {
                      label: 'Edit workout',
                      icon: Pencil,
                      onSelect: () => {
                        returnTo.current = workout.id;
                        setEditing(workout);
                      },
                    },
                    {
                      label: 'Delete workout',
                      icon: Trash2,
                      danger: true,
                      onSelect: () => {
                        returnTo.current = workout.id;
                        setDeleteError('');
                        setDeleting(workout);
                      },
                    },
                  ]}
                />
              </div>
            </div>
            {open && <WorkoutDetails workout={workout} />}
            <footer className='mt-[18px] flex flex-wrap gap-2 border-t border-border pt-4'>
              <Button
                aria-label={`Repeat workout ${workout.name} ${dateLabel(workout.date)}`}
                onClick={() => onRepeat(workout)}
              >
                <RotateCcw size={15} /> Repeat workout
              </Button>
              <Button variant='ghost' onClick={() => onTemplate(workout)}>
                Save as template <ArrowUpRight size={15} />
              </Button>
            </footer>
          </article>
        );
      })}
      {filtered.length > limit && (
        <Button onClick={() => setLimit((n) => n + 20)}>Show more sessions</Button>
      )}
      {!filtered.length && (
        <EmptyState
          icon={History}
          title='No matching workouts'
          description='Try another search or finish your first workout.'
        />
      )}
      {editing && !locked && (
        <HistoryEditor
          key={editing.id}
          workout={editing}
          dataset={dataset}
          disabled={disabled}
          onSave={onChange}
          onClose={() => {
            setEditing(null);
            requestAnimationFrame(() => {
              const id = returnTo.current;
              returnTo.current = null;
              if (id) menus.current.get(id)?.focus({preventScroll: true});
            });
          }}
        />
      )}
      <Dialog
        open={!!deleting && !locked}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <DialogContent onCloseAutoFocus={restoreFocus}>
          <DialogTitle>Delete this workout?</DialogTitle>
          <DialogDescription>
            {deleting &&
              `${deleting.name} on ${dateLabel(deleting.date)} and its ${plural(setCount(deleting), 'set')} will be removed from history, records and charts on every device.`}
          </DialogDescription>
          {deleteError && (
            <p className='mt-3.5' role='alert'>
              {deleteError}
            </p>
          )}
          <DialogActions>
            <DialogClose asChild>
              <Button>Keep workout</Button>
            </DialogClose>
            <Button
              variant='danger'
              disabled={disabled}
              onClick={async () => {
                if (!deleting) return;
                if (await onChange(deleting, null)) setDeleting(null);
                else
                  setDeleteError(
                    'Not deleted. The workout may have changed on another device; close and retry.',
                  );
              }}
            >
              Delete workout
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
    </div>
  );
}
