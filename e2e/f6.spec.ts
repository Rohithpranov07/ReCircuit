import { expect, test } from '@playwright/test';
import { PASSWORD } from './helpers';

// NFR-11 and NFR-14: the core flow fits a 360 px phone and works from the keyboard alone.
test.use({ viewport: { width: 360, height: 740 } });

test('F6 phone width: no sideways scrolling, and sign-in works with the keyboard only', async ({ page }) => {
  await page.goto('/login');
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);

  await page.getByLabel('Email').focus();
  await page.keyboard.type('collector01@example.com');
  await page.keyboard.press('Tab');
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press('Enter');
  await page.waitForURL('**/collector');

  // the collector's core screen is one step from sign-in, and it fits the screen
  await expect(page.getByRole('heading', { name: 'Collector workspace' })).toBeVisible();
  await expect(page.getByLabel('Passport')).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);

  // every tab can be reached and activated with the keyboard; focus is visible
  await page.getByRole('tab', { name: 'Intake' }).focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'Dismantle' })).toHaveAttribute('aria-selected', 'true');
  const outline = await page.getByRole('tab', { name: 'Dismantle' }).evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
  expect(await overflow()).toBeLessThanOrEqual(0);
});
