import {Slot} from '@radix-ui/react-slot';
import {type VariantProps, cva} from 'class-variance-authority';
import {clsx} from 'clsx';
import {forwardRef} from 'react';
import type {ButtonHTMLAttributes, InputHTMLAttributes} from 'react';

const buttonVariants = cva('button', {
  variants: {
    variant: {
      primary: 'button-primary',
      secondary: 'button-secondary',
      ghost: 'button-ghost',
      danger: 'button-danger',
    },
    size: {normal: '', icon: 'button-icon'},
  },
  defaultVariants: {variant: 'secondary', size: 'normal'},
});
export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({className, variant, size, asChild, ...props}, ref) => {
    const Component = asChild ? Slot : 'button';
    return (
      <Component
        ref={ref}
        className={clsx(buttonVariants({variant, size}), className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({className, ...props}, ref) => (
    <input ref={ref} className={clsx('input', className)} {...props} />
  ),
);
Input.displayName = 'Input';

/** `1 set`, `2 sets`; keeps the noun's case (`1 EXERCISE`, `3 EXERCISES`). */
export const plural = (count: number, noun: string) =>
  `${count} ${count === 1 ? noun : noun + (noun === noun.toUpperCase() ? 'S' : 's')}`;
