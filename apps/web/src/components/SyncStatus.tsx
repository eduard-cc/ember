import type {useSync} from '../sync/use-sync';
import {StateNotice} from './StateNotice';

/** The sync-locked full page: owned data stays hidden until the owner's server answers. */
export function SyncLockedNotice({sync}: {sync: ReturnType<typeof useSync>}) {
  const title = sync.lastAttemptFailed ? 'Connection required' : 'Connecting…';
  const message =
    'Connect to Tailscale and make sure your Ember server is reachable. Reconnection is automatic.';
  return (
    <StateNotice title={title} announcement={message} className='mb-5'>
      <p className='text-inherit'>{message}</p>
    </StateNotice>
  );
}
