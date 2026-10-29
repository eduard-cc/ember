const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of a local date. */
export const localDay = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Local wall time `YYYY-MM-DDTHH:MM:SS`, the stored workout timestamp format. */
export const localTimestamp = (date: Date) =>
  `${localDay(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

export function dateLabel(date: string) {
  return new Date(date.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
