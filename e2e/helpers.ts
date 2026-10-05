import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const API = process.env.API_URL ?? 'http://localhost:8000/api/v1';
export const PASSWORD = 'recircuit-demo';

export interface Actor { token: string; org_id: number; facility_id: number }
export interface Unit { unit_id: number; passport_uid: string; serial: string }

let counter = 0;
/** A serial that is unique across runs (the database keeps everything). */
export const uniqueSerial = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(counter += 1)}`;

export async function apiLogin(request: APIRequestContext, email: string): Promise<Actor> {
  const res = await request.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
  expect(res.ok(), `login ${email}`).toBeTruthy();
  const token = ((await res.json()) as { access_token: string }).access_token;
  const me = await request.get(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await me.json()) as { org_id: number; facilities: { facility_id: number }[] };
  return { token, org_id: body.org_id, facility_id: body.facilities[0]!.facility_id };
}

export async function call<T>(request: APIRequestContext, actor: Actor, method: 'get' | 'post', path: string, data?: unknown): Promise<T> {
  const res = await request[method](`${API}${path}`, { data, headers: { Authorization: `Bearer ${actor.token}` } });
  expect(res.ok(), `${method.toUpperCase()} ${path}: ${await res.text()}`).toBeTruthy();
  return (res.status() === 204 ? undefined : await res.json()) as T;
}

export const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString();

export async function modelOf(request: APIRequestContext, actor: Actor, category: string, producerOrg: number): Promise<{ model_id: number; model_number: string }> {
  const models = await call<{ model_id: number; model_number: string; manufacturer_id: number }[]>(request, actor, 'get', `/models?category=${category}&limit=500`);
  const found = models.find((m) => m.manufacturer_id === producerOrg);
  expect(found, `a ${category} model of the producer`).toBeTruthy();
  return found!;
}

/** Create a unit as the producer and record its manufacture two days ago. */
export async function manufacture(request: APIRequestContext, producer: Actor, modelId: number, label: string): Promise<Unit> {
  const serial = uniqueSerial(label);
  const { unit_id } = await call<{ unit_id: number }>(request, producer, 'post', '/units', { model_id: modelId, serial_no: serial });
  await call(request, producer, 'post', `/units/${unit_id}/events`, { event_type: 'MANUFACTURED', occurred_at: daysAgo(2), facility_id: producer.facility_id });
  const tree = await call<{ passport_uid: string }[]>(request, producer, 'get', `/reports/passport?unit_id=${unit_id}`);
  return { unit_id, passport_uid: tree[0]!.passport_uid, serial };
}

export async function signIn(page: Page, email: string, route: string): Promise<void> {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(`**${route}`);
}

export async function findUnit(page: Page, label: string, passportUid: string): Promise<void> {
  const input = page.getByLabel(label);
  await input.fill(passportUid);
  const answered = page.waitForResponse((r) => r.url().includes(`/units/${passportUid}`) && r.request().method() === 'GET');
  await page.locator('form', { has: input }).getByRole('button', { name: 'Find' }).click();
  expect((await answered).ok()).toBeTruthy();
}
