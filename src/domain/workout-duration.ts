/**
 * Elapsed minutes from a local workout timestamp, matching the logger's timer.
 * Whole minutes from one minute on; shorter sessions keep their whole seconds as a
 * fraction so they stay distinguishable from 0, which means unknown.
 */
export function elapsedMinutes(start: string, finishedAt: number): number {
  const started = new Date(start).getTime();
  if (!Number.isFinite(started)) return 0;
  const seconds = Math.max(0, Math.floor((finishedAt - started) / 1000));
  return seconds < 60 ? seconds / 60 : Math.floor(seconds / 60);
}

/** History label for a stored duration in minutes; 0 is unknown and shows nothing. */
export function durationLabel(minutes: number): string {
  if (!minutes) return '';
  return minutes < 1 ? '<1 MIN' : `${minutes} MIN`;
}
