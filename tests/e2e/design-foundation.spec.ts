import {type Page, expect, test} from '@playwright/test';

type Scheme = 'light' | 'dark';

const PINE = {light: 'hsl(155.6 47.8% 26.3%)', dark: 'hsl(145.4 33% 64.9%)'};
const PAPER = 'hsl(38.6 43.8% 93.7%)';
const NIGHT = 'hsl(252 10.2% 9.6%)';

async function resolve(page: Page, css: string): Promise<string> {
  return page.evaluate((value) => {
    const el = document.createElement('div');
    el.style.color = value;
    document.body.appendChild(el);
    const resolved = getComputedStyle(el).color;
    el.remove();
    return resolved;
  }, css);
}

async function open(page: Page, scheme: Scheme) {
  await page.emulateMedia({colorScheme: scheme});
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  // "saved" does not mean the logger sheet is up: it mounts after the first Dexie emit and then
  // makes the main navigation inert, so wait for it before callers decide whether to minimize.
  await expect(page.getByRole('region', {name: 'Active workout'})).toBeVisible();
}

async function minimizeWorkout(page: Page) {
  const minimize = page.getByRole('button', {name: 'Minimize workout'});
  if (await minimize.isVisible()) await minimize.click();
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test('primary buttons are Pine with Paper or Night labels', async ({page}) => {
      await open(page, scheme);
      await page
        .getByRole('button', {name: /Complete .* set 1/})
        .first()
        .click();
      const finish = page
        .getByRole('region', {name: 'Active workout'})
        .getByRole('button', {name: 'Finish'});
      await expect(finish).toBeEnabled();
      const style = await finish.evaluate((el) => {
        const cs = getComputedStyle(el);
        return {background: cs.backgroundColor, color: cs.color};
      });
      expect(style.background).toBe(await resolve(page, PINE[scheme]));
      expect(style.color).toBe(await resolve(page, scheme === 'light' ? PAPER : NIGHT));
    });

    test('page ground and cards use the neutral palette', async ({page}) => {
      await open(page, scheme);
      const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(background).toBe(await resolve(page, scheme === 'light' ? PAPER : NIGHT));

      await minimizeWorkout(page);
      await page
        .getByRole('navigation', {name: 'Main navigation'})
        .getByRole('button', {name: 'Workout', exact: true})
        .click();
      const card = page.locator('.template-card').first();
      await expect(card).toBeVisible();
      const cardBackground = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(cardBackground).toBe(
        await resolve(page, scheme === 'light' ? 'hsl(42 55.6% 96.5%)' : 'hsl(260 9.1% 12.9%)'),
      );
    });

    test('keyboard focus is a 2px ring outline offset 2px', async ({page}) => {
      await open(page, scheme);
      await expect(page.getByRole('region', {name: 'Active workout'})).toBeVisible();
      await expect(async () => {
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
      }).toPass();
      const style = await page.evaluate(() => {
        const cs = getComputedStyle(document.activeElement!);
        return {
          style: cs.outlineStyle,
          width: cs.outlineWidth,
          offset: cs.outlineOffset,
          color: cs.outlineColor,
        };
      });
      expect(style.style).toBe('solid');
      expect(style.width).toBe('2px');
      expect(style.offset).toBe('2px');
      expect(style.color).toBe(await resolve(page, PINE[scheme]));
    });

    test('dialogs sit over the Night scrim', async ({page}) => {
      await open(page, scheme);
      await page.getByRole('button', {name: 'Settings', exact: true}).last().click();
      const overlay = page.locator('.dialog-overlay');
      await expect(overlay).toBeVisible();
      const background = await overlay.evaluate((el) => getComputedStyle(el).backgroundColor);
      const expected = scheme === 'light' ? 'hsl(252 10.2% 9.6% / 0.6)' : 'hsl(252 12% 3% / 0.85)';
      expect(background).toBe(await resolve(page, expected));
    });
  });
}

test('Settings offers no accent choice', async ({page}) => {
  await open(page, 'light');
  await page.getByRole('button', {name: 'Settings', exact: true}).last().click();
  const settings = page.getByRole('dialog', {name: 'Settings'});
  await expect(settings.getByRole('group', {name: 'Theme'})).toBeVisible();
  await expect(settings.getByRole('group', {name: 'Accent'})).toHaveCount(0);
  for (const name of ['Pine', 'Ocean', 'Copper'])
    await expect(settings.getByRole('button', {name, exact: true})).toHaveCount(0);
});

async function openWorkoutTab(page: Page) {
  await open(page, 'light');
  await minimizeWorkout(page);
  await page
    .getByRole('navigation', {name: 'Main navigation'})
    .getByRole('button', {name: 'Workout', exact: true})
    .click();
}

test('type follows the type scale', async ({page}) => {
  await openWorkoutTab(page);
  const h1 = await page
    .locator('.library h1')
    .first()
    .evaluate((el) => {
      const cs = getComputedStyle(el);
      return {size: cs.fontSize, weight: cs.fontWeight, tracking: cs.letterSpacing};
    });
  expect(h1).toEqual({size: '24px', weight: '600', tracking: '-0.6px'});
  await expect(page.locator('.library .template-open ul').first()).toHaveCSS('font-size', '14px');
  await expect(page.locator('.library .button').first()).toHaveCSS('font-weight', '500');

  // Chart text, the tab bar, profile stats, list labels and session-set headers stay out of PR 1.
  const offenders = await page.evaluate(() => {
    const badWeights = new Set(['550', '650']);
    const badSizes = new Set(['10px', '13px', '15px', '17px', '20px', '28px']);
    const exempt = '.tab, .profile-stats, .list-label, .session-sets-head';
    const found: string[] = [];
    for (const el of document.querySelectorAll('.library, .library *')) {
      if (el.closest('svg') || el.closest(exempt)) continue;
      const cs = getComputedStyle(el);
      if (badWeights.has(cs.fontWeight) || badSizes.has(cs.fontSize))
        found.push(`${el.tagName.toLowerCase()}.${el.className} ${cs.fontSize}/${cs.fontWeight}`);
    }
    return found;
  });
  expect(offenders).toEqual([]);
});

for (const [scheme, token] of [
  ['light', 'hsl(33.7 7.8% 40%)'],
  ['dark', 'hsl(36 9.2% 68%)'],
] as const) {
  test(`placeholders use muted-foreground (${scheme})`, async ({page}) => {
    await open(page, scheme);
    await minimizeWorkout(page);
    await page
      .getByRole('navigation', {name: 'Main navigation'})
      .getByRole('button', {name: 'Exercises', exact: true})
      .click();
    const search = page.getByPlaceholder('Search exercises');
    await expect(search).toBeVisible();
    const color = await search.evaluate((el) => getComputedStyle(el, '::placeholder').color);
    expect(color).toBe(await resolve(page, token));
  });
}

test('phones at 320px do not scroll sideways', async ({page}) => {
  await page.setViewportSize({width: 320, height: 740});
  await open(page, 'light');
  const overflow = () =>
    page.evaluate(() => ({
      page: document.scrollingElement!.scrollWidth,
      rows: [...document.querySelectorAll('.set-row')].filter((r) => r.scrollWidth > r.clientWidth)
        .length,
    }));
  expect(await overflow()).toEqual({page: expect.any(Number), rows: 0});
  expect((await overflow()).page).toBeLessThanOrEqual(320);
  await page.getByRole('button', {name: 'Minimize workout'}).click();
  const nav = page.getByRole('navigation', {name: 'Main navigation'});
  for (const tab of ['Workout', 'History', 'Exercises', 'Profile']) {
    await nav.getByRole('button', {name: tab, exact: true}).click();
    expect((await overflow()).page).toBeLessThanOrEqual(320);
  }
});
