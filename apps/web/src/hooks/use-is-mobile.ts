import {useEffect, useState} from 'react';

/** Below the CSS `desk` breakpoint (`--breakpoint-desk: 1000px` in index.css), not the common 768px. */
export const MOBILE_QUERY = '(width < 1000px)';

export const useIsMobile = () => {
  const [value, setValue] = useState(() => matchMedia(MOBILE_QUERY).matches);

  useEffect(() => {
    function onChange(event: MediaQueryListEvent) {
      setValue(event.matches);
    }

    const result = matchMedia(MOBILE_QUERY);
    result.addEventListener('change', onChange);

    return () => result.removeEventListener('change', onChange);
  }, []);

  return value;
};
