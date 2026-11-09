import {ArrowLeft, ChevronRight, History, Info, Trophy} from 'lucide-react';
import {type ReactElement, type ReactNode, useId, useMemo, useRef, useState} from 'react';

import {bodyPartOf, catalogEntry} from '../catalog/catalog';
import {Drawing, ExerciseThumb} from '../components/ExerciseThumb';
import {WorkoutDrawer} from '../components/WorkoutDrawer';
import {Spoken} from '../components/exercise-line';
import {InfoButton, InfoTerm} from '../components/info-button';
import {RecordedSets} from '../components/recorded-sets';
import {Button} from '../components/ui/button';
import {EmptyState} from '../components/ui/empty-state';
import {chartNumber} from '../domain/chart-scale';
import {
  type PersonalRecord,
  recordKindLabel,
  recordKindShort,
  recordKinds,
  recordsAt,
} from '../domain/finish-summary';
import {exerciseWorkoutCount, getHistory, getRecords} from '../domain/model';
import type {Dataset, SetRecord} from '../domain/types';
import {cn} from '../utils/cn';
import {dateLabel} from '../utils/date';
import {plural} from '../utils/plural';
import {type SetText, setText} from '../utils/set-label';
import {ExerciseCharts} from './ExerciseCharts';

const tabs = ['Charts', 'History', 'Records', 'About'] as const;
type Tab = (typeof tabs)[number];
const kg = (n: number) => `${Number(n.toFixed(1)).toLocaleString('en-GB')} kg`;

function Fact({label, value}: {label: string; value: string}) {
  return (
    <div>
      <dt className='text-[12px] text-muted-foreground'>{label}</dt>
      <dd className='mt-1 text-[14px] font-medium wrap-anywhere'>{value}</dd>
    </div>
  );
}

function About({name, framed}: {name: string; framed: boolean}) {
  const entry = catalogEntry(name);
  if (!entry)
    return (
      <EmptyState
        icon={Info}
        title='Custom exercise'
        description='Not in the exercise catalog. Its history, charts and records are still here.'
        framed={framed}
      />
    );
  return (
    <div className='about space-y-7'>
      {entry.images.length > 0 && (
        <div
          className='about-drawings mx-auto grid max-w-[480px] grid-cols-2 gap-2.5'
          aria-hidden='true'
        >
          {entry.images.map((image) => (
            <Drawing
              key={image.file}
              file={image.file}
              className={cn(
                'aspect-square h-auto w-full rounded-none outline outline-border',
                // A single drawing keeps the size of one drawing in a start/finish pair.
                entry.images.length === 1 && 'col-span-full w-[calc(50%-5px)] justify-self-center',
              )}
            />
          ))}
        </div>
      )}
      {entry.images.length === 0 && (
        <p className='rounded-card border border-border bg-card p-4 text-[14px] text-muted-foreground'>
          No drawing available.
        </p>
      )}
      <section>
        <h3 className='mb-3 text-[16px] font-semibold'>Exercise details</h3>
        <dl className='grid grid-cols-2 gap-4 border-t border-border pt-3'>
          <Fact label='Body part' value={entry.bodyPart} />
          <Fact label='Equipment' value={entry.equipment} />
        </dl>
      </section>
      {(entry.primaryMuscles.length > 0 || entry.secondaryMuscles.length > 0) && (
        <section>
          <h3 className='mb-3 text-[16px] font-semibold'>Muscles</h3>
          <dl className='grid gap-4 border-t border-border pt-3'>
            {entry.primaryMuscles.length > 0 && (
              <Fact label='Primary muscles' value={entry.primaryMuscles.join(', ')} />
            )}
            {entry.secondaryMuscles.length > 0 && (
              <Fact label='Secondary muscles' value={entry.secondaryMuscles.join(', ')} />
            )}
          </dl>
        </section>
      )}
    </div>
  );
}

/** Workout PRs this exercise set, keyed by workout; only the first block of a workout shows them. */
function useRecordsByWorkout(dataset: Dataset, name: string, ids: string[]) {
  return useMemo(() => {
    const byId = new Map(dataset.workouts.map((workout) => [workout.id, workout]));
    const found = new Map<string, PersonalRecord[]>();
    for (const id of new Set(ids)) {
      const workout = byId.get(id);
      if (!workout) continue;
      const records = recordsAt(workout, dataset)
        .filter((record) => record.exercise === name)
        .sort((a, b) => recordKinds.indexOf(a.kind) - recordKinds.indexOf(b.kind));
      if (records.length) found.set(id, records);
    }
    return found;
  }, [dataset, name, ids]);
}

function HistoryTab({
  dataset,
  name,
  onSource,
  framed,
}: {
  dataset: Dataset;
  name: string;
  onSource: (id: string, opener: HTMLElement) => void;
  framed: boolean;
}) {
  const [limit, setLimit] = useState(10);
  const history = useMemo(() => getHistory(dataset, name), [dataset, name]);
  const shown = useMemo(() => history.slice(0, limit), [history, limit]);
  const shownIds = useMemo(() => shown.map((session) => session.workoutId), [shown]);
  const records = useRecordsByWorkout(dataset, name, shownIds);
  if (!history.length)
    return (
      <EmptyState
        icon={History}
        title='No history yet'
        description='Sessions appear here after you finish a workout with this exercise.'
        framed={framed}
      />
    );
  return (
    <div className='flex flex-col gap-3'>
      {shown.map((session, i) => {
        const kinds =
          shown[i - 1]?.workoutId === session.workoutId
            ? undefined
            : records.get(session.workoutId);
        return (
          <article
            className='session-card relative min-w-0 rounded-card border border-border bg-card px-4 pt-3 pb-1'
            key={`${session.workoutId}-${i}`}
          >
            <header className='flex items-start gap-3'>
              <span className='min-w-0 flex-1'>
                <h3 className='text-card-title tabular-nums'>{dateLabel(session.date)}</h3>
                <span className='mt-0.5 block text-[12px] wrap-anywhere text-muted-foreground'>
                  {session.workoutName} · {plural(session.sets.length, 'set')}
                </span>
                {kinds && (
                  <span className='mt-1 flex items-start gap-1 text-[12px] text-pretty text-primary'>
                    <Trophy
                      size={14}
                      className='mt-px shrink-0'
                      aria-label='Personal records'
                      role='img'
                    />
                    {/* Short names keep the line to one row; screen readers get the full ones. */}
                    <span aria-hidden='true'>
                      {kinds.map((record) => recordKindShort[record.kind]).join(' · ')}
                    </span>
                    <span className='sr-only'>
                      {kinds.map((record) => recordKindLabel[record.kind]).join(', ')}
                    </span>
                  </span>
                )}
              </span>
              {/* The whole card opens the workout; the table stays plain text for reading. */}
              <button
                type='button'
                className='session-source -mr-3.5 flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground after:absolute after:inset-0 after:rounded-card focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-1 focus-visible:after:outline-ring'
                aria-label={`View source workout ${session.workoutName} ${dateLabel(session.date)}`}
                onClick={(event) => onSource(session.workoutId, event.currentTarget)}
              >
                <ChevronRight size={16} aria-hidden />
              </button>
            </header>
            <RecordedSets sets={session.sets} type={session.type} className='mt-2' />
          </article>
        );
      })}
      {history.length > limit && (
        <Button onClick={() => setLimit((n) => n + 20)}>Show more sessions</Button>
      )}
      {history.some((session) => session.type === 'weighted') && (
        <p className='text-[12px] text-muted-foreground'>
          Est. 1RM uses the Epley formula, for weighted sets of 1–10 reps.
        </p>
      )}
    </div>
  );
}

const sectionHeadingClass =
  'mb-2 flex min-h-6 items-center justify-between gap-2 text-[14px] font-semibold';
const sourceRowClass =
  'pressable grid min-h-14 w-full items-center gap-3 py-2.5 text-left text-foreground hover:bg-accent focus-visible:-outline-offset-2';

type Source = {workoutId: string; workoutName: string; date: string};

/** One record: what it is, its value large, then where it came from. Opens its workout. */
function RecordRow({
  label,
  value,
  spoken,
  detail,
  source,
  onSource,
}: {
  label: string;
  value: ReactNode;
  /** The value as read aloud, when it differs from its text. */
  spoken: string;
  /** The actual set behind a computed value. */
  detail?: SetText;
  source: Source;
  onSource: (id: string, opener: HTMLElement) => void;
}) {
  return (
    <li>
      <button
        type='button'
        className={cn(sourceRowClass, 'grid-cols-[minmax(0,1fr)_16px]')}
        aria-label={`View source workout for ${label}: ${spoken}${detail ? `, from ${detail.spoken ?? detail.text}` : ''}, ${dateLabel(source.date)}, ${source.workoutName}`}
        onClick={(event) => onSource(source.workoutId, event.currentTarget)}
      >
        <span className='min-w-0'>
          <span className='block text-[12px] text-muted-foreground'>{label}</span>
          <strong className='mt-0.5 block text-set-value tabular-nums'>{value}</strong>
          <span className='mt-0.5 block text-[12px] wrap-anywhere text-muted-foreground'>
            {detail && <span className='tabular-nums'>from {detail.text} · </span>}
            <span className='tabular-nums'>{dateLabel(source.date)}</span> · {source.workoutName}
          </span>
        </span>
        <ChevronRight aria-hidden className='size-4 text-muted-foreground' />
      </button>
    </li>
  );
}

function RecordsTab({
  dataset,
  name,
  onSource,
  framed,
}: {
  dataset: Dataset;
  name: string;
  onSource: (id: string, opener: HTMLElement) => void;
  framed: boolean;
}) {
  const records = useMemo(() => getRecords(dataset, name), [dataset, name]);
  const history = useMemo(() => getHistory(dataset, name), [dataset, name]);
  const typeOf = (set: SetRecord) =>
    history.find((session) => session.sets.includes(set))?.type ?? 'weighted';
  if (
    !records.heaviest &&
    !records.leastAssistance &&
    !records.mostReps &&
    !records.bestSetVolume &&
    !records.sessionVolume &&
    !records.estimated &&
    !records.repBests.length
  )
    return (
      <EmptyState
        icon={Trophy}
        title='No records yet'
        description='Records come from your completed sets.'
        framed={framed}
      />
    );
  const setRow = (label: string, entry: (Source & {set: SetRecord}) | null) => {
    if (!entry) return null;
    const actual = setText(entry.set, typeOf(entry.set));
    return (
      <RecordRow
        key={label}
        label={label}
        value={<Spoken value={actual} />}
        spoken={actual.spoken ?? actual.text}
        source={entry}
        onSource={onSource}
      />
    );
  };
  const mostReps = records.mostReps;
  const mostRepsSet = mostReps && setText(mostReps.set, typeOf(mostReps.set));
  const best = [
    setRow('Heaviest weight', records.heaviest),
    setRow('Least assistance', records.leastAssistance),
    mostReps && mostRepsSet && (
      <RecordRow
        key='Most reps'
        label='Most reps'
        value={plural(mostReps.value, 'rep')}
        spoken={plural(mostReps.value, 'rep')}
        // A bodyweight set is just its reps; a loaded one names the weight it was done with.
        detail={mostRepsSet.text === plural(mostReps.value, 'rep') ? undefined : mostRepsSet}
        source={mostReps}
        onSource={onSource}
      />
    ),
  ].filter(Boolean);
  const volume = [
    records.bestSetVolume && (
      <RecordRow
        key='Best set'
        label='Best set'
        value={kg(records.bestSetVolume.value)}
        spoken={kg(records.bestSetVolume.value)}
        detail={setText(records.bestSetVolume.set, typeOf(records.bestSetVolume.set))}
        source={records.bestSetVolume}
        onSource={onSource}
      />
    ),
    records.sessionVolume && (
      <RecordRow
        key='Best session'
        label='Best session'
        value={kg(records.sessionVolume.value)}
        spoken={kg(records.sessionVolume.value)}
        source={records.sessionVolume}
        onSource={onSource}
      />
    ),
  ].filter(Boolean);
  return (
    <div className='records min-w-0 space-y-6'>
      {best.length > 0 && (
        <section>
          <h3 className={sectionHeadingClass}>Best sets</h3>
          <ul className='divide-y divide-border border-y border-border' aria-label='Best sets'>
            {best}
          </ul>
        </section>
      )}
      {records.repBests.length > 0 && (
        <section>
          <h3 className={sectionHeadingClass}>Heaviest weight for each rep count</h3>
          <ul
            className='divide-y divide-border border-y border-border'
            aria-label='Heaviest weight for each rep count'
          >
            {records.repBests.map((entry) => (
              <li key={entry.reps}>
                <button
                  type='button'
                  className={cn(
                    sourceRowClass,
                    'min-h-12 grid-cols-[4.5rem_minmax(0,1fr)_auto_16px] py-2',
                  )}
                  aria-label={`View source workout for ${plural(entry.reps, 'rep')}: ${`${chartNumber(entry.value)} kg`}, ${dateLabel(entry.date)}, ${entry.workoutName}`}
                  onClick={(event) => onSource(entry.workoutId, event.currentTarget)}
                >
                  <span className='text-[14px] text-muted-foreground tabular-nums'>
                    {plural(entry.reps, 'rep')}
                  </span>
                  <strong className='text-[16px] font-semibold tabular-nums'>
                    {`${chartNumber(entry.value)} kg`}
                  </strong>
                  <span className='text-[12px] text-muted-foreground tabular-nums'>
                    {dateLabel(entry.date)}
                  </span>
                  <ChevronRight aria-hidden className='size-4 text-muted-foreground' />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {volume.length > 0 && (
        <section>
          <h3 className={sectionHeadingClass}>Volume (weight × reps)</h3>
          <ul className='divide-y divide-border border-y border-border' aria-label='Volume'>
            {volume}
          </ul>
        </section>
      )}
      {records.estimated && (
        <section>
          <div className={sectionHeadingClass}>
            <h3 className='text-[14px]'>Estimated</h3>
            <InfoButton title='Estimated 1RM' label='About Est. 1RM' className='-my-3 -mr-3'>
              <InfoTerm term='Est. 1RM (Epley)'>
                An estimate of the most you could lift once: weight × (1 + reps ÷ 30), from your
                best weighted set of 1–10 reps. A single rep counts as lifted.
              </InfoTerm>
            </InfoButton>
          </div>
          <ul className='border-y border-border' aria-label='Estimated'>
            <RecordRow
              label='Est. 1RM (Epley)'
              value={kg(records.estimated.value)}
              spoken={kg(records.estimated.value)}
              detail={setText(records.estimated.set, 'weighted')}
              source={records.estimated}
              onSource={onSource}
            />
          </ul>
        </section>
      )}
    </div>
  );
}

/** Exercise evidence: Charts / History / Records / About, traceable to recorded sets. */
export function ExerciseDetail({
  dataset,
  name,
  onBack,
  backLabel = 'Back to exercises',
  renderTitle = (heading) => heading,
  emptyFramed = true,
}: {
  dataset: Dataset;
  name: string;
  onBack: () => void;
  backLabel?: string;
  /** Lets a dialog host wrap the name heading as its accessible title. */
  renderTitle?: (heading: ReactElement) => ReactNode;
  /** False when a dialog hosts the details: empty states then sit on its surface unframed. */
  emptyFramed?: boolean;
}) {
  // Unique workouts, matching the Exercises list; History/Charts/Records stay per exercise block.
  const workouts = useMemo(() => exerciseWorkoutCount(dataset, name), [dataset, name]);
  const [tab, setTab] = useState<Tab>(workouts ? 'Charts' : 'About');
  const [tabMotion, setTabMotion] = useState(false);
  // The library and the workout can both show details at once; ids must stay unique.
  const id = useId();
  // A session opens its workout right here, over these details; closing it returns to the row.
  const [openId, setOpenId] = useState<string | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  // The tapped row itself: Safari on iPhone does not focus a button it taps.
  const onSource = (workoutId: string, opener: HTMLElement) => {
    trigger.current = opener;
    setOpenId(workoutId);
  };
  return (
    <div className='exercise-detail'>
      <header className='detail-header mb-3.5 flex items-center gap-3'>
        <Button variant='ghost' size='icon' aria-label={backLabel} onClick={onBack}>
          <ArrowLeft size={20} />
        </Button>
        <ExerciseThumb name={name} />
        <div className='min-w-0'>
          {renderTitle(<h2 className='text-[18px] wrap-anywhere'>{name}</h2>)}
          <p className='mt-0.5 text-[12px] text-muted-foreground'>
            {bodyPartOf(name)} · {plural(workouts, 'workout')}
          </p>
        </div>
      </header>
      <div
        className='exercise-tabs sticky -top-6 z-1 -mx-1 mb-[18px] flex border-b border-border bg-background [.exercise-detail-panel_&]:max-desk:-top-[18px]'
        role='tablist'
        aria-label='Exercise sections'
      >
        {tabs.map((value) => (
          <button
            key={value}
            role='tab'
            id={`${id}-tab-${value}`}
            aria-selected={tab === value}
            aria-controls={`${id}-panel`}
            tabIndex={tab === value ? 0 : -1}
            className='min-h-[46px] min-w-0 flex-1 border-0 bg-transparent text-[14px] font-medium text-muted-foreground focus-visible:-outline-offset-2 aria-selected:text-foreground'
            onClick={(event) => {
              setTabMotion(event.detail > 0);
              setTab(value);
            }}
            onKeyDown={(event) => {
              const index = tabs.indexOf(value);
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % tabs.length
                  : event.key === 'ArrowLeft'
                    ? (index + tabs.length - 1) % tabs.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? tabs.length - 1
                        : null;
              if (next === null) return;
              event.preventDefault();
              setTabMotion(false);
              setTab(tabs[next]);
              document.getElementById(`${id}-tab-${tabs[next]}`)?.focus();
            }}
          >
            {value}
          </button>
        ))}
        <span
          aria-hidden='true'
          className={cn(
            'tab-underline pointer-events-none absolute -bottom-px left-0 h-0.5 w-1/4 bg-primary',
            tabMotion && 'transition-transform duration-200 ease-(--ease-out)',
          )}
          style={{transform: `translateX(${tabs.indexOf(tab) * 100}%)`}}
        />
      </div>
      <div role='tabpanel' id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`}>
        {tab === 'About' && <About name={name} framed={emptyFramed} />}
        {tab === 'History' && (
          <HistoryTab dataset={dataset} name={name} onSource={onSource} framed={emptyFramed} />
        )}
        {tab === 'Charts' && (
          <ExerciseCharts
            key={name}
            dataset={dataset}
            name={name}
            onSource={onSource}
            framed={emptyFramed}
          />
        )}
        {tab === 'Records' && (
          <RecordsTab dataset={dataset} name={name} onSource={onSource} framed={emptyFramed} />
        )}
      </div>
      <WorkoutDrawer
        dataset={dataset}
        workoutId={openId}
        onClose={() => setOpenId(null)}
        returnFocus={() => {
          // An edit or delete can remove the tapped row; the selected tab is then the way back.
          const target = trigger.current?.isConnected
            ? trigger.current
            : document.getElementById(`${id}-tab-${tab}`);
          target?.focus({preventScroll: true});
        }}
      />
    </div>
  );
}
