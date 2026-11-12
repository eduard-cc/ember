import {forwardRef, useEffect, useRef, useState} from 'react';
import type {InputHTMLAttributes} from 'react';

import {cn} from '../utils/cn';
import {Input} from './ui/input';

/** The digits added to `before` to make `after`, or null when it was any other edit. */
function insertedDigits(before: string, after: string): string | null {
  if (after.length <= before.length) return null;
  let start = 0;
  while (start < before.length && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < before.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++;
  if (start + end !== before.length) return null;
  const added = after.slice(start, after.length - end);
  return /^\d+$/.test(added) ? added : null;
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: number | string;
  onValueChange: (value: string) => void;
};

/**
 * A field whose current value gives way to the first typed digit. It never selects its text: a
 * selection opens the phone's native Cut/Copy/Select all menu, which no page can suppress. While
 * focused and untouched the value shows dimmed; Backspace edits it normally and leaving keeps it.
 */
export const ReplaceInput = forwardRef<HTMLInputElement, Props>(
  ({value, onFocus, onBlur, onValueChange, className, ...props}, forwarded) => {
    const [replacing, setReplacing] = useState(false);
    const own = useRef<HTMLInputElement | null>(null);
    // Refs, not state: the native listener and onChange must see the newest values, and the
    // field's text can differ from the stored number (080 vs 80).
    const latest = useRef({replacing: false, text: '', onValueChange});
    latest.current.onValueChange = onValueChange;
    const replace = (on: boolean) => {
      latest.current.replacing = on;
      setReplacing(on);
    };

    useEffect(() => {
      const input = own.current;
      if (!input) return;
      // React's onBeforeInput is a keypress polyfill; the native event carries inputType.
      const replace = (event: InputEvent) => {
        if (!latest.current.replacing || event.inputType !== 'insertText') return;
        latest.current.replacing = false;
        setReplacing(false);
        if (!/^\d+$/.test(event.data ?? '')) return;
        // Write the digit natively so the caret lands after it; a value set only through React
        // can leave it at the start, and number inputs refuse setSelectionRange.
        event.preventDefault();
        // A tap leaves the caret where the finger landed, so park it after the digit; only text
        // inputs accept a selection range.
        const type = input.type;
        input.type = 'text';
        input.value = event.data!;
        input.setSelectionRange(input.value.length, input.value.length);
        input.type = type;
        latest.current.onValueChange(event.data!);
      };
      input.addEventListener('beforeinput', replace);
      return () => input.removeEventListener('beforeinput', replace);
    }, []);

    return (
      <Input
        ref={(node) => {
          own.current = node;
          if (typeof forwarded === 'function') forwarded(node);
          else if (forwarded) forwarded.current = node;
        }}
        {...props}
        className={cn(className, replacing && 'text-muted-foreground')}
        value={value}
        data-replacing={replacing || undefined}
        onFocus={(event) => {
          latest.current.text = event.currentTarget.value;
          replace(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          replace(false);
          onBlur?.(event);
        }}
        onChange={(event) => {
          const next = event.target.value;
          // Keyboards that commit digits as composition text bypass beforeinput's insertText.
          const typed = latest.current.replacing ? insertedDigits(latest.current.text, next) : null;
          replace(false);
          onValueChange(typed ?? next);
        }}
      />
    );
  },
);
ReplaceInput.displayName = 'ReplaceInput';
