import {ExerciseList} from '../components/ExerciseList';
import type {Dataset} from '../domain/types';

/** Library of catalog and recorded exercises: recent first, then everything A–Z. */
export function ExercisesView({
  dataset,
  onOpen,
}: {
  dataset: Dataset;
  onOpen: (name: string) => void;
}) {
  return <ExerciseList dataset={dataset} onSelect={onOpen} />;
}
