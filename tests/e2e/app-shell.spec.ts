import {expect, test} from '@playwright/test';

import {navigate, openSettings} from '../navigation';
import {resolve} from './colour-helpers';

const AMBER = 'hsl(33 100% 31%)';

async function open(page: import('@playwright/test').Page, minimize: boolean) {
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await expect(page.getByRole('region', {name: 'Active workout'})).toBeVisible();
  if (minimize) await page.getByRole('button', {name: 'Minimize workout'}).click();
}

test('phones have no top bar and the title scrolls with the page', async ({page}) => {
  await open(page, true);
  await expect(page.locator('.library .topbar')).toHaveCount(0);
  const title = page.locator('.library-scroll h1');
  await expect(title).toHaveText('Profile');
  await navigate(page, 'Workouts');
  await expect(
    page.locator('.library').getByRole('button', {name: 'Settings', exact: true}),
  ).toHaveCount(0);
});

test('phone tab bar marks the active tab with an Amber top rule', async ({page}) => {
  await open(page, true);
  const nav = page.locator('nav[aria-label="Main navigation"]');
  const active = nav.locator('.nav-item.active');
  const style = await active.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {color: cs.borderTopColor, width: cs.borderTopWidth};
  });
  expect(style.color).toBe(await resolve(page, AMBER));
  expect(style.width).toBe('2px');
  const box = await nav.boundingBox();
  expect(Math.abs(box!.y + box!.height - 844)).toBeLessThanOrEqual(1);
});

for (const width of [320, 390, 412]) {
  test(`phone tab bar is a 56px row at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 915});
    await open(page, true);
    const bar = page.locator('.app-bar');
    const nav = bar.getByRole('navigation', {name: 'Main navigation'});
    // A 56px row, a 1px top border, and only the device's safe-area inset.
    await expect(bar).toHaveCSS('height', '57px');
    await expect(nav).toHaveCSS('height', '56px');
    for (const tab of await nav.getByRole('button').all()) {
      await expect(tab).toHaveCSS('height', '56px');
    }
    const bounds = await bar.boundingBox();
    expect(bounds!.y + bounds!.height).toBe(page.viewportSize()!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '150%';
    });
    for (const tab of await nav.getByRole('button').all()) {
      const box = (await tab.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(await tab.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
  });
}

test('resume bar is a card strip with an Amber edge', async ({page}) => {
  await page.emulateMedia({colorScheme: 'light'});
  await open(page, true);
  const bar = page.getByRole('button', {name: 'Resume Upper body A'});
  await expect(bar).toBeVisible();
  const style = await bar.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      background: cs.backgroundColor,
      shadow: cs.boxShadow,
      span: getComputedStyle(el.querySelector('span')!).color,
    };
  });
  expect(style.background).toBe(await resolve(page, 'hsl(42 55.6% 96.5%)'));
  expect(style.shadow).toContain(await resolve(page, AMBER));
  expect(style.span).toBe(await resolve(page, 'hsl(33.7 7.8% 40%)'));
});

test('Cancel workout is an outline action with destructive text', async ({page}) => {
  await page.emulateMedia({colorScheme: 'light'});
  await open(page, false);
  const cancel = page.getByRole('button', {name: 'Cancel workout'});
  await cancel.scrollIntoViewIfNeeded();
  const style = await cancel.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {color: cs.color, background: cs.backgroundColor, border: cs.borderTopWidth};
  });
  expect(style.color).toBe(await resolve(page, 'hsl(6 62% 42%)'));
  expect(style.background).not.toBe(await resolve(page, 'hsl(var(--destructive-foreground))'));
  expect(style.border).toBe('1px');
});

test('disabled Finish keeps its label at half opacity', async ({page}) => {
  await open(page, false);
  const finish = page.getByRole('button', {name: 'Finish workout'});
  await expect(finish).toBeDisabled();
  await expect(finish).toHaveText('Finish');
  expect(await finish.evaluate((el) => getComputedStyle(el).opacity)).toBe('0.5');
});

async function minimizeIfPossible(page: import('@playwright/test').Page) {
  const minimize = page.getByRole('button', {name: 'Minimize workout'});
  if (await minimize.count()) await minimize.click();
}

test('labels are sentence case', async ({page}) => {
  await page.emulateMedia({colorScheme: 'light'});
  await open(page, false);
  await navigate(page, 'Workouts');
  const quick = page.getByText('Quick start', {exact: true});
  await expect(quick).toBeVisible();
  expect(await quick.evaluate((el) => getComputedStyle(el).textTransform)).toBe('none');

  await navigate(page, 'Exercises');
  await page.getByLabel('Search exercises').fill('Bench');
  await page.getByRole('button', {name: 'Bench Press (Barbell)', exact: true}).first().click();
  const tabs = page.getByRole('tab');
  await expect(tabs.first()).toBeVisible();
  const styles = await tabs.evaluateAll((els) =>
    els.map((el) => {
      const cs = getComputedStyle(el);
      return {
        transform: cs.textTransform,
        size: cs.fontSize,
        selected: el.getAttribute('aria-selected') === 'true',
        color: cs.color,
        border: cs.borderBottomColor,
      };
    }),
  );
  expect(styles.length).toBeGreaterThan(1);
  for (const s of styles) {
    expect(s.transform).toBe('none');
    expect(s.size).toBe('14px');
  }
  const selected = styles.find((s) => s.selected)!;
  expect(
    await page.locator('.tab-underline').evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe(await resolve(page, AMBER));
  expect(selected.color).toBe(await resolve(page, 'hsl(var(--foreground))'));
});

test('templates are separate flat bordered cards', async ({page}) => {
  await page.emulateMedia({colorScheme: 'light'});
  await open(page, false);
  await navigate(page, 'Workouts');
  const grid = page.locator('.template-grid');
  await expect(grid).toBeVisible();
  expect(await grid.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('0px');
  const cards = page.locator('.template-card');
  for (const card of await cards.all()) {
    const style = await card.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {top: cs.borderTopWidth, left: cs.borderLeftWidth, shadow: cs.boxShadow};
    });
    expect(style).toEqual({top: '1px', left: '1px', shadow: 'none'});
  }
  const [first, second] = [await cards.nth(0).boundingBox(), await cards.nth(1).boundingBox()];
  // 12px apart, beside each other in two columns or stacked in one.
  const gap = Math.max(
    second!.x - (first!.x + first!.width),
    second!.y - (first!.y + first!.height),
  );
  expect(Math.round(gap)).toBe(12);
});

async function openProfile(page: import('@playwright/test').Page, scheme: 'light' | 'dark') {
  await page.emulateMedia({colorScheme: scheme});
  await open(page, false);
  await minimizeIfPossible(page);
  await page
    .getByRole('navigation', {name: 'Main navigation'})
    .getByRole('button', {name: 'Profile', exact: true})
    .click();
}

test('Profile shows totals and selectable weekly metrics', async ({page}) => {
  await openProfile(page, 'light');
  const totals = page.locator('.profile-totals');
  await expect(totals).toHaveText(/^[\d,]+ workouts? · [\d,]+ sets? · since [A-Z][a-z]+\s\d{4}$/);
  expect(await totals.evaluate((el) => el.tagName)).toBe('P');
  await expect(page.getByRole('heading', {name: 'Every week'})).toBeVisible();
  const headline = page.locator('.weekly-headline');
  for (const [label, unit] of [
    ['Workouts', 'workouts'],
    ['Volume', 'kg'],
    ['Time', 'min'],
  ]) {
    await page.getByRole('radio', {name: label, exact: true}).click();
    await expect(headline).toContainText('Last week, ');
    await expect(headline).toContainText('usual');
    await expect(headline).toContainText(unit);
    const chart = page.getByRole('img', {name: new RegExp(`${label} per week`)});
    await expect(chart).toBeVisible();
    await chart.locator('.recharts-surface').focus();
    await page.keyboard.press('ArrowRight');
    await expect(headline).not.toContainText('Last week');
    await expect(headline).toContainText(' – ');
    await page.mouse.move(0, 0);
  }
  // The range widens the chart and the week list together.
  await page.getByRole('radiogroup', {name: 'Time range'}).getByRole('radio', {name: '1Y'}).click();
  await expect(page.getByRole('img', {name: /per week, last 52 weeks/})).toBeVisible();
  await page.setViewportSize({width: 320, height: 915});
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '150%';
  });
  expect(
    await page.locator('.library-scroll').evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  // An expanded muscle's exercise rows fit too.
  await page.getByRole('list', {name: 'Sets per muscle'}).getByRole('button').first().click();
  await expect(page.getByRole('list', {name: /^Exercises for /})).toBeVisible();
  expect(
    await page.locator('.library-scroll').evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  for (const segment of await page
    .getByRole('radiogroup', {name: 'Show per week'})
    .getByRole('radio')
    .all()) {
    const box = (await segment.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
});

test('Profile weeks, records and muscles open their sources', async ({page}) => {
  await openProfile(page, 'dark');
  // A week opens its workouts; a workout opens its drawer in place and closes back to its row.
  const weeks = page.getByRole('list', {name: 'Weeks', exact: true});
  await weeks.locator('button[aria-expanded]').first().click();
  const source = page.getByRole('button', {name: /^View workout /}).first();
  await source.click();
  const drawer = page.locator('.workout-drawer');
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', {name: 'Close workout'}).click();
  await expect(drawer).toBeHidden();
  await expect(source).toBeFocused();
  await expect(page.locator('.library-scroll h1')).toHaveText('Profile');
  // A record opens its exercise on Records, over Profile.
  const record = page.getByRole('list', {name: 'New records'}).getByRole('button').first();
  const name = (await record.getAttribute('aria-label'))!.split(':')[0];
  await record.click();
  const exercise = page.locator('.exercise-page');
  await expect(exercise.getByRole('heading', {name, exact: true})).toBeVisible();
  await expect(exercise.getByRole('tab', {name: 'Records'})).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await exercise.getByRole('button', {name: 'Back to profile'}).click();
  await expect(exercise).toBeHidden();
  await expect(record).toBeFocused();
  // Phone back closes the exercise page, leaving Profile.
  await record.click();
  await expect(exercise).toBeVisible();
  await page.goBack();
  await expect(exercise).toBeHidden();
  await expect(page.locator('.library-scroll h1')).toHaveText('Profile');
  // A muscle expands to the exercises behind it and highlights it on the figure; an exercise
  // opens on Charts over Profile and closes back to its row.
  await page.getByRole('button', {name: /^Show all \d+ muscles$/}).click();
  const muscles = page.getByRole('list', {name: 'Sets per muscle'});
  const chest = muscles.getByRole('button', {name: /^Chest: /});
  await chest.click();
  await expect(chest).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.muscle-figure .muscle-region[data-selected]')).toHaveAttribute(
    'data-region',
    'chest',
  );
  const contribution = page
    .getByRole('list', {name: 'Exercises for Chest'})
    .getByRole('button')
    .first();
  const contributionName = (await contribution.getAttribute('aria-label'))!.split(':')[0];
  await contribution.click();
  await expect(exercise.getByRole('heading', {name: contributionName, exact: true})).toBeVisible();
  await expect(exercise.getByRole('tab', {name: 'Charts'})).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await exercise.getByRole('button', {name: 'Back to profile'}).click();
  await expect(exercise).toBeHidden();
  await expect(contribution).toBeFocused();
});

for (const [weekday, today] of [
  ['Monday', '2026-11-02'],
  ['Sunday', '2026-11-08'],
] as const)
  for (const [scheme, token] of [
    ['light', 'hsl(37 16% 74%)'],
    ['dark', 'hsl(36 6% 48%)'],
  ] as const) {
    test(`the week chart is neutral except last week and the running week (${scheme}, ${weekday})`, async ({
      page,
    }) => {
      await page.clock.setFixedTime(new Date(`${today}T20:00:00`));
      await page.emulateMedia({colorScheme: scheme});
      await page.addInitScript(() => {
        // Both clock dates share the week starting Nov 2; the other sessions fill past weeks.
        const workouts = ['2026-11-02', '2026-10-26', '2026-10-19', '2026-10-12'].map((date) => ({
          id: `synthetic-week-${date}`,
          name: 'Synthetic weekly workout',
          date: `${date}T18:00:00`,
          duration: 45,
          exercises: [
            {
              name: 'Bench Press (Barbell)',
              type: 'weighted',
              sets: [
                {
                  id: `set-${date}`,
                  weight: 60,
                  reps: 8,
                  seconds: null,
                  distance: null,
                  completed: true,
                },
              ],
            },
          ],
        }));
        localStorage.setItem(
          'ember:v1',
          JSON.stringify({
            version: 1,
            dataset: {
              sourceLabel: 'Synthetic weekly chart fixture',
              workouts,
              warnings: {duplicateRows: 0, duplicateKeys: 0, unparsedRows: 0},
            },
            active: null,
            finished: [],
            templates: [],
          }),
        );
      });
      await page.goto('/');
      await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
      await page
        .getByRole('navigation', {name: 'Main navigation'})
        .getByRole('button', {name: 'Profile', exact: true})
        .click();
      await expect(page.locator('.profile-totals')).toHaveText(
        '4 workouts · 4 sets · since Oct\u00a02026',
      );
      const neutral = page.locator(
        '.week-chart .recharts-bar-rectangle path:not(.shown-week):not(.so-far-week)',
      );
      await expect(neutral).not.toHaveCount(0);
      const fills = await neutral.evaluateAll((els) => els.map((el) => getComputedStyle(el).fill));
      expect(fills.length).toBeGreaterThan(1);
      for (const fill of fills) expect(fill).toBe(await resolve(page, token));
      const edges = await neutral.evaluateAll((els) =>
        els.map((el) => {
          const cs = getComputedStyle(el);
          return {stroke: cs.stroke, path: el.getAttribute('d')};
        }),
      );
      // The light edge carries the 3:1 contrast, so it must not fall back to the fill.
      if (scheme === 'light') {
        const edge = await resolve(page, 'hsl(37 12% 48%)');
        for (const e of edges) expect(e.stroke).toBe(edge);
      }
      for (const e of edges) expect(e.path).toMatch(/^M .* h .* v .* h .* Z$/);
      // Last full week (26 Oct) leads in Amber; the running week (2 Nov) is hatched.
      const shown = page.locator('.week-chart .recharts-bar-rectangle path.shown-week');
      await expect(shown).toHaveCount(1);
      expect(await shown.evaluate((el) => getComputedStyle(el).fill)).toBe(
        await resolve(page, 'hsl(var(--primary))'),
      );
      expect(await shown.evaluate((el) => getComputedStyle(el).stroke)).toBe('none');
      await expect(page.locator('.weekly-headline')).toContainText('Last week, 26 Oct – 1 Nov');
      const soFar = page.locator('.week-chart .recharts-bar-rectangle path.so-far-week');
      await expect(soFar).toHaveCount(1);
      expect(await soFar.getAttribute('fill')).toBe('url(#week-so-far)');
    });
  }

test('trend lines are Ink, not Amber', async ({page}) => {
  await page.emulateMedia({colorScheme: 'light'});
  await open(page, false);
  await minimizeIfPossible(page);
  await navigate(page, 'Exercises');
  await page.getByLabel('Search exercises').fill('Bench');
  await page.getByRole('button', {name: 'Bench Press (Barbell)', exact: true}).first().click();
  await page.getByRole('tab', {name: 'Charts', exact: true}).click();
  const line = page.locator('.trend-chart .recharts-area-curve').first();
  await expect(line).toBeVisible();
  expect(await line.evaluate((el) => getComputedStyle(el).stroke)).toBe(
    await resolve(page, 'hsl(270 7% 30%)'),
  );
});

test('metric explanations are readable', async ({page}) => {
  await page.emulateMedia({colorScheme: 'light'});
  await open(page, false);
  await minimizeIfPossible(page);
  await navigate(page, 'Exercises');
  await page.getByLabel('Search exercises').fill('Bench');
  await page.getByRole('button', {name: 'Bench Press (Barbell)', exact: true}).first().click();
  await page.getByRole('tab', {name: 'Charts', exact: true}).click();
  await page.getByRole('button', {name: 'About Heaviest weight', exact: true}).click();
  const info = page.getByRole('dialog', {name: 'Reading this chart'});
  const term = info.locator('dt').first();
  await expect(term).toHaveText('Heaviest weight');
  expect(await term.evaluate((el) => getComputedStyle(el).color)).toBe(
    await resolve(page, 'hsl(var(--foreground))'),
  );
  expect(
    await info
      .locator('dd')
      .first()
      .evaluate((el) => getComputedStyle(el).color),
  ).toBe(await resolve(page, 'hsl(var(--muted-foreground))'));
});

test('selected appearance is an Amber ring on a neutral ground', async ({page}) => {
  await openProfile(page, 'light');
  await page
    .locator('.library-scroll')
    .getByRole('button', {name: 'Settings', exact: true})
    .click();
  const dialog = page.getByRole('dialog', {name: 'Settings', exact: true});
  const system = dialog.getByRole('button', {name: 'System', exact: true});
  await expect(system).toHaveAttribute('aria-pressed', 'true');
  const style = await system.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {shadow: cs.boxShadow, background: cs.backgroundColor};
  });
  const amber = await resolve(page, 'hsl(var(--primary))');
  expect(style.shadow).toContain(amber);
  expect(style.background).toBe(await resolve(page, 'hsl(var(--card))'));
});

test('Settings opened from the Profile cog returns focus to the cog', async ({page}) => {
  for (const close of ['button', 'escape'] as const) {
    await openProfile(page, 'light');
    const cog = page
      .locator('.library-scroll')
      .getByRole('button', {name: 'Settings', exact: true});
    await cog.click();
    const dialog = page.getByRole('dialog', {name: 'Settings', exact: true});
    await expect(dialog).toBeVisible();
    if (close === 'button') await page.getByRole('button', {name: 'Close settings'}).click();
    else await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(cog).toBeFocused();
  }
});

test('the empty templates state sits outside the bordered grid', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await navigate(page, 'Workouts');
  const empty = page.locator('.empty-state', {hasText: 'No templates yet'});
  await expect(empty).toBeVisible();
  await expect(page.locator('.template-grid')).toHaveCount(0);
  await expect(page.locator('.template-grid .empty-state')).toHaveCount(0);
});

test('the tab bar hides while editing a template name', async ({page}) => {
  await open(page, true);
  const bar = page.locator('.app-bar');
  await expect(bar).toHaveCSS('visibility', 'visible');
  await navigate(page, 'Workouts');
  await page.getByRole('button', {name: 'Create template'}).click();
  const name = page.getByLabel('Template name');
  await name.focus();
  await expect(bar).toHaveCSS('visibility', 'hidden');
  await name.blur();
  await expect(bar).toHaveCSS('visibility', 'visible');
});

const DESTRUCTIVE = {
  light: {fill: 'hsl(6 62% 42%)', label: 'hsl(8 60% 96%)'},
  dark: {fill: 'hsl(4 70% 66%)', label: 'hsl(4 40% 12%)'},
} as const;

for (const scheme of ['light', 'dark'] as const) {
  test(`destructive confirmation is a solid fill (${scheme})`, async ({page}) => {
    await page.emulateMedia({colorScheme: scheme});
    await open(page, false);
    await page.getByRole('button', {name: 'Cancel workout'}).click();
    const discard = page.getByRole('button', {name: 'Discard workout'});
    await expect(discard).toBeVisible();
    const style = await discard.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {background: cs.backgroundColor, color: cs.color};
    });
    expect(style.background).toBe(await resolve(page, DESTRUCTIVE[scheme].fill));
    expect(style.color).toBe(await resolve(page, DESTRUCTIVE[scheme].label));
  });
}

test('Delete entry is an outline action with destructive text', async ({page}) => {
  await page.emulateMedia({colorScheme: 'light'});
  await page.goto('/');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await navigate(page, 'Profile');
  const section = page.getByRole('region', {name: 'Body weight', exact: true});
  await section.getByRole('button', {name: 'Add weight', exact: true}).click();
  await page.getByLabel('Weight in kg', {exact: true}).fill('70');
  await page.getByRole('button', {name: 'Save entry', exact: true}).click();
  await section.getByRole('button', {name: /Edit entry/}).click();
  const del = page.getByRole('button', {name: 'Delete entry', exact: true});
  await expect(del).toBeVisible();
  const style = await del.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {color: cs.color, background: cs.backgroundColor};
  });
  expect(style.color).toBe(await resolve(page, 'hsl(6 62% 42%)'));
  expect(style.background).not.toBe(await resolve(page, 'hsl(6 62% 42%)'));
});

test('empty states use the shared EmptyState', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  const muted = await resolve(page, 'hsl(var(--muted-foreground))');
  const check = async (title: string) => {
    const root = page.locator('.empty-state', {hasText: title});
    await expect(root).toBeVisible();
    await expect(root).toHaveCSS('border-top-width', '1px');
    // Ember has no global border-color default, so the frame must name the token itself.
    await expect(root).toHaveCSS('border-top-color', await resolve(page, 'hsl(var(--border))'));
    const card = await resolve(page, 'hsl(var(--card))');
    await expect(root).toHaveCSS('background-color', card);
    const icon = root.locator('svg');
    await expect(icon).toHaveCount(1);
    const box = await icon.boundingBox();
    expect([box!.width, box!.height]).toEqual([48, 48]);
    await expect(icon).toHaveCSS('color', muted);
    const h2 = root.locator('h2');
    await expect(h2).toHaveCSS('font-size', '18px');
    await expect(h2).toHaveCSS('font-weight', '600');
    const p = root.locator('p');
    await expect(p).toHaveCSS('font-size', '14px');
    await expect(p).toHaveCSS('color', muted);
  };
  await navigate(page, 'Workouts');
  await check('No templates yet');
  await navigate(page, 'History');
  await page.getByRole('button', {name: 'Search history'}).click();
  await page.getByLabel('Search workout history').fill('zzzz');
  await check('No matching workouts');
});

test("the picker's no-match state is unframed", async ({page}) => {
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.getByRole('button', {name: 'Add exercise', exact: true}).click();
  const picker = page.getByRole('dialog', {name: 'Add exercise', exact: true});
  await picker.getByLabel('Search exercises').fill('zzzz');
  const empty = picker.locator('.empty-state');
  await expect(empty.locator('h2')).toHaveText('No matching exercise');
  await expect(empty).toHaveCSS('border-top-width', '0px');
  // The state keeps its own spacing inside the picker: no title padding or dialog paragraph margin.
  await expect(empty.locator('h2')).toHaveCSS('padding-right', '0px');
  await expect(empty.locator('p')).toHaveCSS('margin-top', '8px');
});

test('emptyFramed: the library details state is framed, the logger dialog one is not', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  // Logger dialog: add an exercise that has no finished history, then open its details.
  await page.getByRole('button', {name: 'Add exercise', exact: true}).click();
  const picker = page.getByRole('dialog', {name: 'Add exercise', exact: true});
  await picker.getByLabel('Search exercises').fill('Deadlift (Barbell)');
  await picker.getByRole('button', {name: 'Deadlift (Barbell)', exact: true}).click();
  await page
    .getByRole('button', {name: 'Show details for Deadlift (Barbell)', exact: true})
    .click();
  const dialog = page.getByRole('dialog', {name: 'Deadlift (Barbell)', exact: true});
  await dialog.getByRole('tab', {name: 'History', exact: true}).click();
  const inDialog = dialog.locator('.empty-state', {hasText: 'No history yet'});
  await expect(inDialog).toBeVisible();
  await expect(inDialog).toHaveCSS('border-top-width', '0px');
  await expect(inDialog.locator('h2')).toHaveCSS('padding-right', '0px');
  await expect(inDialog.locator('p')).toHaveCSS('margin-top', '8px');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await minimizeIfPossible(page);
  // Library: the same state on the Exercises tab is framed.
  await navigate(page, 'Exercises');
  await page.getByLabel('Search exercises').fill('Deadlift (Barbell)');
  await page.getByRole('button', {name: 'Deadlift (Barbell)', exact: true}).click();
  await page.getByRole('tab', {name: 'History', exact: true}).click();
  const framed = page.locator('.empty-state', {hasText: 'No history yet'}).first();
  await expect(framed).toBeVisible();
  await expect(framed).toHaveCSS('border-top-width', '1px');
});

test('Settings sections are h3 groups under the h2 dialog title', async ({page}) => {
  await page.emulateMedia({colorScheme: 'light'});
  await page.goto('/');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await openSettings(page);
  const dialog = page.getByRole('dialog', {name: 'Settings', exact: true});
  for (const name of ['Appearance', 'Feedback']) {
    const group = dialog.getByRole('region', {name, exact: true});
    await expect(group).toBeVisible();
    const id = await group.getAttribute('aria-labelledby');
    expect(await group.evaluate((el) => el.tagName)).toBe('SECTION');
    const title = group.locator(`h3[id="${id}"]`);
    await expect(title).toHaveText(name);
    await expect(title).toHaveCSS('font-size', '16px');
  }
});

test('Profile body weight is an h2 card whose empty state uses EmptyState', async ({page}) => {
  await page.emulateMedia({colorScheme: 'light'});
  await page.goto('/');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await navigate(page, 'Profile');
  const section = page.getByRole('region', {name: 'Body weight', exact: true});
  await expect(section.locator('h2#body-weight-heading')).toHaveCSS('font-size', '16px');
  // No entries: an unframed EmptyState inside the section's card, no chart.
  const empty = section.locator('.empty-state', {hasText: 'No entries yet'});
  await expect(empty).toBeVisible();
  await expect(empty.locator('h3')).toHaveText('No entries yet');
  await expect(empty).toHaveCSS('border-top-width', '0px');
  await expect(section.locator('.body-weight-chart')).toHaveCount(0);
  // One entry: the chart card shows it in place of a line.
  await section.getByRole('button', {name: 'Add weight', exact: true}).click();
  await page.getByLabel('Weight in kg', {exact: true}).fill('70');
  await page.getByRole('button', {name: 'Save entry', exact: true}).click();
  await expect(section.locator('.body-weight-chart')).toContainText('Add another entry');
  await expect(section.locator('.empty-state', {hasText: 'No entries yet'})).toHaveCount(0);
  // Entries are one bordered list of 56px rows.
  const list = section.getByRole('list', {name: 'Body weight history'});
  await expect(list).toHaveCSS('border-top-width', '1px');
  // No global border-colour default exists, so the list must name the token.
  await expect(list).toHaveCSS('border-top-color', await resolve(page, 'hsl(var(--border))'));
  const row = (await list.getByRole('button').first().boundingBox())!;
  expect(row.height).toBeGreaterThanOrEqual(56);
});
