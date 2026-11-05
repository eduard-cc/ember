import {useState} from 'react';

import type {Dataset} from '../domain/types';
import {ExerciseDetail} from '../views/ExerciseDetail';
import {ContentFieldset} from './ui/content-fieldset';
import {Dialog, DialogContent, DialogDescription, DialogTitle} from './ui/dialog';

/** Retain the closing page until Radix finishes its exit, without touching the underlying draft/list. */
export function ExercisePage({
  name,
  dataset,
  onClose,
  onCloseAutoFocus,
  workout = false,
  disabled = false,
}: {
  name: string | null;
  dataset: Dataset;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
  workout?: boolean;
  disabled?: boolean;
}) {
  const [shown, setShown] = useState(name);
  if (name && name !== shown) setShown(name);
  return (
    <Dialog
      open={!!name}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        variant={workout ? 'workout' : 'panel'}
        className='exercise-detail-panel exercise-page bg-background'
        pushed
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogDescription srOnly>
          Charts, history, records and exercise information from finished workouts.
        </DialogDescription>
        {shown && (
          <ContentFieldset disabled={disabled}>
            <ExerciseDetail
              key={shown}
              dataset={dataset}
              name={shown}
              onBack={onClose}
              backLabel={workout ? 'Back to workout' : 'Back to exercises'}
              emptyFramed={!workout}
              renderTitle={(heading) => <DialogTitle asChild>{heading}</DialogTitle>}
            />
          </ContentFieldset>
        )}
      </DialogContent>
    </Dialog>
  );
}
