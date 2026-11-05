import {ArrowLeft, CircleAlert, X} from 'lucide-react';
import {type ReactNode, type RefObject, useEffect, useRef, useState} from 'react';

import {useBackLayer} from '../state/back';
import {cn} from '../utils/cn';
import {StatusPill, StatusStrips} from './Conditions';
import {Button} from './ui/button';
import {ContentFieldset} from './ui/content-fieldset';
import {Dialog, DialogContent, DialogDescription, DialogTitle} from './ui/dialog';
import {Input} from './ui/input';
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from './ui/responsive-dialog';

/**
 * The editors (finished workouts and templates), built from the logger's pieces: its header
 * (dismiss at left, a centred label where the clock sits, the Amber action where Finish sits),
 * its title field and meta line, then a body that scrolls alone. There is no footer, so Save
 * stays in reach with the keyboard open. Opened over another surface (`backLabel`), the editor
 * slides in over it and its dismiss control is a Back arrow.
 */
export function EditorPanel({
  title,
  description,
  className,
  children,
  closeLabel,
  backLabel,
  nameLabel,
  name,
  namePlaceholder,
  nameProblem,
  nameRef,
  onNameChange,
  meta,
  saveLabel,
  failed,
  problem,
  attempt,
  dirty,
  disabled,
  saveDisabled = false,
  busy,
  discardItem,
  onSave,
  onClose,
  onCloseAutoFocus,
}: {
  title: string;
  description: string;
  className?: string;
  children: ReactNode;
  closeLabel: string;
  /** Names the surface underneath, which dismissing returns to. */
  backLabel?: string;
  nameLabel: string;
  name: string;
  namePlaceholder?: string;
  /** Shown under the name, which is underlined red and described by it. */
  nameProblem?: string;
  nameRef: RefObject<HTMLInputElement | null>;
  onNameChange: (name: string) => void;
  meta: ReactNode;
  /** Save's accessible name ("Save template"); it reads Save on screen. */
  saveLabel: string;
  /** The last save failed: Save reads Retry. */
  failed: boolean;
  /** A failed save or a problem blocking it, in a strip under the header. */
  problem?: string;
  /** Counts Save presses, so a repeated problem takes focus again. */
  attempt: number;
  dirty: boolean;
  disabled: boolean;
  /** Save waits, e.g. for a set still sliding out. */
  saveDisabled?: boolean;
  busy: boolean;
  /** "Your edits to {discardItem} will be lost." */
  discardItem: string;
  onSave: () => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const lastField = useRef<HTMLInputElement | null>(null);
  const [discard, setDiscard] = useState(false);
  const discarding = useRef(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    // Mobile keyboards can shrink/pan the visual viewport without changing 100dvh.
    const resize = () => {
      panel.current?.style.setProperty('--editor-height', `${viewport.height}px`);
      panel.current?.style.setProperty('--editor-top', `${viewport.offsetTop}px`);
    };
    resize();
    viewport.addEventListener('resize', resize);
    viewport.addEventListener('scroll', resize);
    return () => {
      viewport.removeEventListener('resize', resize);
      viewport.removeEventListener('scroll', resize);
    };
  }, []);
  // Each Save that ends in a problem moves focus to it, so it is read out and in view.
  useEffect(() => {
    if (attempt) strip.current?.focus({preventScroll: true});
  }, [attempt, failed]);
  const close = () => {
    if (busy) return;
    if (dirty) setDiscard(true);
    else onClose();
  };
  useBackLayer(true, close);
  // Back on the discard prompt keeps editing, like its Keep editing button.
  useBackLayer(discard, () => setDiscard(false));
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        ref={panel}
        variant='panel'
        className={cn(
          backLabel && 'editor-pushed',
          'editor-panel flex min-h-0 flex-col overflow-hidden bg-background p-0 max-desk:top-[var(--editor-top,0px)] max-desk:bottom-auto max-desk:h-[var(--editor-height,100dvh)] desk:w-[min(680px,calc(100%-32px))] desk:p-0',
          className,
        )}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          // Inline menus handle Escape during bubbling, after Radix's capture handler.
          if (event.target instanceof Element && event.target.closest('[role=menu]'))
            event.preventDefault();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          heading.current?.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
        onFocusCapture={(event) => {
          // Picker input events bubble through React portals, but are not editor fields.
          if (
            event.target instanceof HTMLInputElement &&
            event.currentTarget.contains(event.target)
          )
            lastField.current = event.target;
        }}
      >
        <DialogDescription srOnly>{description}</DialogDescription>
        <header className='editor-top relative shrink-0 border-b border-border bg-card px-3 pt-[calc(8px+env(safe-area-inset-top))] pb-3 desk:px-5 narrow:px-2'>
          <div className='flex items-center gap-1.5'>
            <Button
              size='icon'
              variant='ghost'
              aria-label={backLabel ?? closeLabel}
              disabled={busy}
              onClick={close}
            >
              {backLabel ? <ArrowLeft size={22} /> : <X size={22} />}
            </Button>
            <DialogTitle
              ref={heading}
              tabIndex={-1}
              className='min-w-0 flex-1 text-center text-[14px] font-medium text-muted-foreground focus-visible:outline-none'
            >
              {title}
            </DialogTitle>
            <Button
              variant='primary'
              className='min-w-[88px]'
              aria-label={busy || failed ? undefined : saveLabel}
              disabled={busy || disabled || saveDisabled}
              onClick={() => {
                if (!busy && !disabled && !saveDisabled) onSave();
              }}
            >
              {busy ? 'Saving…' : failed ? 'Retry' : 'Save'}
            </Button>
          </div>
          <label className='sr-only' htmlFor='editor-name'>
            {nameLabel}
          </label>
          <Input
            ref={nameRef}
            id='editor-name'
            disabled={busy || disabled}
            placeholder={namePlaceholder}
            aria-invalid={nameProblem ? true : undefined}
            aria-describedby={nameProblem ? 'editor-name-problem' : undefined}
            className={cn(
              'editor-title border-0 bg-transparent px-1 py-0 text-[18px] font-semibold placeholder:font-normal focus-visible:shadow-[inset_0_-2px_0_hsl(var(--primary))] focus-visible:outline-none disabled:bg-transparent narrow:text-[16px]',
              nameProblem &&
                'shadow-[inset_0_-2px_0_hsl(var(--destructive))] focus-visible:shadow-[inset_0_-2px_0_hsl(var(--destructive))]',
            )}
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
          />
          <div className='editor-meta mx-1 mt-1 flex min-h-7 items-center justify-between gap-2 text-[12px] text-muted-foreground tabular-nums'>
            {nameProblem ? (
              <span id='editor-name-problem' className='text-[13px] font-medium text-destructive'>
                {nameProblem}
              </span>
            ) : (
              <span className='min-w-0'>{meta}</span>
            )}
            <StatusPill covering />
          </div>
        </header>
        {/* A failed save is this editor's own strip below, so it is not repeated above it. */}
        <StatusStrips covering omit={failed ? 'not-saved' : undefined} />
        {problem && (
          <div
            ref={strip}
            tabIndex={-1}
            role='alert'
            className='editor-problem flex shrink-0 items-start gap-2.5 border-b border-destructive/40 bg-destructive-foreground px-4 py-3 text-[14px] font-medium text-destructive focus-visible:outline-none'
          >
            <CircleAlert size={16} className='mt-0.5 shrink-0' aria-hidden='true' />
            <span className='min-w-0 flex-1 [overflow-wrap:anywhere]'>{problem}</span>
          </div>
        )}
        <div className='editor-scroll min-h-0 flex-1 [scroll-padding-block:14px] overflow-y-auto overscroll-contain'>
          <ContentFieldset disabled={disabled || busy}>{children}</ContentFieldset>
        </div>
        <ResponsiveDialog open={discard} onOpenChange={setDiscard}>
          <ResponsiveDialogContent
            className='discard-changes'
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (discarding.current) return;
              // Keep editing returns to the field in use.
              const field = lastField.current?.isConnected ? lastField.current : heading.current;
              field?.focus({preventScroll: true});
            }}
          >
            <ResponsiveDialogHeader className='text-left'>
              <ResponsiveDialogTitle>Discard changes?</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                Your edits to {discardItem} will be lost.
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <ResponsiveDialogFooter className='max-desk:flex-col-reverse max-desk:*:min-h-12'>
              <ResponsiveDialogClose asChild>
                <Button>Keep editing</Button>
              </ResponsiveDialogClose>
              <Button
                variant='danger'
                onClick={() => {
                  discarding.current = true;
                  setDiscard(false);
                  onClose();
                }}
              >
                Discard changes
              </Button>
            </ResponsiveDialogFooter>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      </DialogContent>
    </Dialog>
  );
}
