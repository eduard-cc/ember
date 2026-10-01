import {FileUp, X} from 'lucide-react';
import {useRef, useState} from 'react';

import {getExercises} from '../domain/model';
import type {Dataset} from '../domain/types';
import {type PreparedImport, prepareStrongImport} from '../storage/import';
import {Button} from './ui';

export function ImportPanel({
  onReplace,
  onClose,
}: {
  onReplace: (prepared: PreparedImport) => Promise<void>;
  onClose: () => void;
}) {
  const [prepared, setPrepared] = useState<PreparedImport | null>(null);
  const preview: Dataset | null = prepared?.dataset ?? null;
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const revision = useRef(0);
  const sets =
    preview?.workouts.reduce(
      (n, w) => n + w.exercises.reduce((m, ex) => m + ex.sets.length, 0),
      0,
    ) ?? 0;
  const exercises = preview ? getExercises(preview).length : 0;
  return (
    <section className='import-panel'>
      <div className='section-heading'>
        <div>
          <h2>Import your Strong history</h2>
          <p>
            Parsed in this browser. Confirmed history synchronizes to your own server when signed
            in.
          </p>
        </div>
        <Button variant='ghost' size='icon' aria-label='Close import' onClick={onClose}>
          <X size={18} />
        </Button>
      </div>
      <label className='file-input'>
        <FileUp size={20} />
        <span>
          Choose CSV file
          <input
            aria-label='Choose CSV file'
            type='file'
            accept='.csv,text/csv'
            onChange={async (e) => {
              const file = e.target.files?.[0];
              const token = ++revision.current;
              setPrepared(null);
              setError('');
              if (!file) return;
              if (file.size > 25 * 1024 * 1024) {
                setError('This file is too large. Choose a CSV smaller than 25 MB.');
                return;
              }
              setLoading(true);
              try {
                const parsed = await prepareStrongImport(new Uint8Array(await file.arrayBuffer()));
                if (token === revision.current) setPrepared(parsed);
              } catch (err) {
                if (token === revision.current)
                  setError(
                    err instanceof Error
                      ? err.message
                      : 'Could not read this CSV. The current history was not changed.',
                  );
              } finally {
                if (token === revision.current) setLoading(false);
              }
            }}
          />
        </span>
      </label>
      {loading && <p role='status'>Reading your history…</p>}
      {error && (
        <p className='inline-error' role='alert'>
          {error}
        </p>
      )}
      {preview && (
        <div className='import-preview'>
          <h3>Ready to review</h3>
          <p>
            {preview.workouts.length} workout{preview.workouts.length !== 1 ? 's' : ''} · {sets} set
            {sets !== 1 ? 's' : ''} · {exercises} exercise{exercises !== 1 ? 's' : ''}
          </p>
          <p>
            {preview.warnings.duplicateRows} repeated rows · {preview.warnings.duplicateKeys} key
            collisions · {preview.warnings.suspiciousRows} flagged sets. Repeated rows are
            preserved, not silently merged.
          </p>
          <p>
            Replace the imported/demo history, not append to it. Finished workouts, templates and
            your active draft stay intact. Browser storage is not a backup.
          </p>
          <Button
            variant='primary'
            disabled={loading}
            onClick={async () => {
              if (!prepared) return;
              setLoading(true);
              try {
                await onReplace(prepared);
                onClose();
              } catch {
                setError('Import was not saved. Existing data was kept; retry.');
              } finally {
                setLoading(false);
              }
            }}
          >
            Replace history
          </Button>
        </div>
      )}
    </section>
  );
}
