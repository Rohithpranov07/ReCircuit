// k6 load test for the two read paths with latency targets (NFR-6):
//   GET /units/{passport_uid}       p95 < 200 ms
//   GET /units/{unit_id}/tree       p95 < 300 ms
// Run against the large profile:  k6 run loadtest/passport.js
// Staff endpoints are not cached; every request reaches the database.
import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';

const API = __ENV.API_URL || 'http://localhost:8000/api/v1';
const EMAIL = __ENV.LOAD_EMAIL || 'refurbisher01@example.com';
const PASSWORD = __ENV.LOAD_PASSWORD || 'recircuit-demo';

const passportMs = new Trend('passport_ms', true);
const treeMs = new Trend('tree_ms', true);

export const options = {
  scenarios: {
    passport: { executor: 'constant-arrival-rate', rate: 40, timeUnit: '1s', duration: '60s', preAllocatedVUs: 20, maxVUs: 60, exec: 'passport' },
    tree: { executor: 'constant-arrival-rate', rate: 30, timeUnit: '1s', duration: '60s', preAllocatedVUs: 20, maxVUs: 60, exec: 'tree' },
  },
  thresholds: {
    passport_ms: ['p(95)<200'],
    tree_ms: ['p(95)<300'],
    'http_req_failed': ['rate<0.01'],
  },
};

export function setup() {
  const login = http.post(`${API}/auth/login`, JSON.stringify({ email: EMAIL, password: PASSWORD }), { headers: { 'Content-Type': 'application/json' } });
  check(login, { 'logged in': (r) => r.status === 200 });
  const token = login.json('access_token');
  const headers = { Authorization: `Bearer ${token}` };
  // a sample of real units across the whole dataset
  const rows = http.get(`${API}/reports/current-state?limit=50000`, { headers }).json();
  const sample = [];
  for (let i = 0; i < rows.length; i += Math.max(1, Math.floor(rows.length / 3000))) sample.push({ id: rows[i].unit_id, uid: rows[i].passport_uid });
  // devices that have (or had) parts make the tree query do real work
  const parents = http.get(`${API}/reports/current-state?state=REFURBISHED&limit=5000`, { headers }).json().map((r) => r.unit_id);
  return { token, sample, parents };
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

export function passport(data) {
  const u = pick(data.sample);
  const res = http.get(`${API}/units/${u.uid}`, { headers: { Authorization: `Bearer ${data.token}` }, tags: { endpoint: 'passport' } });
  passportMs.add(res.timings.duration);
  check(res, { 'passport 200': (r) => r.status === 200 });
}

export function tree(data) {
  const id = Math.random() < 0.5 && data.parents.length ? pick(data.parents) : pick(data.sample).id;
  const asOf = Math.random() < 0.5 ? '' : `?as_of=${encodeURIComponent('2025-09-01T00:00:00Z')}`;
  const res = http.get(`${API}/units/${id}/tree${asOf}`, { headers: { Authorization: `Bearer ${data.token}` }, tags: { endpoint: 'tree' } });
  treeMs.add(res.timings.duration);
  check(res, { 'tree 200': (r) => r.status === 200 });
}
