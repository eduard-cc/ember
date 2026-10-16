import {expect, test} from '@playwright/test';

import {navigate, openSettings} from '../navigation';
import {resolve} from './colour-helpers';

const PINE = 'hsl(155.6 47.8% 26.3%)';

async function open(page: import('@playwright/test').Page, minimize: boolean) {
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await expect(page.getByRole('region', {name: 'Active workout'})).toBeVisible();
  if (minimize) await page.getByRole('button', {name: 'Minimize workout'}).click();
}

test('phones have no top bar and the title scrolls with the page', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile');
  await open(page, true);
  await expect(page.locator('.library .topbar')).toHaveCount(0);
  const title = page.locator('.library-scroll h1');
  await expect(title).toHaveText('Workout');
  await expect(
    page.locator('.library').getByRole('button', {name: 'Settings', exact: true}),
  ).toHaveCount(0);
});

test('phone tab bar marks the active tab with a Pine top rule', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile');
  await open(page, true);
  const nav = page.locator('nav[aria-label="Main navigation"]');
  const active = nav.locator('.nav-item.active');
  const style = await active.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {color: cs.borderTopColor, width: cs.borderTopWidth};
  });
  expect(style.color).toBe(await resolve(page, PINE));
  expect(style.width).toBe('2px');
  const box = await nav.boundingBox();
  expect(Math.abs(box!.y + box!.height - 844)).toBeLessThanOrEqual(1);
});

test('desktop header carries brand, text links and Settings', async ({page}, info) => {
  test.skip(info.project.name !== 'desktop');
  await open(page, false);
  const bar = page.locator('.app-bar');
  const box = await bar.boundingBox();
  expect(box!.y).toBe(0);
  expect(box!.height).toBe(48);
  await expect(bar.locator('.app-brand')).toHaveText('Gym Log');
  await expect(bar.locator('.nav-item svg').first()).toBeHidden();
  const color = await bar
    .locator('.nav-item.active')
    .evaluate((el) => getComputedStyle(el).borderBottomColor);
  expect(color).toBe(await resolve(page, PINE));
  await expect(bar.getByRole('button', {name: 'Settings', exact: true})).toBeVisible();
});

test('resume bar is a card strip with a Pine edge', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile');
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
  expect(style.shadow).toContain(await resolve(page, PINE));
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
  await minimizeIfPossible(page);
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
  expect(selected.border).toBe(await resolve(page, PINE));
  expect(selected.color).toBe(await resolve(page, 'hsl(var(--foreground))'));
});

test('templates form one bordered list', async ({page}) => {
  await page.emulateMedia({colorScheme: 'light'});
  await open(page, false);
  await minimizeIfPossible(page);
  const grid = page.locator('.template-grid');
  await expect(grid).toBeVisible();
  expect(await grid.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('1px');
  // nth(2): in two columns the second card sits in the first row and has no top rule.
  const second = page.locator('.template-card').nth(2);
  const style = await second.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {top: cs.borderTopWidth, shadow: cs.boxShadow};
  });
  expect(style.top).toBe('1px');
  expect(style.shadow).toBe('none');
});

test('long template lines wrap instead of truncating', async ({page}, info) => {
  test.skip(info.project.name !== 'desktop');
  await open(page, false);
  await minimizeIfPossible(page);
  const rows = page.locator('.template-open li');
  await expect(rows.first()).toBeVisible();
  const result = await rows.evaluateAll((els) =>
    els.map((el) => ({
      overflow: el.scrollWidth > el.clientWidth,
      white: getComputedStyle(el).whiteSpace,
    })),
  );
  expect(result.length).toBeGreaterThan(0);
  for (const r of result) {
    expect(r.overflow).toBe(false);
    expect(r.white).not.toBe('nowrap');
  }
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

test('Profile states totals in one line', async ({page}) => {
  await openProfile(page, 'light');
  const totals = page.locator('.profile-totals');
  await expect(totals).toHaveText(/^\d+ workouts? · \d+ sets? · \d+ this week$/);
  expect(await totals.evaluate((el) => el.tagName)).toBe('P');
});

for (const [scheme, token] of [
  ['light', 'hsl(37 16% 74%)'],
  ['dark', 'hsl(36 6% 48%)'],
] as const) {
  test(`the week chart is neutral except the current week (${scheme})`, async ({page}) => {
    await openProfile(page, scheme);
    const neutral = page.locator('.week-chart rect:not(.current-week)');
    await expect(neutral).not.toHaveCount(0);
    const fills = await neutral.evaluateAll((els) => els.map((el) => getComputedStyle(el).fill));
    expect(fills.length).toBeGreaterThan(1);
    for (const fill of fills) expect(fill).toBe(await resolve(page, token));
    const edges = await neutral.evaluateAll((els) =>
      els.map((el) => {
        const cs = getComputedStyle(el);
        return {stroke: cs.stroke, rx: cs.rx};
      }),
    );
    // The light edge carries the 3:1 contrast, so it must not fall back to the fill.
    if (scheme === 'light') {
      const edge = await resolve(page, 'hsl(37 12% 48%)');
      for (const e of edges) expect(e.stroke).toBe(edge);
    }
    for (const e of edges) expect(e.rx).toMatch(/^0(px)?$/);
    const current = page.locator('.week-chart rect.current-week');
    await expect(current).toHaveCount(1);
    expect(await current.evaluate((el) => getComputedStyle(el).fill)).toBe(
      await resolve(page, 'hsl(var(--primary))'),
    );
    expect(await current.evaluate((el) => getComputedStyle(el).stroke)).toBe('none');
  });
}

test('trend lines are Ink, not Pine', async ({page}) => {
  await page.emulateMedia({colorScheme: 'light'});
  await open(page, false);
  await minimizeIfPossible(page);
  await navigate(page, 'Exercises');
  await page.getByLabel('Search exercises').fill('Bench');
  await page.getByRole('button', {name: 'Bench Press (Barbell)', exact: true}).first().click();
  await page.getByRole('tab', {name: 'Charts', exact: true}).click();
  const line = page.locator('.trend-chart polyline').first();
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
  const note = page.locator('.metric-explanation').first();
  await expect(note).toBeVisible();
  expect(await note.evaluate((el) => getComputedStyle(el).color)).toBe(
    await resolve(page, 'hsl(var(--foreground))'),
  );
});

test('selected appearance is a Pine ring on a neutral ground', async ({page}, info) => {
  // The Profile Settings row is the phone entry point; desktop uses the header gear.
  test.skip(info.project.name !== 'mobile');
  await openProfile(page, 'light');
  await page.getByRole('navigation', {name: 'Profile'}).getByRole('button').click();
  const dialog = page.getByRole('dialog', {name: 'Settings', exact: true});
  const system = dialog.getByRole('button', {name: 'System', exact: true});
  await expect(system).toHaveAttribute('aria-pressed', 'true');
  const style = await system.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {shadow: cs.boxShadow, background: cs.backgroundColor};
  });
  const pine = await resolve(page, 'hsl(var(--primary))');
  expect(style.shadow).toContain(pine);
  expect(style.background).toBe(await resolve(page, 'hsl(var(--card))'));
});

test('desktop hides the Profile Settings row because the header gear is the entry', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop');
  await openProfile(page, 'light');
  await expect(page.locator('.profile-view')).toBeVisible();
  await expect(page.getByRole('navigation', {name: 'Profile'})).toBeHidden();
});

test('Settings opened from the Profile row returns focus to that row', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile');
  for (const close of ['button', 'escape'] as const) {
    await openProfile(page, 'light');
    const row = page.getByRole('navigation', {name: 'Profile'}).getByRole('button');
    await row.click();
    const dialog = page.getByRole('dialog', {name: 'Settings', exact: true});
    await expect(dialog).toBeVisible();
    if (close === 'button') await page.getByRole('button', {name: 'Close settings'}).click();
    else await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(row).toBeFocused();
  }
});

test('the odd last template spans both desktop columns, with pinned dividers', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop');
  await open(page, false);
  await minimizeIfPossible(page);
  const grid = page.locator('.template-grid');
  await expect(grid).toBeVisible();
  const count = await page.locator('.template-card').count();
  expect(count % 2).toBe(1);
  const gridBox = await grid.boundingBox();
  const lastBox = await page.locator('.template-card').last().boundingBox();
  // The grid has a 1px border on each side.
  expect(Math.abs(lastBox!.width - (gridBox!.width - 2))).toBeLessThanOrEqual(1);
  const second = await page
    .locator('.template-card')
    .nth(1)
    .evaluate((el) => {
      const cs = getComputedStyle(el);
      return {left: cs.borderLeftWidth, top: cs.borderTopWidth};
    });
  expect(second).toEqual({left: '1px', top: '0px'});
});

test('with the logger open the odd last template stays in the single column', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop');
  await open(page, false);
  const grid = page.locator('.template-grid');
  await expect(grid).toBeVisible();
  // One track while the logger is open.
  const tracks = await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' '));
  expect(tracks).toHaveLength(1);
  // The second card keeps its top rule and has no left rule.
  const second = await page
    .locator('.template-card')
    .nth(1)
    .evaluate((el) => {
      const cs = getComputedStyle(el);
      return {left: cs.borderLeftWidth, top: cs.borderTopWidth};
    });
  expect(second).toEqual({left: '0px', top: '1px'});
  const gridBox = await grid.boundingBox();
  const lastBox = await page.locator('.template-card').last().boundingBox();
  expect(Math.abs(lastBox!.width - (gridBox!.width - 2))).toBeLessThanOrEqual(1);
});

test('the empty templates state sits outside the bordered grid', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await minimizeIfPossible(page);
  const empty = page.locator('.empty-state', {hasText: 'No templates yet'});
  await expect(empty).toBeVisible();
  await expect(page.locator('.template-grid')).toHaveCount(0);
  await expect(page.locator('.template-grid .empty-state')).toHaveCount(0);
});

test('the brand stays on one line at 1000px with the logger open', async ({page}, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.setViewportSize({width: 1000, height: 800});
  await open(page, false);
  const box = await page.locator('.app-brand').boundingBox();
  expect(box!.height).toBeLessThanOrEqual(24);
});

test('the tab bar hides while a library input is focused', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile');
  await open(page, true);
  await navigate(page, 'Exercises');
  const bar = page.locator('.app-bar');
  await expect(bar).toHaveCSS('visibility', 'visible');
  const search = page.getByLabel('Search exercises');
  await search.focus();
  await expect(bar).toHaveCSS('visibility', 'hidden');
  await search.blur();
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
  await openSettings(page);
  const section = page.getByRole('region', {name: 'Body weight', exact: true});
  await section.getByRole('button', {name: 'Add weight', exact: true}).click();
  await section.getByLabel('Weight in kg', {exact: true}).fill('70');
  await section.getByRole('button', {name: 'Save entry', exact: true}).click();
  await section.getByRole('button', {name: /Edit entry/}).click();
  const del = section.getByRole('button', {name: 'Delete entry', exact: true});
  await expect(del).toBeVisible();
  const style = await del.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {color: cs.color, background: cs.backgroundColor};
  });
  expect(style.color).toBe(await resolve(page, 'hsl(6 62% 42%)'));
  expect(style.background).not.toBe(await resolve(page, 'hsl(6 62% 42%)'));
});

test('secondary buttons wash on hover', async ({page}, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.emulateMedia({colorScheme: 'light'});
  await open(page, false);
  const add = page.getByRole('button', {name: 'Add exercise'}).first();
  await add.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await expect(add).toHaveCSS('background-color', await resolve(page, 'hsl(42 55.6% 96.5%)'));
  await add.hover();
  await expect(add).toHaveCSS('background-color', await resolve(page, 'hsl(37.1 36.8% 88.8%)'));
  await page.mouse.move(0, 0);
  await expect(add).toHaveCSS('background-color', await resolve(page, 'hsl(42 55.6% 96.5%)'));
});

test('primary buttons dim on hover', async ({page}, info) => {
  test.skip(info.project.name !== 'desktop');
  await open(page, false);
  await page.getByRole('button', {name: 'Cancel workout'}).click();
  await page.getByRole('button', {name: 'Discard workout'}).click();
  const start = page.getByRole('button', {name: 'Start empty workout'});
  await expect(start).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(start).toHaveCSS('filter', 'none');
  await start.hover();
  await expect(start).toHaveCSS('filter', 'brightness(0.94)');
});

for (const [scheme, wash] of [
  ['light', 'hsl(37.1 36.8% 88.8%)'],
  ['dark', 'hsl(262.5 9.1% 17.3%)'],
] as const) {
  test(`resume bar hovers to the accent wash with foreground meta (${scheme})`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop');
    await page.emulateMedia({colorScheme: scheme});
    await open(page, true);
    const bar = page.getByRole('button', {name: 'Resume Upper body A'});
    await expect(bar).toBeVisible();
    const meta = bar.locator('span.block');
    const time = bar.locator('.elapsed');
    const accent = await resolve(page, wash);
    const foreground = await bar.evaluate((el) => getComputedStyle(el).color);
    await page.mouse.move(0, 0);
    await expect(bar).not.toHaveCSS('background-color', accent);
    await expect(meta).not.toHaveCSS('color', foreground);
    await bar.hover();
    await expect(bar).toHaveCSS('background-color', accent);
    await expect(meta).toHaveCSS('color', foreground);
    await expect(time).toHaveCSS('color', foreground);
  });
}
