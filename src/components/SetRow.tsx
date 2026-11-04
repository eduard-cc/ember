import {Ellipsis, Trash2} from 'lucide-react';
import {type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';

import {cue} from '../feedback';
import {useIsMobile} from '../hooks/use-is-mobile';
import {cn} from '../utils/cn';
import {reducedMotion} from '../utils/motion';
import {ActionSheet} from './action-sheet';
import {Button} from './ui/button';

/** The five-column set grid, shared by the header row and each row's sliding content. */
export const SET_GRID =
  'relative grid min-h-14 grid-cols-[44px_minmax(66px,1fr)_minmax(52px,.86fr)_minmax(48px,.78fr)_48px] items-center gap-1.5 tabular-nums narrow:gap-1';
/** The editors' grid: the logger's without its Done column, so every value sits where it does there. */
export const EDIT_GRID =
  'relative grid min-h-14 grid-cols-[44px_minmax(66px,1fr)_minmax(52px,.86fr)_minmax(48px,.78fr)] items-center gap-1.5 tabular-nums narrow:gap-1';

/** Width of the revealed Delete action. */
const OPEN = 88;
/** Past this share of the row width, releasing deletes without a second tap. */
const COMMIT = 0.6;
/** px/ms; a quick flick opens or closes regardless of distance. */
const FLICK = 0.3;
/** ms after a delete is applied; a row still mounted by then had its change refused. */
const REFUSED_AFTER = 1500;

type Gesture = {
  id: number;
  x: number;
  y: number;
  base: number;
  axis: 'x' | null;
  offset: number;
  samples: {x: number; t: number}[];
};

/**
 * The row slides under the finger as soon as a drag reads as horizontal. Native pan-y keeps
 * vertical scrolling; a focused field keeps horizontal drags for caret movement.
 */
export function SetRow({
  children,
  gridClass = SET_GRID,
  completed,
  added,
  number,
  label,
  onDelete,
  onDeletingChange,
}: {
  children: ReactNode;
  gridClass?: string;
  completed?: boolean;
  /** A set added in the history editor: its number is Amber. */
  added?: boolean;
  number: number;
  label: string;
  onDelete: () => void;
  onDeletingChange: (deleting: boolean) => void;
}) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  // Phones: the set number opens a drawer with Delete set; desktop reveals the swipe action.
  const [sheet, setSheet] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const deleteAction = useRef<HTMLButtonElement>(null);
  const suppressClick = useRef(false);
  const gesture = useRef<Gesture | null>(null);
  // The delete lands after the exit animation; always call the latest handler so edits made
  // meanwhile (another set added, a value typed) are not overwritten by a stale workout.
  const latestDelete = useRef(onDelete);
  const latestDeletingChange = useRef(onDeletingChange);
  useLayoutEffect(() => {
    latestDelete.current = onDelete;
    latestDeletingChange.current = onDeletingChange;
  }, [onDelete, onDeletingChange]);

  // Transforms are written straight to the element so a drag never re-renders the row.
  const place = useCallback((offset: number, animate: boolean) => {
    const el = content.current;
    if (!el) return;
    el.style.transition = animate ? '' : 'none';
    el.style.transform = offset ? `translateX(${offset}px)` : '';
  }, []);
  const settle = useCallback(
    (next: boolean, animate = true) => {
      delete row.current?.dataset.swiping;
      delete row.current?.dataset.commit;
      place(next ? -OPEN : 0, animate);
      setOpen(next);
      if (!next && deleteAction.current === document.activeElement)
        action.current?.focus({preventScroll: true});
    },
    [place],
  );
  const removing = useRef(false);
  const exitAnimation = useRef<Animation | null>(null);
  const refusedTimer = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      window.clearTimeout(refusedTimer.current);
      exitAnimation.current?.cancel();
      if (removing.current) latestDeletingChange.current(false);
    },
    [],
  );
  const disabled = () => !!row.current?.closest('fieldset:disabled');
  const remove = (animate = true) => {
    const el = content.current,
      box = row.current;
    if (removing.current || disabled()) return;
    if (!el || !box) return;
    cue('delete');
    if (!animate || reducedMotion()) return latestDelete.current();
    removing.current = true;
    latestDeletingChange.current(true);
    // The leaving row must not take focus or input during its exit, or a fast edit is lost.
    box.inert = true;
    delete box.dataset.swiping;
    el.style.transition = '';
    el.style.transform = 'translateX(-100%)';
    // Slide out, then close the gap so the rows below glide up instead of jumping.
    const animation = box.animate([{height: `${box.offsetHeight}px`}, {height: '0px'}], {
      duration: 160,
      delay: 140,
      easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
      fill: 'forwards',
    });
    exitAnimation.current = animation;
    const restore = () => {
      animation.cancel();
      exitAnimation.current = null;
      box.inert = false;
      removing.current = false;
      latestDeletingChange.current(false);
      settle(false);
    };
    animation.finished
      .then(() => {
        if (!box.isConnected) return;
        // Editing became disabled mid-exit: keep the set and bring the row back.
        if (disabled()) return restore();
        latestDelete.current();
        // React removes the row on its next commit, which is asynchronous. Keep it collapsed and
        // off-screen until then; restoring now would flash the deleted row back for a frame.
        // Only a refused change leaves it mounted, and then it is restored.
        refusedTimer.current = window.setTimeout(() => {
          refusedTimer.current = undefined;
          if (box.isConnected) restore();
        }, REFUSED_AFTER);
      })
      .catch(() => {
        // Cancelled on unmount: never apply a stale workout or reopen a closed editor.
      });
  };

  const cancelGesture = useCallback(() => {
    if (gesture.current?.axis) settle(open);
    gesture.current = null;
  }, [open, settle]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (open && !row.current?.contains(event.target as Node)) settle(false);
    };
    window.addEventListener('blur', cancelGesture);
    document.addEventListener('pointerdown', outside, true);
    return () => {
      window.removeEventListener('blur', cancelGesture);
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [open, settle, cancelGesture]);

  return (
    <div
      ref={row}
      className={cn(
        'set-row set-swipe relative touch-pan-y tabular-nums',
        completed && 'set-complete',
      )}
      data-open={open || undefined}
      onPointerDown={(event) => {
        if (!event.currentTarget.contains(event.target as Node)) return;
        suppressClick.current = false;
        const target = event.target as HTMLElement;
        if (
          event.button !== 0 ||
          disabled() ||
          gesture.current ||
          (target.matches('input') && target === document.activeElement)
        )
          return;
        gesture.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          base: open ? -OPEN : 0,
          axis: null,
          offset: open ? -OPEN : 0,
          samples: [{x: event.clientX, t: event.timeStamp}],
        };
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.contains(event.target as Node)) return;
        const g = gesture.current;
        if (!g || g.id !== event.pointerId) return;
        if ((event.pointerType === 'mouse' && !event.buttons) || disabled()) return cancelGesture();
        const dx = event.clientX - g.x,
          dy = event.clientY - g.y;
        if (!g.axis) {
          if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
          if (Math.abs(dy) >= Math.abs(dx)) {
            gesture.current = null;
            return;
          }
          g.axis = 'x';
          row.current!.dataset.swiping = '';
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // Synthetic pointers cannot be captured; the gesture still tracks.
          }
        }
        const raw = g.base + dx;
        // Dragging right past closed meets friction instead of a wall.
        g.offset = raw > 0 ? raw * 0.2 : raw;
        g.samples = [...g.samples.slice(-3), {x: event.clientX, t: event.timeStamp}];
        place(g.offset, false);
        const width = row.current!.offsetWidth;
        const commit = g.offset < -width * COMMIT;
        if (commit !== 'commit' in row.current!.dataset) {
          if (commit) {
            row.current!.dataset.commit = '';
            navigator.vibrate?.(8);
          } else delete row.current!.dataset.commit;
        }
      }}
      onPointerUp={(event) => {
        if (!event.currentTarget.contains(event.target as Node)) return;
        const g = gesture.current;
        if (!g || g.id !== event.pointerId) return;
        gesture.current = null;
        if (!g.axis) return;
        if (disabled()) return settle(false);
        suppressClick.current = true;
        const first = g.samples.find((s) => event.timeStamp - s.t < 100) ?? g.samples.at(-1)!;
        const dt = event.timeStamp - first.t;
        const velocity = dt > 0 ? (event.clientX - first.x) / dt : 0;
        if ('commit' in row.current!.dataset) return remove();
        if (velocity < -FLICK) return settle(true);
        if (velocity > FLICK) return settle(false);
        settle(g.offset < -OPEN / 2);
      }}
      onPointerCancel={(event) => {
        if (!event.currentTarget.contains(event.target as Node)) return;
        if (gesture.current?.id === event.pointerId) cancelGesture();
      }}
      onLostPointerCapture={(event) => {
        // Moving capture from the pressed control to this row also emits lostcapture on
        // that control. Only losing the row's own capture cancels our drag.
        if (event.target !== event.currentTarget) return;
        if (gesture.current?.id === event.pointerId) cancelGesture();
      }}
      onPointerLeave={(event) => {
        if (!event.currentTarget.contains(event.target as Node)) return;
        // Once captured, keep tracking beyond the row. Before capture, abandon a departing press.
        if (gesture.current?.id === event.pointerId && !gesture.current.axis) cancelGesture();
      }}
      onClickCapture={(event) => {
        if (!event.currentTarget.contains(event.target as Node)) return;
        if (event.detail === 0) return;
        if (suppressClick.current) {
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
          return;
        }
        // While open, a tap on the row closes it instead of acting on what is underneath.
        if (open && !(event.target as HTMLElement).closest('.set-swipe-actions')) {
          event.preventDefault();
          event.stopPropagation();
          settle(false);
        }
      }}
      onMouseDown={(event) => {
        if (!event.currentTarget.contains(event.target as Node)) return;
        // A tap that only closes the open row must not focus a field and raise the keyboard.
        if (open && !(event.target as HTMLElement).closest('.set-swipe-actions'))
          event.preventDefault();
      }}
      onKeyDown={(event) => {
        if (!event.currentTarget.contains(event.target as Node)) return;
        if (event.key === 'Escape' && open) settle(false, false);
      }}
    >
      <div ref={content} className={cn('set-swipe-content', gridClass)}>
        <Button
          size='icon'
          variant='ghost'
          className={cn('set-index gap-0.5', (completed || added) && 'font-semibold text-primary')}
          ref={action}
          aria-label={`Actions for ${label}`}
          aria-haspopup={mobile ? 'menu' : undefined}
          aria-expanded={open || sheet}
          onClick={(event) => {
            if (mobile && !open) {
              cue('tick');
              return setSheet(true);
            }
            if (!open) cue('tick');
            settle(!open, event.detail !== 0);
            if (!open && event.detail === 0) deleteAction.current?.focus({preventScroll: true});
          }}
        >
          {number}
          <Ellipsis size={11} aria-hidden='true' />
        </Button>
        {children}
        <Button
          size='icon'
          variant='ghost'
          className='desktop-remove hidden'
          aria-label={`Remove ${label}`}
          onClick={() => {
            cue('delete');
            onDelete();
          }}
        >
          <Trash2 size={14} />
        </Button>
      </div>
      <div className='set-swipe-actions'>
        <button
          ref={deleteAction}
          type='button'
          className='set-swipe-delete'
          tabIndex={open ? 0 : -1}
          aria-hidden={!open}
          aria-label={`Delete ${label}`}
          onClick={(event) => remove(event.detail !== 0)}
        >
          <Trash2 size={18} aria-hidden='true' />
          <span>Delete</span>
        </button>
      </div>
      {mobile && (
        <ActionSheet
          open={sheet}
          onOpenChange={setSheet}
          title={label}
          label={`Actions for ${label}`}
          trigger={action}
          actions={[{label: 'Delete set', icon: Trash2, danger: true, onSelect: () => remove()}]}
        />
      )}
    </div>
  );
}
