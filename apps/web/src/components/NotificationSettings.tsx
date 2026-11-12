import {Bell} from 'lucide-react';
import {useState} from 'react';

import {
  notificationSupport,
  requestNotificationPermission,
  setNotificationsEnabled,
  useNotificationState,
} from '../pwa/workout-notification';
import {cn} from '../utils/cn';
import {
  SettingsGroup,
  SettingsList,
  SettingsRow,
  SwitchTrack,
  settingsRowClass,
} from './settings-group';
import {InlineError} from './ui/inline-error';

const label = 'Active workout';

/**
 * The active-workout notification: on by default, separate from the OS permission it needs.
 * The row says honestly when the phone has not allowed or has blocked it.
 */
export function NotificationSettings() {
  const {preferences, permission, error} = useNotificationState();
  const [saveError, setSaveError] = useState('');
  const support = notificationSupport();
  const on = preferences.enabled;
  const status =
    !on || permission === 'granted'
      ? 'Shows while you log a workout. Tap it to resume.'
      : permission === 'denied'
        ? 'Blocked for Ember in your phone’s settings.'
        : 'Not allowed yet.';
  return (
    <SettingsGroup id='notification-heading' titleAs='h3' title='Notification'>
      {support === 'supported' ? (
        <SettingsList as='ul'>
          <li>
            {/* The whole row is the switch, so the target is the full 64px row. */}
            <button
              type='button'
              role='switch'
              aria-checked={on}
              aria-labelledby='notification-label'
              aria-describedby='notification-description'
              className={cn(
                settingsRowClass,
                'notification-switch w-full bg-transparent text-left hover:bg-accent focus-visible:-outline-offset-2',
              )}
              onClick={() =>
                setSaveError(
                  setNotificationsEnabled(!on)
                    ? ''
                    : 'This choice could not be saved. It lasts only while this tab stays open.',
                )
              }
            >
              <Bell size={18} className='shrink-0 text-muted-foreground' aria-hidden='true' />
              <span className='min-w-0 flex-1'>
                <span id='notification-label' className='block text-sm font-medium text-foreground'>
                  {label}
                </span>
                <span
                  id='notification-description'
                  className='mt-0.5 block text-label font-normal text-muted-foreground'
                >
                  {status}
                </span>
              </span>
              <SwitchTrack on={on} />
            </button>
          </li>
          {on && permission === 'default' && (
            <li>
              <button
                type='button'
                className={cn(
                  settingsRowClass,
                  'min-h-14 w-full justify-start bg-transparent pl-[50px] text-left text-sm font-medium text-primary hover:bg-accent focus-visible:-outline-offset-2',
                )}
                onClick={() => void requestNotificationPermission()}
              >
                Allow notifications
              </button>
            </li>
          )}
        </SettingsList>
      ) : (
        <SettingsList>
          <SettingsRow
            label={label}
            value={
              support === 'install'
                ? 'Add Ember to your Home Screen to get it.'
                : 'Not available in this browser.'
            }
          />
        </SettingsList>
      )}
      {(saveError || error) && (
        <InlineError role='status' className='mt-3'>
          {saveError || error}
        </InlineError>
      )}
    </SettingsGroup>
  );
}
