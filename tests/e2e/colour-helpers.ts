import type {Page} from '@playwright/test';

/** Resolve a CSS colour to the computed `rgb()` string the browser reports. */
export async function resolve(page: Page, css: string): Promise<string> {
  return page.evaluate((value) => {
    const el = document.createElement('div');
    el.style.color = value;
    document.body.appendChild(el);
    const resolved = getComputedStyle(el).color;
    el.remove();
    return resolved;
  }, css);
}
