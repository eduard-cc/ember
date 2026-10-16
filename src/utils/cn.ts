import {type ClassValue, clsx} from 'clsx';
import {extendTailwindMerge} from 'tailwind-merge';

// The named type styles from src/index.css are font sizes, not text colours, and `set-value`
// is a whole 18/600/1.5 style that replaces a base text-size, weight and line-height.
const twMerge = extendTailwindMerge<'set-value'>({
  extend: {
    theme: {text: ['page-title', 'section-title', 'card-title', 'label', 'caption']},
    classGroups: {'set-value': ['set-value']},
    conflictingClassGroups: {'set-value': ['font-size', 'font-weight', 'leading']},
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
