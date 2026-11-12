import {useEffect, useState} from 'react';

import {elapsedSeconds} from '../domain/workout-duration';
import {cn} from '../utils/cn';

/** Workout duration since its local start time. Isolated so the ledger never re-renders per tick. */
export function ElapsedTimer({start, className}: {start: string; className?: string}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = elapsedSeconds(start, now);
  const h = Math.floor(seconds / 3600),
    m = Math.floor((seconds % 3600) / 60),
    s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <time
      className={cn('elapsed text-[14px] text-muted-foreground tabular-nums', className)}
      aria-label='Workout duration'
    >
      {h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`}
    </time>
  );
}
