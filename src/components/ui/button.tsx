import {Slot} from '@radix-ui/react-slot';
import {type VariantProps, cva} from 'class-variance-authority';
import {forwardRef} from 'react';
import type {ButtonHTMLAttributes} from 'react';

import {cn} from '../../utils/cn';

const buttonVariants = cva(
  'button inline-flex min-h-11 items-center justify-center gap-2 rounded-none border border-transparent px-[15px] text-sm leading-normal font-medium press-feedback',
  {
    variants: {
      variant: {
        primary:
          'button-primary bg-primary text-primary-foreground hover:not-disabled:brightness-[.94]',
        secondary: 'button-secondary bg-card border-border hover:not-disabled:bg-accent',
        ghost: 'button-ghost bg-transparent text-muted-foreground hover:not-disabled:bg-accent',
        danger: 'button-danger bg-destructive text-destructive-foreground',
      },
      size: {normal: '', icon: 'button-icon w-11 shrink-0 p-0'},
    },
    defaultVariants: {variant: 'secondary', size: 'normal'},
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({className, variant, size, asChild, ...props}, ref) => {
    const Component = asChild ? Slot : 'button';
    return (
      <Component ref={ref} className={cn(buttonVariants({variant, size}), className)} {...props} />
    );
  },
);
Button.displayName = 'Button';

export {Button, buttonVariants};
