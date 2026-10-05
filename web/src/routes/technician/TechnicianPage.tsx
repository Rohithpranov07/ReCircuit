import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { Category, EventResult, ReuseRow, TestResult, UnitPassport } from '../../api/types';
import { AppShell } from '../../components/AppShell';
import { EventBadge } from '../../components/EventBadge';
import { useToast } from '../../components/Toast';
import { Button, Field, Panel, Tabs, inputClass, occurredNow } from '../../components/ui';
import { FacilityField } from '../passport/FacilityField';
import { useMe } from '../passport/shared';
import { UnitLookup } from '../passport/UnitLookup';

const TABS = ['Workbench', 'Reuse inventory'] as const;
type Tab = (typeof TABS)[number];

const TEST_TYPES: Record<string, string[]> = {
  BATTERY: ['BATTERY_SOH'], STORAGE: ['SMART_HEALTH'], MEMORY: ['MEMTEST'], DISPLAY: ['DISPLAY_DEAD_PIXELS'],
};
const ALL_TESTS = ['BATTERY_SOH', 'SMART_HEALTH', 'MEMTEST', 'DISPLAY_DEAD_PIXELS'];
const CATEGORIES: Category[] = ['DEVICE', 'BOARD', 'BATTERY', 'STORAGE', 'MEMORY', 'DISPLAY', 'CHIP', 'OTHER'];

export default function TechnicianPage() {
  const me = useMe();
  const [tab, setTab] = useState<Tab>('Workbench');
  const [facility, setFacility] = useState<number | null>(null);
  const facilityId = facility ?? me.data?.facilities[0]?.facility_id ?? 0;
  return (
    <AppShell wide>
      <h1 className="text-2xl font-semibold tracking-tight">Technician workbench</h1>
      {me.data && <div className="mt-3"><FacilityField me={me.data} value={facilityId} onChange={setFacility} /></div>}
      <div className="mt-5"><Tabs label="Technician tasks" tabs={TABS} active={tab} onChange={setTab} /></div>
      <div className="mt-6 space-y-6">
        {me.data && tab === 'Workbench' && <Workbench facilityId={facilityId} />}
        {tab === 'Reuse inventory' && <Inventory />}
      </div>
    </AppShell>
  );
}

function Workbench({ facilityId }: { facilityId: number }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [unit, setUnit] = useState<UnitPassport | null>(null);
  const [target, setTarget] = useState<UnitPassport | null>(null);
  const [testType, setTestType] = useState('');
  const [measured, setMeasured] = useState('');
  const [score, setScore] = useState('');
  const [result, setResult] = useState<TestResult>('PASS');
  const [note, setNote] = useState<string | null>(null);

  const types = unit ? (TEST_TYPES[unit.model.category] ?? ALL_TESTS) : ALL_TESTS;
  const chosen = testType && types.includes(testType) ? testType : (types[0] ?? 'BATTERY_SOH');

  async function refresh(message: string, id: number) {
    const fresh = await api<UnitPassport>(`/units/${unit?.passport_uid ?? ''}`, { quiet: true });
    setUnit(fresh);
    setNote(message);
    toast.show(message);
    await qc.invalidateQueries({ queryKey: ['events', id] });
  }

  async function recordTests() {
    if (!unit) return;
    await api<EventResult>(`/units/${unit.unit_id}/tests`, { method: 'POST', body: {
      occurred_at: occurredNow(), facility_id: facilityId,
      tests: [{ test_type: chosen, result, measured_value: measured === '' ? null : Number(measured), health_score: score === '' ? null : Number(score) }] } });
    await refresh('Test recorded', unit.unit_id);
  }
  async function harvest() {
    if (!unit) return;
    await api<EventResult>(`/units/${unit.unit_id}/harvest`, { method: 'POST', body: { occurred_at: occurredNow(), facility_id: facilityId } });
    await refresh('Part harvested', unit.unit_id);
  }
  async function reinstall() {
    if (!unit || !target) return;
    await api<EventResult>(`/units/${unit.unit_id}/reinstall`, { method: 'POST',
      body: { new_parent_unit_id: target.unit_id, occurred_at: occurredNow(), facility_id: facilityId } });
    setTarget(null);
    await refresh(`Reinstalled into ${target.model.model_number}`, unit.unit_id);
  }

  return (
    <>
      <Panel title="Scan a part">
        <UnitLookup label="Part passport" onFound={(p) => { setUnit(p); setNote(null); }} />
      </Panel>
      {unit && (
        <>
          <Panel title="Record a test">
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Test" htmlFor="t-type">
                <select id="t-type" value={chosen} onChange={(e) => setTestType(e.target.value)} className={inputClass}>
                  {types.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Measured value" htmlFor="t-val"><input id="t-val" inputMode="decimal" value={measured} onChange={(e) => setMeasured(e.target.value)} className={inputClass} /></Field>
              <Field label="Health score (0–100)" htmlFor="t-score"><input id="t-score" inputMode="numeric" value={score} onChange={(e) => setScore(e.target.value)} className={inputClass} /></Field>
              <Field label="Result" htmlFor="t-res">
                <select id="t-res" value={result} onChange={(e) => setResult(e.target.value as TestResult)} className={inputClass}>
                  <option value="PASS">Pass</option><option value="DEGRADED">Degraded</option><option value="FAIL">Fail</option>
                </select>
              </Field>
            </div>
            <Button className="mt-4" disabled={score !== '' && !(Number(score) >= 0 && Number(score) <= 100)} onClick={() => void recordTests()}>Record test</Button>
          </Panel>
          <Panel title="Harvest or reinstall">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-ink-soft">Current state</span>
              {unit.current_state && <EventBadge type={unit.current_state} />}
              {unit.current_parent && <span className="text-sm">inside {unit.current_parent.model_number}</span>}
            </div>
            <div className="mt-4">
              <Button variant="quiet" onClick={() => void harvest()}>Harvest from its device</Button>
            </div>
            <div className="mt-6 border-t border-solder pt-4">
              <UnitLookup label="Reinstall into this device" onFound={setTarget} />
              <Button className="mt-4" disabled={!target} onClick={() => void reinstall()}>Reinstall</Button>
            </div>
            {note && <p role="status" className="mt-4 text-trace">{note}</p>}
          </Panel>
        </>
      )}
    </>
  );
}

function Inventory() {
  const navigate = useNavigate();
  const [category, setCategory] = useState('');
  const [minHealth, setMinHealth] = useState('');
  const { data, isPending } = useQuery({
    queryKey: ['reuse', category, minHealth],
    queryFn: () => api<ReuseRow[]>(`/inventory/reuse?${new URLSearchParams({
      ...(category ? { category } : {}), ...(minHealth ? { min_health: minHealth } : {}) }).toString()}`),
  });
  return (
    <Panel title="Loose parts ready for reuse">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Category" htmlFor="inv-cat">
          <select id="inv-cat" value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}
          </select>
        </Field>
        <Field label="Minimum health" htmlFor="inv-min">
          <input id="inv-min" inputMode="numeric" value={minHealth} onChange={(e) => setMinHealth(e.target.value)} placeholder="e.g. 80" className={inputClass} />
        </Field>
      </div>
      {isPending ? <p className="text-ink-soft">Loading…</p> : (data ?? []).length === 0
        ? <p className="text-ink-soft">No loose parts match. Lower the minimum health or choose another category.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-ink-soft"><th className="py-1 font-medium">Model</th><th className="font-medium">Category</th><th className="text-right font-medium">Health</th><th className="font-medium">Last test</th><th /></tr></thead>
              <tbody>
                {(data ?? []).map((r) => (
                  <tr key={r.unit_id} className="border-t border-solder">
                    <td className="py-2">{r.model_number}</td><td>{r.category.toLowerCase()}</td>
                    <td className="text-right tabular-nums">{r.latest_health ?? '—'}</td><td>{r.test_type ?? 'Not tested'}</td>
                    <td className="text-right"><Button variant="quiet" onClick={() => navigate(`/unit/${r.passport_uid}`)}>Open</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </Panel>
  );
}
