import type {useSync} from '../sync/use-sync';

export function SyncStatus({sync}: {sync: ReturnType<typeof useSync>}) {
  return (
    <span role='status' aria-label='Server synchronization' className='quiet-note'>
      {sync.status}
    </span>
  );
}
