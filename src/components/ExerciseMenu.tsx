import {ArrowDown, ArrowUp, Ellipsis, type LucideIcon, Replace, Trash2} from 'lucide-react';
import {
  type KeyboardEvent,
  forwardRef,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import {useBackLayer} from '../state/back';
import {Button} from './ui';

/** How long the backdrop waits for the click that follows its closing tap. */
const SWALLOW_MS = 700;

/** Visible vertical bounds for the menu: every clipping ancestor, then the viewport. */
function clipBox(node: HTMLElement) {
  let top = 0;
  let bottom = window.innerHeight;
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (getComputedStyle(el).overflowY === 'visible') continue;
    const rect = el.getBoundingClientRect();
    top = Math.max(top, rect.top);
    bottom = Math.min(bottom, rect.bottom);
  }
  return {top, bottom};
}

export interface MenuItem {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
}

/**
 * A ⋯ options menu. Rendered inline (not portaled) so it stays inside its card and is
 * hidden with it. It opens below the trigger, or above it when there is no room below.
 * Escape or a tap outside closes it and returns focus to ⋯; Tab continues from ⋯; focus
 * moving anywhere else closes it. A transparent backdrop takes the closing tap, so that tap
 * never also presses whatever was underneath.
 */
export const OptionsMenu = forwardRef<
  HTMLButtonElement,
  {label: string; items: MenuItem[]; className?: string}
>(({label, items: entries, className = ''}, ref) => {
  const [open, setOpen] = useState(false);
  const [upward, setUpward] = useState(false);
  // The backdrop outlives the menu by one tap: it closes on pointerdown, then eats the click.
  const [swallowing, setSwallowing] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const id = useId();
  const items = () =>
    Array.from(menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? []);

  // Measured before paint: flip upward when the menu doesn't fit below and fits better above.
  useLayoutEffect(() => {
    if (!open || !menu.current || !trigger.current) return;
    const button = trigger.current.getBoundingClientRect();
    const height = menu.current.offsetHeight + 4;
    const clip = clipBox(trigger.current);
    const below = clip.bottom - button.bottom;
    const above = button.top - clip.top;
    setUpward(below < height && above > below);
  }, [open]);

  useEffect(() => {
    if (open) items()[0]?.focus({preventScroll: true});
  }, [open]);

  useEffect(() => {
    if (!swallowing) return;
    // A gesture that never becomes a click (a drag, a cancelled touch) must not leave it up.
    const timer = setTimeout(() => setSwallowing(false), SWALLOW_MS);
    return () => clearTimeout(timer);
  }, [swallowing]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus({preventScroll: true});
  };
  useBackLayer(open, close);
  const onMenuKey = (event: KeyboardEvent) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const move = (index: number) => list[(index + list.length) % list.length]?.focus();
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      // Focus ⋯ without cancelling the key: the browser's own Tab step then starts from ⋯, so
      // Tab and Shift+Tab land exactly where they would have if the menu had never opened.
      close();
      return;
    } else if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(-1);
    else return;
    event.preventDefault();
  };
  const choose = (action: () => void) => {
    close();
    action();
  };

  return (
    <div
      className={`exercise-menu ${className}`}
      onBlur={(event) => {
        // Focus moving outside (another ⋯, a field) closes this menu; only one is ever open.
        if (open && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <Button
        ref={(node) => {
          trigger.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        size='icon'
        variant='ghost'
        aria-label={label}
        aria-haspopup='menu'
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Ellipsis size={18} aria-hidden='true' />
      </Button>
      {(open || swallowing) && (
        <div
          className='exercise-menu-backdrop'
          aria-hidden='true'
          onPointerDown={(event) => {
            // Keeps focus where it is and presses nothing underneath: this tap only closes.
            event.preventDefault();
            if (!open) return;
            setSwallowing(true);
            close();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setSwallowing(false);
          }}
        />
      )}
      {open && (
        <div
          ref={menu}
          id={id}
          role='menu'
          aria-label={label}
          // Focusable, so a press on its padding keeps focus inside instead of closing it.
          tabIndex={-1}
          className='exercise-menu-list'
          data-side={upward ? 'top' : 'bottom'}
          onKeyDown={onMenuKey}
        >
          {entries.map(({label, icon: Icon, onSelect, danger}) => (
            <button
              key={label}
              type='button'
              role='menuitem'
              tabIndex={-1}
              className={danger ? 'exercise-menu-danger' : undefined}
              onClick={() => choose(onSelect)}
            >
              <Icon size={16} aria-hidden='true' />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
OptionsMenu.displayName = 'OptionsMenu';

/** Per-exercise ⋯ menu in the logger and the editors. Move items appear only where possible. */
export const ExerciseMenu = forwardRef<
  HTMLButtonElement,
  {
    name: string;
    onReplace: () => void;
    onRemove: () => void;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
  }
>(({name, onReplace, onRemove, onMoveUp, onMoveDown}, ref) => (
  <OptionsMenu
    ref={ref}
    label={`Exercise options for ${name}`}
    items={[
      {label: 'Replace exercise', icon: Replace, onSelect: onReplace},
      ...(onMoveUp ? [{label: 'Move up', icon: ArrowUp, onSelect: onMoveUp}] : []),
      ...(onMoveDown ? [{label: 'Move down', icon: ArrowDown, onSelect: onMoveDown}] : []),
      {label: 'Remove exercise', icon: Trash2, onSelect: onRemove, danger: true},
    ]}
  />
));
ExerciseMenu.displayName = 'ExerciseMenu';
