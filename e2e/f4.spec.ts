import { expect, test } from '@playwright/test';
import { apiLogin, call, daysAgo, manufacture, modelOf, signIn, superuserSql } from './helpers';

// F4: an auditor checks history. A clean unit verifies; after a superuser edits one event the same check
// names the first broken link, the whole-dataset check fails, and the public passport stops saying "verified".
test('F4 tamper check, custody gaps and the public badge', async ({ page, request }) => {
  const producer = await apiLogin(request, 'producer01@example.com');
  const collector = await apiLogin(request, 'collector01@example.com');
  const model = await modelOf(request, producer, 'BATTERY', producer.org_id);
  const unit = await manufacture(request, producer, model.model_id, 'F4');
  await call(request, collector, 'post', `/units/${unit.unit_id}/events`, { event_type: 'COLLECTED', occurred_at: daysAgo(1), facility_id: collector.facility_id });

  await signIn(page, 'auditor@example.com', '/auditor');
  await page.getByLabel('Unit id').fill(String(unit.unit_id));
  await page.getByRole('button', { name: 'Check this unit' }).click();
  await expect(page.getByRole('status')).toContainText('every event matches its hash');

  await page.getByRole('tab', { name: 'Custody gaps' }).click();
  await expect(page.getByRole('heading', { name: 'Units without a manifest' })).toBeVisible();
  await expect(page.getByRole('table').or(page.getByText('No custody gaps'))).toBeVisible();
  await page.getByRole('tab', { name: 'Certificate backing' }).click();
  await expect(page.getByText('Every certificate is backed by at least the weight it claims.')).toBeVisible();
  await page.getByRole('tab', { name: 'Audit log' }).click();
  await expect(page.getByRole('cell', { name: 'CERT_ISSUE' }).first()).toBeVisible();

  // --- a superuser edits the facility of the unit's COLLECTED event, then the checks notice
  const eventId = superuserSql(`SELECT event_id FROM lifecycle_event WHERE unit_id = ${unit.unit_id} AND event_type = 'COLLECTED'`);
  const original = superuserSql(`SELECT facility_id FROM lifecycle_event WHERE event_id = ${eventId}`);
  const other = superuserSql(`SELECT facility_id FROM facility WHERE facility_id <> ${original} ORDER BY facility_id LIMIT 1`);
  const tamper = (facility: string) => superuserSql(
    `ALTER TABLE lifecycle_event DISABLE TRIGGER trg_event_immutable; UPDATE lifecycle_event SET facility_id = ${facility} WHERE event_id = ${eventId}; ALTER TABLE lifecycle_event ENABLE TRIGGER trg_event_immutable;`);
  tamper(other);
  try {
    await page.getByRole('tab', { name: 'Tamper check' }).click();
    await page.getByLabel('Unit id').fill(String(unit.unit_id));
    await page.getByRole('button', { name: 'Check this unit' }).click();
    await expect(page.getByRole('status')).toContainText(`first broken link is event ${eventId}`);
    await page.getByRole('button', { name: 'Check every unit' }).click();
    await expect(page.getByRole('status')).toContainText(/units fail the check/);

    const publicPage = await page.context().newPage();
    await publicPage.goto(`/p/${unit.passport_uid}`);
    await expect(publicPage.getByTestId('chain-badge')).toHaveText('Chain not verified');
  } finally {
    tamper(original);
  }
  await page.getByRole('button', { name: 'Check this unit' }).click();
  await expect(page.getByRole('status')).toContainText('every event matches its hash');
});
