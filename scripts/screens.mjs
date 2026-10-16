// Screenshot and pixel-compare harness for visual-parity work. Not a test suite; not run in CI.
//   node scripts/screens.mjs capture <outDir>
//   node scripts/screens.mjs compare <beforeDir> <afterDir>
// Capture needs the dev server already running on GYM_LOG_E2E_PORT (default 5188).
import {chromium} from '@playwright/test';
import {mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const port = Number(process.env.GYM_LOG_E2E_PORT ?? 5188);
const viewports = [
  {name: 'mobile', width: 390, height: 844},
  {name: 'desktop', width: 1440, height: 1000},
];
const themes = ['light', 'dark'];
const threshold = 0.001;

const launch = () =>
  chromium.launch({
    executablePath: process.env.CI ? undefined : '/usr/bin/google-chrome',
    args: ['--no-sandbox'],
  });

async function capture(outDir) {
  mkdirSync(outDir, {recursive: true});
  const browser = await launch();
  let count = 0;
  for (const vp of viewports)
    for (const theme of themes) {
      const context = await browser.newContext({
        viewport: {width: vp.width, height: vp.height},
        colorScheme: theme,
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      const shoot = async (name) => {
        await page.waitForTimeout(400);
        await page.screenshot({
          path: join(outDir, `${vp.name}-${theme}-${name}.png`),
          animations: 'disabled',
          caret: 'hide',
        });
        count++;
      };
      await page.goto(`http://127.0.0.1:${port}/?demo=1`);
      await page.locator('.app-shell[data-save="saved"]').waitFor();
      // Elapsed clocks tick; hide them so captures are deterministic.
      await page.addStyleTag({content: '.elapsed{visibility:hidden !important}'});
      await shoot('logger');
      const minimize = page.getByRole('button', {name: 'Minimize workout'});
      if (await minimize.isVisible()) await minimize.click();
      const nav = page.getByRole('navigation', {name: 'Main navigation'});
      for (const tab of ['Workout', 'History', 'Exercises', 'Profile']) {
        await nav.getByRole('button', {name: tab, exact: true}).click();
        await shoot(tab.toLowerCase());
      }
      await page.getByRole('button', {name: 'Settings', exact: true}).last().click();
      await page.getByRole('dialog', {name: 'Settings', exact: true}).waitFor();
      await shoot('settings');
      await page.getByRole('button', {name: 'Close settings'}).click();
      await nav.getByRole('button', {name: 'Exercises', exact: true}).click();
      await page
        .getByRole('region', {name: 'All exercises'})
        .locator('.exercise-row')
        .first()
        .click();
      await shoot('exercise-detail');
      await context.close();
    }
  await browser.close();
  console.log(`captured ${count} screens to ${outDir}`);
}

async function compare(beforeDir, afterDir) {
  const names = readdirSync(beforeDir)
    .filter((f) => f.endsWith('.png'))
    .sort();
  const browser = await launch();
  const page = await browser.newPage();
  // Decode PNGs with the browser's canvas so no image dependency is needed.
  const diffOne = (a, b) =>
    page.evaluate(
      async ([a, b]) => {
        const load = (src) =>
          new Promise((res, rej) => {
            const img = new Image();
            img.onload = () => res(img);
            img.onerror = rej;
            img.src = src;
          });
        const [ia, ib] = await Promise.all([load(a), load(b)]);
        const w = Math.max(ia.width, ib.width);
        const h = Math.max(ia.height, ib.height);
        const data = (img) => {
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const ctx = c.getContext('2d', {willReadFrequently: true});
          ctx.drawImage(img, 0, 0);
          return ctx.getImageData(0, 0, w, h);
        };
        const da = data(ia);
        const db = data(ib);
        const out = new ImageData(w, h);
        let differ = 0;
        for (let i = 0; i < da.data.length; i += 4) {
          const same =
            da.data[i] === db.data[i] &&
            da.data[i + 1] === db.data[i + 1] &&
            da.data[i + 2] === db.data[i + 2] &&
            da.data[i + 3] === db.data[i + 3];
          if (same) {
            const g = 255 - (255 - da.data[i]) * 0.15;
            out.data.set([g, g, g, 255], i);
          } else {
            differ++;
            out.data.set([255, 0, 0, 255], i);
          }
        }
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d').putImageData(out, 0, 0);
        return {differ, total: w * h, diff: c.toDataURL('image/png')};
      },
      [a, b],
    );
  const url = (dir, n) => `data:image/png;base64,${readFileSync(join(dir, n)).toString('base64')}`;
  let failed = false;
  for (const name of names) {
    let r;
    try {
      r = await diffOne(url(beforeDir, name), url(afterDir, name));
    } catch {
      console.log(`${name}: missing or unreadable in ${afterDir}`);
      failed = true;
      continue;
    }
    writeFileSync(
      join(afterDir, name.replace(/\.png$/, '.diff.png')),
      Buffer.from(r.diff.split(',')[1], 'base64'),
    );
    const pct = ((r.differ / r.total) * 100).toFixed(3);
    const over = r.differ / r.total > threshold;
    if (over) failed = true;
    console.log(`${name}: ${r.differ} px differ (${pct}%)${over ? ' FAIL' : ''}`);
  }
  await browser.close();
  if (failed) process.exitCode = 1;
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'capture' && args.length === 1) await capture(args[0]);
else if (cmd === 'compare' && args.length === 2) await compare(args[0], args[1]);
else {
  console.error('usage: screens.mjs capture <outDir> | compare <beforeDir> <afterDir>');
  process.exit(2);
}
