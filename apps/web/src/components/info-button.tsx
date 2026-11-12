import {Info} from 'lucide-react';
import {type ReactNode, useState} from 'react';

import {useBackLayer} from '../state/back';
import {cn} from '../utils/cn';
import {Button} from './ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogCornerClose,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from './ui/responsive-dialog';

/** One explained term in an info drawer: the term, then what it means. */
export function InfoTerm({term, children}: {term: string; children: ReactNode}) {
  return (
    <div className='border-t border-border py-3 first:border-t-0 first:pt-0'>
      <dt className='text-[14px] font-medium text-foreground'>{term}</dt>
      <dd className='mt-1 text-[14px] text-muted-foreground'>{children}</dd>
    </div>
  );
}

/**
 * An ⓘ button that keeps a definition one tap away instead of on the page: a drawer on phones,
 * a dialog on desktop. `children` are `InfoTerm`s.
 */
export function InfoButton({
  title,
  label,
  className,
  children,
}: {
  title: string;
  /** The button's accessible name, e.g. "About Heaviest weight". */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useBackLayer(open, () => setOpen(false));
  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialogTrigger asChild>
        <Button
          variant='ghost'
          size='icon'
          aria-label={label}
          className={cn('info-button text-muted-foreground', className)}
        >
          <Info size={18} />
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className='info-dialog'>
        <ResponsiveDialogHeader className='pr-14 text-left desk:pr-7'>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className='sr-only'>
            What this means
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className='pb-[calc(1.5rem+env(safe-area-inset-bottom))] desk:pb-0'>
          <dl>{children}</dl>
        </ResponsiveDialogBody>
        <ResponsiveDialogCornerClose label='Close info' />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
