import * as DialogPrimitive from '@radix-ui/react-dialog';
import {type VariantProps, cva} from 'class-variance-authority';
import {X} from 'lucide-react';
import type {ComponentPropsWithRef, ComponentPropsWithoutRef, HTMLAttributes} from 'react';

import {cn} from '../../utils/cn';
import {Button} from './button';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
/** Closes the dialog from an action, e.g. `<DialogClose asChild><Button>Keep logging</Button></DialogClose>`. */
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

/** The scrim. `dialog-overlay` stays as a test hook (design-foundation pins 0.6 light, 0.85 dark). */
export function DialogOverlay({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        'dialog-overlay fixed inset-0 z-50 bg-[hsl(var(--scrim)/0.6)] dark:bg-[hsl(var(--scrim)/0.85)]',
        className,
      )}
      {...props}
    />
  );
}

/*
 * The surfaces, as cva variants like Button's. The class names first in each are hooks: the
 * visualViewport reveal in App.tsx finds the scroller with `closest('.settings-panel,
 * .dialog-content')`, and tests select them.
 */
const dialogContentVariants = cva('fixed z-50 overflow-auto overscroll-contain bg-card', {
  variants: {
    variant: {
      /** The centred card: confirms, Previous evidence, the template preview. */
      center:
        'dialog-content top-1/2 left-1/2 max-h-[calc(100dvh-24px)] w-[min(520px,calc(100%-24px))] border border-border px-6 py-7 [box-shadow:var(--shadow)] -translate-x-1/2 -translate-y-1/2',
      /** The side sheet (Settings, the History editor): full screen on phones. */
      panel:
        'settings-panel inset-0 w-full border-0 border-border p-[18px] [box-shadow:var(--shadow)] desk:inset-[16px_16px_16px_auto] desk:w-[min(520px,calc(100%-32px))] desk:border desk:p-6',
      /** The logger's details: the panel on phones, exactly the 500px workout column on desktop. */
      workout:
        'settings-panel exercise-detail-panel inset-0 w-full border-0 border-border bg-background p-[18px] [box-shadow:var(--shadow)] desk:inset-[0_max(0px,calc((100vw-1480px)/2))_0_auto] desk:w-[500px] desk:border-l desk:p-6 desk:[box-shadow:none]',
      /** The exercise picker: the whole viewport, content in a 900px column. */
      fullscreen:
        'dialog-content inset-0 h-dvh w-full border-border px-[max(18px,calc((100vw-900px)/2))] py-6 shadow-none',
    },
  },
  defaultVariants: {variant: 'center'},
});

// Overlay motion: the scrim fades and the card fades and zooms from 95% over 180ms.
const overlayMotion =
  'overlay-motion data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0';
const contentMotion = `${overlayMotion} data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95`;

/**
 * Portal, scrim and surface in one. `motion` adds the enter and exit animation; it is opt-in
 * (`ResponsiveDialog` uses it) because the exit keeps the closing scrim mounted for 180ms, under
 * which the existing dialogs' flows would lose a tap made right after closing.
 */
export function DialogContent({
  variant,
  motion = false,
  pushed = false,
  className,
  ...props
}: ComponentPropsWithRef<typeof DialogPrimitive.Content> &
  VariantProps<typeof dialogContentVariants> & {motion?: boolean; pushed?: boolean}) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay className={pushed ? 'page-overlay' : motion ? overlayMotion : undefined} />
      <DialogPrimitive.Content
        className={cn(
          dialogContentVariants({variant}),
          motion && contentMotion,
          pushed && 'pushed-page',
          className,
        )}
        {...props}
      />
    </DialogPrimitive.Portal>
  );
}

/**
 * An `h2` (18px from the base layer). It has no padding of its own: a title that shares its row
 * with a `DialogCornerClose` passes `pr-7` so the X never covers it.
 */
export function DialogTitle(props: ComponentPropsWithRef<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title {...props} />;
}

/** A `p` 14px under the title. `srOnly` hides it for a dialog whose title says enough on screen. */
export function DialogDescription({
  srOnly = false,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Description> & {srOnly?: boolean}) {
  return (
    <DialogPrimitive.Description
      className={cn(srOnly ? 'sr-only' : 'mt-3.5', className)}
      {...props}
    />
  );
}

/** The title block, used by `ResponsiveDialog` from the `desk` breakpoint up. */
export function DialogHeader({className, ...props}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5 text-left', className)} {...props} />;
}

/** The button row: right-aligned on desktop; stacked full-width, primary on top, on phones. */
export function DialogActions({className, ...props}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'mt-6 flex flex-col-reverse flex-wrap justify-end gap-2.5 max-desk:*:w-full desk:flex-row',
        className,
      )}
      {...props}
    />
  );
}

/** The X in the top-right corner of a centred dialog. */
export function DialogCornerClose({label, iconSize = 18}: {label: string; iconSize?: number}) {
  return (
    <DialogPrimitive.Close asChild>
      <Button variant='ghost' size='icon' className='absolute top-1.5 right-1.5' aria-label={label}>
        <X size={iconSize} />
      </Button>
    </DialogPrimitive.Close>
  );
}

/** The shadcn name for the button row, so `ResponsiveDialog` uses this one dialog system. */
export const DialogFooter = DialogActions;
