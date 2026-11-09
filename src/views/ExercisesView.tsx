import type {BodyPart} from '../catalog/catalog';
import {ExerciseList} from '../components/ExerciseList';
import type {Dataset} from '../domain/types';

/** Library of catalog and recorded exercises, most done or A–Z. */
export function ExercisesView({
  dataset,
  onOpen,
  initialPart,
}: {
  dataset: Dataset;
  onOpen: (name: string) => void;
  /** Opens filtered to this body part (a Profile body-part row). */
  initialPart?: BodyPart;
}) {
  return <ExerciseList dataset={dataset} onSelect={onOpen} sortable initialPart={initialPart} />;
}
