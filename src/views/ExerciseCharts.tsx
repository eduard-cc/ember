import {ChevronRight, LineChart, Trophy} from 'lucide-react';
import {useMemo, useState} from 'react';

import {SegmentToggle} from '../components/segment-toggle';
import {TrendArea} from '../components/trend-area';
import {EmptyChart, MetricExplanation} from '../components/ui/chart';
import {EmptyState} from '../components/ui/empty-state';
import {chartNumber} from '../domain/chart-scale';
import {getHistory, getTrend} from '../domain/model';
import type {Dataset, Metric, TrendPoint} from '../domain/types';
import {cn} from '../utils/cn';
import {dateLabel, localDay} from '../utils/date';
import {plural} from '../utils/plural';
import {setText} from '../utils/set-label';

const labels: Record<Metric, string> = {
  load: 'Heaviest weight',
  reps: 'Best reps',
  volume: 'Volume',
  e1rm: 'Est. 1RM',
};
const ranges = [
  {value: '30', label: '1M'},
  {value: '90', label: '3M'},
  {value: '180', label: '6M'},
  {value: '365', label: '1Y'},
  {value: 'all', label: 'All'},
];
type Point = TrendPoint & {t: number};

/** Per-session trend with the original metric definitions and every source workout. */
export function ExerciseCharts({
  dataset,
  name,
  onSource,
  framed = true,
}: {
  dataset: Dataset;
  name: string;
  onSource: (id: string, opener: HTMLElement) => void;
  framed?: boolean;
}) {
  const history = useMemo(() => getHistory(dataset, name), [dataset, name]);
  const type = history[0]?.type;
  const applicable: Metric[] =
    type === 'weighted'
      ? ['load', 'reps', 'volume', 'e1rm']
      : type === 'assisted'
        ? ['load', 'reps']
        : ['reps'];
  const [metric, setMetric] = useState<Metric>(applicable[0]);
  const [range, setRange] = useState('all');
  const [inspected, setInspected] = useState<Point | null>(null);
  const activeMetric = applicable.includes(metric) ? metric : applicable[0];
  const trend = useMemo(() => getTrend(dataset, name, activeMetric), [dataset, name, activeMetric]);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Number(range));
  const firstDay = range === 'all' ? null : localDay(cutoff);
  const data = useMemo(
    () =>
      trend
        .filter((p) => !firstDay || p.date.slice(0, 10) >= firstDay)
        .map((p) => ({
          ...p,
          // An estimate reads to one decimal, like the workout drawer and Records.
          value: activeMetric === 'e1rm' ? Number(p.value.toFixed(1)) : p.value,
          t: new Date(p.date).getTime(),
        })),
    [trend, firstDay, activeMetric],
  );
  const hover = inspected && data.includes(inspected) ? inspected : null;
  const first = data[0];
  const last = data.at(-1);
  const shown = hover ?? last;
  const delta = first && last ? last.value - first.value : 0;
  const lower = activeMetric === 'load' && type === 'assisted';
  const better = lower ? delta < 0 : delta > 0;
  const unit = activeMetric === 'reps' ? 'reps' : activeMetric === 'volume' ? 'kg·reps' : 'kg';
  const metricLabel = lower ? 'Least assistance' : labels[activeMetric];
  const best = shown ? setText(shown.best, shown.type) : null;
  if (!history.length)
    return (
      <EmptyState
        icon={LineChart}
        title='No history yet'
        description='Charts appear after you log this exercise.'
        framed={framed}
      />
    );
  return (
    <section className='exercise-charts grid min-w-0 gap-4'>
      <SegmentToggle
        value={activeMetric}
        onChange={(m) => {
          setInspected(null);
          setMetric(m);
        }}
        label='Chart metric'
        items={applicable.map((m) => ({
          value: m,
          label: m === 'load' && type === 'assisted' ? 'Least assistance' : labels[m],
        }))}
        className='min-w-0 justify-start overflow-x-auto pb-1'
        itemClassName='px-2.5'
      />
      <div className='chart-headline min-h-[4.25rem]'>
        {shown ? (
          <>
            <p className='flex flex-wrap items-baseline gap-1.5 text-foreground'>
              <span className='numeric text-stat'>{chartNumber(shown.value)}</span>
              <span className='text-sm font-medium text-muted-foreground'>{unit}</span>
              {shown.pr && (
                <span className='ml-1 inline-flex items-center gap-1 self-center bg-primary-tint px-1.5 py-0.5 text-label text-primary'>
                  <Trophy className='size-3' /> PR
                </span>
              )}
            </p>
            <p className='mt-1 text-label font-normal text-muted-foreground'>
              {hover ? (
                <>
                  <span className='text-foreground'>{dateLabel(hover.date)}</span> · best set{' '}
                  <span aria-label={best?.spoken}>{best?.text}</span>
                </>
              ) : delta === 0 || data.length < 2 ? (
                `Latest, ${dateLabel(last!.date)}`
              ) : (
                <>
                  <span
                    className={cn(
                      'numeric font-medium',
                      better ? 'text-success' : 'text-foreground',
                    )}
                  >
                    {delta > 0 ? '+' : '−'}
                    {chartNumber(Math.abs(delta))} {unit}
                  </span>{' '}
                  since {dateLabel(first.date)}
                </>
              )}
            </p>
          </>
        ) : (
          <p>No eligible sets in this time range.</p>
        )}
      </div>
      {data.length ? (
        <TrendArea
          key={`${name}-${activeMetric}-${range}`}
          data={data}
          onInspect={setInspected}
          label={`${metricLabel} for ${name}. ${plural(data.length, 'session')}. Every session and its exact values are listed below.`}
        />
      ) : (
        <EmptyChart>
          <p>No eligible sets in this time range.</p>
        </EmptyChart>
      )}
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <SegmentToggle
          value={range}
          onChange={(r) => {
            setInspected(null);
            setRange(r);
          }}
          label='Time range'
          items={ranges}
          itemClassName='px-2.5'
        />
        <span className='flex items-center gap-1 text-caption text-muted-foreground'>
          <span className='size-2 rounded-full bg-primary' /> PR
        </span>
      </div>
      <MetricExplanation>
        {activeMetric === 'e1rm'
          ? 'Epley estimate = weight × (1 + reps / 30), for 1–10 reps. One rep uses recorded weight. This is an estimate, not a tested maximum.'
          : activeMetric === 'volume'
            ? 'Recorded load × reps, summed per session. Not a measure of hypertrophy. Dumbbell load is per dumbbell.'
            : lower
              ? 'Lowest recorded assistance per session. Lower assistance means less help; no estimated strength or volume formula is applied.'
              : activeMetric === 'load'
                ? 'Highest recorded load per session; reps may differ. Machine loads are not comparable across different machines or gyms.'
                : 'Highest recorded reps in a set per session. Weights may differ: compare the exact source sets.'}{' '}
        Hold and slide on the chart to inspect a session. PR marks a strict metric improvement over
        earlier workouts, not a tested strength gain.
      </MetricExplanation>
      <section>
        <h3 className='mb-1 text-label text-muted-foreground'>Sessions</h3>
        <ul
          aria-label='Sessions'
          className='max-h-[340px] divide-y divide-border overflow-auto border-y border-border'
        >
          {[...data].reverse().map((point, i) => {
            const source = setText(point.best, point.type);
            return (
              <li key={`${point.workoutId}-${i}`}>
                <button
                  className='pressable grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto_16px] items-center gap-2 py-2 text-left hover:bg-accent focus-visible:-outline-offset-2'
                  aria-label={`View source workout ${dateLabel(point.date)}, ${source.spoken ?? source.text}, ${metricLabel} ${chartNumber(point.value)} ${unit}${point.pr ? ', personal record' : ''}`}
                  onClick={(event) => onSource(point.workoutId, event.currentTarget)}
                >
                  <span className='flex min-w-0 flex-col gap-0.5 numeric text-sm text-muted-foreground min-[480px]:flex-row min-[480px]:gap-4'>
                    <span>{dateLabel(point.date)}</span>
                    <span aria-label={source.spoken}>{source.text}</span>
                  </span>
                  <span className='flex shrink-0 items-center gap-1.5 text-right numeric text-sm font-semibold'>
                    {point.pr && (
                      <Trophy
                        aria-label='Personal record'
                        className='size-3.5 shrink-0 text-primary'
                      />
                    )}
                    <span>
                      {chartNumber(point.value)}{' '}
                      <span className='font-normal text-muted-foreground'>{unit}</span>
                    </span>
                  </span>
                  <ChevronRight aria-hidden className='size-4 text-muted-foreground' />
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </section>
  );
}
