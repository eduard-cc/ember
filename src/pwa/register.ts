/** No development registration and no automatic refresh on controller changes. */
export async function registerProductionShell(): Promise<ServiceWorkerRegistration | undefined> {
  if (!import.meta.env.PROD || !window.isSecureContext || !('serviceWorker' in navigator)) return;
  const worker = new URL('/sw.js', window.location.origin);
  return navigator.serviceWorker.register(worker.href, {scope: '/', updateViaCache: 'none'});
}

/** User-initiated only. Caller owns draft/outbox durability and confirmation across tabs.
 * Activates a waiting worker but deliberately never refreshes or redraws this page.
 */
export async function requestShellUpdate(
  registration: ServiceWorkerRegistration,
  savedTransitionGate: () => Promise<boolean>,
): Promise<boolean> {
  const waiting = registration.waiting;
  if (!waiting || !(await savedTransitionGate())) return false;
  if (registration.waiting !== waiting) return false;
  waiting.postMessage({type: 'ACTIVATE_SAVED_SHELL'});
  return true;
}
