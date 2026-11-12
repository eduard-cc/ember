import {ChevronRight, LineChart, Trophy} from 'lucide-react';
import {useMemo, useState} from 'react';

import {InfoButton, InfoTerm} from '../components/info-button';
import {SegmentToggle} from '../components/segment-toggle';
import {TrendArea} from '../components/trend-area';
import {Button} from '../components/ui/button';
import {EmptyChart} from '../components/ui/chart';
import {EmptyState} from '../components/ui/empty-state';
import {
  type ChartRange,
  chartNumber,
  chartRanges,
  initialRange,
  rangeStart,
} from '../domain/chart-scale';
import {getHistory, getTrend} from '../domain/model';
import type {Dataset, Metric, TrendPoint} from '../domain/types';
import {cn} from '../utils/cn';
import {dateLabel} from '../utils/date';
import {plural} from '../utils/plural';
import {setText} from '../utils/set-label';

const labels: Record<Metric, string> = {
  load: 'Heaviest weight',
  reps: 'Best reps',
  volume: 'Volume',
  e1rm: 'Est. 1RM',
};
type Point = TrendPoint & {t: number};

/** What the selected metric plots, kept behind the ⓘ button rather than on the page. */
function metricMeaning(metric: Metric, assisted: boolean) {
  if (assisted && metric === 'load')
    return 'The least machine assistance in a set, each session. Less is better.';
  switch (metric) {
    case 'load':
      return 'The heaviest set of each session, whatever its reps. Machine weights can differ between gyms.';
    case 'reps':
      return 'The most reps in one set, each session. The weight can differ, so check the set.';
    case 'volume':
      return 'Weight × reps, added up over every set of the session. Dumbbells count per dumbbell.';
    case 'e1rm':
      return 'An estimate of the most you could lift once, from your best set each session: weight × (1 + reps ÷ 30), the Epley formula. Only sets of 1–10 reps count; a single rep counts as lifted.';
  }
}

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
  const [range, setRange] = useState<ChartRange>(() => initialRange(history));
  const [limit, setLimit] = useState(10);
  const [inspected, setInspected] = useState<Point | null>(null);
  const activeMetric = applicable.includes(metric) ? metric : applicable[0];
  const trend = useMemo(() => getTrend(dataset, name, activeMetric), [dataset, name, activeMetric]);
  const firstDay = rangeStart(range);
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
  const workoutNames = useMemo(
    () => new Map(history.map((session) => [session.workoutId, session.workoutName])),
    [history],
  );
  const hover = inspected && data.includes(inspected) ? inspected : null;
  const first = data[0];
  const last = data.at(-1);
  const shown = hover ?? last;
  const delta = first && last ? last.value - first.value : 0;
  const lower = activeMetric === 'load' && type === 'assisted';
  const better = lower ? delta < 0 : delta > 0;
  const unit = activeMetric === 'reps' ? 'reps' : 'kg';
  const metricLabel = lower ? 'Least assistance' : labels[activeMetric];
  const best = shown ? setText(shown.best, shown.type) : null;
  const sessions = [...data].reverse();
  // History without a set this metric counts (e.g. Est. 1RM after only high-rep sets) is not an
  // empty range.
  const emptyNote = trend.length
    ? 'No sessions in this time range.'
    : `No sets count toward ${metricLabel} yet.`;
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
      <div className='flex items-start gap-1'>
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
          className='min-w-0 flex-1 justify-start overflow-x-auto pb-1'
          itemClassName='px-2.5'
        />
        <InfoButton
          title='Reading this chart'
          label={`About ${metricLabel}`}
          className='-mr-3 shrink-0'
        >
          <InfoTerm term={metricLabel}>{metricMeaning(activeMetric, lower)}</InfoTerm>
          <InfoTerm term='PR'>
            A trophy and an amber dot mark a session that beat every earlier one.
          </InfoTerm>
          <InfoTerm term='Inspect a session'>
            Hold and slide along the chart to see each session&apos;s value and best set.
          </InfoTerm>
        </InfoButton>
      </div>
      <div className='chart-headline min-h-[4.25rem]'>
        {shown ? (
          <>
            <p className='flex flex-wrap items-baseline gap-1.5 text-foreground'>
              <span className='numeric text-stat'>{chartNumber(shown.value)}</span>
              <span className='text-sm font-medium text-muted-foreground'>{unit}</span>
              {shown.pr && (
                <span className='ml-1 inline-flex items-center gap-1 self-center rounded-sm bg-primary-tint px-1.5 py-0.5 text-label text-primary'>
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
          <p>{emptyNote}</p>
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
          <p>{emptyNote}</p>
        </EmptyChart>
      )}
      <SegmentToggle
        value={range}
        onChange={(r) => {
          setInspected(null);
          setRange(r);
        }}
        label='Time range'
        items={[...chartRanges]}
        className='w-full'
        itemClassName='flex-1'
      />
      {sessions.length > 0 && (
        <section className='mt-2'>
          <h3 className='mb-2 flex items-baseline justify-between text-[14px] font-semibold'>
            Sessions
            <span className='text-[12px] font-normal text-muted-foreground tabular-nums'>
              {plural(sessions.length, 'session')}
            </span>
          </h3>
          <ul aria-label='Sessions' className='divide-y divide-border border-y border-border'>
            {sessions.slice(0, limit).map((point, i) => {
              const source = setText(point.best, point.type);
              // The weight is already the value; its reps are what the set adds.
              const detail =
                activeMetric === 'load' && point.best.reps !== null
                  ? plural(point.best.reps, 'rep')
                  : source.text === `${chartNumber(point.value)} ${unit}`
                    ? null
                    : source.text;
              const workout = workoutNames.get(point.workoutId) ?? '';
              return (
                <li key={`${point.workoutId}-${i}`}>
                  <button
                    className='pressable grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto_16px] items-center gap-3 py-2.5 text-left hover:bg-accent focus-visible:-outline-offset-2'
                    aria-label={`View source workout ${dateLabel(point.date)}, ${workout}, ${metricLabel} ${chartNumber(point.value)} ${unit}${point.pr ? ', personal record' : ''}, best set ${source.spoken ?? source.text}`}
                    onClick={(event) => onSource(point.workoutId, event.currentTarget)}
                  >
                    <span className='min-w-0'>
                      <span className='block text-[14px] font-medium tabular-nums'>
                        {dateLabel(point.date)}
                      </span>
                      <span className='mt-0.5 block text-[12px] wrap-anywhere text-muted-foreground'>
                        {workout}
                      </span>
                    </span>
                    <span className='text-right tabular-nums'>
                      <span className='flex items-center justify-end gap-1.5 text-[14px] font-semibold'>
                        {point.pr && (
                          <Trophy aria-hidden className='size-3.5 shrink-0 text-primary' />
                        )}
                        <span>
                          {chartNumber(point.value)}{' '}
                          <span className='font-normal text-muted-foreground'>{unit}</span>
                        </span>
                      </span>
                      {detail && (
                        <span className='mt-0.5 block text-[12px] text-muted-foreground'>
                          {detail}
                        </span>
                      )}
                    </span>
                    <ChevronRight aria-hidden className='size-4 text-muted-foreground' />
                  </button>
                </li>
              );
            })}
          </ul>
          {sessions.length > limit && (
            <Button className='mt-3 w-full' onClick={() => setLimit((n) => n + 20)}>
              Show more sessions
            </Button>
          )}
        </section>
      )}
    </section>
  );
}
