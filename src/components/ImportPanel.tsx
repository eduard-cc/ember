import {FileUp} from 'lucide-react';
import {useRef, useState} from 'react';

import {getExercises} from '../domain/model';
import type {Dataset} from '../domain/types';
import {type PreparedImport, prepareStrongImport} from '../storage/import';
import {Button} from './ui/button';
import {Card} from './ui/card';
import {InlineError} from './ui/inline-error';

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
    <Card className='import-panel'>
      <label className='flex items-center gap-[15px] border border-dashed border-border bg-accent p-5 text-sm text-primary'>
        <FileUp size={20} className='shrink-0' />
        <span className='min-w-0 flex-1'>
          Choose CSV file
          <input
            aria-label='Choose CSV file'
            type='file'
            accept='.csv,text/csv'
            className='mt-2.5 block w-full text-[12px] file:mr-2.5 file:min-h-11 file:border file:border-border file:bg-card file:px-3 file:py-2 file:text-foreground file:[font:inherit]'
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
      {loading && (
        <p className='mt-3.5' role='status'>
          Reading your history…
        </p>
      )}
      {error && (
        <InlineError role='alert' className='mt-3.5'>
          {error}
        </InlineError>
      )}
      {preview && (
        <div className='mt-5'>
          <h4>Ready to review</h4>
          <p className='mt-2'>
            {preview.workouts.length} workout{preview.workouts.length !== 1 ? 's' : ''} · {sets} set
            {sets !== 1 ? 's' : ''} · {exercises} exercise{exercises !== 1 ? 's' : ''}
          </p>
          <p className='mt-2'>
            {preview.warnings.duplicateRows} repeated rows · {preview.warnings.duplicateKeys} key
            collisions. Repeated rows are preserved, not silently merged.
          </p>
          <p className='mt-2'>
            Replace the imported/demo history, not append to it. Finished workouts, templates and
            your active draft stay intact. Browser storage is not a backup.
          </p>
          <Button
            variant='primary'
            className='mt-4'
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
    </Card>
  );
}
