import {type ReactNode, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';

import {cn} from '../utils/cn';
import {errorBannerClass, noticeClass} from './banner';

/** Keep live text outside modal-covered logger/editor ancestors (Radix hideOthers). */
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
  const [exposed, setExposed] = useState(false);
  useLayoutEffect(() => {
    const node = surface.current;
    if (!node) return;
    // A covered page must not repeat the owning dialog's error announcement.
    const check = () => setExposed(!node.closest('[aria-hidden="true"], [inert], [hidden]'));
    const observer = new MutationObserver(check);
    for (let ancestor: HTMLElement | null = node; ancestor; ancestor = ancestor.parentElement)
      observer.observe(ancestor, {
        attributes: true,
        attributeFilter: ['aria-hidden', 'inert', 'hidden'],
      });
    check();
    return () => observer.disconnect();
  }, []);
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
      {exposed &&
        createPortal(
          <div
            className='sr-only'
            role={problem ? 'alert' : 'status'}
            aria-live={problem ? 'assertive' : 'polite'}
            aria-label={title}
          >
            {announcement}
          </div>,
          document.body,
        )}
    </>
  );
}
