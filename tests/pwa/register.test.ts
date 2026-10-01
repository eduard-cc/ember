import {describe, expect, it, vi} from 'vitest';

import * as pwa from '../../src/pwa/register';

type Update = (
  registration: ServiceWorkerRegistration,
  savedTransitionGate: () => Promise<boolean>,
) => Promise<boolean>;
const update = () => (pwa as unknown as {requestShellUpdate?: Update}).requestShellUpdate;

describe('explicit saved-transition update API', () => {
  it('does not register from a non-production build', async () => {
    expect(await pwa.registerProductionShell()).toBeUndefined();
  });
  it('returns false without a waiting update', async () => {
    const gate = vi.fn(async () => true);
    expect(await update()!({waiting: null} as unknown as ServiceWorkerRegistration, gate)).toBe(
      false,
    );
    expect(gate).not.toHaveBeenCalled();
  });
  it('propagates failed durable-save confirmation without activating', async () => {
    const postMessage = vi.fn();
    await expect(
      update()!({waiting: {postMessage}} as unknown as ServiceWorkerRegistration, async () => {
        throw new Error('save failed');
      }),
    ).rejects.toThrow('save failed');
    expect(postMessage).not.toHaveBeenCalled();
  });
  it('does not activate a different update that appeared while the caller was saving', async () => {
    const first = {postMessage: vi.fn()};
    const second = {postMessage: vi.fn()};
    const registration = {waiting: first} as unknown as ServiceWorkerRegistration;
    expect(
      await update()!(registration, async () => {
        Object.assign(registration, {waiting: second});
        return true;
      }),
    ).toBe(false);
    expect(first.postMessage).not.toHaveBeenCalled();
    expect(second.postMessage).not.toHaveBeenCalled();
  });
  it('sends only an explicit activation message after the caller confirms a safe transition', async () => {
    const postMessage = vi.fn();
    const registration = {waiting: {postMessage}} as unknown as ServiceWorkerRegistration;
    expect(await update()!(registration, async () => true)).toBe(true);
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({type: 'ACTIVATE_SAVED_SHELL'});
  });
  it('refuses activation when the caller has not confirmed the draft is safely saved', async () => {
    expect(update()).toBeTypeOf('function');
    const postMessage = vi.fn();
    const registration = {waiting: {postMessage}} as unknown as ServiceWorkerRegistration;
    expect(await update()!(registration, async () => false)).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
  });
});
