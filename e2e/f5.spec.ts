import { expect, test } from '@playwright/test';
import { apiLogin, call, daysAgo, manufacture, modelOf } from './helpers';

// F5: anyone holding a part opens its public passport from the QR link: no sign-in, model, history and health,
// a verified badge, and nothing about the people or organisations that handled it.
test('F5 public passport', async ({ browser, request }) => {
  const producer = await apiLogin(request, 'producer01@example.com');
  const collector = await apiLogin(request, 'collector01@example.com');
  const technician = await apiLogin(request, 'refurbisher01@example.com');
  const model = await modelOf(request, producer, 'BATTERY', producer.org_id);
  const device = await modelOf(request, producer, 'DEVICE', producer.org_id);
  const donor = await manufacture(request, producer, device.model_id, 'F5D');
  const battery = await manufacture(request, producer, model.model_id, 'F5B');
  await call(request, collector, 'post', `/units/${donor.unit_id}/events`, { event_type: 'COLLECTED', occurred_at: daysAgo(1.5), facility_id: collector.facility_id });
  await call(request, collector, 'post', `/units/${donor.unit_id}/dismantle`, { parts: [{ model_id: model.model_id, serial_no: battery.serial }], occurred_at: daysAgo(1.4), facility_id: collector.facility_id });
  await call(request, technician, 'post', `/units/${battery.unit_id}/tests`, { occurred_at: daysAgo(1), facility_id: technician.facility_id, tests: [{ test_type: 'BATTERY_SOH', result: 'PASS', measured_value: 86, health_score: 86 }] });

  const visitor = await browser.newContext();               // no cookies, no token
  const page = await visitor.newPage();
  await page.goto(`/p/${battery.passport_uid}`);
  await expect(page.getByTestId('health')).toHaveText('86');
  await expect(page.getByTestId('chain-badge')).toHaveText('Chain verified');
  for (const step of ['Manufactured', 'Collected', 'Harvested', 'Diagnosed']) {
    await expect(page.getByText(step, { exact: true }).first()).toBeVisible();
  }
  const text = await page.locator('main').innerText();
  expect(text).not.toMatch(/Demo (Collector|Refurbisher|Recycler)/);   // no organisations that handled it
  expect(text).not.toMatch(/@example\.com/);                           // no people

  await page.goto('/p/6f1d6a52-3c5f-4a54-8f4e-2f5b3a6c9d10');
  await expect(page.getByRole('alert')).toContainText('does not match any passport');
  await visitor.close();
});
