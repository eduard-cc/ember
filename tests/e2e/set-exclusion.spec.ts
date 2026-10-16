import {type Page, expect, test} from '@playwright/test';

import {navigate} from '../navigation';

const set = (id: string, weight: number, reps: number, extra = {}) => ({
  id,
  weight,
  reps,
  seconds: null,
  distance: null,
  ...extra,
});
const seeded = {
  version: 1,
  dataset: {
    sourceLabel: 'Synthetic fixture',
    workouts: [
      {
        id: 'typo-session',
        name: 'Arms day',
        date: '2026-02-01T12:00:00',
        duration: 40,
        exercises: [
          {
            name: 'Synthetic Curl',
            type: 'weighted',
            sets: [set('real-2', 20, 10), set('typo', 20, 60, {suspicious: true})],
          },
        ],
      },
      {
        id: 'real-session',
        name: 'Arms day',
        date: '2026-01-01T12:00:00',
        duration: 40,
        exercises: [{name: 'Synthetic Curl', type: 'weighted', sets: [set('real-1', 20, 12)]}],
      },
    ],
    warnings: {duplicateRows: 0, duplicateKeys: 0, suspiciousRows: 1, unparsedRows: 0},
  },
  active: null,
  finished: [],
  templates: [],
};

test.use({viewport: {width: 412, height: 915}, hasTouch: true, isMobile: true});

const mostReps = (page: Page) =>
  page.getByRole('listitem').filter({hasText: 'Most reps in a set'}).locator('strong');

test('a flagged set can be excluded from records and included again', async ({page}) => {
  await page.addInitScript(
    (value) => localStorage.setItem('gym-log:v1', JSON.stringify(value)),
    seeded,
  );
  await page.goto('/?demo=1');
  await navigate(page, 'Exercises');
  await page.getByLabel('Search exercises').fill('Synthetic Curl');
  await page.getByRole('button', {name: 'Synthetic Curl', exact: true}).first().click();
  await page.getByRole('tab', {name: 'Records', exact: true}).click();
  await expect(mostReps(page)).toHaveText('60 reps');

  await page.getByRole('tab', {name: 'History', exact: true}).click();
  const exclude = page.getByRole('button', {
    name: 'Exclude Synthetic Curl set 2 (20 kg × 60) on 1 Feb 2026 from analytics',
  });
  const box = await exclude.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  await exclude.click();
  const include = page.getByRole('button', {
    name: 'Include Synthetic Curl set 2 (20 kg × 60) on 1 Feb 2026 in analytics again',
  });
  await expect(include).toBeVisible();
  await expect(page.locator('.session-set').filter({hasText: '20 kg × 60'})).toContainText(
    'excluded',
  );
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');

  await page.getByRole('tab', {name: 'Records', exact: true}).click();
  await expect(mostReps(page)).toHaveText('12 reps');

  // Durable: a fresh page reads the exclusion back from IndexedDB, raw values intact.
  await page.reload();
  await navigate(page, 'Exercises');
  await page.getByLabel('Search exercises').fill('Synthetic Curl');
  await page.getByRole('button', {name: 'Synthetic Curl', exact: true}).first().click();
  await page.getByRole('tab', {name: 'Records', exact: true}).click();
  await expect(mostReps(page)).toHaveText('12 reps');
  await page.getByRole('tab', {name: 'History', exact: true}).click();
  await page
    .getByRole('button', {
      name: 'Include Synthetic Curl set 2 (20 kg × 60) on 1 Feb 2026 in analytics again',
    })
    .click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.getByRole('tab', {name: 'Records', exact: true}).click();
  await expect(mostReps(page)).toHaveText('60 reps');
});

test('the source workout and Profile offer the same reversible exclusion', async ({page}) => {
  await page.addInitScript(
    (value) => localStorage.setItem('gym-log:v1', JSON.stringify(value)),
    seeded,
  );
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page
    .getByRole('navigation', {name: 'Main navigation'})
    .getByRole('button', {name: 'Profile', exact: true})
    .click();
  const flagged = page.getByRole('region', {name: 'Flagged sets'});
  await expect(flagged).toContainText('1 flagged set');
  await expect(flagged).toContainText('Synthetic Curl');
  await flagged
    .getByRole('button', {
      name: 'Exclude Synthetic Curl set 2 (20 kg × 60) on 1 Feb 2026 from analytics',
    })
    .click();
  await expect(flagged).toContainText('excluded');

  await navigate(page, 'History');
  await page
    .getByRole('button', {name: /View sets for Arms day/})
    .first()
    .click();
  const details = page.locator('.workout-details').first();
  await expect(details).toContainText('excluded');
  // Every recorded set in the source workout can be excluded, not only flagged ones.
  await details
    .getByRole('button', {
      name: 'Exclude Synthetic Curl set 1 (20 kg × 10) on 1 Feb 2026 from analytics',
    })
    .click();
  await details
    .getByRole('button', {
      name: 'Include Synthetic Curl set 2 (20 kg × 60) on 1 Feb 2026 in analytics again',
    })
    .click();
  await expect(details.getByRole('button', {name: /in analytics again/})).toHaveCount(1);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
});

test('repeating a workout with flagged and excluded sets starts clean on Pixel 6', async ({
  page,
}) => {
  const withExcluded = structuredClone(seeded);
  Object.assign(withExcluded.dataset.workouts[0].exercises[0].sets[1], {
    excluded: true,
    original: {'Exercise Name': 'Synthetic Curl', Weight: '20', Reps: '60'},
  });
  await page.clock.install({time: new Date('2026-03-01T10:00:00')});
  await page.addInitScript(
    (value) => localStorage.setItem('gym-log:v1', JSON.stringify(value)),
    withExcluded,
  );
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await navigate(page, 'History');
  await page.getByRole('button', {name: 'Repeat workout Arms day 1 Feb 2026'}).click();
  // The targets carry over; the flag and the exclusion do not.
  await expect(page.getByLabel('Reps for Synthetic Curl set 2')).toHaveValue('60');
  await page.getByRole('button', {name: 'Complete Synthetic Curl set 1'}).click();
  await page.getByRole('button', {name: 'Complete Synthetic Curl set 2'}).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.getByRole('button', {name: 'Finish workout'}).click();
  await page.getByRole('button', {name: 'Save finished workout'}).click();

  await page
    .getByRole('button', {name: /View sets for Arms day/})
    .first()
    .click();
  const repeat = page.locator('.workout-details').first();
  await expect(repeat).toContainText('20 kg × 60');
  await expect(repeat).not.toContainText('flagged');
  await expect(repeat).not.toContainText('excluded');
  await expect(
    repeat.getByRole('button', {
      name: 'Exclude Synthetic Curl set 2 (20 kg × 60) on 1 Mar 2026 from analytics',
    }),
  ).toBeVisible();
  // The source set keeps its own exclusion.
  await page
    .getByRole('button', {name: /View sets for Arms day/})
    .nth(1)
    .click();
  await expect(
    page.getByRole('button', {
      name: 'Include Synthetic Curl set 2 (20 kg × 60) on 1 Feb 2026 in analytics again',
    }),
  ).toBeVisible();
});
