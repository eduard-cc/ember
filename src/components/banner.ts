/**
 * Class strings for the two banners. The border is explicit: there is no global default colour.
 * `noticeClass` has no margin; each caller spaces it (a column gap, or `mb-5` under a page title).
 */
export const noticeClass =
  'flex flex-wrap items-center gap-3 border border-border bg-primary-tint p-[15px] text-[14px] text-primary';

/** Storage, ownership and sync problems. A `p` inside takes the banner colour with `text-inherit`. */
export const errorBannerClass =
  'flex flex-wrap gap-3 bg-destructive-foreground p-4 text-[14px] text-destructive';
