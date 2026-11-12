/** Hashed build URLs (or inlined data) of the catalog drawings. The dev server uses image-urls.dev.ts. */
const urls = import.meta.glob<string>('./images/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});
export function imageUrl(file: string): string | undefined {
  return urls[`./images/${file}`];
}
