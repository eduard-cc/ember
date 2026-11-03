import type {useSync} from '../sync/use-sync';
import {plural} from '../utils/plural';
import {StateNotice} from './StateNotice';

export function SyncStatus({sync}: {sync: ReturnType<typeof useSync>}) {
  const download = sync.historyDownload;
  const title = sync.locked
    ? sync.lastAttemptFailed
      ? 'Connection required'
      : 'Connecting…'
    : download
      ? 'History download'
      : sync.lastAttemptFailed
        ? 'Server unavailable'
        : sync.status === 'Connecting…'
          ? 'Connecting…'
          : null;
  if (!title) return null;
  const message = sync.locked
    ? 'Connect to Tailscale and make sure your Ember server is reachable. Reconnection is automatic.'
    : download
      ? download === 'waiting'
        ? `Your workout history has not finished downloading. It continues when your server is reachable.${sync.pending ? ` ${plural(sync.pending, 'change')} waiting to sync.` : ''}`
        : 'Downloading your workout history from your server…'
      : sync.pending
        ? `${plural(sync.pending, 'change')} waiting to sync. Reconnection is automatic; you can keep working on this device.`
        : 'You can keep working on this device. Reconnection is automatic when your server is reachable.';
  return (
    <StateNotice title={title} announcement={message} className='mb-5'>
      <p className='text-inherit'>{message}</p>
    </StateNotice>
  );
}
