import type {ReactNode} from 'react';

import {cn} from '../../utils/cn';

/** Classes for a trend-chart svg: axis text, grid lines, the trend line and its points. */
export const trendChartClass =
  'trend-chart mt-[15px] block h-auto w-full [&_circle]:fill-chart-primary [&_line]:stroke-border [&_polyline]:stroke-chart-primary [&_text]:fill-muted-foreground [&_text]:text-[11px]';

/** The shaded note under a chart or record list that says what the number does and does not mean. */
export function MetricExplanation({children}: {children: ReactNode}) {
  return (
    <p className='metric-explanation mt-4 bg-accent p-3 text-[12px] text-foreground'>{children}</p>
  );
}

/** The note that stands in for a chart with nothing to plot. Pass the vertical padding to change it. */
export function EmptyChart({className, children}: {className?: string; children: ReactNode}) {
  return <div className={cn('py-10 text-center', className)}>{children}</div>;
}
