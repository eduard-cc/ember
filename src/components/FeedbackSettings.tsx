import {Vibrate, Volume2} from 'lucide-react';
import {useState} from 'react';

import {previewFeedback, setFeedbackPreferences, useFeedbackPreferences} from '../feedback';
import {cn} from '../utils/cn';
import {SettingsGroup, SettingsList, SwitchTrack, settingsRowClass} from './settings-group';
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
                <SwitchTrack on={on} />
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
