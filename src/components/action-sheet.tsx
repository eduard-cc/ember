import type {LucideIcon} from 'lucide-react';
import {type KeyboardEvent, type RefObject, useRef} from 'react';

import {cue} from '../feedback';
import {useBackLayer} from '../state/back';
import {cn} from '../utils/cn';
import {Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle} from './ui/drawer';

export interface SheetAction {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/**
 * The phone form of a ⋯ menu: a drawer holding a `menu` of full-width 56px rows. Arrow
 * keys, Home and End move between rows, Escape and Android's back gesture close it, and focus
 * starts on the first row and returns to the control that opened it. A chosen action runs once
 * the drawer has gone, after focus is back on that control, so an action that opens another
 * layer or moves focus (Replace, Remove) never fights the closing drawer.
 */
export function ActionSheet({
  open,
  onOpenChange,
  title,
  label,
  description,
  actions,
  trigger,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** The menu's accessible name; defaults to the title. */
  label?: string;
  description?: string;
  actions: SheetAction[];
  /** Gets focus back on close. Passed explicitly: iPhone Safari never focuses a tapped button. */
  trigger: RefObject<HTMLElement | null>;
}) {
  useBackLayer(open, () => onOpenChange(false));
  const list = useRef<HTMLUListElement>(null);
  const chosen = useRef<(() => void) | null>(null);
  const items = () =>
    Array.from(list.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not(:disabled)') ?? []);
  const onKeyDown = (event: KeyboardEvent) => {
    const rows = items();
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const move = (index: number) => rows[(index + rows.length) % rows.length]?.focus();
    if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(-1);
    else return;
    event.preventDefault();
  };
  return (
    <Drawer open={open} onOpenChange={onOpenChange} autoFocus>
      <DrawerContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          items()[0]?.focus({preventScroll: true});
        }}
        onCloseAutoFocus={(event) => {
          // Restore focus without scrolling the logger underneath, then run the chosen action.
          event.preventDefault();
          trigger.current?.focus({preventScroll: true});
          const action = chosen.current;
          chosen.current = null;
          action?.();
        }}
      >
        <DrawerHeader className='text-left'>
          <DrawerTitle className='truncate'>{title}</DrawerTitle>
          {description ? (
            <DrawerDescription>{description}</DrawerDescription>
          ) : (
            <DrawerDescription className='sr-only'>Actions</DrawerDescription>
          )}
        </DrawerHeader>
        <ul
          ref={list}
          role='menu'
          aria-label={label ?? title}
          className='action-sheet divide-y divide-border border-y border-border'
          onKeyDown={onKeyDown}
        >
          {actions.map((a) => (
            <li key={a.label} role='none'>
              <button
                type='button'
                role='menuitem'
                disabled={a.disabled}
                onClick={() => {
                  cue('tick');
                  chosen.current = a.onSelect;
                  onOpenChange(false);
                }}
                className={cn(
                  'pressable flex h-14 w-full items-center gap-3.5 px-5 text-left text-base focus-visible:outline-offset-[-2px] disabled:opacity-40',
                  a.danger ? 'text-destructive' : 'text-foreground',
                )}
              >
                <a.icon className='size-5 shrink-0 opacity-80' aria-hidden='true' />
                {a.label}
              </button>
            </li>
          ))}
        </ul>
        <div className='h-[calc(1rem+env(safe-area-inset-bottom))] shrink-0' />
      </DrawerContent>
    </Drawer>
  );
}
