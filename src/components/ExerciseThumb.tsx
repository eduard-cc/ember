import {
  Activity,
  BicepsFlexed,
  Dumbbell,
  Footprints,
  HeartPulse,
  PersonStanding,
  Target,
} from 'lucide-react';

import {type BodyPart, catalogEntry, imageUrl} from '../catalog/catalog';

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
export function Drawing({file, className = 'drawing'}: {file: string; className?: string}) {
  const url = imageUrl(file);
  if (!url) return null;
  return (
    <span
      className={className}
      style={{maskImage: `url("${url}")`, WebkitMaskImage: `url("${url}")`}}
    />
  );
}

export function ExerciseThumb({name, large = false}: {name: string; large?: boolean}) {
  const entry = catalogEntry(name);
  const Icon = icons[entry?.bodyPart ?? 'Other'];
  const file = entry?.images[0]?.file;
  return (
    <span className={`exercise-thumb${large ? 'large' : ''}`} aria-hidden='true'>
      {file ? <Drawing file={file} /> : <Icon size={large ? 26 : 19} />}
    </span>
  );
}
