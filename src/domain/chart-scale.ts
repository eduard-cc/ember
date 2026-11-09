/** Padded, nonnegative domains with round, distinct ticks, even for hundredth-kg changes. */
export function chartDomain(values: number[]) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || hi * 0.1 || 1;
  const raw = span / 3;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw)!;
  const min = Math.max(0, Math.floor((lo - span * 0.15) / step) * step);
  const max = Math.max(min + step * 2, Math.ceil((hi + span * 0.15) / step) * step);
  const ticks = Array.from({length: Math.round((max - min) / step) + 1}, (_, i) =>
    Number((min + i * step).toPrecision(12)),
  );
  return {domain: [ticks[0], ticks.at(-1)!] as [number, number], ticks};
}

/** Calendar months, not elapsed-day approximations; short histories still get a date label. */
export function monthTicks(from: number, to: number): number[] {
  const first = new Date(from);
  const last = new Date(to);
  const months =
    (last.getFullYear() - first.getFullYear()) * 12 + last.getMonth() - first.getMonth();
  const step = Math.max(1, Math.ceil(months / 6));
  const date = new Date(first.getFullYear(), first.getMonth() + 1, 1);
  const ticks: number[] = [];
  while (date.getTime() <= to) {
    ticks.push(date.getTime());
    date.setMonth(date.getMonth() + step);
  }
  return ticks.length ? ticks : [from];
}

/** Range segments shared by the exercise charts: days back from today, or the whole history. */
export const chartRanges = [
  {value: '30', label: '1M'},
  {value: '90', label: '3M'},
  {value: '180', label: '6M'},
  {value: '365', label: '1Y'},
  {value: 'all', label: 'All'},
] as const;
export type ChartRange = (typeof chartRanges)[number]['value'];

/** First local day (`YYYY-MM-DD`) inside a range, or null for the whole history. */
export function rangeStart(range: ChartRange, today = new Date()) {
  if (range === 'all') return null;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - Number(range));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
}

/**
 * The range a chart opens on: the last three months, widened to 6M, 1Y and then All until at
 * least two workouts fall inside it, so an exercise not done lately still draws a line. Repeated
 * blocks of one workout are one chart session.
 */
export function initialRange(
  sessions: {workoutId: string; date: string}[],
  today = new Date(),
): ChartRange {
  for (const range of ['90', '180', '365'] as const) {
    const start = rangeStart(range, today)!;
    const inside = sessions.filter((session) => session.date.slice(0, 10) >= start);
    if (new Set(inside.map((session) => session.workoutId)).size >= 2) return range;
  }
  return 'all';
}

export const chartNumber = (value: number) =>
  Number(value.toFixed(4)).toLocaleString('en-GB', {maximumFractionDigits: 4});
/** Match the scale's 12 significant digits; compacting must not collapse adjacent ticks. */
export const compactTick = (value: number) => {
  const thousands = Math.abs(value) >= 1000;
  return `${(thousands ? value / 1000 : value).toLocaleString('en-GB', {maximumSignificantDigits: 12})}${thousands ? 'k' : ''}`;
};
