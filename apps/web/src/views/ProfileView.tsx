import {ChevronDown, ChevronRight} from 'lucide-react';
import {type ReactNode, type RefObject, useMemo, useRef, useState} from 'react';
import {Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis} from 'recharts';

import type {Muscle} from '../catalog/catalog';
import {BodyFigure, ToneSwatch} from '../components/BodyFigure';
import {ExercisePage} from '../components/ExercisePage';
import {ExerciseThumb} from '../components/ExerciseThumb';
import {WorkoutDrawer} from '../components/WorkoutDrawer';
import {InfoButton, InfoTerm} from '../components/info-button';
import {SegmentToggle} from '../components/segment-toggle';
import {ChartInspection} from '../components/trend-area';
import {Button} from '../components/ui/button';
import {Card} from '../components/ui/card';
import {ChartContainer, ChartTooltip} from '../components/ui/chart';
import {EmptyState} from '../components/ui/empty-state';
import {chartDomain, compactTick} from '../domain/chart-scale';
import {type RecordKind, recordKindLabel} from '../domain/finish-summary';
import {weekStartOf, workoutsPerWeek} from '../domain/model';
import {type Tone, muscleSets, regionTones, regionsOf, toneEdges} from '../domain/muscles';
import {
  type RecentRecord,
  type WeekMetric,
  minutesLabel,
  recentRecords,
  weekComparison,
} from '../domain/profile';
import {setCount} from '../domain/sets';
import type {Dataset, Workout} from '../domain/types';
import {durationLabel} from '../domain/workout-duration';
import {useBackLayer} from '../state/back';
import {cn} from '../utils/cn';
import {localDay} from '../utils/date';

type Week = ReturnType<typeof workoutsPerWeek>[number];
type Range = '13' | '26' | '52';
const metrics: {value: WeekMetric; label: string}[] = [
  {value: 'count', label: 'Workouts'},
  {value: 'volume', label: 'Volume'},
  {value: 'time', label: 'Time'},
];
const ranges: {value: Range; label: string}[] = [
  {value: '13', label: '3M'},
  {value: '26', label: '6M'},
  {value: '52', label: '1Y'},
];
const LIST = 4;

const noon = (day: string) => new Date(`${day.slice(0, 10)}T12:00:00`);
const format = (day: string, options: Intl.DateTimeFormatOptions) =>
  noon(day).toLocaleDateString('en-GB', options);
const dayMonth = (day: string) => format(day, {day: 'numeric', month: 'short'});
/** "2 – 8 Nov", or "27 Oct – 2 Nov" across a month. */
function weekSpan(start: string) {
  const end = noon(start);
  end.setDate(end.getDate() + 6);
  const last = localDay(end);
  return noon(start).getMonth() === end.getMonth()
    ? `${noon(start).getDate()} – ${dayMonth(last)}`
    : `${dayMonth(start)} – ${dayMonth(last)}`;
}
const grouped = (n: number) => Math.round(n).toLocaleString('en-GB');
/** Exact kg, as recorded: 102.5 stays 102.5. */
const kg = (n: number) => `${Number(n.toFixed(2)).toLocaleString('en-GB')} kg`;
/** A week's value in words: "3 workouts", "12,000 kg", "4 h 30 min". */
function metricText(metric: WeekMetric, value: number) {
  if (metric === 'count')
    return `${Number(value.toFixed(1))} ${value === 1 ? 'workout' : 'workouts'}`;
  return metric === 'volume' ? kg(value) : minutesLabel(value);
}

/** The headline number with its units muted; time reads as hours and minutes. */
function Headline({metric, value}: {metric: WeekMetric; value: number}) {
  const unit = 'text-sm font-medium text-muted-foreground';
  if (metric === 'time') {
    // Same rounding as minutesLabel: whole minutes, normalised at the hour.
    const total = Math.round(value);
    const h = Math.floor(total / 60);
    return (
      <p className='flex items-baseline gap-1.5 text-foreground'>
        {h > 0 && (
          <>
            <span className='numeric text-stat'>{h}</span>
            <span className={unit}>h</span>
          </>
        )}
        <span className='numeric text-stat'>{value > 0 && value < 1 ? '<1' : total % 60}</span>
        <span className={unit}>min</span>
      </p>
    );
  }
  return (
    <p className='flex items-baseline gap-1.5 text-foreground'>
      <span className='numeric text-stat'>
        {metric === 'volume' ? Number(value.toFixed(2)).toLocaleString('en-GB') : value}
      </span>
      <span className={unit}>
        {metric === 'volume' ? 'kg' : value === 1 ? 'workout' : 'workouts'}
      </span>
    </p>
  );
}

function HatchSwatch() {
  return (
    <svg className='size-2.5' aria-hidden='true'>
      <defs>
        <pattern
          id='week-so-far-swatch'
          width='3'
          height='3'
          patternUnits='userSpaceOnUse'
          patternTransform='rotate(45)'
        >
          <rect width='3' height='3' fill='hsl(var(--chart-secondary))' fillOpacity={0.35} />
          <line y2='3' stroke='hsl(var(--chart-secondary-edge))' strokeWidth={1.5} />
        </pattern>
      </defs>
      <rect width='10' height='10' fill='url(#week-so-far-swatch)' />
    </svg>
  );
}

/**
 * Twelve-plus local Monday weeks: last full week against the usual week, the running week hatched
 * "so far", and a week list (the exact-value alternative) whose workouts open in place.
 */
function EveryWeek({
  dataset,
  byId,
  today,
}: {
  dataset: Dataset;
  byId: Map<string, Workout>;
  today: string;
}) {
  const {workouts} = dataset;
  const [metric, setMetric] = useState<WeekMetric>('count');
  const [range, setRange] = useState<Range>('13');
  const [hover, setHover] = useState<Week | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const sources = useRef(new Map<string, HTMLButtonElement>());
  const weeks = useMemo(
    () => workoutsPerWeek(workouts, Number(range), noon(today)),
    [workouts, range, today],
  );
  const first = workouts.at(-1)?.date;
  const {last, usual} = weekComparison(weeks, metric, first);
  const running = weeks.at(-1)!;
  // The headline week: the inspected one, else the last full week, else (history began this
  // week) the running week.
  const lead = hover ?? (last === null ? running : weeks[last]);
  const plotted = (week: Week) => (metric === 'time' ? week.time / 60 : week[metric]);
  const usualPlot = usual === null ? null : metric === 'time' ? usual / 60 : usual;
  const {domain, ticks} = chartDomain([
    0,
    Math.max(metric === 'count' ? 3 : 1, ...weeks.map(plotted), usualPlot ?? 0),
  ]);
  const tickText = (tick: number) => `${compactTick(tick)}${metric === 'time' ? 'h' : ''}`;
  const axisWidth = Math.max(30, ...ticks.map((tick) => tickText(tick).length * 7 + 8));
  // Month labels at the first week starting in each month (every other month over a year).
  const monthWeeks = weeks
    .filter((week) => noon(week.start).getDate() <= 7)
    .map((week) => week.start)
    .filter((_, i, list) => range !== '52' || (list.length - 1 - i) % 2 === 0);
  const from = first ? weekStartOf(first) : null;
  const listed = from ? weeks.filter((week) => week.start >= from).reverse() : [];
  const label = metrics.find((m) => m.value === metric)!.label;
  if (!workouts.length)
    return (
      <Card as='section' className='grid gap-4'>
        <h2 className='text-card-title'>Every week</h2>
        <EmptyState
          framed={false}
          titleAs='h3'
          title='No workouts yet'
          description='Finished workouts show up here by week.'
        />
      </Card>
    );
  return (
    <Card as='section' className='grid gap-4'>
      <h2 className='text-card-title'>Every week</h2>
      <SegmentToggle
        value={metric}
        onChange={(next) => {
          setHover(null);
          setMetric(next);
        }}
        label='Show per week'
        items={metrics}
        className='w-full flex-wrap'
        itemClassName='flex-1'
      />
      <div className='weekly-headline min-h-[4.25rem]'>
        <Headline metric={metric} value={lead[metric]} />
        <p className='mt-1 text-label font-normal text-muted-foreground'>
          <span className='text-foreground'>
            {lead === running
              ? 'This week so far'
              : !hover
                ? `Last week, ${weekSpan(lead.start)}`
                : weekSpan(lead.start)}
          </span>
          {usual !== null && <> · usual {metricText(metric, usual)}</>}
        </p>
      </div>
      <div className='grid gap-1.5'>
        <ChartContainer
          key={`${metric}-${range}`}
          className='week-chart -mx-1 aspect-auto h-44'
          config={{value: {color: 'hsl(var(--chart-secondary))'}}}
          role='img'
          aria-label={`${label} per week, last ${range} weeks. ${weeks.map((w) => `${weekSpan(w.start)}: ${metricText(metric, w[metric])}`).join(', ')}.`}
        >
          <BarChart
            data={weeks}
            margin={{left: 4, right: 4, top: 10, bottom: 0}}
            barCategoryGap={range === '52' ? '14%' : '22%'}
            accessibilityLayer
          >
            <defs>
              <pattern
                id='week-so-far'
                width='4'
                height='4'
                patternUnits='userSpaceOnUse'
                patternTransform='rotate(45)'
              >
                <rect width='4' height='4' fill='hsl(var(--chart-secondary))' fillOpacity={0.35} />
                <line y2='4' stroke='hsl(var(--chart-secondary-edge))' strokeWidth={2.5} />
              </pattern>
            </defs>
            <CartesianGrid vertical={false} stroke='hsl(var(--border))' />
            <XAxis
              dataKey='start'
              tickLine={false}
              axisLine={false}
              interval={0}
              height={22}
              ticks={monthWeeks}
              tick={{fontSize: 11}}
              tickFormatter={(start: string) => format(start, {month: 'short'})}
            />
            <YAxis
              orientation='right'
              width={axisWidth}
              tickLine={false}
              axisLine={false}
              allowDecimals={metric !== 'count'}
              tick={{fontSize: 11, className: 'numeric'}}
              tickFormatter={tickText}
              domain={domain}
              ticks={ticks}
            />
            <ChartTooltip
              cursor={{fill: 'hsl(var(--foreground))', fillOpacity: 0.05}}
              content={(props) => (
                <ChartInspection<Week> {...(props as object)} data={weeks} onChange={setHover} />
              )}
            />
            <Bar
              dataKey={plotted}
              isAnimationActive={false}
              // A zero week since history began gets a sliver; weeks before it get nothing.
              minPointSize={(_: unknown, index: number) =>
                from && weeks[index].start >= from ? 2 : 0
              }
            >
              {weeks.map((week) => (
                <Cell
                  key={week.start}
                  className={
                    week === running ? 'so-far-week' : week === lead ? 'shown-week' : undefined
                  }
                  fill={
                    week === running
                      ? 'url(#week-so-far)'
                      : week === lead
                        ? 'hsl(var(--primary))'
                        : 'hsl(var(--chart-secondary))'
                  }
                  stroke={
                    week === lead && week !== running ? 'none' : 'hsl(var(--chart-secondary-edge))'
                  }
                  strokeWidth={1}
                />
              ))}
            </Bar>
            {usualPlot !== null && (
              <ReferenceLine
                className='usual-line'
                y={usualPlot}
                stroke='hsl(var(--foreground))'
                strokeOpacity={0.55}
                strokeDasharray='4 4'
                strokeWidth={1.5}
                ifOverflow='extendDomain'
              />
            )}
          </BarChart>
        </ChartContainer>
        <p className='flex justify-end gap-3 text-caption text-muted-foreground' aria-hidden='true'>
          {usual !== null && (
            <span className='flex items-center gap-1.5'>
              <i className='w-3 border-t-[1.5px] border-dashed border-foreground/55' /> usual
            </span>
          )}
          <span className='flex items-center gap-1.5'>
            <HatchSwatch /> so far
          </span>
        </p>
      </div>
      <SegmentToggle
        value={range}
        onChange={(next) => {
          setHover(null);
          setAll(false);
          setRange(next);
        }}
        label='Time range'
        items={ranges}
        className='w-full'
        itemClassName='flex-1'
      />
      <section className='mt-2'>
        <h3 className='mb-2 flex items-baseline justify-between text-[14px] font-semibold'>
          Weeks
          <span className='text-[12px] font-normal text-muted-foreground tabular-nums'>
            {listed.length} {listed.length === 1 ? 'week' : 'weeks'}
          </span>
        </h3>
        <ul aria-label='Weeks' className='divide-y divide-border border-y border-border'>
          {(all ? listed : listed.slice(0, LIST)).map((week) => {
            const open = expanded === week.start;
            const others = metrics
              .filter((m) => m.value !== metric)
              .map((m) => metricText(m.value, week[m.value]))
              .join(' · ');
            const title = (
              <span className='min-w-0'>
                <span className='block text-[14px] font-medium tabular-nums'>
                  {weekSpan(week.start)}
                  {week === running && (
                    <span className='font-normal text-muted-foreground'> · so far</span>
                  )}
                </span>
                <span className='mt-0.5 block text-[12px] text-muted-foreground tabular-nums'>
                  {week.count ? others : 'No workouts'}
                </span>
              </span>
            );
            return (
              <li key={week.start}>
                {week.count ? (
                  <button
                    className='pressable grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto_16px] items-center gap-3 py-2.5 text-left hover:bg-accent focus-visible:-outline-offset-2'
                    aria-expanded={open}
                    onClick={() => setExpanded(open ? null : week.start)}
                  >
                    {title}
                    <span className='text-right text-[14px] font-semibold tabular-nums'>
                      {metricText(metric, week[metric])}
                    </span>
                    <ChevronDown
                      aria-hidden='true'
                      className={cn(
                        'size-4 text-muted-foreground transition-transform duration-200',
                        open && 'rotate-180',
                      )}
                    />
                  </button>
                ) : (
                  <div className='grid min-h-14 grid-cols-[minmax(0,1fr)_auto_16px] items-center gap-3 py-2.5'>
                    {title}
                    <span className='text-right text-[14px] text-muted-foreground'>—</span>
                  </div>
                )}
                {open && (
                  <ul aria-label={`Workouts, ${weekSpan(week.start)}`} className='grid pb-2'>
                    {week.workouts
                      .map((id) => byId.get(id)!)
                      .sort((a, b) => a.date.localeCompare(b.date))
                      .map((workout) => (
                        <li key={workout.id}>
                          <button
                            ref={(el) => {
                              if (el) sources.current.set(workout.id, el);
                              else sources.current.delete(workout.id);
                            }}
                            className='pressable flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-left hover:bg-accent focus-visible:-outline-offset-2'
                            aria-label={`View workout ${format(workout.date, {weekday: 'long', day: 'numeric', month: 'long'})}, ${workout.name}`}
                            onClick={() => setOpenId(workout.id)}
                          >
                            <span className='w-9 shrink-0 text-[12px] font-medium text-muted-foreground'>
                              {format(workout.date, {weekday: 'short'})}
                            </span>
                            <span className='min-w-0 flex-1 truncate text-[14px]'>
                              {workout.name}
                            </span>
                            {workout.duration > 0 && (
                              <span className='text-[12px] text-muted-foreground tabular-nums'>
                                {durationLabel(workout.duration)}
                              </span>
                            )}
                            <ChevronRight
                              aria-hidden='true'
                              className='size-4 text-muted-foreground'
                            />
                          </button>
                        </li>
                      ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        {listed.length > LIST && (
          <Button className='mt-3 w-full' onClick={() => setAll(!all)}>
            {all ? 'Show fewer weeks' : `Show all ${listed.length} weeks`}
          </Button>
        )}
      </section>
      <WorkoutDrawer
        dataset={dataset}
        workoutId={openId}
        onClose={() => setOpenId(null)}
        returnFocus={(id) => sources.current.get(id)?.focus({preventScroll: true})}
      />
    </Card>
  );
}

const recordValue = (kind: RecordKind, n: number) => (kind === 'reps' ? `${n} reps` : kg(n));

/** Records from the last four weeks, one row per exercise; a row opens its Records tab. */
function NewRecords({
  records,
  onOpen,
  rows,
}: {
  records: RecentRecord[];
  onOpen: (exercise: string) => void;
  rows: RefObject<Map<string, HTMLButtonElement>>;
}) {
  const [all, setAll] = useState(false);
  if (!records.length) return null;
  return (
    <Card as='section' className='grid gap-3' aria-labelledby='new-records-heading'>
      <header className='min-w-0'>
        <h2 id='new-records-heading' className='text-card-title'>
          New records
        </h2>
        <p className='text-label font-normal text-muted-foreground'>Last 4 weeks</p>
      </header>
      <ul aria-label='New records' className='-mx-1 grid'>
        {(all ? records : records.slice(0, LIST)).map((record) => {
          const value = recordValue(record.kind, record.value);
          const gain = recordValue(record.kind, record.value - record.previous);
          const kind = recordKindLabel[record.kind];
          return (
            <li key={record.exercise}>
              <button
                ref={(el) => {
                  if (el) rows.current.set(record.exercise, el);
                  else rows.current.delete(record.exercise);
                }}
                className='pressable flex min-h-16 w-full items-center gap-3 rounded-md px-1 py-2 text-left hover:bg-accent focus-visible:-outline-offset-2'
                aria-label={`${record.exercise}: ${kind.replace(/\u00a0/g, ' ')} ${value}, up ${gain}, ${dayMonth(record.date)}. Open records`}
                onClick={() => onOpen(record.exercise)}
              >
                <ExerciseThumb name={record.exercise} />
                <span className='min-w-0 flex-1'>
                  <span className='line-clamp-2 text-[14px] font-medium [overflow-wrap:anywhere]'>
                    {record.exercise}
                  </span>
                  <span className='mt-0.5 block text-[12px] text-muted-foreground'>
                    {kind} · {dayMonth(record.date)}
                  </span>
                </span>
                <span className='shrink-0 text-right tabular-nums'>
                  <span className='block text-[14px] font-semibold'>{value}</span>
                  <span className='block text-[12px] font-medium text-success'>+{gain}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {records.length > LIST && (
        <Button className='w-full' onClick={() => setAll(!all)}>
          {all ? 'Show fewer records' : `Show all ${records.length} records`}
        </Button>
      )}
    </Card>
  );
}

const setsText = (n: number) => String(Number(n.toFixed(1)));
const setWord = (n: number) => (n === 1 ? 'set' : 'sets');

function ToneLegend() {
  const labels = [
    '0',
    `<${toneEdges[0]}`,
    `${toneEdges[0]}+`,
    `${toneEdges[1]}+`,
    `${toneEdges[2]}+`,
  ];
  return (
    <div className='flex justify-end' aria-hidden='true'>
      <div className='grid grid-cols-[repeat(5,minmax(0,2.25rem))] text-center text-caption text-muted-foreground tabular-nums'>
        {labels.map((label, tone) => (
          <span key={label} className='grid justify-items-center gap-1'>
            <ToneSwatch tone={tone as Tone} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Sets per muscle over the last four weeks on a front/back figure, with the exact-value list as
 * the control: a row expands to the exercises behind it (the figure highlights the muscle), and
 * an exercise opens its page.
 */
function Muscles({
  workouts,
  today,
  rows: rowRefs,
  onOpen,
}: {
  workouts: Workout[];
  today: string;
  rows: RefObject<Map<string, HTMLButtonElement>>;
  /** Opens the exercise; `key` is the row's entry in `rows`, for focus return. */
  onOpen: (exercise: string, key: string) => void;
}) {
  const {rows, trained} = useMemo(() => muscleSets(workouts, noon(today)), [workouts, today]);
  // Muscles with no sets now or usually stay off the list (the figure shows them as none).
  const sorted = useMemo(
    () =>
      rows
        .filter((row) => row.sets > 0 || (row.usual ?? 0) > 0)
        .sort((a, b) => b.sets - a.sets || (b.usual ?? 0) - (a.usual ?? 0)),
    [rows],
  );
  const [open, setOpen] = useState<Muscle | null>(null);
  const [all, setAll] = useState(false);
  if (!trained) return null;
  const max = Math.max(...rows.map((row) => Math.max(row.sets, row.usual ?? 0)), 1);
  const grid =
    'grid min-h-12 w-full grid-cols-[minmax(0,6.25rem)_minmax(1.5rem,1fr)_minmax(max-content,4.5rem)_16px] items-center gap-3 rounded-md px-1 text-left';
  return (
    <Card as='section' className='muscle-tones grid gap-4' aria-labelledby='muscles-heading'>
      <header className='flex items-start justify-between gap-2'>
        <div className='min-w-0'>
          <h2 id='muscles-heading' className='text-card-title'>
            Muscles
          </h2>
          <p className='text-label font-normal text-muted-foreground'>Sets, last 4 weeks</p>
        </div>
        <InfoButton title='Muscles' label='About Muscles' className='-my-1 -mr-3 shrink-0'>
          <InfoTerm term='Sets'>
            Recorded sets in the last 28 days. A set counts once for an exercise&apos;s primary
            muscles and half for its secondary muscles: a bench press set adds 1 to chest and ½ to
            front delts and triceps. Cardio counts toward no muscle.
          </InfoTerm>
          <InfoTerm term='Usual'>
            The middle value of the six 4-week blocks before, among blocks with any training. Shown
            as the tick and after the slash.
          </InfoTerm>
          <InfoTerm term='Shoulders'>
            The front figure&apos;s shoulder shows front delts, the back figure&apos;s rear delts;
            side delts colour both. Hip flexors and rotator cuff appear only in the list.
          </InfoTerm>
        </InfoButton>
      </header>
      <div className='grid gap-3'>
        <BodyFigure
          tones={regionTones(rows)}
          selected={open ? regionsOf(open) : undefined}
          className='mx-auto w-full max-w-[19rem]'
        />
        <ToneLegend />
      </div>
      <div className='grid gap-3'>
        <ul aria-label='Sets per muscle' className='-mx-1 grid'>
          {(all ? sorted : sorted.slice(0, LIST)).map((row) => {
            const expanded = open === row.muscle;
            const usual = row.usual === null ? null : Math.round(row.usual);
            const label = `${row.muscle}: ${setsText(row.sets)} ${setWord(row.sets)} in the last 4 weeks${usual !== null ? `, usual ${usual}` : ''}`;
            const cells = (
              <>
                <span className='truncate text-[14px] font-medium'>{row.muscle}</span>
                <span className='relative h-2.5 rounded-sm bg-accent' aria-hidden='true'>
                  {row.sets > 0 && (
                    <span
                      className='absolute inset-y-0 left-0 rounded-sm border border-chart-secondary-edge bg-chart-secondary'
                      style={{width: `${(row.sets / max) * 100}%`}}
                    />
                  )}
                  {row.usual !== null && (
                    <span
                      className='usual-tick absolute -inset-y-1 w-0.5 rounded-full bg-foreground'
                      style={{left: `calc(${(row.usual / max) * 100}% - 1px)`}}
                    />
                  )}
                </span>
                <span className='text-right text-[14px] tabular-nums'>
                  <span className={cn('font-semibold', !row.sets && 'text-muted-foreground')}>
                    {setsText(row.sets)}
                  </span>
                  {usual !== null && (
                    <span className='text-[12px] text-muted-foreground'> / {usual}</span>
                  )}
                </span>
              </>
            );
            return (
              <li key={row.muscle}>
                {row.contributions.length ? (
                  <button
                    className={cn(
                      grid,
                      'pressable hover:bg-accent focus-visible:-outline-offset-2',
                    )}
                    aria-expanded={expanded}
                    aria-label={`${label}. ${expanded ? 'Hide' : 'Show'} exercises`}
                    onClick={() => setOpen(expanded ? null : row.muscle)}
                  >
                    {cells}
                    <ChevronDown
                      aria-hidden='true'
                      className={cn(
                        'size-4 text-muted-foreground transition-transform duration-200',
                        expanded && 'rotate-180',
                      )}
                    />
                  </button>
                ) : (
                  <div className={grid} role='group' aria-label={label}>
                    {cells}
                    <span />
                  </div>
                )}
                {expanded && (
                  <ul aria-label={`Exercises for ${row.muscle}`} className='grid pb-2'>
                    {row.contributions.map((c) => {
                      const key = `${row.muscle}|${c.exercise}`;
                      const counted = c.role === 'primary' ? c.sets : c.sets / 2;
                      const role =
                        c.role === 'primary'
                          ? 'Primary'
                          : `Secondary · ½ of ${c.sets} ${setWord(c.sets)}`;
                      return (
                        <li key={c.exercise}>
                          <button
                            ref={(el) => {
                              if (el) rowRefs.current.set(key, el);
                              else rowRefs.current.delete(key);
                            }}
                            className='pressable grid min-h-12 w-full grid-cols-[minmax(0,1fr)_minmax(max-content,4.5rem)_16px] items-center gap-3 rounded-md px-1 py-1.5 text-left hover:bg-accent focus-visible:-outline-offset-2'
                            aria-label={`${c.exercise}: ${role.replace('·', ',').replace('½', 'half')}, adds ${setsText(counted)}. Open exercise`}
                            onClick={() => onOpen(c.exercise, key)}
                          >
                            <span className='min-w-0 pl-3'>
                              <span className='line-clamp-2 text-[14px] [overflow-wrap:anywhere]'>
                                {c.exercise}
                              </span>
                              <span className='block text-[12px] text-muted-foreground tabular-nums'>
                                {role}
                              </span>
                            </span>
                            <span className='text-right text-[14px] tabular-nums'>
                              {setsText(counted)}
                            </span>
                            <span />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        {sorted.length > LIST && (
          <Button className='w-full' onClick={() => setAll(!all)}>
            {all ? 'Show fewer muscles' : `Show all ${sorted.length} muscles`}
          </Button>
        )}
      </div>
    </Card>
  );
}

/**
 * Profile: lifetime totals, Every week, Muscles, New records, then `children` (body weight).
 * Muscles exercises open their Charts tab over Profile, records their Records tab.
 */
export function ProfileView({
  dataset,
  disabled,
  locked,
  children,
}: {
  dataset: Dataset;
  disabled: boolean;
  /** Sync is locked: the portaled exercise page must unmount. */
  locked: boolean;
  children?: ReactNode;
}) {
  const {workouts} = dataset;
  const today = localDay(new Date());
  const byId = useMemo(() => new Map(workouts.map((w) => [w.id, w])), [workouts]);
  const sets = useMemo(() => workouts.reduce((n, w) => n + setCount(w), 0), [workouts]);
  const records = useMemo(() => recentRecords(dataset, noon(today)), [dataset, today]);
  const [exercise, setExercise] = useState<string | null>(null);
  const [exerciseTab, setExerciseTab] = useState<'Records' | 'Charts'>('Records');
  const sourceRows = useRef(new Map<string, HTMLButtonElement>());
  const returnTo = useRef<string | null>(null);
  useBackLayer(!!exercise && !locked, () => setExercise(null));
  const since = workouts.at(-1)?.date;
  return (
    <div className='profile-view grid gap-5'>
      {workouts.length > 0 && (
        <p className='profile-totals -mt-2'>
          <span className='numeric'>{grouped(workouts.length)}</span>
          {workouts.length === 1 ? ' workout' : ' workouts'} ·{' '}
          <span className='numeric'>{grouped(sets)}</span>
          {sets === 1 ? ' set' : ' sets'}
          {since && (
            <> · since {format(since, {month: 'short', year: 'numeric'}).replace(' ', '\u00a0')}</>
          )}
        </p>
      )}
      <EveryWeek dataset={dataset} byId={byId} today={today} />
      <Muscles
        workouts={workouts}
        today={today}
        rows={sourceRows}
        onOpen={(name, key) => {
          returnTo.current = key;
          setExerciseTab('Charts');
          setExercise(name);
        }}
      />
      <NewRecords
        records={records}
        rows={sourceRows}
        onOpen={(name) => {
          returnTo.current = name;
          setExerciseTab('Records');
          setExercise(name);
        }}
      />
      {children}
      {!locked && (
        <ExercisePage
          name={exercise}
          dataset={dataset}
          disabled={disabled}
          backLabel='Back to profile'
          initialTab={exerciseTab}
          onClose={() => setExercise(null)}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const name = returnTo.current;
            returnTo.current = null;
            if (name) sourceRows.current.get(name)?.focus({preventScroll: true});
          }}
        />
      )}
    </div>
  );
}
