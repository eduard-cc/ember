import {useSyncExternalStore} from 'react';

/**
 * The resolved theme, read from `<html data-theme>`, which `useAppearance` keeps in step with the
 * Appearance setting and the system scheme. Ember has no next-themes provider.
 */
const read = (): 'light' | 'dark' =>
  document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
  return () => observer.disconnect();
}

export const useTheme = () => useSyncExternalStore(subscribe, read, () => 'light' as const);
