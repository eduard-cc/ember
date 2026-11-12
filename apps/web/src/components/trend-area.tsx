import {useEffect, useId} from 'react';
import {Area, AreaChart, CartesianGrid, XAxis, YAxis, useYAxisScale} from 'recharts';

import {chartDomain, compactTick, monthTicks} from '../domain/chart-scale';
import {ChartContainer, ChartTooltip} from './ui/chart';

/** Tooltip state goes to a stable headline rather than a box over the evidence. */
export function ChartInspection<T>({
  active,
  activeIndex,
  data,
  onChange,
}: {
  active?: boolean;
  activeIndex?: string;
  data: readonly T[];
  onChange: (point: T | null) => void;
}) {
  // Axis payloads are label-matched by Recharts, so duplicate timestamps lose block identity.
  const point = active && activeIndex !== undefined ? (data[Number(activeIndex)] ?? null) : null;
  useEffect(() => onChange(point), [point, onChange]);
  return null;
}

/** Recharts' active index is the original point, even when its label-matched payload is not. */
function TrendActiveDot({cx, index, data}: {cx: number; index: number; data: {value: number}[]}) {
  const scale = useYAxisScale();
  return (
    <circle
      className='chart-active-dot'
      cx={cx}
      cy={scale!(data[index].value)}
      r={5}
      fill='hsl(var(--primary))'
      stroke='hsl(var(--card))'
      strokeWidth={2}
    />
  );
}

/** Shared exercise/body-weight plot. No data animation on metric switches or keyboard actions. */
export function TrendArea<T extends {t: number; value: number; pr?: boolean}>({
  data,
  label,
  onInspect,
}: {
  data: T[];
  label: string;
  onInspect: (point: T | null) => void;
}) {
  const fill = `trend-${useId().replace(/:/g, '')}`;
  const {domain, ticks} = chartDomain(data.map((p) => p.value));
  const from = data[0].t;
  const to = data.at(-1)!.t;
  const years = new Date(from).getFullYear() !== new Date(to).getFullYear();
  const width = Math.max(40, ...ticks.map((t) => compactTick(t).length * 7 + 10));
  return (
    <ChartContainer
      className='trend-chart -mx-1 aspect-auto h-56'
      config={{value: {color: 'hsl(var(--chart-primary))'}}}
      role='img'
      aria-label={label}
    >
      <AreaChart data={data} margin={{left: 8, right: 8, top: 12, bottom: 4}} accessibilityLayer>
        <defs>
          <linearGradient id={fill} x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor='var(--color-value)' stopOpacity={0.2} />
            <stop offset='100%' stopColor='var(--color-value)' stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke='hsl(var(--border))' />
        <XAxis
          dataKey='t'
          type='number'
          scale='time'
          domain={from === to ? [from - 86400000, to + 86400000] : ['dataMin', 'dataMax']}
          ticks={monthTicks(from, to)}
          tickLine={false}
          axisLine={false}
          height={24}
          tick={{fontSize: 11}}
          minTickGap={24}
          padding={{left: 6, right: 6}}
          tickFormatter={(t: number) =>
            new Date(t).toLocaleDateString('en-GB', {
              month: 'short',
              ...(years ? {year: '2-digit'} : {}),
            })
          }
        />
        <YAxis
          orientation='right'
          tickLine={false}
          axisLine={false}
          width={width}
          domain={domain}
          ticks={ticks}
          tick={{fontSize: 11, className: 'numeric'}}
          tickFormatter={compactTick}
        />
        <ChartTooltip
          cursor={{stroke: 'hsl(var(--foreground))', strokeOpacity: 0.45, strokeDasharray: '3 3'}}
          content={(props) => (
            <ChartInspection<T> {...(props as object)} data={data} onChange={onInspect} />
          )}
        />
        <Area
          dataKey='value'
          type='monotone'
          stroke='var(--color-value)'
          strokeWidth={2}
          fill={`url(#${fill})`}
          isAnimationActive={false}
          dot={(props: {cx?: number; cy?: number; payload?: T; index?: number}) => (
            <circle
              key={props.index}
              cx={props.cx}
              cy={props.cy}
              r={props.payload?.pr ? 3.5 : 2}
              fill={props.payload?.pr ? 'hsl(var(--primary))' : 'var(--color-value)'}
              stroke={props.payload?.pr ? 'hsl(var(--card))' : 'none'}
              strokeWidth={1.5}
            />
          )}
          activeDot={(props) => <TrendActiveDot cx={props.cx!} index={props.index} data={data} />}
        />
      </AreaChart>
    </ChartContainer>
  );
}
