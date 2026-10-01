import {Ellipsis, Trash2} from 'lucide-react';
import {type ReactNode, useRef, useState} from 'react';

import {Button} from './ui';

/** Horizontal intent only; native pan-y keeps vertical scrolling and input editing intact. */
export function SetRow({
  children,
  completed,
  number,
  label,
  onDelete,
}: {
  children: ReactNode;
  completed?: boolean;
  number: number;
  label: string;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const suppressClick = useRef(false);
  const gesture = useRef<{id: number; x: number; y: number; left: boolean} | null>(null);
  return (
    <div
      className={`set-row ${completed ? 'set-complete' : ''}`}
      onPointerDown={(event) => {
        suppressClick.current = false;
        if (
          event.button !== 0 ||
          (event.target as HTMLElement).closest('input,button:not(.set-index):not(.set-check)')
        )
          return;
        gesture.current = {id: event.pointerId, x: event.clientX, y: event.clientY, left: false};
      }}
      onPointerMove={(event) => {
        const start = gesture.current;
        if (!start || start.id !== event.pointerId) return;
        const dx = event.clientX - start.x,
          dy = event.clientY - start.y;
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
          gesture.current = null;
          return;
        }
        start.left = dx < -48 && Math.abs(dx) > Math.abs(dy) * 2;
      }}
      onPointerUp={(event) => {
        if (gesture.current?.id === event.pointerId && gesture.current.left) {
          setOpen(true);
          suppressClick.current = true;
        }
        gesture.current = null;
      }}
      onPointerCancel={() => {
        gesture.current = null;
      }}
      onPointerLeave={() => {
        gesture.current = null;
      }}
      onClickCapture={(event) => {
        if (suppressClick.current && event.detail > 0) {
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
        }
      }}
    >
      <Button
        size='icon'
        variant='ghost'
        className='set-index'
        aria-label={`Actions for ${label}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {number}
        <Ellipsis size={11} aria-hidden='true' />
      </Button>
      {children}
      <Button
        size='icon'
        variant='ghost'
        className='desktop-remove'
        aria-label={`Remove ${label}`}
        onClick={onDelete}
      >
        <Trash2 size={14} />
      </Button>
      {open && (
        <div className='set-delete-actions'>
          <Button variant='ghost' onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant='danger' aria-label={`Delete ${label}`} onClick={onDelete}>
            <Trash2 size={16} /> Delete
          </Button>
        </div>
      )}
    </div>
  );
}
