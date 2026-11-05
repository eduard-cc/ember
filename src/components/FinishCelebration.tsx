import * as DialogPrimitive from '@radix-ui/react-dialog';
import {Trophy} from 'lucide-react';
import {type CSSProperties, useEffect, useState} from 'react';

import {
  type PersonalRecord,
  type RecordKind,
  recordKindLabel,
  recordKinds,
  workoutVolume,
} from '../domain/finish-summary';
import type {Workout} from '../domain/types';
import {cue} from '../feedback';
import {reducedMotion} from '../utils/motion';
import {EmberHeart} from './EmberHeart';
import {ExerciseLine} from './exercise-line';
import {Button} from './ui/button';
import {RollingNumber} from './ui/rolling-number';

export interface Celebration {
  workout: Workout;
  records: PersonalRecord[];
}

// Sparks rise from the flame tip: [dx, dy, delay, duration, size], fixed so it plays the same.
const SPARKS = [
  [-34, -92, 0, 1300, 6],
  [22, -120, 90, 1500, 8],
  [46, -84, 200, 1200, 5],
  [-10, -146, 300, 1600, 7],
  [-58, -70, 380, 1250, 5],
  [34, -160, 470, 1700, 6],
  [6, -104, 560, 1400, 9],
  [-28, -132, 680, 1550, 5],
  [60, -118, 760, 1650, 6],
  [-46, -150, 880, 1800, 7],
  [14, -176, 980, 1900, 5],
  [-4, -80, 1100, 1300, 6],
] as const;

/** The Ember heart, lit once: the one place the app spends its delight budget. */
function LitHeart({still}: {still: boolean}) {
  return (
    <div className='relative grid size-32 place-items-center short:size-20' aria-hidden='true'>
      <div className='celebrate-glow absolute inset-[-40%] rounded-full bg-[radial-gradient(closest-side,rgb(245_177_61/0.32),transparent)]' />
      {!still &&
        SPARKS.map(([dx, dy, delay, duration, size], i) => (
          <span
            key={i}
            className='celebrate-spark absolute top-[30%] left-[62%] rounded-full bg-[#f5b13d] shadow-[0_0_8px_rgb(245_177_61/0.8)]'
            style={
              {
                width: size,
                height: size,
                '--dx': `${dx}px`,
                '--dy': `${dy}px`,
                '--delay': `${delay + 300}ms`,
                '--dur': `${duration}ms`,
              } as CSSProperties
            }
          />
        ))}
      <EmberHeart className='celebrate-heart relative size-28 drop-shadow-[0_8px_24px_rgb(245_177_61/0.35)] short:size-16' />
    </div>
  );
}

const recordValue = (kind: RecordKind, n: number) =>
  kind === 'reps'
    ? `${n} reps`
    : kind === 'volume'
      ? `${Math.round(n).toLocaleString('en-GB')} kg`
      : `${Number(n.toFixed(1))} kg`;

/** One row per exercise: the headline record with its gain, every record named under it. */
function RecordRow({records, delay}: {records: PersonalRecord[]; delay: number}) {
  const sorted = [...records].sort(
    (a, b) => recordKinds.indexOf(a.kind) - recordKinds.indexOf(b.kind),
  );
  const lead = sorted[0];
  return (
    <li
      className='celebrate-rise flex items-center gap-3 border border-border bg-card p-3'
      style={{animationDelay: `${delay}ms`}}
    >
      <span className='grid size-10 shrink-0 place-items-center bg-primary-tint text-primary'>
        <Trophy size={20} aria-hidden='true' />
      </span>
      <div className='min-w-0 flex-1'>
        <p className='line-clamp-2 text-sm font-semibold [overflow-wrap:anywhere] text-foreground'>
          {lead.exercise}
        </p>
        <p className='text-[12px] text-pretty text-muted-foreground'>
          {sorted.map((record) => recordKindLabel[record.kind]).join(' · ')}
        </p>
      </div>
      <div className='shrink-0 text-right'>
        <p className='text-sm font-semibold text-foreground tabular-nums'>
          {recordValue(lead.kind, lead.value)}
        </p>
        <p className='text-[12px] font-medium text-success tabular-nums'>
          +{recordValue(lead.kind, lead.value - lead.previous)}
        </p>
      </div>
    </li>
  );
}

const stagger = 180;

/**
 * The finish moment, shown only after the finish transaction committed: the lit heart, the
 * session's duration, sets and volume, the personal records it set and its exercises. Done, Escape
 * and the back gesture all close it onto History.
 */
export function FinishCelebration({
  celebration,
  onDone,
}: {
  celebration: Celebration | null;
  onDone: () => void;
}) {
  return (
    <DialogPrimitive.Root
      open={!!celebration}
      onOpenChange={(open) => {
        if (!open) onDone();
      }}
    >
      <DialogPrimitive.Portal>
        {celebration && (
          <CelebrationContent key={celebration.workout.id} celebration={celebration} />
        )}
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function CelebrationContent({celebration: {workout, records}}: {celebration: Celebration}) {
  const [still] = useState(reducedMotion);
  const [counted, setCounted] = useState(still);
  const names = [...new Set(records.map((record) => record.exercise))];
  useEffect(() => {
    cue('finish');
    const timers = [
      setTimeout(() => setCounted(true), 450),
      ...names.map((_, i) => setTimeout(() => cue('pr'), 850 + i * stagger)),
    ];
    return () => timers.forEach(clearTimeout);
    // Plays once when the celebration opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const sets = workout.exercises.reduce((n, exercise) => n + exercise.sets.length, 0);
  const volume = Math.round(workoutVolume(workout));
  const minutes = workout.duration;
  const date = new Date(workout.date).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const count = {
    transformTiming: {duration: 900, easing: 'cubic-bezier(0.23, 1, 0.32, 1)'},
    locales: 'en-GB',
  };
  // A session under a minute reads "<1"; 0 is an unknown duration, as in History.
  const stats: {label: string; value: number | string; unit: string}[] = [
    minutes
      ? {label: 'Duration', value: minutes < 1 ? '<1' : minutes, unit: 'min'}
      : {label: 'Duration', value: '—', unit: ''},
    {label: 'Sets', value: sets, unit: ''},
    {label: 'Volume', value: volume, unit: 'kg'},
  ];
  const prNames = new Set(names);
  return (
    <DialogPrimitive.Content
      className='finish-celebration fixed inset-0 z-50 flex flex-col bg-background outline-none'
      aria-describedby={undefined}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        (event.currentTarget as HTMLElement)
          .querySelector<HTMLButtonElement>('.celebrate-done')
          ?.focus();
      }}
      onCloseAutoFocus={(event) => {
        // The trigger (the confirmation) is gone; focus lands on the new workout in History.
        event.preventDefault();
        document.querySelector<HTMLElement>('.focused-history button')?.focus();
      }}
    >
      <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-[calc(2.5rem+env(safe-area-inset-top))] pb-6 short:pt-4'>
        <div className='mx-auto max-w-[560px]'>
          <div className='grid justify-items-center text-center'>
            <LitHeart still={still} />
            <DialogPrimitive.Title
              className='celebrate-rise mt-2 text-page-title text-foreground'
              style={{animationDelay: '250ms'}}
            >
              Workout complete
            </DialogPrimitive.Title>
            <p
              className='celebrate-rise mt-1 text-sm text-balance [overflow-wrap:anywhere] text-muted-foreground'
              style={{animationDelay: '320ms'}}
            >
              {workout.name} · {date}
            </p>
          </div>

          <dl
            className='celebrate-rise mt-7 grid grid-cols-3 divide-x divide-border border-y border-border py-4'
            style={{animationDelay: '420ms'}}
          >
            {stats.map(({label, value, unit}) => (
              <div key={label} className='grid min-w-0 justify-items-center gap-1 px-1'>
                <dt className='text-[12px] text-muted-foreground'>{label}</dt>
                <dd
                  className='flex flex-wrap items-baseline justify-center text-stat text-foreground tabular-nums narrow:text-[22px]'
                  data-stat={label}
                >
                  {typeof value === 'string' ? (
                    value
                  ) : (
                    <RollingNumber value={counted ? value : 0} {...count} />
                  )}
                  {unit && (
                    <span className='ml-0.5 text-sm font-medium text-muted-foreground'>{unit}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>

          {records.length > 0 && (
            <section className='mt-7' aria-labelledby='celebrate-records'>
              <h2
                id='celebrate-records'
                className='celebrate-rise mb-3'
                style={{animationDelay: '700ms'}}
              >
                {records.length === 1 ? 'New personal record' : 'New personal records'}
              </h2>
              <ul className='grid gap-2'>
                {names.map((name, i) => (
                  <RecordRow
                    key={name}
                    records={records.filter((record) => record.exercise === name)}
                    delay={800 + i * stagger}
                  />
                ))}
              </ul>
            </section>
          )}

          <section
            className='celebrate-rise mt-7'
            aria-labelledby='celebrate-exercises'
            style={{animationDelay: `${records.length ? 1000 + names.length * stagger : 600}ms`}}
          >
            <h2
              id='celebrate-exercises'
              className='mb-1 text-[12px] font-medium text-muted-foreground'
            >
              Exercises
            </h2>
            <ul className='grid gap-0.5'>
              {workout.exercises.map((exercise, i) => (
                <ExerciseLine key={i} exercise={exercise} record={prNames.has(exercise.name)} />
              ))}
            </ul>
          </section>
        </div>
      </div>
      <div className='shrink-0 border-t border-border p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] short:py-2'>
        <DialogPrimitive.Close asChild>
          <Button
            variant='primary'
            className='celebrate-done mx-auto flex min-h-12 w-full max-w-[560px] text-base desk:max-w-[320px]'
            onClick={() => cue('tick')}
          >
            Done
          </Button>
        </DialogPrimitive.Close>
      </div>
    </DialogPrimitive.Content>
  );
}
