import * as Dialog from '@radix-ui/react-dialog';
import {ArrowUpRight, ChevronDown, ChevronUp, Pencil, RotateCcw, Trash2} from 'lucide-react';
import {useRef, useState} from 'react';

import {ExcludeSet, type ExcludeSetHandler} from '../components/ExcludeSet';
import {OptionsMenu} from '../components/ExerciseMenu';
import {HistoryEditor} from '../components/HistoryEditor';
import {Button, Input, plural} from '../components/ui';
import type {Dataset, Workout} from '../domain/types';
import {durationLabel} from '../domain/workout-duration';
import {dateLabel} from './WorkoutView';

export function WorkoutDetails({
  workout,
  onExclude,
}: {
  workout: Workout;
  onExclude: ExcludeSetHandler;
}) {
  return (
    <div className='workout-details'>
      {workout.exercises.map((ex, i) => (
        <section key={`${ex.name}-${i}`}>
          <h3>{ex.name}</h3>
          <div className='recorded-sets'>
            {ex.sets.map((set, j) => (
              <div key={set.id} className={`recorded-set ${set.excluded ? 'excluded-set' : ''}`}>
                <span className={set.suspicious ? 'suspicious-set' : ''}>
                  Set {j + 1}:{' '}
                  {ex.type === 'duration' || ex.type === 'cardio'
                    ? `${set.seconds ?? '—'} seconds${set.distance !== null ? ` · ${set.distance} km` : ''}`
                    : `${set.weight === null ? 'Bodyweight' : `${set.weight} kg${ex.type === 'assisted' ? ' assistance' : ''}`} × ${set.reps ?? '—'} reps`}
                  {set.suspicious ? ' · review flagged' : ''}
                  {set.excluded ? ' · excluded' : ''}
                </span>
                <ExcludeSet
                  workoutId={workout.id}
                  date={workout.date}
                  exercise={ex.name}
                  set={set}
                  number={j + 1}
                  type={ex.type}
                  onExclude={onExclude}
                />
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
  onExclude,
  onChange,
  disabled,
  locked,
}: {
  dataset: Dataset;
  focusedId: string | null;
  onRepeat: (workout: Workout) => void;
  onTemplate: (workout: Workout) => void;
  onExclude: ExcludeSetHandler;
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
    <div className='history-list'>
      <div className='list-toolbar'>
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
        const count = workout.exercises.reduce((n, ex) => n + ex.sets.length, 0);
        return (
          <article
            className={`history-card ${focusedId === workout.id ? 'focused-history' : ''}`}
            key={workout.id}
          >
            <div className='history-card-top'>
              <div>
                <span className='eyebrow'>
                  {dateLabel(workout.date)}
                  {workout.duration ? ` · ${durationLabel(workout.duration)}` : ''}
                </span>
                <h2>{workout.name}</h2>
                <p>
                  {count} completed set{count !== 1 ? 's' : ''}
                </p>
                <p className='exercise-preview'>
                  {workout.exercises.map((ex) => ex.name).join(' · ')}
                </p>
              </div>
              <div className='history-card-actions'>
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
            {open && <WorkoutDetails workout={workout} onExclude={onExclude} />}
            <footer>
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
        <div className='empty-state'>
          <h2>No matching workouts</h2>
          <p>Try another search or finish your first workout.</p>
        </div>
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
      <Dialog.Root
        open={!!deleting && !locked}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className='dialog-overlay' />
          <Dialog.Content className='dialog-content' onCloseAutoFocus={restoreFocus}>
            <Dialog.Title>Delete this workout?</Dialog.Title>
            <Dialog.Description>
              {deleting &&
                `${deleting.name} on ${dateLabel(deleting.date)} and its ${plural(
                  deleting.exercises.reduce((n, ex) => n + ex.sets.length, 0),
                  'set',
                )} will be removed from history, records and charts on every device.`}
            </Dialog.Description>
            {deleteError && <p role='alert'>{deleteError}</p>}
            <div className='dialog-actions'>
              <Dialog.Close asChild>
                <Button>Keep workout</Button>
              </Dialog.Close>
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
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
