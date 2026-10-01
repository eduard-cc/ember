import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
const buttonVariants = cva('button', { variants: { variant: { primary: 'button-primary', secondary: 'button-secondary', ghost: 'button-ghost', danger: 'button-danger' }, size: { normal: '', icon: 'button-icon' } }, defaultVariants: { variant: 'secondary', size: 'normal' } });
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean }
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, ...props }, ref) => { const Component = asChild ? Slot : 'button'; return <Component ref={ref} className={clsx(buttonVariants({ variant, size }), className)} {...props} />; });
Button.displayName = 'Button';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => <input ref={ref} className={clsx('input', className)} {...props} />);
Input.displayName = 'Input';
