/** Whole seconds since a local workout timestamp; 0 when it is unparseable or in the future. */
export function elapsedSeconds(start: string, now: number): number {
  const started = new Date(start).getTime();
  return Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : 0;
}
/**
 * Elapsed minutes from a local workout timestamp, matching the logger's timer.
 * Whole minutes from one minute on; shorter sessions keep their whole seconds as a
 * fraction so they stay distinguishable from 0, which means unknown.
 */
export function elapsedMinutes(start: string, finishedAt: number): number {
  const seconds = elapsedSeconds(start, finishedAt);
  return seconds < 60 ? seconds / 60 : Math.floor(seconds / 60);
}

/** History label for a stored duration in minutes; 0 is unknown and shows nothing. */
export function durationLabel(minutes: number): string {
  if (!minutes) return '';
  return minutes < 1 ? '<1 MIN' : `${minutes} MIN`;
}
