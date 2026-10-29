import {useEffect, useState} from 'react';

import {requestShellUpdate} from '../pwa/register';
import type {WorkoutRepository} from '../storage/repository';
import {SettingsGroup, SettingsList, SettingsRow} from './settings-group';
import {Button} from './ui/button';

interface Props {
  repository: WorkoutRepository;
  available: boolean;
  begin: (restoring: boolean) => Promise<void>;
  end: () => void;
}
/** The writer tab holds the installation lock throughout this gate; other tabs cannot edit. */
export function ShellUpdatePanel({repository, available, begin, end}: Props) {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    let cancelled = false;
    const inspect = async () => {
      const r = await navigator.serviceWorker.getRegistration();
      if (!cancelled) {
        setRegistration(r);
        setWaiting(r?.waiting ?? null);
      }
    };
    void inspect();
    const timer = setInterval(() => void inspect(), 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  async function apply() {
    if (!available || busy || !registration || registration.waiting !== waiting) return;
    if (
      !window.confirm(
        'Apply the new app shell? No draft may be active in any tab. This page will stay open; close all Ember tabs and reopen later to use the update.',
      )
    )
      return;
    setBusy(true);
    setMessage('');
    let begun = false;
    try {
      const applied = await requestShellUpdate(registration, async () => {
        await begin(true);
        begun = true;
        const locks = await navigator.locks?.query();
        if (
          !locks?.held?.some((lock) => lock.name === 'ember:installation:writer') ||
          (await repository.readDraft())
        )
          return false;
        return !(await repository.needsReconnect());
      });
      setMessage(
        applied
          ? 'Update activation requested. Close all Ember tabs and reopen when convenient; this page will not refresh.'
          : 'Update deferred. Finish every active workout and save local changes before trying again.',
      );
    } catch {
      setMessage('Update deferred. Local data was not changed.');
    } finally {
      if (begun) end();
      setBusy(false);
    }
  }
  if (!import.meta.env.PROD || (!waiting && !message)) return null;
  return (
    <SettingsGroup id='app-update-heading' titleAs='h3' title='App update'>
      {waiting && (
        <SettingsList>
          <SettingsRow
            label='A new app shell is ready'
            value='Finish active workouts first, including in other tabs. Applying never refreshes this page.'
            action={
              <Button disabled={!available || busy} onClick={() => void apply()}>
                Apply shell update
              </Button>
            }
          />
        </SettingsList>
      )}
      {message && (
        <p className={waiting ? 'mt-3' : undefined} role='status'>
          {message}
        </p>
      )}
    </SettingsGroup>
  );
}
