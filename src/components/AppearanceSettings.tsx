import {useEffect, useState} from 'react';

import {Button} from './ui';

export type Theme = 'system' | 'light' | 'dark';
export type Accent = 'pine' | 'ocean' | 'copper';
interface Appearance {
  version: 1;
  theme: Theme;
  accent: Accent;
}
const key = 'gym-log:appearance:v1';
const defaults: Appearance = {version: 1, theme: 'system', accent: 'pine'};
const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  values.includes(value as T);
export function parseAppearance(raw: string | null): Appearance {
  try {
    const value = JSON.parse(raw ?? 'null') as Partial<Record<keyof Appearance, unknown>> | null;
    if (
      value?.version === 1 &&
      oneOf<Theme>(['system', 'light', 'dark'], value.theme) &&
      oneOf<Accent>(['pine', 'ocean', 'copper'], value.accent)
    )
      return {version: 1, theme: value.theme, accent: value.accent};
  } catch {
    /* Appearance is optional, not workout data. */
  }
  return defaults;
}
export function useAppearance() {
  const [appearance, setAppearance] = useState(() => {
    try {
      return parseAppearance(localStorage.getItem(key));
    } catch {
      return defaults;
    }
  });
  const [error, setError] = useState('');
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const theme =
        appearance.theme === 'system' ? (media.matches ? 'dark' : 'light') : appearance.theme;
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.accent = appearance.accent;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', theme === 'dark' ? '#17161b' : '#f6f1e8');
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [appearance]);
  const choose = (patch: Partial<Pick<Appearance, 'theme' | 'accent'>>) => {
    const next = {...appearance, ...patch};
    setAppearance(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setError('');
    } catch {
      setError(
        'Appearance could not be saved. This choice lasts only while this tab stays open. Workout saving is separate.',
      );
    }
  };
  return {appearance, choose, error};
}
export function AppearanceSettings({settings}: {settings: ReturnType<typeof useAppearance>}) {
  return (
    <section aria-label='Appearance' className='appearance-settings'>
      <h3>Appearance</h3>
      <p>System follows your device. Workout saving is separate.</p>
      <div role='group' aria-label='Theme' className='appearance-options'>
        {(['system', 'light', 'dark'] as const).map((theme) => (
          <Button
            key={theme}
            aria-pressed={settings.appearance.theme === theme}
            onClick={() => settings.choose({theme})}
          >
            {theme[0].toUpperCase() + theme.slice(1)}
          </Button>
        ))}
      </div>
      <div role='group' aria-label='Accent' className='appearance-options accents'>
        {(['pine', 'ocean', 'copper'] as const).map((accent) => (
          <Button
            key={accent}
            aria-pressed={settings.appearance.accent === accent}
            onClick={() => settings.choose({accent})}
          >
            <span className={`accent-swatch ${accent}`} aria-hidden='true' />
            {accent[0].toUpperCase() + accent.slice(1)}
          </Button>
        ))}
      </div>
      {settings.error && (
        <p role='status' className='inline-error'>
          {settings.error}
        </p>
      )}
    </section>
  );
}
