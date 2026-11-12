import {type ReactNode, type RefObject, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';

import {cn} from '../utils/cn';
import {errorBannerClass, noticeClass} from './banner';

/** Whether a surface is exposed: not under an `aria-hidden`, `inert` or `hidden` ancestor. */
function useExposed(surface: RefObject<HTMLElement | null>) {
  const [exposed, setExposed] = useState(false);
  useLayoutEffect(() => {
    const node = surface.current;
    if (!node) return;
    const check = () => setExposed(!node.closest('[aria-hidden="true"], [inert], [hidden]'));
    const observer = new MutationObserver(check);
    for (let ancestor: HTMLElement | null = node; ancestor; ancestor = ancestor.parentElement)
      observer.observe(ancestor, {
        attributes: true,
        attributeFilter: ['aria-hidden', 'inert', 'hidden'],
      });
    check();
    return () => observer.disconnect();
  }, [surface]);
  return exposed;
}

/**
 * Live text for a visible condition, portaled to the body: an `aria-live` region inside the
 * logger or an editor would keep it exposed behind a modal (Radix hideOthers). It is announced
 * only while `surface` is exposed, so a covered page never repeats the owning dialog's feedback.
 */
export function Announcement({
  surface,
  title,
  text,
  urgent,
}: {
  surface: RefObject<HTMLElement | null>;
  title: string;
  text: string;
  urgent: boolean;
}) {
  const exposed = useExposed(surface);
  if (!exposed) return null;
  return createPortal(
    <div
      className='sr-only'
      role={urgent ? 'alert' : 'status'}
      aria-live={urgent ? 'assertive' : 'polite'}
      aria-label={title}
    >
      {text}
    </div>,
    document.body,
  );
}

/** A titled notice inside a dialog or a full page, with its live text kept outside it. */
export function StateNotice({
  title,
  children,
  announcement,
  problem = false,
  className,
}: {
  title: string;
  children: ReactNode;
  announcement: string;
  problem?: boolean;
  className?: string;
}) {
  const surface = useRef<HTMLElement>(null);
  return (
    <>
      <section
        ref={surface}
        aria-label={title}
        className={cn(
          problem ? errorBannerClass : noticeClass,
          'min-w-0 flex-col items-stretch gap-2 [overflow-wrap:anywhere]',
          className,
        )}
      >
        <h2 className='text-[14px] font-semibold text-inherit'>{title}</h2>
        {children}
      </section>
      <Announcement surface={surface} title={title} text={announcement} urgent={problem} />
    </>
  );
}
