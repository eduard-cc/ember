import {useId, useRef, useState} from 'react';

import {type Backup, parseBackup} from '../../shared/backup';
import {exportBackup, restoreBackup} from '../storage/backup';
import type {WorkoutRepository} from '../storage/repository';
import {Button, Input} from './ui';

export interface RecoveryPanelProps {
  repository: WorkoutRepository;
  onRestored?: () => void | Promise<void>;
  readOnly?: boolean;
  persistenceError?: boolean;
  begin?: (restoring: boolean) => Promise<void>;
  end?: (safeToResume?: boolean) => void;
}
export function RecoveryPanel({
  repository,
  onRestored,
  readOnly = false,
  persistenceError = false,
  begin,
  end,
}: RecoveryPanelProps) {
  const id = useId();
  const generation = useRef(0);
  const [candidate, setCandidate] = useState<{text: string; backup: Backup} | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  async function download() {
    if (readOnly) return;
    setBusy(true);
    setError('');
    let begun = false;
    try {
      await begin?.(false);
      begun = true;
      const text = await exportBackup(repository);
      const url = URL.createObjectURL(new Blob([text], {type: 'application/json'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = `gym-log-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(
        'Backup exported locally. Keep it private; it contains workout history and original source evidence.',
      );
    } catch {
      setError('Could not export local backup. No data was changed.');
    } finally {
      if (begun) end?.();
      setBusy(false);
    }
  }
  async function preview(file?: File) {
    const current = ++generation.current;
    setCandidate(null);
    setConfirmed(false);
    setError('');
    setStatus('');
    if (!file) return;
    try {
      const text = await file.text();
      const backup = parseBackup(text);
      if (current !== generation.current) return;
      setCandidate({text, backup});
      const s = backup.state;
      setStatus(
        `${(s.dataset?.workouts.length ?? 0) + s.finished.length} historical workouts, ${s.templates?.length ?? 0} templates, ${s.active ? 1 : 0} local active draft. ${backup.sources.length} original sources; ${backup.pendingOperations.operations.length} diagnostic pending operations (not replayed).`,
      );
    } catch {
      if (current === generation.current)
        setError('Invalid backup. Existing local data has not been changed.');
    }
  }
  async function restore() {
    if (!candidate || !confirmed || readOnly) return;
    setBusy(true);
    setError('');
    let begun = false;
    let safeToResume = true;
    try {
      await begin?.(true);
      begun = true;
      await restoreBackup(repository, candidate.text, {
        replaceLocal: true,
        confirmation: 'REPLACE LOCAL DATA',
      });
      setCandidate(null);
      setConfirmed(false);
      setStatus(
        'Restored locally. Draft ownership was reset. New pending operations may conflict with existing server revisions; no newer server data was overwritten.',
      );
      try {
        await onRestored?.();
      } catch {
        safeToResume = false;
        setError(
          'Restore completed, but the view could not refresh. Reload this page before editing.',
        );
      }
    } catch {
      setError('Restore failed. No local data was replaced.');
    } finally {
      if (begun) end?.(safeToResume);
      setBusy(false);
    }
  }
  return (
    <section className='card' aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Backup and recovery</h2>
      <p>
        Exports stay on this device and exclude credentials and sessions. The active draft is local
        to its starting installation. Import deliberately resets local ownership; drafts are not
        queued for server sync.
      </p>
      <Button onClick={() => void download()} disabled={busy || readOnly}>
        Export local backup
      </Button>
      {persistenceError && (
        <p role='alert'>
          Export includes only data saved on this device, not unsaved changes in memory. Restore is
          unavailable until those changes are saved.
        </p>
      )}
      <label htmlFor={`${id}-file`}>Import backup JSON</label>
      <Input
        id={`${id}-file`}
        type='file'
        accept='.json,application/json'
        disabled={busy || readOnly}
        onChange={(event) => void preview(event.target.files?.[0])}
      />
      <p role='status' aria-live='polite'>
        {readOnly && !status.startsWith('Restored locally.') ? '' : status}
      </p>
      <label>
        <input
          type='checkbox'
          checked={confirmed}
          disabled={!candidate || busy || readOnly}
          onChange={(event) => setConfirmed(event.target.checked)}
        />{' '}
        I understand this replaces local data and resets draft ownership
      </label>
      <p>
        Original retained source bytes remain unchanged. Queue acknowledgements and server revision
        assumptions are not restored. Pause sync and other editing before restoring.
      </p>
      <Button
        variant='danger'
        disabled={!candidate || !confirmed || busy || readOnly || persistenceError}
        onClick={() => void restore()}
      >
        Restore backup locally
      </Button>
      {readOnly && (
        <p>
          Recovery is unavailable while loading, signed out of owned data, or another tab owns this
          installation.
        </p>
      )}
      {error && <p role='alert'>{error}</p>}
    </section>
  );
}
