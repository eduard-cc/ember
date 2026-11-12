import {useEffect, useState} from 'react';

import {EmberHeart} from './EmberHeart';

/** After this long without an answer, the launch hands over to the connection notice. */
const LAUNCH_SPLASH_MS = 5000;

/**
 * Whether launch still shows the splash: from opening until Ember is ready, has something to tell
 * the owner (`waiting` turns false), or the splash time runs out. Once over, it never returns,
 * so a later sync lock shows its notice.
 */
export function useLaunchSplash(waiting: boolean) {
  const [launching, setLaunching] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setLaunching(false), LAUNCH_SPLASH_MS);
    return () => clearTimeout(timer);
  }, []);
  if (launching && !waiting) setLaunching(false);
  return launching && waiting;
}

/** The launch screen: the Ember heart slowly lighting up while the app gets ready. */
export function LaunchSplash() {
  return (
    <div
      role='status'
      aria-label='Opening Ember'
      className='grid h-dvh place-items-center bg-background'
    >
      <div className='relative grid place-items-center' aria-hidden='true'>
        <div className='launch-glow absolute size-40 rounded-full bg-[radial-gradient(closest-side,rgb(245_177_61/0.28),transparent)]' />
        <EmberHeart className='launch-heart relative size-16' />
      </div>
    </div>
  );
}
