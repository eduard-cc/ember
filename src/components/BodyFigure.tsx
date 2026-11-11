import {bodyViews} from '../catalog/body-paths';
import type {Region, Tone} from '../domain/muscles';
import {cn} from '../utils/cn';

/**
 * Front and back body figure. Decorative: the exact values sit in the list beside it, so it is
 * hidden from assistive tech and not tappable. Regions without a tone are plain body;
 * `selected` dims every other toned region.
 */
export function BodyFigure({
  tones,
  selected,
  className,
}: {
  tones: Partial<Record<Region, Tone>>;
  selected?: readonly Region[];
  className?: string;
}) {
  return (
    <div
      className={cn('muscle-figure grid grid-cols-2 gap-2', className)}
      data-selecting={selected?.length ? '' : undefined}
      aria-hidden='true'
    >
      {(['front', 'back'] as const).map((view) => {
        const {viewBox, body, regions} = bodyViews[view];
        return (
          <svg key={view} viewBox={viewBox} className='h-auto w-full' data-view={view}>
            <path className='muscle-body' d={body} />
            {(Object.entries(regions) as [Region, string][]).map(([region, d]) => {
              const tone = tones[region];
              if (tone === undefined) return null;
              return (
                <path
                  key={region}
                  d={d}
                  className='muscle-region'
                  data-region={region}
                  data-tone={tone}
                  data-selected={selected?.includes(region) ? '' : undefined}
                />
              );
            })}
          </svg>
        );
      })}
    </div>
  );
}

/** A legend swatch in a figure tone. */
export function ToneSwatch({tone}: {tone: Tone}) {
  return <i className='muscle-swatch' data-tone={tone} aria-hidden='true' />;
}
