/** Whole elapsed minutes from a local workout timestamp, matching the logger's timer. */
export function elapsedMinutes(start: string, finishedAt: number): number {
  const started = new Date(start).getTime();
  return Number.isFinite(started) ? Math.max(0, Math.floor((finishedAt - started) / 60_000)) : 0;
}
