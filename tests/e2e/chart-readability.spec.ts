import {devices, expect, test} from '@playwright/test';

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

  for (const metric of ['Heaviest weight', 'Best reps', 'Volume', 'Est. 1RM']) {
    await page.getByRole('radio', {name: metric, exact: true}).click();
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
    await expect(page.getByRole('list', {name: 'Sessions'})).toBeVisible();
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

test('each repeated exercise block can be inspected at its recorded time, then the metric switches on one press', async ({
  page,
}) => {
  await page.route('**/src/domain/demo.ts', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({
      response,
      body:
        body +
        `\ndemoDataset.workouts = [
      {id:'synthetic-older', name:'Earlier press', date:'2026-03-01T18:00:00', duration:40, exercises:[
        {name:'Bench Press (Barbell)', type:'weighted', sets:[{id:'older-set', weight:50, reps:8, seconds:null, distance:null}]}
      ]},
      {id:'synthetic-repeat', name:'Repeated press blocks', date:'2026-03-08T18:00:00', duration:45, exercises:[
        {name:'Bench Press (Barbell)', type:'weighted', sets:[{id:'first-block', weight:60, reps:8, seconds:null, distance:null}]},
        {name:'Bench Press (Barbell)', type:'weighted', sets:[{id:'second-block', weight:70, reps:6, seconds:null, distance:null}]}
      ]}
    ];`,
    });
  });
  await page.goto('/?demo=1');
  await navigate(page, 'Exercises');
  await page.getByLabel('Search exercises').fill('Bench');
  await page.getByRole('button', {name: 'Bench Press (Barbell)', exact: true}).first().click();
  await page.getByRole('tab', {name: 'Charts', exact: true}).click();
  // Estimates read to one decimal: 50 kg × 8 is 63.3 kg, so the change is +20.7 kg.
  await page.getByRole('radio', {name: 'Est. 1RM', exact: true}).click();
  const chart = page.getByRole('img', {name: /Est\. 1RM for Bench/});
  const headline = page.locator('.chart-headline');
  await expect(headline).toHaveText(/^84\s*kg.*\+20\.7 kg since/);
  await expect(page.getByRole('list', {name: 'Sessions'}).locator('li').last()).toHaveText(
    /63\.3 kg$/,
  );
  await chart.locator('.recharts-surface').focus();
  await expect(headline).toHaveText(/^63\.3\s*kg.*50 kg × 8$/);
  await page.keyboard.press('ArrowRight');
  await expect(headline).toContainText('60 kg × 8');
  await page.keyboard.press('ArrowRight');
  await expect(headline).toContainText('70 kg × 6');
  const dotY = await chart.locator('.recharts-area-dots circle').last().getAttribute('cy');
  await expect(chart.locator('.chart-active-dot')).toHaveAttribute('cy', dotY!);
  await expect(page.getByRole('list', {name: 'Sessions'}).locator('li')).toHaveCount(3);
  // Leaving keyboard inspection, one press switches the metric (on phones the page stays put).
  const load = page.getByRole('radio', {name: 'Heaviest weight', exact: true});
  await load.click();
  await expect(load).toHaveAttribute('data-state', 'on');
  await expect(headline).toHaveText(/^70\s*kg/);
});

test('holding and sliding inspects sessions with optional haptics, then returns to the latest value', async ({
  browser,
  baseURL,
}, info) => {
  test.skip(info.project.name !== 'mobile');
  const context = await browser.newContext({...devices['Pixel 6'], baseURL});
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(window, 'chartTicks', {value: [], writable: true});
    Object.defineProperty(navigator, 'vibrate', {
      value: (pattern: number[]) => {
        (window as unknown as {chartTicks: number[][]}).chartTicks.push(pattern);
        return true;
      },
    });
  });
  await page.goto('/?demo=1');
  await navigate(page, 'Exercises');
  await page.getByLabel('Search exercises').fill('Bench');
  await page.getByRole('button', {name: 'Bench Press (Barbell)', exact: true}).first().click();
  await page.getByRole('tab', {name: 'Charts', exact: true}).click();
  const chart = page.getByRole('img', {name: /Heaviest weight for Bench/});
  await chart.scrollIntoViewIfNeeded();
  const dots = chart.locator('.recharts-area-dots circle');
  const first = (await dots.first().boundingBox())!;
  const last = (await dots.last().boundingBox())!;
  const cdp = await context.newCDPSession(page);
  const start = {x: first.x + first.width / 2, y: first.y + first.height / 2};
  const end = {x: last.x + last.width / 2, y: last.y + last.height / 2};
  const headline = page.locator('.chart-headline');
  const latest = (await headline.textContent())!;
  const ticks = () =>
    page.evaluate(() => (window as unknown as {chartTicks: number[][]}).chartTicks.length);
  const before = await ticks();
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [start]});
  await expect(headline).toContainText('best set');
  const inspected = (await headline.textContent())!;
  await expect(chart.locator('.recharts-tooltip-cursor')).toHaveAttribute(
    'stroke-dasharray',
    '3 3',
  );
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [end]});
  await expect(headline).not.toHaveText(inspected);
  await expect.poll(ticks).toBeGreaterThan(before);
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await expect(headline).toHaveText(latest);
  // Preferences also govern the chart's selection ticks.
  await page.evaluate(async () => {
    const path = '/src/feedback/preferences.ts';
    const {setFeedbackPreferences} = await import(path);
    setFeedbackPreferences({haptics: false});
  });
  const muted = await ticks();
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [start]});
  await expect(headline).toContainText('best set');
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [end]});
  await expect(headline).not.toHaveText(inspected);
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await expect(headline).toHaveText(latest);
  expect(await ticks()).toBe(muted);
  await context.close();
});
