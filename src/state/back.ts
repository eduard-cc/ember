import {useLayoutEffect, useRef} from 'react';
import {flushSync} from 'react-dom';

/**
 * Android's back gesture (and the browser Back button) closes the newest open layer (a dialog,
 * exercise details, an editor, the expanded mobile workout) instead of leaving the app.
 *
 * Each open layer owns one same-document history entry above the app's own entry, numbered in
 * `history.state`. Going back pops an entry and closes the newest layer. A layer may decline
 * (unsaved changes); the app then steps forward onto its entry again. A layer closed from the
 * UI gives its entry back, so back on a main tab still leaves the app. Main tabs never add
 * entries. After a reload, leftover entries are reconciled on the first tap, not at startup:
 * the saved workout reopens only after storage loads and sync unlocks, so an early trim would
 * remove its entry and the re-added one would wait for a tap, letting back leave the app.
 *
 * Chrome lets the back gesture skip entries a page adds without a fresh tap, and an in-page
 * back resets that tap. Declined backs therefore reuse the existing entry instead of pushing a
 * new one, which Chrome would mark skippable and the next back would leave the app.
 */
const KEY = 'emberBackDepth';
type Layer = {close: () => void};
const layers: Layer[] = [];
let depth = 0;
// Our own history.go() calls whose popstate is still due; their pops close nothing.
let ignoring = 0;
let scheduled = false;

const depthOf = (state: unknown) =>
  typeof state === 'object' && state !== null && typeof (state as never)[KEY] === 'number'
    ? ((state as Record<string, number>)[KEY] ?? 0)
    : 0;

function reconcile() {
  scheduled = false;
  if (ignoring) return;
  const target = layers.length;
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
        flushSync(() => top.close());
        if (layers.at(-1) === top) break; // Declined.
      }
      // Entries just popped still exist ahead; step back onto them for layers that stayed open.
      const restore = Math.min(layers.length, depth + popped) - depth;
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
    const layer = {close: () => latest.current()};
    layers.push(layer);
    schedule();
    return () => {
      layers.splice(layers.indexOf(layer), 1);
      schedule();
    };
  }, [active]);
}
