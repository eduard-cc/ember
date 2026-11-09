import {X} from 'lucide-react';
import * as React from 'react';

import {useIsMobile} from '../../hooks/use-is-mobile';
import {cn} from '../../utils/cn';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from './drawer';

interface BaseProps {
  children: React.ReactNode;
}

interface RootResponsiveDialogProps extends BaseProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Ember: stop the phone drawer's drag-to-dismiss while saving. */
  dismissible?: boolean;
}

interface ResponsiveDialogProps extends BaseProps {
  className?: string;
  asChild?: true;
  'aria-label'?: string;
  'data-testid'?: string;
  /** Ember: where focus goes when a dialog without a trigger closes. */
  onCloseAutoFocus?: (event: Event) => void;
  onOpenAutoFocus?: (event: Event) => void;
}

const ResponsiveDialogContext = React.createContext<{isDesktop: boolean}>({
  isDesktop: false,
});

const useResponsiveDialogContext = () => {
  const context = React.useContext(ResponsiveDialogContext);
  if (!context) {
    throw new Error(
      'ResponsiveDialog components cannot be rendered outside the ResponsiveDialog Context',
    );
  }
  return context;
};

const ResponsiveDialog = ({children, dismissible = true, ...props}: RootResponsiveDialogProps) => {
  const isDesktop = !useIsMobile();
  const ResponsiveDialog = isDesktop ? Dialog : Drawer;

  return (
    <ResponsiveDialogContext.Provider value={{isDesktop}}>
      <ResponsiveDialog
        {...props}
        // Ember: the phone drawer follows the keyboard itself (ResponsiveDialogContent); vaul's
        // own repositioning keeps a stretched height after the keyboard hides with focus kept.
        {...(!isDesktop && {autoFocus: true, dismissible, repositionInputs: false})}
      >
        {children}
      </ResponsiveDialog>
    </ResponsiveDialogContext.Provider>
  );
};

const ResponsiveDialogTrigger = ({className, children, ...props}: ResponsiveDialogProps) => {
  const {isDesktop} = useResponsiveDialogContext();
  const ResponsiveDialogTrigger = isDesktop ? DialogTrigger : DrawerTrigger;

  return (
    <ResponsiveDialogTrigger className={className} {...props}>
      {children}
    </ResponsiveDialogTrigger>
  );
};

const ResponsiveDialogClose = ({className, children, ...props}: ResponsiveDialogProps) => {
  const {isDesktop} = useResponsiveDialogContext();
  const ResponsiveDialogClose = isDesktop ? DialogClose : DrawerClose;

  return (
    <ResponsiveDialogClose className={className} {...props}>
      {children}
    </ResponsiveDialogClose>
  );
};

/** A 44px close button in the top corner of a full-height sheet whose own close button is hidden. */
const ResponsiveDialogCornerClose = ({label}: {label: string}) => (
  <ResponsiveDialogClose
    aria-label={label}
    className='absolute top-3 right-3 z-20 inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
  >
    <X className='h-4 w-4' aria-hidden='true' />
    <span className='sr-only'>{label}</span>
  </ResponsiveDialogClose>
);

/** A toast's action (such as Undo) answers what happened in the dialog; it is not a click outside it. */
const keepOpenForToasts = (event: {target: EventTarget | null; preventDefault: () => void}) => {
  if (event.target instanceof Element && event.target.closest('[data-sonner-toaster]'))
    event.preventDefault();
};

const ResponsiveDialogContent = ({className, children, ...props}: ResponsiveDialogProps) => {
  const {isDesktop} = useResponsiveDialogContext();
  const ResponsiveDialogContent = isDesktop ? DialogContent : DrawerContent;
  // Ember: on phones the drawer ends where the on-screen keyboard begins and fits the visible
  // height, then returns to its own size when the keyboard goes, even if a field keeps focus.
  const [drawer, setDrawer] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    const viewport = window.visualViewport;
    if (isDesktop || !drawer || !viewport) return;
    const fit = () => {
      // Against the layout height: some phones report the visible height as innerHeight too.
      const layout = document.documentElement.clientHeight;
      const covered = Math.max(0, layout - viewport.height - viewport.offsetTop);
      drawer.style.setProperty('--keyboard-inset', `${covered}px`);
      drawer.style.setProperty('--visible-height', `${viewport.height}px`);
    };
    fit();
    viewport.addEventListener('resize', fit);
    viewport.addEventListener('scroll', fit);
    return () => {
      viewport.removeEventListener('resize', fit);
      viewport.removeEventListener('scroll', fit);
    };
  }, [isDesktop, drawer]);

  return (
    <ResponsiveDialogContent
      className={cn(
        !isDesktop &&
          'bottom-[var(--keyboard-inset,0px)] max-h-[calc(var(--visible-height,100dvh)-1rem)]',
        className,
      )}
      onInteractOutside={keepOpenForToasts}
      {...(isDesktop ? {motion: true} : {ref: setDrawer})}
      {...props}
    >
      {children}
    </ResponsiveDialogContent>
  );
};

const ResponsiveDialogDescription = ({className, children, ...props}: ResponsiveDialogProps) => {
  const {isDesktop} = useResponsiveDialogContext();
  const ResponsiveDialogDescription = isDesktop ? DialogDescription : DrawerDescription;

  return (
    <ResponsiveDialogDescription className={className} {...props}>
      {children}
    </ResponsiveDialogDescription>
  );
};

const ResponsiveDialogHeader = ({className, children, ...props}: ResponsiveDialogProps) => {
  const {isDesktop} = useResponsiveDialogContext();
  const ResponsiveDialogHeader = isDesktop ? DialogHeader : DrawerHeader;

  return (
    <ResponsiveDialogHeader className={className} {...props}>
      {children}
    </ResponsiveDialogHeader>
  );
};

const ResponsiveDialogTitle = ({className, children, ...props}: ResponsiveDialogProps) => {
  const {isDesktop} = useResponsiveDialogContext();
  const ResponsiveDialogTitle = isDesktop ? DialogTitle : DrawerTitle;

  return (
    <ResponsiveDialogTitle className={className} {...props}>
      {children}
    </ResponsiveDialogTitle>
  );
};

const ResponsiveDialogBody = ({className, children, ...props}: ResponsiveDialogProps) => {
  return (
    <div className={cn('px-4 desk:px-0', className)} {...props}>
      {children}
    </div>
  );
};

const ResponsiveDialogFooter = ({className, children, ...props}: ResponsiveDialogProps) => {
  const {isDesktop} = useResponsiveDialogContext();
  const ResponsiveDialogFooter = isDesktop ? DialogFooter : DrawerFooter;

  return (
    <ResponsiveDialogFooter className={className} {...props}>
      {children}
    </ResponsiveDialogFooter>
  );
};

export {
  ResponsiveDialog,
  ResponsiveDialogTrigger,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogCornerClose,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogBody,
  ResponsiveDialogFooter,
};
