import {useEffect, useRef, useState} from 'react';

import {requestShellUpdate} from '../pwa/register';
import {useBackLayer} from '../state/back';
import type {WorkoutRepository} from '../storage/repository';
import {SettingsGroup, SettingsList, SettingsRow} from './settings-group';
import {Button} from './ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from './ui/responsive-dialog';

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
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const focusPending = useRef(false);
  useEffect(() => {
    if (!available || busy || !focusPending.current) return;
    focusPending.current = false;
    trigger.current?.focus();
  }, [available, busy]);
  useBackLayer(confirming, () => setConfirming(false));
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
    setConfirming(false);
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
              <Button
                ref={trigger}
                disabled={!available || busy}
                onClick={() => setConfirming(true)}
              >
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
      <ResponsiveDialog open={confirming} onOpenChange={setConfirming}>
        <ResponsiveDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            // A sync attempt can disable the opener while the confirmation is open.
            // Restore immediately when possible, otherwise on the first eligible render.
            if (trigger.current?.disabled) focusPending.current = true;
            else trigger.current?.focus();
          }}
        >
          <ResponsiveDialogHeader className='text-left'>
            <ResponsiveDialogTitle>Apply the new app shell?</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              No draft may be active in any tab. This page will stay open; close all Ember tabs and
              reopen later to use the update.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter className='max-desk:flex-col-reverse max-desk:*:min-h-12'>
            <ResponsiveDialogClose asChild>
              <Button>Not now</Button>
            </ResponsiveDialogClose>
            <Button variant='primary' disabled={!available || busy} onClick={() => void apply()}>
              Apply update
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </SettingsGroup>
  );
}
