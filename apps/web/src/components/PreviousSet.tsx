import {ArrowUpRight} from 'lucide-react';
import {type MouseEvent, type ReactNode, useId, useMemo, useRef, useState} from 'react';

import {bestComparable, getHistory, nearestRecorded} from '../domain/model';
import {isTimed} from '../domain/sets';
import type {Dataset, ExerciseLog, SetRecord} from '../domain/types';
import {useBackLayer} from '../state/back';
import {cn} from '../utils/cn';
import {dateLabel} from '../utils/date';
import {plural} from '../utils/plural';
import {setText} from '../utils/set-label';
import {WorkoutDrawer} from './WorkoutDrawer';
import {Spoken} from './exercise-line';
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogCornerClose,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from './ui/responsive-dialog';

function recorded(set: SetRecord, type: ExerciseLog['type']) {
  if (isTimed(type))
    return `${set.seconds ?? '—'} s${type === 'cardio' ? ` · ${set.distance ?? '—'} km` : ''}`;
  return `${type === 'bodyweight' ? 'BW' : `${set.weight ?? '—'} kg${type === 'assisted' ? ' assistance' : ''}`} × ${set.reps ?? '—'}`;
}

const sectionClass = 'border-t border-border py-4 first:border-t-0';
const headingClass = 'text-label text-muted-foreground';
const sourceRowClass =
  'pressable -mx-2 flex min-h-14 w-[calc(100%+1rem)] items-center gap-3 border-0 bg-transparent px-2 py-2.5 text-left text-foreground hover:bg-accent focus-visible:-outline-offset-2';

/** One recorded set that came from a workout: the set, then its date and workout. */
function EvidenceRow({
  tag,
  value,
  date,
  workoutName,
  label,
  onOpen,
}: {
  tag?: string;
  value: ReactNode;
  date: string;
  workoutName: string;
  label: string;
  onOpen?: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const body = (
    <span className='min-w-0 flex-1'>
      <span className='flex flex-wrap items-baseline gap-x-2'>
        {tag && <span className='text-[14px] font-medium text-muted-foreground'>{tag}</span>}
        <strong className='text-set-value tabular-nums'>{value}</strong>
      </span>
      <span className='mt-0.5 block text-[12px] wrap-anywhere text-muted-foreground'>
        <span className='tabular-nums'>{dateLabel(date)}</span> · {workoutName}
      </span>
    </span>
  );
  if (!onOpen) return <div className='py-2.5'>{body}</div>;
  return (
    <button type='button' className={sourceRowClass} aria-label={label} onClick={onOpen}>
      {body}
      <ArrowUpRight size={16} aria-hidden className='shrink-0 text-muted-foreground' />
    </button>
  );
}

/** Only actual matching variant/type evidence, never an inferred equivalent. */
export function PreviousSet({
  dataset,
  exercise,
  set,
  index,
  sources = false,
}: {
  dataset: Dataset;
  exercise: ExerciseLog;
  set: SetRecord;
  index: number;
  /** Source rows open their workout over this drawer; editors leave them out. */
  sources?: boolean;
}) {
  const [open, setOpen] = useState(false);
  useBackLayer(open, () => setOpen(false));
  // Every row re-renders per keystroke: scan history once per dataset/exercise, not per render.
  const previous = useMemo(
    () => getHistory(dataset, exercise.name).find((session) => session.type === exercise.type),
    [dataset, exercise.name, exercise.type],
  );
  const previousSet = previous?.sets[index];
  const timed = isTimed(exercise.type);
  const assisted = exercise.type === 'assisted' ? ' assistance' : '';
  // The exact-weight lookup is only needed while the evidence dialog is open.
  const comparable =
    open && !timed && (exercise.type === 'bodyweight' || set.weight !== null)
      ? bestComparable(
          dataset,
          exercise.name,
          exercise.type,
          exercise.type === 'bodyweight' ? null : set.weight,
        )
      : null;
  // Only when the chosen weight has no counted history: actual neighbours, never an estimate.
  const nearest =
    open && !comparable && set.weight !== null && Number.isFinite(set.weight)
      ? nearestRecorded(dataset, exercise.name, exercise.type, set.weight)
      : null;
  const nearestId = useId();
  // A source opens its workout right here, over this drawer; closing it returns to the row.
  const [sourceId, setSourceId] = useState<string | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  // The tapped row itself: Safari on iPhone does not focus a button it taps.
  const openSource = (id: string, event: MouseEvent<HTMLButtonElement>) => {
    trigger.current = event.currentTarget;
    setSourceId(id);
  };
  return (
    <>
      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogTrigger asChild>
          <button
            className='set-previous min-h-11 border-0 bg-transparent px-0.5 text-center text-[12px] leading-[1.3] text-muted-foreground tabular-nums'
            aria-label={`Previous for ${exercise.name} set ${index + 1}`}
          >
            {previousSet ? recorded(previousSet, exercise.type) : '—'}
            {previousSet && (
              <span className='mt-[3px] block text-[11px]'>{dateLabel(previous.date)}</span>
            )}
          </button>
        </ResponsiveDialogTrigger>
        <ResponsiveDialogContent className='source-dialog max-desk:max-h-[calc(var(--visible-height,100dvh)-2.5rem)] desk:flex desk:flex-col'>
          <ResponsiveDialogHeader className='shrink-0 border-b border-border pr-14 pb-3 text-left desk:pr-7'>
            <ResponsiveDialogTitle className='[overflow-wrap:anywhere]'>
              {exercise.name}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className='desk:mt-0'>
              Set {index + 1} · recorded sets only, nothing estimated
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody className='min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(1.5rem+env(safe-area-inset-bottom))] desk:pb-0'>
            {!timed && (
              <section className={cn('source-evidence', sectionClass)}>
                <h3 className={headingClass}>
                  {exercise.type === 'bodyweight'
                    ? 'Best at bodyweight'
                    : `Best at ${set.weight ?? '—'} kg${assisted}`}
                </h3>
                {comparable ? (
                  <EvidenceRow
                    value={<Spoken value={setText(comparable.set, exercise.type)} />}
                    date={comparable.date}
                    workoutName={comparable.workoutName}
                    label={`View source workout ${comparable.workoutName}, ${recorded(comparable.set, exercise.type)}, ${dateLabel(comparable.date)}`}
                    onOpen={
                      sources ? (event) => openSource(comparable.workoutId, event) : undefined
                    }
                  />
                ) : (
                  <p className='mt-2 text-[14px] text-muted-foreground'>
                    {exercise.type === 'bodyweight'
                      ? 'No exact-weight history'
                      : set.weight === null || !Number.isFinite(set.weight)
                        ? 'Enter a weight to compare'
                        : `No counted sets at ${set.weight} kg${assisted}`}
                  </p>
                )}
              </section>
            )}
            {nearest && (nearest.below || nearest.above) && (
              <section
                className={cn('source-evidence', sectionClass)}
                aria-labelledby={`${nearestId}-title`}
              >
                <h3 id={`${nearestId}-title`} className={headingClass}>
                  Nearest recorded
                </h3>
                <p className='mt-1 text-[12px] text-muted-foreground'>
                  Actual sets at other weights, not an equivalent for {set.weight} kg{assisted}.
                </p>
                <ul className='nearest-list mt-1'>
                  {(
                    [
                      [exercise.type === 'assisted' ? 'Less assistance' : 'Lighter', nearest.below],
                      [exercise.type === 'assisted' ? 'More assistance' : 'Heavier', nearest.above],
                    ] as const
                  ).map(([label, entry]) =>
                    entry ? (
                      <li key={label}>
                        <EvidenceRow
                          tag={label}
                          value={<Spoken value={setText(entry.set, exercise.type)} />}
                          date={entry.date}
                          workoutName={entry.workoutName}
                          label={`View source workout ${entry.workoutName} (${label.toLowerCase()}), ${recorded(entry.set, exercise.type)}, ${dateLabel(entry.date)}`}
                          onOpen={
                            sources ? (event) => openSource(entry.workoutId, event) : undefined
                          }
                        />
                      </li>
                    ) : null,
                  )}
                </ul>
              </section>
            )}
            <section className={cn('source-evidence', sectionClass)}>
              <h3 className={headingClass}>Previous session</h3>
              {previous ? (
                <>
                  {sources ? (
                    <button
                      type='button'
                      className={cn(sourceRowClass, 'mt-1')}
                      aria-label={`View source workout ${previous.workoutName} ${dateLabel(previous.date)}`}
                      onClick={(event) => openSource(previous.workoutId, event)}
                    >
                      <SessionHead
                        date={previous.date}
                        name={previous.workoutName}
                        sets={previous.sets.length}
                      />
                      <ArrowUpRight
                        size={16}
                        aria-hidden
                        className='shrink-0 text-muted-foreground'
                      />
                    </button>
                  ) : (
                    <div className='mt-1 py-2.5'>
                      <SessionHead
                        date={previous.date}
                        name={previous.workoutName}
                        sets={previous.sets.length}
                      />
                    </div>
                  )}
                  <ol aria-label='Sets performed' className='source-set-list m-0 list-none p-0'>
                    {previous.sets.map((record, i) => (
                      <li
                        key={record.id}
                        aria-current={i === index ? 'true' : undefined}
                        className={cn(
                          'flex min-h-10 items-baseline gap-3 border-t border-border py-2 tabular-nums',
                          i === index && '-mx-2 bg-primary-tint px-2',
                        )}
                      >
                        <span
                          className={cn(
                            'w-5 shrink-0 text-[12px]',
                            i === index ? 'font-semibold text-primary' : 'text-muted-foreground',
                          )}
                        >
                          {i + 1}
                        </span>
                        <span className='min-w-0 flex-1 text-[16px] font-medium wrap-anywhere'>
                          <Spoken value={setText(record, exercise.type)} />
                        </span>
                        {i === index && (
                          <span className='shrink-0 text-[12px] font-medium text-primary'>
                            This set
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <p className='mt-2 text-[14px] text-muted-foreground'>
                  No matching history yet. Your targets are not historical records.
                </p>
              )}
            </section>
          </ResponsiveDialogBody>
          <ResponsiveDialogCornerClose label='Close previous sets' />
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      {sources && (open || sourceId) && (
        <WorkoutDrawer
          dataset={dataset}
          workoutId={sourceId}
          onClose={() => setSourceId(null)}
          returnFocus={() =>
            // A delete in the drawer can remove the tapped row; Close is then the way out.
            (trigger.current?.isConnected
              ? trigger.current
              : document.querySelector<HTMLElement>(
                  '.source-dialog [aria-label="Close previous sets"]',
                )
            )?.focus({preventScroll: true})
          }
        />
      )}
    </>
  );
}

function SessionHead({date, name, sets}: {date: string; name: string; sets: number}) {
  return (
    <span className='min-w-0 flex-1'>
      <span className='block text-card-title tabular-nums'>{dateLabel(date)}</span>
      <span className='mt-0.5 block text-[12px] font-normal wrap-anywhere text-muted-foreground'>
        {name} · {plural(sets, 'set')}
      </span>
    </span>
  );
}
