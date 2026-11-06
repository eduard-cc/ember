import {useLayoutEffect, useRef} from 'react';
import {flushSync} from 'react-dom';

/**
 * Android's back gesture (and the browser Back button) closes the newest open layer (a dialog,
 * exercise details, an editor, the expanded mobile workout) instead of leaving the app.
 *
 * Each open layer owns one same-document history entry (or shares one, below) above the app's
 * own entry, numbered in `history.state`. Going back pops an entry and closes the newest layer.
 * A layer may decline (unsaved changes); the app then steps forward onto its entry again. A
 * layer closed from the UI gives its entry back, so back on a main tab still leaves the app.
 * Main tabs never add entries. After a reload, leftover entries are reconciled on the first
 * tap, not at startup: the saved workout reopens only after storage loads and sync unlocks, so
 * an early trim would remove its entry and the re-added one would wait for a tap, letting back
 * leave the app.
 *
 * Chrome lets the back gesture skip entries a page adds without a fresh tap, and an entry
 * pushed shortly after a gesture back is marked skippable, so the next back would leave the
 * app. A back therefore never leads to a push: a declined back steps forward onto the existing
 * entry, and a layer the declining layer opens in response (its discard prompt) shares that
 * entry. Back on the shared entry closes the newest layer, then steps forward again.
 */
const KEY = 'emberBackDepth';
type Layer = {close: () => void; shared?: boolean};
const layers: Layer[] = [];
let depth = 0;
// Our own history.go() calls whose popstate is still due; their pops close nothing.
let ignoring = 0;
let scheduled = false;
// Layers registered while a back is closing a layer, or null outside one.
let opened: Layer[] | null = null;

const depthOf = (state: unknown) =>
  typeof state === 'object' && state !== null && typeof (state as never)[KEY] === 'number'
    ? ((state as Record<string, number>)[KEY] ?? 0)
    : 0;

/** Entries the open layers need: shared layers ride on the entry below them. */
const needed = () => layers.filter((layer) => !layer.shared).length;

function reconcile() {
  scheduled = false;
  if (ignoring) return;
  const target = needed();
  if (depth > target) {
    ignoring++;
    history.go(target - depth);
    return;
  }
  // Chrome's back gesture skips entries added before the user ever interacted with the page,
  // which would leave the app. A layer open from launch waits for the first tap or key.
  if (depth < target && navigator.userActivation?.hasBeenActive === false) return;
  while (depth < target) history.pushState({...history.state, [KEY]: ++depth}, '');
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  // Layout effects of one commit run together; settle once after all of them.
  queueMicrotask(reconcile);
}

if (typeof window !== 'undefined') {
  depth = depthOf(history.state);
  window.addEventListener('popstate', (event) => {
    const next = depthOf(event.state);
    const popped = depth - next;
    depth = next;
    if (ignoring) ignoring--;
    else {
      for (let i = 0; i < popped; i++) {
        const top = layers.at(-1);
        if (!top) break;
        // Render the close now so the layer has unregistered before the next step.
        opened = [];
        flushSync(() => top.close());
        const declined = layers.includes(top);
        if (declined) for (const layer of opened) layer.shared = true;
        opened = null;
        // A shared layer's entry still belongs to the layer below it.
        if (declined || top.shared) break;
      }
      // Entries just popped still exist ahead; step back onto them for layers that stayed open.
      const restore = Math.min(needed(), depth + popped) - depth;
      if (restore > 0) {
        ignoring++;
        history.go(restore);
        return;
      }
    }
    schedule();
  });
  window.addEventListener('click', schedule, true);
  window.addEventListener('keydown', schedule, true);
}

/** While `active`, back closes this layer by calling `close`, which may decline. */
export function useBackLayer(active: boolean, close: () => void) {
  const latest = useRef(close);
  useLayoutEffect(() => {
    latest.current = close;
  });
  useLayoutEffect(() => {
    if (!active) return;
    const layer: Layer = {close: () => latest.current()};
    layers.push(layer);
    opened?.push(layer);
    schedule();
    return () => {
      layers.splice(layers.indexOf(layer), 1);
      schedule();
    };
  }, [active]);
}
