import {type ExternalToast, toast} from 'sonner';

import {useIsMobile} from '../hooks/use-is-mobile';
import {Toaster} from './ui/sonner';

/**
 * Settings is a modal whose focus trap keeps the keyboard out of the app's toaster, so its own
 * toasts (body-weight Undo) render in a toaster inside the panel.
 */
export const SETTINGS_TOASTER = 'settings';
/** The full-screen exercise picker's own toaster, under its Back row rather than over it. */
export const PICKER_TOASTER = 'picker';
/** Phone top offsets that keep each full-screen surface's title row and dismiss control clear. */
const phoneTop: Record<string, number> = {[SETTINGS_TOASTER]: 72, [PICKER_TOASTER]: 64};

/**
 * Toasts carry one-off events the screen does not already show; ongoing conditions stay as page
 * banners (DESIGN.md "Save and connection states"). One shows at a time, under the status bar on phones.
 */
export function EmberToaster({id}: {id?: string}) {
  const mobile = useIsMobile();
  const top = {top: `calc(env(safe-area-inset-top) + ${(id && phoneTop[id]) ?? 16}px)`};
  return (
    <Toaster
      id={id}
      visibleToasts={1}
      position={mobile ? 'top-center' : 'bottom-right'}
      offset={mobile ? top : undefined}
      mobileOffset={top}
    />
  );
}

// Sonner's 24px buttons are below the 44px hit target; its unlayered styles need `!`.
const button = 'h-11! px-3.5! text-[13px]!';
// Dismiss is quieter than the outlined action beside it.
const classNames = {
  actionButton: button,
  // `group-[.toast]:` matches the specificity of the shared toaster's muted fill.
  cancelButton: `${button} group-[.toast]:bg-transparent! font-medium hover:group-[.toast]:bg-current/10!`,
};
type Options = Pick<ExternalToast, 'id' | 'toasterId' | 'onDismiss' | 'onAutoClose'>;

/** A finished action whose result is off-screen. */
export const toastDone = (message: string, options?: Options) =>
  toast.success(message, {duration: 3500, ...options});

/** A finished action that an existing Undo path can reverse; pressing Undo does not close it. */
export const toastUndo = (message: string, undo: () => void, options?: Options) =>
  toast(message, {
    duration: 5000,
    classNames,
    action: {
      label: 'Undo',
      onClick: (event) => {
        event.preventDefault();
        undo();
      },
    },
    ...options,
  });

/** A tap the screen refuses, with the reason. Nothing to retry, so it closes by itself. */
export const toastRefused = (message: string, options?: Options) =>
  toast.error(message, {duration: 3500, ...options});

/** A failed one-off action. It stays until retried or dismissed (swipe or Dismiss). */
export const toastFailed = (message: string, retry: () => void, options?: Options) =>
  toast.error(message, {
    duration: Infinity,
    classNames,
    action: {label: 'Retry', onClick: retry},
    cancel: {label: 'Dismiss', onClick: () => {}},
    ...options,
  });

export const dismissToast = (id: string | number) => toast.dismiss(id);
