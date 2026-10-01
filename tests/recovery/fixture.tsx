import {createRoot} from 'react-dom/client';

import {RecoveryPanel} from '../../src/components/RecoveryPanel';
import {WorkoutRepository} from '../../src/storage/repository';

import '../../src/styles.css';

const repository = new WorkoutRepository('recovery-fixture');
createRoot(document.getElementById('root')!).render(
  <RecoveryPanel
    repository={repository}
    onRestored={() => {
      if (location.search.includes('refreshFailure')) throw new Error('synthetic refresh failure');
      document.body.dataset.restored = 'true';
    }}
  />,
);
