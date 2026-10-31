import type {LucideIcon} from 'lucide-react';

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
 * The mobile replacement for a ⋯ dropdown: a drawer with full-width 56px rows. Android's
 * back gesture closes it like any other layer.
 */
export function ActionSheet({
  open,
  onOpenChange,
  title,
  description,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  actions: SheetAction[];
}) {
  useBackLayer(open, () => onOpenChange(false));
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className='text-left'>
          <DrawerTitle className='truncate'>{title}</DrawerTitle>
          {description ? (
            <DrawerDescription>{description}</DrawerDescription>
          ) : (
            <DrawerDescription className='sr-only'>Actions</DrawerDescription>
          )}
        </DrawerHeader>
        <ul className='divide-y divide-border border-y border-border pb-[env(safe-area-inset-bottom)]'>
          {actions.map((a) => (
            <li key={a.label}>
              <button
                disabled={a.disabled}
                onClick={() => {
                  cue('tick');
                  onOpenChange(false);
                  // Let the drawer start closing before the next layer opens.
                  setTimeout(a.onSelect, 120);
                }}
                className={cn(
                  'pressable flex h-14 w-full items-center gap-3.5 px-5 text-left text-base disabled:opacity-40',
                  a.danger ? 'text-destructive' : 'text-foreground',
                )}
              >
                <a.icon className='size-5 shrink-0 opacity-80' />
                {a.label}
              </button>
            </li>
          ))}
        </ul>
        <div className='h-4' />
      </DrawerContent>
    </Drawer>
  );
}
