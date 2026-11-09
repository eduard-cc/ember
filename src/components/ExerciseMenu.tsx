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

import {useIsMobile} from '../hooks/use-is-mobile';
import {useBackLayer} from '../state/back';
import {cn} from '../utils/cn';
import {ActionSheet} from './action-sheet';
import {Button} from './ui/button';

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
 * A ⋯ options menu. Below 1000px it is an `ActionSheet` (a bottom drawer). From 1000px it is
 * rendered inline (not portaled) so it stays inside its card and is
 * hidden with it. It opens below the trigger, or above it when there is no room below.
 * Escape or a tap outside closes it and returns focus to ⋯; Tab continues from ⋯; focus
 * moving anywhere else closes it. A transparent backdrop takes the closing tap, so that tap
 * never also presses whatever was underneath.
 */
export const OptionsMenu = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    items: MenuItem[];
    className?: string;
    /** The drawer's visible heading on phones; defaults to the label. */
    title?: string;
    /** For a menu portaled outside the disabled content fieldset (the workout drawer). */
    disabled?: boolean;
    /** The ⋯ button's look: bare in cards and headings, outlined in a button row. */
    variant?: 'ghost' | 'secondary';
  }
>(({label, items: entries, className = '', title, disabled, variant = 'ghost'}, ref) => {
  const mobile = useIsMobile();
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
    if (!open || mobile || !menu.current || !trigger.current) return;
    const button = trigger.current.getBoundingClientRect();
    const height = menu.current.offsetHeight + 4;
    const clip = clipBox(trigger.current);
    const below = clip.bottom - button.bottom;
    const above = button.top - clip.top;
    setUpward(below < height && above > below);
  }, [open, mobile]);

  useEffect(() => {
    if (open && !mobile) items()[0]?.focus({preventScroll: true});
  }, [open, mobile]);

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
  // The drawer registers its own back layer.
  useBackLayer(open && !mobile, close);
  const toggle = (next: boolean) => {
    setOpen(next);
  };
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
      className={cn('exercise-menu relative shrink-0', className)}
      onBlur={(event) => {
        // Focus moving outside (another ⋯, a field) closes this menu; only one is ever open.
        if (open && !mobile && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <Button
        ref={(node) => {
          trigger.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        size='icon'
        variant={variant}
        className='aria-expanded:bg-accent aria-expanded:text-foreground'
        aria-label={label}
        disabled={disabled}
        aria-haspopup='menu'
        aria-expanded={open}
        aria-controls={open && !mobile ? id : undefined}
        onClick={() => toggle(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            toggle(true);
          }
        }}
      >
        <Ellipsis size={18} aria-hidden='true' />
      </Button>
      {mobile && (
        <ActionSheet
          open={open}
          onOpenChange={setOpen}
          title={title ?? label}
          label={label}
          trigger={trigger}
          actions={entries}
        />
      )}
      {!mobile && (open || swallowing) && (
        <div
          className='exercise-menu-backdrop fixed inset-0 z-[19] [-webkit-tap-highlight-color:transparent]'
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
      {open && !mobile && (
        <div
          ref={menu}
          id={id}
          role='menu'
          aria-label={label}
          // Focusable, so a press on its padding keeps focus inside instead of closing it.
          tabIndex={-1}
          className='exercise-menu-list absolute top-[calc(100%+4px)] right-0 z-20 flex min-w-[208px] flex-col rounded-md border border-border bg-card p-1 [box-shadow:var(--shadow)] data-[side=top]:top-auto data-[side=top]:bottom-[calc(100%+4px)]'
          data-side={upward ? 'top' : 'bottom'}
          onKeyDown={onMenuKey}
        >
          {entries.map(({label, icon: Icon, onSelect, danger}) => (
            <button
              key={label}
              type='button'
              role='menuitem'
              tabIndex={-1}
              className={cn(
                'flex min-h-11 items-center gap-2.5 rounded-sm bg-transparent px-3 text-left text-[14px] font-medium transition-[background] duration-[120ms] ease-[ease] hover:bg-accent focus-visible:outline-offset-[-2px]',
                danger && 'exercise-menu-danger text-destructive',
              )}
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
    className?: string;
  }
>(({name, onReplace, onRemove, onMoveUp, onMoveDown, className}, ref) => (
  <OptionsMenu
    ref={ref}
    className={className}
    label={`Exercise options for ${name}`}
    title={name}
    items={[
      {label: 'Replace exercise', icon: Replace, onSelect: onReplace},
      ...(onMoveUp ? [{label: 'Move up', icon: ArrowUp, onSelect: onMoveUp}] : []),
      ...(onMoveDown ? [{label: 'Move down', icon: ArrowDown, onSelect: onMoveDown}] : []),
      {label: 'Remove exercise', icon: Trash2, onSelect: onRemove, danger: true},
    ]}
  />
));
ExerciseMenu.displayName = 'ExerciseMenu';
