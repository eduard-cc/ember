import {
  Activity,
  BicepsFlexed,
  Dumbbell,
  Footprints,
  HeartPulse,
  PersonStanding,
  Target,
} from 'lucide-react';
import type {ReactNode} from 'react';

import {type BodyPart, catalogEntry, imageUrl} from '../catalog/catalog';
import {cn} from '../utils/cn';

const icons: Record<BodyPart, typeof Dumbbell> = {
  Chest: Dumbbell,
  Back: Activity,
  Shoulders: Dumbbell,
  Arms: BicepsFlexed,
  Legs: Footprints,
  Core: Target,
  Cardio: HeartPulse,
  'Full body': PersonStanding,
  Other: Dumbbell,
};

/** Licensed drawings are alpha masks painted in the theme's ink, so they work in light and dark. */
export function Drawing({file, className}: {file: string; className?: string}) {
  const url = imageUrl(file);
  if (!url) return null;
  return (
    <span
      className={cn(
        'drawing block h-[88%] w-[88%] bg-foreground mask-contain mask-center mask-no-repeat',
        className,
      )}
      style={{maskImage: `url("${url}")`, WebkitMaskImage: `url("${url}")`}}
    />
  );
}

/** The square tile every exercise row, heading and picker row sits on. */
export function ThumbFrame({className, children}: {className?: string; children: ReactNode}) {
  return (
    <span
      className={cn(
        'exercise-thumb grid size-11 shrink-0 place-items-center overflow-hidden rounded-none bg-accent text-muted-foreground',
        className,
      )}
      aria-hidden='true'
    >
      {children}
    </span>
  );
}

export function ExerciseThumb({name, className}: {name: string; className?: string}) {
  const entry = catalogEntry(name);
  const Icon = icons[entry?.bodyPart ?? 'Other'];
  const file = entry?.images[0]?.file;
  return (
    <ThumbFrame className={className}>
      {file ? <Drawing file={file} /> : <Icon size={19} />}
    </ThumbFrame>
  );
}
