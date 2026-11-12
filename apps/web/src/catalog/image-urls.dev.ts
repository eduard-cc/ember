/**
 * Dev-server stand-in for image-urls.ts (aliased in vite.config.ts). An eager `?url` glob costs
 * one module request per drawing on every page load; the lazy glob only lists the files, and
 * the dev server serves them from source.
 */
const files = import.meta.glob('./images/*.webp');
export function imageUrl(file: string): string | undefined {
  return `./images/${file}` in files ? `/src/catalog/images/${file}` : undefined;
}
