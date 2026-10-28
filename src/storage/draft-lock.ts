// Serialize lifecycle acquisition within a document (including StrictMode remounts).
let lifetime: Promise<unknown> = Promise.resolve();
export interface DraftLock {
  writable: boolean;
  error: string;
  release: () => void;
}
// One ember DB is one installation per origin. This stable installation key
// also guards first-run metadata and migration before a draft ID exists.
export async function acquireDraftLock(signal: AbortSignal): Promise<DraftLock> {
  if (!navigator.locks?.request)
    return {
      writable: false,
      error:
        'Web Locks is unavailable. Editing is disabled to protect your draft. Use a browser with Web Locks support.',
      release() {},
    };
  return new Promise((resolve, reject) => {
    const request = lifetime.then(() =>
      navigator.locks.request('ember:installation:writer', {ifAvailable: true}, async (lock) => {
        if (signal.aborted) throw new DOMException('Lock acquisition cancelled', 'AbortError');
        if (!lock) {
          resolve({
            writable: false,
            error:
              'Another tab is editing this installation. This tab is read-only. Close the writer tab, then reload to edit.',
            release() {},
          });
          return;
        }
        await new Promise<void>((release) => {
          resolve({writable: true, error: '', release});
        });
      }),
    );
    lifetime = request.catch(() => undefined);
    request.catch(reject);
  });
}
