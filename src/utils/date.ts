const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of a local date. */
export const localDay = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Local wall time `YYYY-MM-DDTHH:MM:SS`, the stored workout timestamp format. */
export const localTimestamp = (date: Date) =>
  `${localDay(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

/** A stored workout timestamp as a local Date; a bare day is read at noon so it never shifts. */
const local = (date: string) => new Date(date.length === 10 ? `${date}T12:00:00` : date);

/** A History month section label: "October 2026". */
export const monthLabel = (date: string) =>
  local(date).toLocaleDateString('en-GB', {month: 'long', year: 'numeric'});

/** "Sat" for a History card's day column. */
export const weekdayLabel = (date: string) =>
  local(date).toLocaleDateString('en-GB', {weekday: 'short'});

/** "Saturday, 31 October 2026 at 18:05"; a bare day has no time. */
export function fullDateTime(date: string) {
  const d = local(date);
  const day = d.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  if (date.length === 10) return day;
  return `${day} at ${d.toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit'})}`;
}

/** "today", "yesterday", "3 days ago", then the date: when a template was last done. */
export function relativeDay(date: string, now = new Date()) {
  const days = Math.round(
    (new Date(`${localDay(now)}T12:00:00`).getTime() -
      new Date(`${date.slice(0, 10)}T12:00:00`).getTime()) /
      86_400_000,
  );
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days > 1 && days < 7) return `${days} days ago`;
  return dateLabel(date);
}

/** "Sun, 1 Nov 2026": the editor's meta line. */
export const weekdayDateLabel = (date: string) => `${weekdayLabel(date)}, ${dateLabel(date)}`;

export function dateLabel(date: string) {
  return new Date(date.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
