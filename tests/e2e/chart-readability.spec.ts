import {expect, test} from '@playwright/test';

import {navigate} from '../navigation';

// Pixel 6 CSS viewport, not its physical-pixel resolution.
test('chart axis and date labels stay readable without clipping or overlap', async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === 'mobile') await page.setViewportSize({width: 412, height: 915});
  await page.goto('/?demo=1');
  await navigate(page, 'Exercises');
  await page.getByLabel('Search exercises').fill('Bench');
  await page.getByRole('button', {name: 'Bench Press (Barbell)', exact: true}).first().click();
  await page.getByRole('tab', {name: 'Charts', exact: true}).click();
  await page.evaluate(() => document.fonts.ready);

  for (const metric of ['Best reps', 'Best load', 'Session volume', 'Estimated 1RM']) {
    await page.getByRole('button', {name: metric, exact: true}).click();
    const chart = page.getByRole('img', {name: new RegExp(`${metric} for Bench`)});
    await expect(chart).toBeVisible();
    await expect
      .poll(
        async () =>
          chart.locator('text').evaluateAll((labels) =>
            Math.min(
              ...labels.map((label) => {
                const transform = (label as SVGTextElement).getScreenCTM()!;
                return (
                  parseFloat(getComputedStyle(label).fontSize) *
                  Math.hypot(transform.a, transform.b)
                );
              }),
            ),
          ),
        {message: `${metric} labels must render at least 11 CSS pixels`},
      )
      .toBeGreaterThanOrEqual(10.99);

    const geometry = await chart.evaluate((svg) => {
      const bounds = svg.getBoundingClientRect();
      const boxes = [...svg.querySelectorAll('text')].map((label) => label.getBoundingClientRect());
      return {
        contained: boxes.every(
          (box) =>
            box.left >= bounds.left &&
            box.right <= bounds.right &&
            box.top >= bounds.top &&
            box.bottom <= bounds.bottom,
        ),
        overlap: boxes.some((box, i) =>
          boxes
            .slice(i + 1)
            .some(
              (other) =>
                box.left < other.right &&
                box.right > other.left &&
                box.top < other.bottom &&
                box.bottom > other.top,
            ),
        ),
      };
    });
    expect(geometry).toEqual({contained: true, overlap: false});
    await expect(page.getByRole('table', {name: 'Exact trend values'})).toBeVisible();
    await expect(page.getByRole('button', {name: /View source workout/}).first()).toBeVisible();
  }

  // The chart must also adapt when an already mounted container changes size.
  await page.setViewportSize({width: testInfo.project.name === 'mobile' ? 390 : 1100, height: 915});
  await expect
    .poll(async () =>
      page.locator('.trend-chart text').evaluateAll((labels) =>
        Math.min(
          ...labels.map((label) => {
            const transform = (label as SVGTextElement).getScreenCTM()!;
            return (
              parseFloat(getComputedStyle(label).fontSize) * Math.hypot(transform.a, transform.b)
            );
          }),
        ),
      ),
    )
    .toBeGreaterThanOrEqual(10.99);
});
