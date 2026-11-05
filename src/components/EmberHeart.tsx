import {useId} from 'react';

// The Ember heart from the app icon: an amber heart whose right side rises into a flame.
const HEART =
  'M12 19.4 C9.2 17.6 4.6 14.8 4.6 10.5 C4.6 8 6.4 6.3 8.6 6.3 C10 6.3 11.3 7.1 12 8.3 C12.9 6.4 14.3 4.9 16.3 3.9 C16.1 5.4 16.6 6.6 17.6 7.7 C18.8 8.9 19.4 10 19.4 11.3 C19.4 15.1 14.8 17.7 12 19.4 Z';

/** The amber Ember heart, sized and animated by its caller. */
export function EmberHeart({className}: {className?: string}) {
  const gradient = useId();
  return (
    <svg viewBox='3 2 18 19' className={className} aria-hidden='true'>
      <defs>
        <linearGradient id={gradient} x1='0' y1='0' x2='1' y2='1'>
          <stop offset='0' stopColor='#FFC24B' />
          <stop offset='1' stopColor='#F2920A' />
        </linearGradient>
      </defs>
      <path d={HEART} fill={`url(#${gradient})`} />
    </svg>
  );
}
