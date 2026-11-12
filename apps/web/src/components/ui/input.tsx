import {forwardRef} from 'react';
import type {InputHTMLAttributes} from 'react';

import {cn} from '../../utils/cn';

const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({className, ...props}, ref) => (
    <input
      ref={ref}
      className={cn(
        'input min-h-11 w-full min-w-0 rounded-md border border-border bg-card px-3 py-[9px] text-base disabled:bg-accent [&::-webkit-inner-spin-button]:appearance-none [&[type=number]]:[appearance:textfield] [&[type=number]]:numeric',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export {Input};
