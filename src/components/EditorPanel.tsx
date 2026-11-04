import {ArrowLeft, X} from 'lucide-react';
import {type ReactNode, useEffect, useRef} from 'react';

import {cn} from '../utils/cn';
import {Button} from './ui/button';
import {Dialog, DialogContent, DialogDescription, DialogTitle} from './ui/dialog';

/**
 * Focused editor chrome: only the body scrolls, leaving dismissal and saving reachable. Opened
 * from another surface (`backLabel`), its dismiss control is a Back arrow before the title.
 */
export function EditorPanel({
  title,
  description,
  className,
  children,
  footer,
  closeLabel = 'Close template editor',
  backLabel,
  onClose,
  onCloseAutoFocus,
  busy,
}: {
  title: string;
  description: string;
  className?: string;
  children: ReactNode;
  footer: ReactNode;
  closeLabel?: string;
  /** Names the surface underneath, which dismissing returns to. */
  backLabel?: string;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
  busy: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
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
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        ref={panel}
        variant='panel'
        className={cn(
          'editor-panel flex min-h-0 flex-col overflow-hidden p-0 max-desk:top-[var(--editor-top,0px)] max-desk:bottom-auto max-desk:h-[var(--editor-height,100dvh)] desk:w-[min(680px,calc(100%-32px))] desk:p-0',
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
      >
        <header
          className={cn(
            'flex shrink-0 items-center gap-3 border-b border-border px-[18px] pt-[env(safe-area-inset-top)] desk:px-6',
            !backLabel && 'justify-between',
          )}
        >
          {backLabel && (
            <Button
              size='icon'
              variant='ghost'
              aria-label={backLabel}
              disabled={busy}
              onClick={onClose}
            >
              <ArrowLeft size={20} />
            </Button>
          )}
          <DialogTitle ref={heading} tabIndex={-1} className='py-4 focus-visible:outline-none'>
            {title}
          </DialogTitle>
          {!backLabel && (
            <Button
              size='icon'
              variant='ghost'
              aria-label={closeLabel}
              disabled={busy}
              onClick={onClose}
            >
              <X size={20} />
            </Button>
          )}
        </header>
        <DialogDescription srOnly>{description}</DialogDescription>
        <div className='editor-scroll min-h-0 flex-1 [scroll-padding-block:14px] overflow-y-auto overscroll-contain px-[18px] py-5 desk:px-6'>
          {children}
        </div>
        <footer className='shrink-0 border-t border-border px-[18px] pt-3 pb-[max(12px,env(safe-area-inset-bottom))] desk:px-6'>
          {footer}
        </footer>
      </DialogContent>
    </Dialog>
  );
}
