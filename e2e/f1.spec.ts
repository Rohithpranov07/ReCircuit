import { expect, test } from '@playwright/test';
import { apiLogin, call, findUnit, manufacture, modelOf, signIn, uniqueSerial } from './helpers';

// F1: a collector collects and dismantles a device; a technician tests the harvested battery; it shows up
// in the reuse inventory with its score.
test('F1 collect, dismantle, test and list in the reuse inventory', async ({ page, request }) => {
  const producer = await apiLogin(request, 'producer01@example.com');
  const deviceModel = await modelOf(request, producer, 'DEVICE', producer.org_id);
  const batteryModel = await modelOf(request, producer, 'BATTERY', producer.org_id);
  const device = await manufacture(request, producer, deviceModel.model_id, 'F1D');
  const battery = await manufacture(request, producer, batteryModel.model_id, 'F1B');

  // --- collector, in the browser
  await signIn(page, 'collector01@example.com', '/collector');
  await findUnit(page, 'Passport', device.passport_uid);
  await page.getByRole('button', { name: 'Mark as collected' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'recorded as collected' })).toBeVisible();

  await page.getByRole('tab', { name: 'Dismantle' }).click();
  await findUnit(page, 'Device passport', device.passport_uid);
  await page.getByLabel('Part 1 model').selectOption({ label: `${batteryModel.model_number} (battery)` });
  await page.getByLabel('Part 1 serial').fill(battery.serial);
  await page.getByRole('button', { name: 'Dismantle device' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'now have their own passports' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();

  // --- technician, in the browser
  await signIn(page, 'refurbisher01@example.com', '/technician');
  await findUnit(page, 'Part passport', battery.passport_uid);
  await page.getByLabel('Measured value').fill('86');
  await page.getByLabel('Health score (0–100)').fill('86');
  await page.getByRole('button', { name: 'Record test' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Test recorded' }).first()).toBeVisible();

  await page.getByRole('tab', { name: 'Reuse inventory' }).click();
  await page.getByLabel('Category').selectOption('BATTERY');
  await page.getByLabel('Minimum health').fill('86');
  const row = page.getByRole('row', { name: new RegExp(`${batteryModel.model_number}.*86`) }).first();
  await expect(row).toBeVisible();

  // the same facts through the API
  const events = await call<{ event_type: string }[]>(request, producer, 'get', `/units/${battery.unit_id}/events`);
  expect(events.map((e) => e.event_type)).toEqual(['MANUFACTURED', 'COLLECTED', 'HARVESTED', 'DIAGNOSED']);
  expect(uniqueSerial('x')).not.toEqual(uniqueSerial('x'));
});
