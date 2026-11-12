import {type Page, expect, test} from '@playwright/test';

import {navigate, openWorkout, pressAt} from '../navigation';

// Synthetic fixture only: 22 one-exercise October workouts, then one long September session.
const set = (id: string, weight: number | null, reps: number | null, extra = {}) => ({
  id,
  weight,
  reps,
  seconds: null,
  distance: null,
  ...extra,
});
const october = Array.from({length: 22}, (_, i) => ({
  id: `oct-${i}`,
  name: `Synthetic October ${i + 1}`,
  date: `2026-10-${String(30 - i).padStart(2, '0')}T18:00:00`,
  duration: 50,
  exercises: [
    {
      name: 'Synthetic Press',
      type: 'weighted',
      // Each session lifts 1 kg more than the one before it.
      sets: [set(`oct-${i}-1`, 61 - i, 8), set(`oct-${i}-2`, 61 - i, 6)],
    },
  ],
}));
const long = {
  id: 'september-long',
  name: 'Synthetic very long September session name that keeps going and going',
  date: '2026-09-15T07:30:00',
  duration: 95,
  exercises: [
    {
      name: 'Synthetic Leg Press',
      type: 'weighted',
      sets: [set('l1', 100, 12), set('l2', 1250, 1), set('l3', 100, 8)],
    },
    {name: 'Pull Up (Assisted)', type: 'assisted', sets: [set('l4', 30, 8), set('l5', 20, 8)]},
    {name: 'Synthetic Dip', type: 'bodyweight', sets: [set('l6', null, 12)]},
    {name: 'Plank', type: 'duration', sets: [set('l7', null, null, {seconds: 60})]},
    {
      name: 'Running',
      type: 'cardio',
      sets: [set('l8', null, null, {seconds: 300, distance: 1.2})],
    },
    {name: 'Synthetic Curl', type: 'weighted', sets: [set('l9', 12, 10)]},
    {name: 'Synthetic Raise', type: 'weighted', sets: [set('l10', 8, 15)]},
  ],
};
const seeded = {
  version: 1,
  dataset: {
    sourceLabel: 'Synthetic fixture',
    workouts: [...october, long],
    warnings: {duplicateRows: 0, duplicateKeys: 0, unparsedRows: 0},
  },
  active: null,
  finished: [],
  templates: [],
};

async function open(page: Page, value: object = seeded) {
  await page.addInitScript(
    (value) => localStorage.setItem('ember:v1', JSON.stringify(value)),
    value,
  );
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await navigate(page, 'History');
}

test('History groups workouts by month under sticky labels and pages older workouts', async ({
  page,
}) => {
  await open(page);
  const months = page.locator('.month-label');
  await expect(months).toHaveCount(1);
  await expect(months.first()).toHaveText('October 202622 workouts');
  await expect(page.locator('.history-card')).toHaveCount(20);
  const first = page.locator('.history-card').first();
  await expect(first).toContainText('Fri30');
  await expect(first).toContainText('50 min');
  await expect(first).toContainText('854 kg');
  await expect(first).toContainText('3 PRs');
  const line = first.locator('.exercise-line');
  await expect(line).toContainText('Synthetic Press');
  await expect(line).toContainText('61 kg × 8');
  await expect(line).toContainText('2 sets');
  await expect(line.getByRole('img', {name: 'Personal record'})).toBeVisible();

  // Scrolled, the month label stays flush with the top of the scroller.
  const scroller = page.locator('.library-scroll');
  await scroller.evaluate((el) => el.scrollBy(0, 900));
  await expect
    .poll(async () => {
      const [label, box] = [await months.first().boundingBox(), await scroller.boundingBox()];
      return Math.round(label!.y - box!.y);
    })
    .toBe(0);

  await page.getByRole('button', {name: 'Show older workouts'}).click();
  await expect(page.locator('.history-card')).toHaveCount(23);
  await expect(page.getByRole('button', {name: 'Show older workouts'})).toHaveCount(0);
  // The oldest October session was the first press, so it set nothing.
  await expect(page.locator('.history-card').nth(21)).toContainText('Synthetic October 22');
  await expect(page.locator('.history-card').nth(21)).not.toContainText('PR');
  await expect(months.nth(1)).toHaveText('September 20261 workout');
  // The long session shows five exercises, each as its top set, then how many more.
  const card = page.locator('.history-card').last();
  const lines = card.locator('.exercise-line');
  await expect(lines).toHaveCount(5);
  await expect(lines.nth(0)).toContainText('1250 kg × 1');
  await expect(lines.nth(1)).toContainText('−20 kg × 8');
  await expect(lines.nth(1).locator('.sr-only')).toHaveText('20 kg assistance × 8');
  await expect(lines.nth(2)).toContainText('12 reps');
  await expect(lines.nth(3)).toContainText('60 s');
  await expect(lines.nth(4)).toContainText('1.2 km · 5:00');
  await expect(card).toContainText('+ 2 more');
  await expect(card).toContainText('95 min');
  await expect(card).toContainText('3,490 kg');
  // Nothing in a card scrolls sideways, however long the name or numbers.
  expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('History search opens from the title, filters by exercise and closes empty', async ({
  page,
}) => {
  await open(page);
  const search = page.getByLabel('Search workout history');
  await expect(search).toHaveCount(0);
  await page.getByRole('button', {name: 'Search history'}).click();
  await expect(search).toBeFocused();
  const navigation = page.getByRole('navigation', {name: 'Main navigation'});
  await expect(navigation).toBeVisible();
  await search.fill('synthetic dip');
  await expect(page.locator('.history-card')).toHaveCount(1);
  await expect(page.locator('.month-label')).toHaveText('September 20261 workout');
  await search.fill('zzzz');
  await expect(page.locator('.history-card')).toHaveCount(0);
  await expect(page.locator('.empty-state')).toContainText('No matching workouts');
  await expect(page.locator('.empty-state')).toContainText('Nothing matches “zzzz”');
  await search.press('Escape');
  await expect(search).toHaveCount(0);
  await expect(page.locator('.history-card')).toHaveCount(20);
  await page.getByRole('button', {name: 'Search history'}).click();
  await expect(search).toHaveValue('');
  await page.getByRole('button', {name: 'Close search'}).click();
  await expect(search).toHaveCount(0);
  // Searching does not leave the user stranded on the current tab.
  await page.getByRole('button', {name: 'Search history'}).click();
  await search.fill('synthetic');
  await navigation.getByRole('button', {name: 'Exercises', exact: true}).click();
  const exercises = page.getByLabel('Search exercises');
  await exercises.fill('Bench');
  await expect(exercises).toBeFocused();
  await expect(navigation).toBeVisible();
  await navigation.getByRole('button', {name: 'Workout', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Workout', exact: true})).toBeVisible();
});

test("a source link opens a workout's drawer with every set, its records and bounded estimates, then Repeat", async ({
  page,
}) => {
  await open(page);
  // An exercise's source link opens its workout's drawer over the exercise.
  await navigate(page, 'Exercises');
  await page.getByLabel('Search exercises').fill('Synthetic Leg Press');
  await page.getByRole('button', {name: /^Synthetic Leg Press/}).click();
  await page.getByRole('tab', {name: 'History', exact: true}).click();
  const source = page.getByRole('button', {name: /^View source workout /}).first();
  await source.click();
  const drawer = page.locator('.workout-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('heading', {name: long.name})).toBeVisible();
  await expect(drawer).toContainText('Tuesday, 15 September 2026 at 07:30');
  await expect(drawer).toContainText('95 min');
  await expect(drawer).toContainText('10 sets');
  const press = drawer.locator('section').first();
  await expect(press.getByRole('columnheader')).toHaveText(['Set', 'Weight × reps', 'Est. 1RM']);
  // Epley only for 1–10 reps; a single rep is the recorded load.
  await expect(press.getByRole('row').nth(1)).toHaveText('1100 kg × 12—');
  await expect(press.getByRole('row').nth(2)).toHaveText('21250 kg × 11250 kg');
  await expect(press.getByRole('row').nth(3)).toHaveText('3100 kg × 8126.7 kg');
  const assisted = drawer.locator('section').nth(1);
  await expect(assisted.getByRole('columnheader')).toHaveText(['Set', 'Assistance × reps']);
  await drawer.getByRole('button', {name: 'Close workout'}).click();
  await expect(drawer).toBeHidden();
  await expect(source).toBeFocused();
  await page.getByRole('button', {name: 'Back to exercises'}).click();
  // In History, pressing a card's exercise drawing opens that workout, even one beyond the
  // first page; closing it returns to the card.
  await navigate(page, 'History');
  await page.getByRole('button', {name: 'Show older workouts'}).click();
  await pressAt(
    page,
    page.locator('.history-card', {hasText: long.name}).locator('.drawing').first(),
  );
  await expect(drawer.getByRole('heading', {name: long.name})).toBeVisible();
  await drawer.getByRole('button', {name: 'Close workout'}).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('button', {name: new RegExp(`^${long.name}, `)})).toBeFocused();
  // The newest session beat the one before on weight, volume and estimate.
  await page.locator('.library-scroll').evaluate((el) => el.scrollTo(0, 0));
  const newest = await openWorkout(page, 'Synthetic October 1');
  await expect(newest).toContainText('3 PRs');
  await expect(newest.locator('section').first()).toContainText(
    'Heaviest weight · Session volume · Est. 1RM (Epley)',
  );
  await newest.getByRole('button', {name: /^Repeat workout Synthetic October 1 /}).click();
  await expect(newest).toBeHidden();
  await expect(page.getByLabel('Weight for Synthetic Press set 1')).toHaveValue('61');
  await expect(page.getByRole('button', {name: /Uncomplete /})).toHaveCount(0);
});

test("Repeat from an exercise's workout, with a workout active, replaces it and shows the logger", async ({
  page,
}) => {
  const active = {
    id: 'active-synthetic',
    name: 'Synthetic active',
    date: '2026-10-31T09:00:00',
    duration: 0,
    exercises: [
      {name: 'Synthetic Curl', type: 'weighted', sets: [{...set('a1', 10, 8), completed: false}]},
    ],
  };
  await open(page, {...seeded, active});
  await navigate(page, 'Exercises');
  await page.getByLabel('Search exercises').fill('Synthetic Leg Press');
  await page.getByRole('button', {name: /^Synthetic Leg Press/}).click();
  await page.getByRole('tab', {name: 'History', exact: true}).click();
  await page
    .getByRole('button', {name: /^View source workout /})
    .first()
    .click();
  const drawer = page.locator('.workout-drawer');
  await drawer.getByRole('button', {name: /^Repeat workout /}).click();
  await page.getByRole('button', {name: 'Replace active draft'}).click();
  // The repeated workout's logger is what shows, not the exercise it was opened from.
  const weight = page.getByLabel('Weight for Synthetic Leg Press set 1');
  await expect(weight).toBeInViewport();
  await expect(page.locator('.overlay-motion')).toHaveCount(0);
  const box = (await weight.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(weight).toBeFocused();
});

test('a logger source link opens its workout over Previous and leaves History as it was', async ({
  page,
}) => {
  const active = {
    id: 'active-synthetic',
    name: 'Synthetic active',
    date: '2026-10-31T09:00:00',
    duration: 0,
    exercises: [
      {
        name: 'Synthetic Leg Press',
        type: 'weighted',
        sets: [{...set('a1', 100, 8), completed: false}],
      },
    ],
  };
  await open(page, {...seeded, active});
  await navigate(page, 'History');
  await page.getByRole('button', {name: 'Search history'}).click();
  await page.getByLabel('Search workout history').fill('october');
  await expect(page.locator('.history-card')).toHaveCount(20);
  const resume = page.getByRole('button', {name: /^Resume /});
  if (await resume.isVisible()) await resume.click();
  await page.getByRole('button', {name: 'Previous for Synthetic Leg Press set 1'}).click();
  const previous = page.locator('.source-dialog');
  const source = previous.getByRole('button', {
    name: new RegExp(`^View source workout ${long.name} 15 Sept? 2026$`),
  });
  await source.click();
  const drawer = page.locator('.workout-drawer');
  await expect(drawer.getByRole('heading', {name: long.name})).toBeVisible();
  await drawer.getByRole('button', {name: 'Close workout'}).click();
  await expect(drawer).toBeHidden();
  await expect(source).toBeFocused();
  await previous.getByRole('button', {name: 'Close previous sets'}).click();
  await page.getByRole('button', {name: 'Minimize workout'}).click();
  await expect(page.getByLabel('Search workout history')).toHaveValue('october');
  await expect(page.locator('.history-card')).toHaveCount(20);
});
