import { expect, test } from '@playwright/test';
import { apiLogin, call, daysAgo, manufacture, modelOf, signIn, uniqueSerial } from './helpers';

// F3: units travel producer -> collector -> recycler; the recycler receives (one unit flagged missing),
// recycles two, issues a certificate through the wizard, allocates it, and the database refuses a forced
// over-claim in plain words.
test('F3 receive, recycle, certify, allocate and refuse an over-claim', async ({ page, request }) => {
  const producer = await apiLogin(request, 'producer01@example.com');
  const collector = await apiLogin(request, 'collector01@example.com');
  const deviceModel = await modelOf(request, producer, 'DEVICE', producer.org_id);
  const [d1, d2, d3] = [await manufacture(request, producer, deviceModel.model_id, 'F3A'),
                        await manufacture(request, producer, deviceModel.model_id, 'F3B'),
                        await manufacture(request, producer, deviceModel.model_id, 'F3C')];
  const orgs = await call<{ org_id: number; org_name: string }[]>(request, collector, 'get', '/organizations');
  const recycler = orgs.find((o) => o.org_name === 'Demo Recycler 01')!;

  for (const u of [d1, d2, d3]) {
    await call(request, collector, 'post', `/units/${u.unit_id}/events`, { event_type: 'COLLECTED', occurred_at: daysAgo(1.5), facility_id: collector.facility_id });
  }
  const manifestNo = uniqueSerial('MF-F3');
  await call(request, collector, 'post', '/transfers', { manifest_no: manifestNo, to_org_id: recycler.org_id, shipped_at: daysAgo(1.2), total_mass_kg: 4.5,
    items: [d1, d2, d3].map((u) => ({ unit_id: u.unit_id, declared_condition: 'SCRAP' })) });

  await signIn(page, 'recycler01@example.com', '/recycler');

  // --- receive, flagging the second unit as missing
  const card = page.locator('li', { hasText: manifestNo });
  await card.getByLabel(new RegExp(d2.serial)).check();
  await card.getByRole('button', { name: /Confirm receipt \(1 missing\)/ }).click();
  await expect(page.getByText('No manifests are on their way to you.')).toBeVisible().catch(() => undefined);
  const transfers = await call<{ manifest_no: string; received_at: string | null; discrepancies: { unit_id: number; kind: string }[] }[]>(request, collector, 'get', '/transfers');
  const received = transfers.find((t) => t.manifest_no === manifestNo)!;
  expect(received.received_at).not.toBeNull();
  expect(received.discrepancies).toEqual([{ unit_id: d2.unit_id, kind: 'MISSING' }]);

  // --- recycle queue
  await page.getByRole('tab', { name: 'Recycle queue' }).click();
  for (const u of [d1, d3]) {
    await page.getByRole('row', { name: new RegExp(u.serial) }).getByRole('button', { name: 'Mark recycled' }).click();
    await expect(page.getByRole('row', { name: new RegExp(u.serial) })).toHaveCount(0);
  }

  // --- certificate wizard: a covered claim is issued
  await page.getByRole('tab', { name: 'Certificates' }).click();
  await page.getByRole('button', { name: 'Issue a certificate' }).click();
  const certNo = uniqueSerial('RC-F3');
  await page.getByLabel('Certificate number').fill(certNo);
  await page.getByLabel('Claimed quantity (kg)').fill('0.5');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('checkbox', { name: new RegExp(d1.serial) }).check();
  await expect(page.getByTestId('backing-line')).toContainText(/Backed [0-9.]+ kg of 0.5 kg claimed$/);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Issue certificate' }).click();
  await expect(page.getByText(certNo)).toBeVisible();

  // --- allocate to the producer
  const row = page.locator('li', { hasText: certNo });
  await row.getByLabel(`Producer for ${certNo}`).selectOption({ label: 'Demo Producer 01' });
  await row.getByRole('button', { name: 'Allocate' }).click();
  await expect(row.getByText('Allocated to Demo Producer 01')).toBeVisible();

  // --- forced over-claim: the wizard only hints; a tampered request still meets the database's refusal
  await page.route('**/api/v1/certificates', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const body = route.request().postDataJSON() as { quantity_kg: number };
    return route.continue({ postData: JSON.stringify({ ...body, quantity_kg: 900 }) });
  });
  await page.getByRole('button', { name: 'Issue a certificate' }).click();
  await page.getByLabel('Certificate number').fill(uniqueSerial('RC-F3X'));
  await page.getByLabel('Claimed quantity (kg)').fill('0.5');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('checkbox', { name: new RegExp(d3.serial) }).check();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Issue certificate' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'claims more weight than its units account for' })).toBeVisible();
  const certs = await call<{ cert_no: string }[]>(request, producer, 'get', '/certificates');
  expect(certs.map((c) => c.cert_no)).toContain(certNo);
});
