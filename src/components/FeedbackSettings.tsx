import {Vibrate, Volume2} from 'lucide-react';
import {useState} from 'react';

import {previewFeedback, setFeedbackPreferences, useFeedbackPreferences} from '../feedback';
import {cn} from '../utils/cn';
import {SettingsGroup, SettingsList, settingsRowClass} from './settings-group';
import {InlineError} from './ui/inline-error';

const options = [
  {
    key: 'sound',
    label: 'Sounds',
    description: 'Short cues when you log sets and finish. They mix with your music.',
    icon: Volume2,
  },
  {
    key: 'haptics',
    label: 'Haptics',
    description: 'Physical feedback when you log sets and finish workouts.',
    icon: Vibrate,
  },
] as const;

/** Sounds and haptics, each on by default; a device preference separate from workout data. */
export function FeedbackSettings() {
  const preferences = useFeedbackPreferences();
  const [error, setError] = useState('');
  return (
    <SettingsGroup
      id='feedback-heading'
      titleAs='h3'
      title='Feedback'
      description='Cues when you start, log and finish.'
    >
      <SettingsList as='ul'>
        {options.map(({key, label, description, icon: Icon}) => {
          const on = preferences[key];
          return (
            <li key={key}>
              {/* The whole row is the switch, so the target is the full 64px row. */}
              <button
                type='button'
                role='switch'
                aria-checked={on}
                aria-labelledby={`feedback-${key}-label`}
                aria-describedby={`feedback-${key}-description`}
                className={cn(
                  settingsRowClass,
                  'feedback-switch w-full bg-transparent text-left hover:bg-accent focus-visible:-outline-offset-2',
                )}
                onClick={() => {
                  const saved = setFeedbackPreferences({[key]: !on});
                  setError(
                    saved
                      ? ''
                      : 'Feedback could not be saved. This choice lasts only while this tab stays open.',
                  );
                  // Turning one on plays a sample through it, so the change is heard or felt.
                  if (!on) previewFeedback(key);
                }}
              >
                <Icon size={18} className='shrink-0 text-muted-foreground' aria-hidden='true' />
                <span className='min-w-0 flex-1'>
                  <span
                    id={`feedback-${key}-label`}
                    className='block text-sm font-medium text-foreground'
                  >
                    {label}
                  </span>
                  <span
                    id={`feedback-${key}-description`}
                    className='mt-0.5 block text-label font-normal text-muted-foreground'
                  >
                    {description}
                  </span>
                </span>
                <span
                  aria-hidden='true'
                  className={cn(
                    'relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200',
                    // Off keeps a muted-foreground outline and knob, so its shape stays above 3:1.
                    on
                      ? 'bg-primary'
                      : 'bg-muted shadow-[inset_0_0_0_1px_hsl(var(--muted-foreground))]',
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 left-0.5 size-6 rounded-full shadow-sm transition-transform duration-200 ease-(--ease-out)',
                      on ? 'translate-x-5 bg-background' : 'bg-muted-foreground',
                    )}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </SettingsList>
      {error && (
        <InlineError role='status' className='mt-3'>
          {error}
        </InlineError>
      )}
    </SettingsGroup>
  );
}
