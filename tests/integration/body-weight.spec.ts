import {type Locator, type Page, expect, test} from '@playwright/test';

import {openSettings} from '../navigation';
import {login, syncNow} from './helpers';

// Synthetic values only.
async function section(page: Page) {
  await openSettings(page);
  const region = page.getByRole('region', {name: 'Body weight', exact: true});
  await expect(region).toBeVisible();
  return region;
}
const rows = (region: Locator) =>
  region.getByRole('list', {name: 'Body weight history'}).getByRole('listitem');

test('body-weight create, correction and delete sync between two isolated installations', async ({
  page,
  browser,
}) => {
  await login(page);
  let mine = await section(page);
  await mine.getByRole('button', {name: 'Add weight', exact: true}).click();
  await mine.page().getByLabel('Weight in kg', {exact: true}).fill('82.4');
  await mine.page().getByLabel('Date and time', {exact: true}).fill('2021-05-06T07:08');
  await mine.page().getByRole('button', {name: 'Save entry', exact: true}).click();
  await expect(rows(mine)).toHaveCount(1);
  await syncNow(page);

  const peerContext = await browser.newContext();
  const peer = await peerContext.newPage();
  await login(peer);
  let theirs = await section(peer);
  await expect(rows(theirs)).toHaveCount(1);
  await expect(rows(theirs).first()).toContainText('6 May 2021');
  await expect(rows(theirs).first()).toContainText('82.4');

  // The peer corrects it; the first installation receives the correction.
  await theirs.getByRole('button', {name: /Edit entry 6 May 2021/}).click();
  await theirs.page().getByLabel('Weight in kg', {exact: true}).fill('81.95');
  await theirs.page().getByRole('button', {name: 'Save entry', exact: true}).click();
  await expect(rows(theirs).first()).toContainText('81.95');
  await syncNow(peer);
  await syncNow(page);
  mine = await section(page);
  await expect(rows(mine).first()).toContainText('81.95');

  // The first installation deletes it; the peer loses it too.
  await mine.getByRole('button', {name: /Edit entry 6 May 2021/}).click();
  await mine.page().getByRole('button', {name: 'Delete entry', exact: true}).click();
  await expect(rows(mine)).toHaveCount(0);
  await syncNow(page);
  await syncNow(peer);
  theirs = await section(peer);
  await expect(rows(theirs)).toHaveCount(0);
  await expect(theirs.getByText('No entries yet', {exact: false})).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
  await expect(peer.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
  await peerContext.close();
});
