import {type ReactNode, useMemo, useState} from 'react';
import {Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis} from 'recharts';

import {SegmentToggle} from '../components/segment-toggle';
import {ChartInspection} from '../components/trend-area';
import {Card} from '../components/ui/card';
import {ChartContainer, ChartTooltip} from '../components/ui/chart';
import {chartDomain, chartNumber, compactTick} from '../domain/chart-scale';
import {workoutsPerWeek} from '../domain/model';
import {setCount} from '../domain/sets';
import type {Workout} from '../domain/types';
import {dateLabel} from '../utils/date';
import {plural} from '../utils/plural';

const WEEKS = 12;
type Week = ReturnType<typeof workoutsPerWeek>[number];
type WeekMetric = 'count' | 'volume' | 'time';
const metrics: {value: WeekMetric; label: string}[] = [
  {value: 'count', label: 'Workouts'},
  {value: 'volume', label: 'Volume'},
  {value: 'time', label: 'Time'},
];

/**
 * Weekly actual totals, then `children` (body weight). The average always excludes the current
 * partial week.
 */
export function ProfileView({workouts, children}: {workouts: Workout[]; children?: ReactNode}) {
  const weeks = useMemo(() => workoutsPerWeek(workouts, WEEKS), [workouts]);
  const sets = useMemo(() => workouts.reduce((n, w) => n + setCount(w), 0), [workouts]);
  const [metric, setMetric] = useState<WeekMetric>('count');
  const [hover, setHover] = useState<Week | null>(null);
  const shown = hover && weeks.includes(hover) ? hover : weeks.at(-1)!;
  const current = weeks.at(-1)!;
  const first = workouts.at(-1)?.date.slice(0, 4);
  const average = weeks.slice(0, -1).reduce((n, w) => n + w[metric], 0) / (WEEKS - 1);
  const {domain, ticks} = chartDomain([
    0,
    Math.max(metric === 'count' ? 3 : 1, ...weeks.map((w) => w[metric])),
  ]);
  const axisWidth = Math.max(42, ...ticks.map((tick) => compactTick(tick).length * 7 + 10));
  const label = metrics.find((m) => m.value === metric)!.label;
  const unit =
    metric === 'count'
      ? shown.count === 1
        ? 'workout'
        : 'workouts'
      : metric === 'volume'
        ? 'kg'
        : 'min';
  return (
    <div className='profile-view grid gap-5'>
      <p className='profile-totals -mt-2'>
        <span className='numeric'>{workouts.length}</span>
        {workouts.length === 1 ? ' workout' : ' workouts'} · <span className='numeric'>{sets}</span>
        {sets === 1 ? ' set' : ' sets'} · <span className='numeric'>{current.count}</span> this week
      </p>
      <Card as='section' className='grid gap-4'>
        <header className='flex flex-wrap items-center justify-between gap-2'>
          <h2 className='text-card-title'>Every week</h2>
          <SegmentToggle
            value={metric}
            onChange={(m) => {
              setHover(null);
              setMetric(m);
            }}
            label='Show per week'
            items={metrics}
            className='max-w-full min-w-0 flex-wrap justify-start'
            itemClassName='px-2.5'
          />
        </header>
        <div className='weekly-headline'>
          <p className='flex items-baseline gap-1.5 text-foreground'>
            <span className='numeric text-stat'>{chartNumber(shown[metric])}</span>
            <span className='text-sm font-medium text-muted-foreground'>{unit}</span>
          </p>
          <p className='mt-1 text-label font-normal text-muted-foreground'>
            {shown.start === current.start ? 'This week' : `Week of ${dateLabel(shown.start)}`} ·
            average {chartNumber(Number(average.toFixed(1)))}{' '}
            {metric === 'count' ? 'workouts' : unit} before this week
            {first ? ` · logging since ${first}` : ''}.
          </p>
        </div>
        <ChartContainer
          key={metric}
          className='week-chart -mx-1 aspect-auto h-44'
          config={{value: {color: 'hsl(var(--chart-secondary))'}}}
          role='img'
          aria-label={`${label} per week for the last ${WEEKS} weeks. ${weeks.map((w) => `${w.start}: ${chartNumber(w[metric])} ${metric === 'count' ? 'workouts' : unit}`).join(', ')}.`}
        >
          <BarChart
            data={weeks}
            margin={{left: 4, right: 8, top: 10, bottom: 4}}
            accessibilityLayer
          >
            <CartesianGrid vertical={false} stroke='hsl(var(--border))' />
            <XAxis
              dataKey='start'
              tickLine={false}
              axisLine={false}
              height={24}
              tick={{fontSize: 11}}
              ticks={weeks.filter((_, i) => (11 - i) % 4 === 0).map((w) => w.start)}
              tickFormatter={(v: string) =>
                v === current.start
                  ? 'This wk'
                  : new Date(`${v}T12:00:00`).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                    })
              }
            />
            <YAxis
              orientation='right'
              width={axisWidth}
              tickLine={false}
              axisLine={false}
              allowDecimals={metric !== 'count'}
              tick={{fontSize: 11, className: 'numeric'}}
              tickFormatter={compactTick}
              domain={domain}
              ticks={ticks}
            />
            <ChartTooltip
              cursor={{fill: 'hsl(var(--accent))'}}
              content={(props) => (
                <ChartInspection<Week> {...(props as object)} data={weeks} onChange={setHover} />
              )}
            />
            <Bar dataKey={metric} isAnimationActive={false}>
              {weeks.map((w) => (
                <Cell
                  key={w.start}
                  className={w.start === current.start ? 'current-week' : undefined}
                  fill={
                    w.start === current.start
                      ? 'hsl(var(--primary))'
                      : 'hsl(var(--chart-secondary))'
                  }
                  stroke={w.start === current.start ? 'none' : 'hsl(var(--chart-secondary-edge))'}
                  strokeWidth={1}
                />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
        <p className='text-label font-normal text-muted-foreground'>
          Last {WEEKS} weeks. Hold and slide to inspect.
          {metric === 'volume'
            ? ' Recorded load × reps, not a measure of hypertrophy; dumbbell load is per dumbbell.'
            : metric === 'time'
              ? ' Recorded workout minutes; unknown durations contribute no time.'
              : ` ${plural(current.count, 'workout')} this week.`}
        </p>
      </Card>
      {children}
    </div>
  );
}
