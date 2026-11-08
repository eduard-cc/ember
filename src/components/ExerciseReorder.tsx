import {GripVertical} from 'lucide-react';
import {type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useRef} from 'react';

import {reorderShift, reorderTarget} from '../domain/reorder';
import type {ExerciseLog} from '../domain/types';
import {selectionHaptic} from '../feedback';
import {reducedMotion} from '../utils/motion';
import {plural} from '../utils/plural';
import {ExerciseThumb} from './ExerciseThumb';

/** Completed of total, like the card's status line; validity is the card's rule. */
type SetProgress = (exercise: ExerciseLog) => string;

/** How long a header must be held before it lifts. Shorter than Android's context-menu press. */
const HOLD_MS = 400;
/** Moving further than this before the hold completes is a scroll, not a hold. */
const SLOP = 8;
/** Distance from the scroller's edge where a held row starts scrolling the list. */
const EDGE = 72;
/** Fastest auto-scroll step, px per frame. */
const MAX_SCROLL = 14;
const SETTLE_MS = 180;
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

export interface ReorderStart {
  /** Transient identity of the held exercise. */
  id: string;
  pointerId: number;
  /** Finger position when the hold completed. */
  y: number;
  /**
   * Hands the pointer over to the list. The finger may lift (or the window lose focus) between
   * the lift and the list's listeners being attached; such an early end is reported here once,
   * so the list can put the exercise back instead of waiting for a release that already happened.
   */
  claim: () => 'ended' | null;
}

/** Nearest ancestor that scrolls vertically: the logger, the library or an editor panel. */
export function scrollParent(node: Element | null): HTMLElement | null {
  for (let el = node?.parentElement; el; el = el.parentElement) {
    const {overflowY} = getComputedStyle(el);
    if (overflowY === 'auto' || overflowY === 'scroll') return el;
  }
  return null;
}

/**
 * Press-and-hold detection for exercise headers. A tap still clicks (opens details), and
 * moving before the hold completes is left to native scrolling. Only a still hold lifts.
 * `onHold` may return false to refuse the lift (the card then stays as it was).
 */
export function useHold(onHold: (start: ReorderStart) => boolean | void) {
  const latest = useRef(onHold);
  useLayoutEffect(() => {
    latest.current = onHold;
  }, [onHold]);
  const pending = useRef<(() => void) | null>(null);
  const lifted = useRef(false);
  // Watches the lifted pointer until the list claims it.
  const handoff = useRef<(() => 'ended' | null) | null>(null);
  // Touch events keep targeting the node the finger went down on; block scrolling on that node
  // and on the window, only for the length of a press.
  const origin = useRef<{node: EventTarget; block: (event: Event) => void} | null>(null);
  const unblock = () => {
    if (!origin.current) return;
    origin.current.node.removeEventListener('touchmove', origin.current.block);
    window.removeEventListener('touchmove', origin.current.block);
    origin.current = null;
  };
  useEffect(() => {
    // Android's long-press menu (and text selection callout) must not interrupt a hold.
    const menu = (event: Event) => {
      if (pending.current || lifted.current) event.preventDefault();
    };
    document.addEventListener('contextmenu', menu, true);
    return () => {
      pending.current?.();
      handoff.current?.();
      unblock();
      document.removeEventListener('contextmenu', menu, true);
    };
  }, []);

  const begin = (event: ReactPointerEvent<HTMLElement>, id: string, card: HTMLElement) => {
    if (event.button !== 0 || !event.isPrimary || pending.current || lifted.current) return;
    if (card.closest('fieldset:disabled')) return;
    const {pointerId, clientX: x, clientY: y0} = event;
    let y = y0;
    const scroller = scrollParent(card);
    const cleanup = () => {
      window.clearTimeout(timer);
      if (!lifted.current) unblock();
      delete card.dataset.holding;
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', end, true);
      document.removeEventListener('pointercancel', end, true);
      scroller?.removeEventListener('scroll', cleanup);
      window.removeEventListener('blur', cleanup);
      pending.current = null;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      y = e.clientY;
      if (Math.hypot(e.clientX - x, e.clientY - y0) > SLOP) cleanup();
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId === pointerId) cleanup();
    };
    const timer = window.setTimeout(() => {
      if (card.closest('fieldset:disabled')) return cleanup();
      lifted.current = true;
      cleanup();
      // React renders the list a moment later; a release in between must not be lost, or the
      // list would wait for it forever with scrolling blocked.
      let ended = false;
      const early = (e: Event) => {
        if (!(e instanceof PointerEvent) || e.pointerId === pointerId) ended = true;
      };
      document.addEventListener('pointerup', early, true);
      document.addEventListener('pointercancel', early, true);
      window.addEventListener('blur', early);
      const claim = () => {
        document.removeEventListener('pointerup', early, true);
        document.removeEventListener('pointercancel', early, true);
        window.removeEventListener('blur', early);
        handoff.current = null;
        const result = ended ? ('ended' as const) : null;
        ended = false;
        return result;
      };
      handoff.current = claim;
      if (latest.current({id, pointerId, y, claim}) === false) {
        claim();
        lifted.current = false;
        unblock();
        return;
      }
      swallowNextClick(pointerId);
      selectionHaptic([10]);
    }, HOLD_MS);
    unblock();
    const block = (e: Event) => {
      if (lifted.current && e.cancelable) e.preventDefault();
    };
    // Only for the length of this press: a page-wide non-passive listener would make every
    // scroll in the app wait on the main thread.
    event.target.addEventListener('touchmove', block, {passive: false});
    window.addEventListener('touchmove', block, {passive: false});
    origin.current = {node: event.target, block};
    card.dataset.holding = '';
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', end, true);
    document.addEventListener('pointercancel', end, true);
    scroller?.addEventListener('scroll', cleanup, {passive: true});
    window.addEventListener('blur', cleanup);
    pending.current = cleanup;
  };

  return {
    begin,
    release: () => {
      handoff.current?.();
      lifted.current = false;
      unblock();
    },
  };
}

/**
 * A hold can end in a click on whatever is under the pointer once the drag is over; it must
 * not open details or press a button. Only that pointer click is eaten: keyboard activation
 * (detail 0) always passes, and the guard expires shortly after the drag's pointer is released
 * (a touch drag usually produces no click at all), or at the next press.
 */
function swallowNextClick(pointerId: number) {
  let timer = 0;
  const swallow = (event: MouseEvent) => {
    if (event.detail === 0) return;
    event.preventDefault();
    event.stopPropagation();
    stop();
  };
  const released = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(stop, 400);
  };
  const stop = () => {
    window.clearTimeout(timer);
    document.removeEventListener('click', swallow, true);
    document.removeEventListener('pointerdown', stop, true);
    document.removeEventListener('pointerup', released, true);
    document.removeEventListener('pointercancel', released, true);
  };
  // Installed after the drag's own press, so the next press means the drag is long over.
  document.addEventListener('click', swallow, true);
  document.addEventListener('pointerdown', stop, true);
  document.addEventListener('pointerup', released, true);
  document.addEventListener('pointercancel', released, true);
}

/**
 * The compact list shown while an exercise is held: one row per exercise, the held one under
 * the finger, the others sliding aside. Release drops it; Escape, a cancelled pointer or
 * leaving the window puts it back. Transforms are written directly, so dragging never
 * re-renders.
 */
export function ReorderList({
  exercises,
  identity,
  start,
  onDrop,
  onCancel,
  progress = (ex) => plural(ex.sets.length, 'set'),
}: {
  exercises: ExerciseLog[];
  progress?: SetProgress;
  identity: (exercise: ExerciseLog) => string;
  start: ReorderStart;
  /** Target slot, and the held row's viewport top where it settled. */
  onDrop: (to: number, top: number) => void;
  /** The held row's viewport top, back in its own slot. */
  onCancel: (top: number) => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  const callbacks = useRef({onDrop, onCancel});
  useLayoutEffect(() => {
    callbacks.current = {onDrop, onCancel};
  }, [onDrop, onCancel]);
  const from = exercises.findIndex((ex) => identity(ex) === start.id);

  // Before paint: scroll so the held row sits under the finger, as if its card shrank around it.
  // The compact list is often shorter than the screen and can't scroll that far; temporary
  // space above or below it (gone with the list) makes up the difference, and room below lets
  // auto-scroll bring every slot within reach of a finger that can't leave the screen.
  useLayoutEffect(() => {
    const el = list.current;
    const rows = el ? (Array.from(el.children) as HTMLElement[]) : [];
    const row = rows[from];
    const scroller = scrollParent(el);
    if (!el || !row || !scroller) return;
    const centre = () => {
      const box = row.getBoundingClientRect();
      return box.top + box.height / 2;
    };
    const fit = () => {
      scroller.scrollTop += centre() - start.y;
    };
    fit();
    const gap = centre() - start.y;
    if (gap < -1) el.style.marginTop = `${-gap}px`;
    let below = gap > 1 ? gap : 0;
    const pitch = rows.length > 1 ? rows[1].offsetTop - rows[0].offsetTop : row.offsetHeight;
    const box = scroller.getBoundingClientRect();
    const bottomEdge = Math.min(box.bottom, innerHeight) - EDGE;
    const lastCentre = start.y + (rows.length - 1 - from) * pitch;
    const room = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop + below;
    below += Math.max(0, lastCentre - bottomEdge - room);
    if (below) el.style.marginBottom = `${below}px`;
    fit();
    // The list is created per drag (keyed by the held exercise); start and from never change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const rows = Array.from(el.children) as HTMLElement[];
    const held = rows[from];
    if (!held) return callbacks.current.onCancel(0);
    const scroller = scrollParent(el);
    const count = rows.length;
    const pitch = count > 1 ? rows[1].offsetTop - rows[0].offsetTop : held.offsetHeight;
    let y = start.y;
    let target = from;
    // Where the finger holds the row, relative to its centre; kept for the whole drag, so lifting
    // never moves the row even when the list is too short to scroll it under the finger.
    const half = held.offsetHeight / 2;
    const grab = start.y - (held.getBoundingClientRect().top + half);
    // Auto-scroll waits for real movement, so lifting near an edge doesn't scroll by itself.
    let moved = false;
    let frame = 0;
    let settleTimer = 0;
    let done = false;

    // Viewport top of the first slot; offsetTop ignores the transforms applied while dragging.
    const firstTop = () => el.getBoundingClientRect().top + rows[0].offsetTop;
    const place = () => {
      const top = firstTop();
      // The finger may wander past the ends; the row stops a little beyond the first/last slot.
      const centre = Math.min(
        Math.max(y - grab, top + half - pitch * 0.4),
        top + (count - 1) * pitch + half + pitch * 0.4,
      );
      const offset = centre - (top + from * pitch + half);
      held.style.transform = `translateY(${offset}px)`;
      const next = reorderTarget(from * pitch + offset, pitch, count);
      if (next === target) return;
      target = next;
      selectionHaptic([4]);
      rows.forEach((row, i) => {
        if (row === held) return;
        const shift = reorderShift(i, from, target);
        row.style.transform = shift ? `translateY(${shift * pitch}px)` : '';
      });
    };
    const tick = () => {
      if (done || !scroller) return;
      if (!moved) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const box = scroller.getBoundingClientRect();
      const top = Math.max(box.top, 0);
      const bottom = Math.min(box.bottom, innerHeight);
      const depth =
        y < top + EDGE
          ? -(top + EDGE - y) / EDGE
          : y > bottom - EDGE
            ? (y - bottom + EDGE) / EDGE
            : 0;
      if (depth) {
        const before = scroller.scrollTop;
        scroller.scrollTop += Math.max(-1, Math.min(1, depth)) * MAX_SCROLL;
        if (scroller.scrollTop !== before) place();
      }
      frame = requestAnimationFrame(tick);
    };

    const finish = (wanted: boolean) => {
      if (done) return;
      done = true;
      cancelAnimationFrame(frame);
      detach();
      // Editing may have been locked mid-drag (read-only tab, maintenance, a save in progress):
      // then the exercise goes back instead of changing a draft that can't be edited.
      const commit = wanted && !el.closest('fieldset:disabled');
      const slot = commit ? target : from;
      const settle = () => {
        const top = firstTop() + slot * pitch;
        if (commit) callbacks.current.onDrop(slot, top);
        else callbacks.current.onCancel(top);
      };
      if (!commit)
        rows.forEach((row) => {
          if (row !== held) row.style.transform = '';
        });
      if (reducedMotion()) return settle();
      // Glide into the slot it will occupy, then let the cards expand around it.
      held.dataset.dropping = '';
      held.style.transition = `transform ${SETTLE_MS}ms ${EASE_OUT}`;
      held.style.transform = `translateY(${(slot - from) * pitch}px)`;
      settleTimer = window.setTimeout(settle, SETTLE_MS);
    };

    const move = (event: PointerEvent) => {
      if (event.pointerId !== start.pointerId || done) return;
      y = event.clientY;
      if (Math.abs(y - start.y) > 10) moved = true;
      place();
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId === start.pointerId) finish(true);
    };
    const cancel = (event: PointerEvent) => {
      if (event.pointerId === start.pointerId) finish(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Before any dialog's own Escape handling: this Escape only puts the exercise back.
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    };
    const blur = () => finish(false);
    const detach = () => {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', blur);
    };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', cancel, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', blur);
    place();
    frame = requestAnimationFrame(tick);
    // A finger lifted before these listeners existed: put the exercise back where it was.
    if (start.claim() === 'ended') finish(false);
    return () => {
      done = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      detach();
    };
    // Runs once per drag: see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ol
      className='reorder-list relative m-0 flex touch-none list-none flex-col gap-1.5 px-4 py-3 select-none narrow:px-3 [.workout-sheet_&]:desk:px-6 [.workout-sheet_&]:desk:py-[14px]'
      ref={list}
      aria-label='Reorder exercises'
    >
      {exercises.map((ex, i) => (
        <li
          key={identity(ex)}
          className='reorder-row grid min-h-14 grid-cols-[40px_minmax(0,1fr)_auto_18px] items-center gap-3 border py-0 pr-3 pl-2 [-webkit-tap-highlight-color:transparent]'
          data-held={i === from || undefined}
          aria-current={i === from || undefined}
        >
          <ExerciseThumb name={ex.name} className='size-10' />
          <span className='reorder-name truncate text-[16px] font-semibold text-foreground'>
            {ex.name}
          </span>
          <span className='reorder-count text-[12px] tabular-nums'>{progress(ex)}</span>
          <GripVertical size={18} aria-hidden='true' />
        </li>
      ))}
    </ol>
  );
}
