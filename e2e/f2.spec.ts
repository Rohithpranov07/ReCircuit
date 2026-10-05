import { expect, test } from '@playwright/test';
import { apiLogin, call, daysAgo, findUnit, manufacture, modelOf, signIn } from './helpers';

// F2: a technician reinstalls a harvested battery into a refurbished laptop; a duplicate click is refused
// with a plain-language message and writes nothing.
test('F2 reinstall a harvested part, then try it twice', async ({ page, request }) => {
  const producer = await apiLogin(request, 'producer01@example.com');
  const collector = await apiLogin(request, 'collector01@example.com');
  const technician = await apiLogin(request, 'refurbisher01@example.com');
  const deviceModel = await modelOf(request, producer, 'DEVICE', producer.org_id);
  const batteryModel = await modelOf(request, producer, 'BATTERY', producer.org_id);

  // setup through the API: a dismantled donor device and a refurbished target laptop
  const donor = await manufacture(request, producer, deviceModel.model_id, 'F2D');
  const battery = await manufacture(request, producer, batteryModel.model_id, 'F2B');
  const target = await manufacture(request, producer, deviceModel.model_id, 'F2T');
  await call(request, collector, 'post', `/units/${donor.unit_id}/events`, { event_type: 'COLLECTED', occurred_at: daysAgo(1.5), facility_id: collector.facility_id });
  await call(request, collector, 'post', `/units/${donor.unit_id}/dismantle`, { parts: [{ model_id: batteryModel.model_id, serial_no: battery.serial }], occurred_at: daysAgo(1.4), facility_id: collector.facility_id });
  for (const [kind, at] of [['COLLECTED', 1.3], ['DIAGNOSED', 1.2], ['REFURBISHED', 1.1]] as const) {
    await call(request, technician, 'post', `/units/${target.unit_id}/events`, { event_type: kind, occurred_at: daysAgo(at), facility_id: technician.facility_id });
  }
  await call(request, technician, 'post', `/units/${battery.unit_id}/tests`, { occurred_at: daysAgo(1.0), facility_id: technician.facility_id, tests: [{ test_type: 'BATTERY_SOH', result: 'PASS', measured_value: 90, health_score: 90 }] });

  await signIn(page, 'refurbisher01@example.com', '/technician');
  await findUnit(page, 'Part passport', battery.passport_uid);
  await findUnit(page, 'Reinstall into this device', target.passport_uid);
  await page.getByRole('button', { name: 'Reinstall', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Reinstalled into' }).first()).toBeVisible();

  // the second attempt: the part is already inside the laptop
  await findUnit(page, 'Reinstall into this device', target.passport_uid);
  await page.getByRole('button', { name: 'Reinstall', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'still installed in another device' })).toBeVisible();

  const events = await call<{ event_type: string }[]>(request, producer, 'get', `/units/${battery.unit_id}/events`);
  expect(events.filter((e) => e.event_type === 'REINSTALLED')).toHaveLength(1);
  const history = await call<{ parent_unit_id: number }[]>(request, producer, 'get', `/units/${battery.unit_id}/history`);
  expect(history.map((h) => h.parent_unit_id)).toEqual([donor.unit_id, target.unit_id]);
});
