import {type Page, expect, test} from '@playwright/test';

import type {Workout} from '../../src/domain/types';
import {navigate} from '../navigation';

test('historical workouts repeat as editable uncompleted targets', async ({page}) => {
  await page.goto('/?demo=1');
  await navigate(page, 'History');
  await expect(page.getByRole('heading', {name: 'History', exact: true})).toBeVisible();
  await page.locator('.history-card button').first().click();
  await page.getByRole('button', {name: /^Repeat workout /}).click();
  // On phones, like every confirmation, its text starts at the actions' left edge and spans
  // their width.
  const confirmation = page.getByRole('dialog', {name: 'Replace your active workout?'});
  const textEdges = await confirmation.evaluate((dialog) =>
    [dialog.querySelector('h2')!, dialog.querySelector('p')!].map((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return {start: range.getClientRects()[0].left, right: element.getBoundingClientRect().right};
    }),
  );
  const actions = (await confirmation
    .getByRole('button', {name: 'Resume current workout'})
    .boundingBox())!;
  for (const {start, right} of textEdges) {
    expect(Math.abs(start - actions.x)).toBeLessThan(1);
    expect(Math.abs(right - (actions.x + actions.width))).toBeLessThan(1);
  }
  await page.getByRole('button', {name: 'Replace active draft'}).click();
  await expect(page.getByRole('heading', {name: 'Your workout'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Finish workout'})).toBeDisabled();
  await expect(page.getByRole('button', {name: /Complete .* set 1/}).first()).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});
test('progress exposes source sets and selectable metrics', async ({page}) => {
  await page.goto('/?demo=1');
  await navigate(page, 'Exercises');
  await expect(page.getByRole('heading', {name: 'Exercises', exact: true})).toBeVisible();
  await page.getByLabel('Search exercises').fill('Bench');
  await page.getByRole('button', {name: 'Bench Press (Barbell)', exact: true}).first().click();
  await page.getByRole('tab', {name: 'Charts', exact: true}).click();
  await expect(page.getByRole('radio', {name: 'Heaviest weight', exact: true})).toHaveAttribute(
    'data-state',
    'on',
  );
  // The demo's sessions are all recent, so the chart opens on the last three months.
  await expect(page.getByRole('radio', {name: '3M', exact: true})).toHaveAttribute(
    'data-state',
    'on',
  );
  await expect(page.locator('.chart-headline')).toContainText('kg');
  await page.getByRole('radio', {name: 'Est. 1RM', exact: true}).click();
  // What the metric means sits behind its ⓘ, not on the page.
  const about = page.getByRole('button', {name: 'About Est. 1RM', exact: true});
  await about.click();
  const info = page.getByRole('dialog', {name: 'Reading this chart'});
  await expect(info.locator('dt').first()).toHaveText('Est. 1RM');
  await expect(info).toContainText('weight × (1 + reps ÷ 30), the Epley formula');
  await expect(info).toContainText('Only sets of 1–10 reps count');
  await info.getByRole('button', {name: 'Close info'}).click();
  await expect(info).toBeHidden();
  await expect(about).toBeFocused();
  await expect(page.getByRole('list', {name: 'Sessions'})).toBeVisible();
  for (const range of ['1M', '3M', '6M', '1Y', 'All']) {
    await page.getByRole('radio', {name: range, exact: true}).click();
    await expect(page.getByRole('radio', {name: range, exact: true})).toHaveAttribute(
      'data-state',
      'on',
    );
  }
  const source = page.getByRole('button', {name: /View source workout/}).first();
  await source.click();
  // The workout opens over the charts; closing it lands back on the same session.
  const drawer = page.locator('.workout-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('.recorded-sets').first()).toBeVisible();
  await drawer.getByRole('button', {name: 'Close workout'}).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('tab', {name: 'Charts', exact: true})).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('radio', {name: 'All', exact: true})).toHaveAttribute(
    'data-state',
    'on',
  );
  await expect(source).toBeFocused();
  // History cards name a workout's three records on one short line.
  await page.getByRole('tab', {name: 'History', exact: true}).click();
  const records = page
    .locator('.session-card')
    .first()
    .getByText('Weight · Volume · Est. 1RM', {exact: true});
  await expect(records).toBeVisible();
  expect((await records.boundingBox())!.height).toBeLessThan(20);
});

async function evidence(page: Page, workouts: Workout[], name = 'Bench Press (Barbell)') {
  await page.route('**/src/domain/demo.ts', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()) + `\ndemoDataset.workouts = ${JSON.stringify(workouts)};`,
    });
  });
  await page.goto('/?demo=1');
  await navigate(page, 'Exercises');
  await page.getByLabel('Search exercises').fill(name);
  await page.getByRole('button', {name, exact: true}).first().click();
}

const sourceSet = (id: string, weight: number | null, reps: number | null) => ({
  id,
  weight,
  reps,
  seconds: null,
  distance: null,
});
const evidenceWorkouts: Workout[] = [
  {
    id: 'earlier-press',
    name: 'Earlier press',
    date: '2026-03-01T18:00:00',
    duration: 40,
    exercises: [
      {
        name: 'Bench Press (Barbell)',
        type: 'weighted',
        sets: [sourceSet('earlier-five', 100, 5), sourceSet('earlier-single', 110, 1)],
      },
    ],
  },
  {
    id: 'repeated-press',
    name: 'Repeated press blocks',
    date: '2026-03-08T18:00:00',
    duration: 45,
    exercises: [
      {
        name: 'Bench Press (Barbell)',
        type: 'weighted',
        sets: [sourceSet('first-three', 105, 3), sourceSet('second-three', 105, 3)],
      },
      {
        name: 'Bench Press (Barbell)',
        type: 'weighted',
        sets: [
          sourceSet('eight', 80, 8),
          sourceSet('fifteen', 70, 15),
          sourceSet('tied-single', 110, 1),
        ],
      },
    ],
  },
];

test('exercise history exposes every block and numbered actual set with its source workout @dev-server', async ({
  page,
}) => {
  await evidence(page, evidenceWorkouts);
  await page.getByRole('tab', {name: 'History', exact: true}).click();
  const cards = page.locator('.session-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.first().getByRole('heading')).toHaveText('8 Mar 2026');
  await expect(cards.first()).toContainText('Repeated press blocks');
  await expect(cards.first()).toContainText('2 sets');
  // The workout's records for this exercise show once, on its first block.
  await expect(cards.first().getByRole('img', {name: 'Personal records'})).toBeVisible();
  await expect(cards.first().getByText('Volume', {exact: true})).toBeVisible();
  await expect(cards.first()).toContainText('Session volume');
  await expect(cards.nth(1).getByRole('img', {name: 'Personal records'})).toHaveCount(0);
  const rows = (card: typeof cards) =>
    card
      .locator('.recorded-sets tbody tr')
      .evaluateAll((trs) =>
        trs.map((tr) => [...(tr as HTMLTableRowElement).cells].map((td) => td.textContent)),
      );
  expect(await rows(cards.first())).toEqual([
    ['1', '105 kg × 3', '115.5 kg'],
    ['2', '105 kg × 3', '115.5 kg'],
  ]);
  expect(await rows(cards.nth(1))).toEqual([
    ['1', '80 kg × 8', '101.3 kg'],
    ['2', '70 kg × 15', '—'],
    ['3', '110 kg × 1', '110 kg'],
  ]);
  const source = cards
    .first()
    .getByRole('button', {name: /View source workout Repeated press blocks/});
  expect((await source.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // A tap anywhere on the card, even on its sets, opens the workout.
  const cell = (await cards.first().getByText('105 kg × 3').first().boundingBox())!;
  await page.mouse.click(cell.x + cell.width / 2, cell.y + cell.height / 2);
  const drawer = page.locator('.workout-drawer');
  await expect(
    drawer.getByRole('heading', {name: 'Repeated press blocks', exact: true}),
  ).toBeVisible();
  await expect(drawer.locator('.recorded-sets')).toHaveCount(2);
  // It opens over the exercise's History tab, which is still there once it closes.
  await drawer.getByRole('button', {name: 'Close workout'}).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('tab', {name: 'History', exact: true})).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(source).toBeFocused();
});

test('records lead with actual loads and exact reps, followed by source-linked estimates @dev-server', async ({
  page,
}) => {
  await evidence(page, evidenceWorkouts);
  await page.getByRole('tab', {name: 'Records', exact: true}).click();
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByRole('heading')).toHaveText([
    'Best sets',
    'Heaviest weight for each rep count',
    'Volume (weight × reps)',
    'Estimated',
  ]);
  const heaviest = panel.getByRole('button', {
    name: 'View source workout for Heaviest weight',
    exact: false,
  });
  await expect(heaviest).toHaveAccessibleName(
    'View source workout for Heaviest weight: 110 kg × 1, 1 Mar 2026, Earlier press',
  );
  await expect(heaviest).toContainText('110 kg × 1');
  await expect(heaviest).toContainText('1 Mar 2026');
  await expect(heaviest).toContainText('Earlier press');
  await expect(
    panel.getByRole('button', {name: 'View source workout for Most reps', exact: false}),
  ).toContainText('15 repsfrom 70 kg × 15');
  const reps = panel.getByRole('list', {name: 'Heaviest weight for each rep count'});
  expect(
    await reps
      .getByRole('button')
      .evaluateAll((rows) => rows.map((row) => [...row.children].map((c) => c.textContent))),
  ).toEqual([
    ['1 rep', '110 kg', '1 Mar 2026', ''],
    ['3 reps', '105 kg', '8 Mar 2026', ''],
    ['5 reps', '100 kg', '1 Mar 2026', ''],
    ['8 reps', '80 kg', '8 Mar 2026', ''],
    ['15 reps', '70 kg', '8 Mar 2026', ''],
  ]);
  const volume = panel.getByRole('button', {
    name: 'View source workout for Best session',
    exact: false,
  });
  await expect(volume).toContainText('2,430 kg');
  await expect(volume).toContainText('Repeated press blocks');
  const estimate = panel.getByRole('button', {
    name: 'View source workout for Est. 1RM (Epley)',
    exact: false,
  });
  await expect(estimate).toContainText('116.7 kg');
  await expect(estimate).toContainText('from 100 kg × 5');
  await panel.getByRole('button', {name: 'About Est. 1RM', exact: true}).click();
  await expect(page.getByRole('dialog', {name: 'Estimated 1RM'})).toContainText(
    'weight × (1 + reps ÷ 30)',
  );
  await page.getByRole('button', {name: 'Close info'}).click();
  await heaviest.click();
  await expect(
    page.locator('.workout-drawer').getByRole('heading', {name: 'Earlier press', exact: true}),
  ).toBeVisible();
});

for (const example of [
  {
    type: 'assisted',
    name: 'Pull Up (Assisted)',
    set: sourceSet('assisted-set', 20, 8),
    actual: '−20 kg × 8',
    record: 'Least assistance',
  },
  {
    type: 'bodyweight',
    name: 'Pull Up',
    set: sourceSet('bodyweight-set', null, 12),
    actual: '12 reps',
    record: 'Most reps',
  },
  {
    type: 'duration',
    name: 'Plank',
    set: {...sourceSet('timed-set', null, null), seconds: 65},
    actual: '65 s',
    record: null,
  },
  {
    type: 'cardio',
    name: 'Running',
    set: {...sourceSet('distance-set', null, null), seconds: 300, distance: 1.25},
    actual: '1.25 km · 5:00',
    record: null,
  },
] as const) {
  test(`${example.type} evidence shows its recorded units and applicable records @dev-server`, async ({
    page,
  }) => {
    await evidence(
      page,
      [
        {
          id: 'typed-session',
          name: 'Typed session',
          date: '2026-03-08T18:00:00',
          duration: 20,
          exercises: [{name: example.name, type: example.type, sets: [example.set]}],
        },
      ],
      example.name,
    );
    await page.getByRole('tab', {name: 'History', exact: true}).click();
    const performed = page.locator('.session-card .recorded-sets tbody tr');
    await expect(performed).toHaveCount(1);
    await expect(performed.getByText(example.actual, {exact: true})).toBeVisible();
    await expect(page.getByRole('columnheader', {name: 'Est. 1RM'})).toHaveCount(0);
    if (example.type === 'assisted')
      await expect(performed).toMatchAriaSnapshot(`
        - row "1 20 kg assistance × 8"
      `);
    await page.getByRole('tab', {name: 'Records', exact: true}).click();
    if (example.record) {
      await expect(
        page.getByRole('button', {name: `View source workout for ${example.record}`, exact: false}),
      ).toContainText(example.actual);
      await expect(page.getByRole('heading', {name: 'Estimated'})).toHaveCount(0);
    } else await expect(page.getByRole('heading', {name: 'No records yet'})).toBeVisible();
  });
}

test('recorded names outside the catalog keep source evidence and an explicit About state @dev-server', async ({
  page,
}) => {
  const name = 'SyntheticRecordedExerciseName'.repeat(5) + '肩部';
  await evidence(
    page,
    [
      {
        id: 'recorded-only',
        name: 'Recorded session',
        date: '2026-03-08T18:00:00',
        duration: 30,
        exercises: [{name, type: 'weighted', sets: [sourceSet('custom-set', 42.25, 6)]}],
      },
    ],
    name,
  );
  const header = page.locator('.detail-header');
  expect(
    await header.evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);
  await page.getByRole('tab', {name: 'About', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Custom exercise'})).toBeVisible();
  await expect(page.getByText('Not in the exercise catalog.', {exact: false})).toBeVisible();
  await page.getByRole('tab', {name: 'History', exact: true}).click();
  await expect(page.locator('.session-card .recorded-sets')).toContainText('42.25 kg × 6');
  await page.getByRole('tab', {name: 'Records', exact: true}).click();
  await expect(
    page.getByRole('button', {name: 'View source workout for Heaviest weight', exact: false}),
  ).toContainText('42.25 kg × 6');
  // Rep records keep the recorded weight's precision.
  await expect(
    page.getByRole('button', {name: 'View source workout for 6 reps: 42.25 kg', exact: false}),
  ).toContainText('42.25 kg');
});

test('older exercise blocks can be loaded without hiding the displayed sets @dev-server', async ({
  page,
}) => {
  const first = evidenceWorkouts[0];
  const workouts = Array.from({length: 31}, (_, index) => ({
    ...first,
    id: `session-${index}`,
    date: `2026-01-${String(index + 1).padStart(2, '0')}T18:00:00`,
  }));
  await evidence(page, workouts);
  // Charts list ten sessions at a time too, inside the page rather than a nested scroller.
  const sessions = page.getByRole('list', {name: 'Sessions'}).locator('li');
  await expect(sessions).toHaveCount(10);
  await page.getByRole('button', {name: 'Show more sessions'}).click();
  await expect(sessions).toHaveCount(30);
  await page.getByRole('tab', {name: 'History', exact: true}).click();
  await expect(page.locator('.session-card')).toHaveCount(10);
  await page.getByRole('button', {name: 'Show more sessions'}).click();
  await expect(page.locator('.session-card')).toHaveCount(30);
  await page.getByRole('button', {name: 'Show more sessions'}).click();
  await expect(page.locator('.session-card')).toHaveCount(31);
  await expect(page.locator('.session-card .recorded-sets tbody tr')).toHaveCount(62);
});

test('an unused catalog exercise opens About with explicit empty History and Records @dev-server', async ({
  page,
}) => {
  await evidence(page, [], 'Bench Press (Barbell)');
  await expect(page.getByRole('tab', {name: 'About', exact: true})).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', {name: 'History', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'No history yet'})).toBeVisible();
  await page.getByRole('tab', {name: 'Records', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'No records yet'})).toBeVisible();
});

test('About shows facts and drawings without instructions or credit text', async ({page}) => {
  await page.goto('/?demo=1');
  await navigate(page, 'Exercises');
  for (const name of ['Bench Press (Barbell)', 'Plank']) {
    await page.getByLabel('Search exercises').fill(name);
    await page.getByRole('button', {name, exact: true}).first().click();
    await page.getByRole('tab', {name: 'About', exact: true}).click();
    const panel = page.getByRole('tabpanel');
    await expect(panel.getByRole('heading')).toHaveText(['Exercise details', 'Muscles']);
    await expect(panel.locator('.about-drawings > .drawing').first()).toBeVisible();
    await expect(panel.getByText('Equipment', {exact: true})).toBeVisible();
    await expect(panel.getByText('Primary muscles', {exact: true})).toBeVisible();
    if (name === 'Bench Press (Barbell)') {
      // The figure shows primary muscles at full Amber, secondary a step lighter, as listed.
      await expect(panel.locator('dd')).toContainText(['Chest', 'Front delts, Triceps']);
      const figure = panel.locator('.muscle-figure');
      await expect(figure).toHaveAttribute('aria-hidden', 'true');
      await expect(figure.locator('[data-region="chest"]')).toHaveAttribute('data-tone', '4');
      await expect(figure.locator('[data-region="frontCap"]')).toHaveAttribute('data-tone', '3');
      await expect(figure.locator('[data-region="quads"]')).toHaveCount(0);
    }
    await expect(panel.getByText('Instructions')).toHaveCount(0);
    await expect(panel.locator('ol, .attribution')).toHaveCount(0);
    await expect(panel.getByText(/CC BY|Everkinetic|wger|source/i)).toHaveCount(0);
    await page.getByRole('button', {name: 'Back to exercises'}).click();
  }
});

test('catalog facts remain available when no drawing is supplied @dev-server', async ({page}) => {
  await page.route('**/src/catalog/catalog.ts', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()) + `\ncatalogEntry('Plank').images = [];`,
    });
  });
  await page.goto('/?demo=1');
  await navigate(page, 'Exercises');
  await page.getByLabel('Search exercises').fill('Plank');
  await page.getByRole('button', {name: 'Plank', exact: true}).first().click();
  await page.getByRole('tab', {name: 'About', exact: true}).click();
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByText('No drawing available.', {exact: true})).toBeVisible();
  await expect(panel.getByRole('heading', {name: 'Exercise details'})).toBeVisible();
  await expect(panel.getByText('Bodyweight', {exact: true})).toBeVisible();
});

test('a single drawing renders at the same size as each drawing in a pair', async ({page}) => {
  await page.goto('/?demo=1');
  await navigate(page, 'Exercises');
  const widths = async (name: string) => {
    await page.getByLabel('Search exercises').fill(name);
    await page.getByRole('button', {name, exact: true}).first().click();
    await page.getByRole('tab', {name: 'About', exact: true}).click();
    const drawings = page.locator('.about-drawings > .drawing');
    await expect(drawings.first()).toBeVisible();
    const boxes = await drawings.evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect().width),
    );
    await page.getByRole('button', {name: 'Back to exercises'}).click();
    return boxes;
  };
  const pair = await widths('Bench Press (Barbell)');
  expect(pair).toHaveLength(2);
  const single = await widths('Plank');
  expect(single).toHaveLength(1);
  expect(Math.abs(single[0] - pair[0])).toBeLessThanOrEqual(2);
});
