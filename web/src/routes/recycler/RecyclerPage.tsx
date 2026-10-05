import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client';
import type { CertificateRow, Me, UnitStateRow } from '../../api/types';
import { AppShell } from '../../components/AppShell';
import { useToast } from '../../components/Toast';
import { Button, Panel, Tabs, inputClass, occurredNow } from '../../components/ui';
import { FacilityField } from '../passport/FacilityField';
import { useTransfers } from '../passport/queries';
import { useMe, useOrganizations } from '../passport/shared';
import { CertificateWizard } from './CertificateWizard';

const TABS = ['Incoming', 'Recycle queue', 'Certificates'] as const;
type Tab = (typeof TABS)[number];
const RECYCLABLE = new Set(['COLLECTED', 'HARVESTED', 'DIAGNOSED']);
const fmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

/** Units this organisation currently holds (the holder is derived by the database). */
export const useHeldUnits = (me: Me | undefined) =>
  useQuery({ queryKey: ['held', me?.org_id], enabled: !!me,
             queryFn: () => api<UnitStateRow[]>(`/reports/current-state?holder_org_id=${String(me?.org_id)}&limit=5000`) });

export default function RecyclerPage() {
  const me = useMe();
  const [tab, setTab] = useState<Tab>('Incoming');
  const [facility, setFacility] = useState<number | null>(null);
  const facilityId = facility ?? me.data?.facilities[0]?.facility_id ?? 0;
  return (
    <AppShell wide>
      <h1 className="text-2xl font-semibold tracking-tight">Recycler workspace</h1>
      {me.data && <div className="mt-3"><FacilityField me={me.data} value={facilityId} onChange={setFacility} /></div>}
      <div className="mt-5"><Tabs label="Recycler tasks" tabs={TABS} active={tab} onChange={setTab} /></div>
      <div className="mt-6 space-y-6">
        {me.data && tab === 'Incoming' && <Incoming me={me.data} />}
        {me.data && tab === 'Recycle queue' && <Queue me={me.data} facilityId={facilityId} />}
        {me.data && tab === 'Certificates' && <Certificates me={me.data} />}
      </div>
    </AppShell>
  );
}

function Incoming({ me }: { me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isPending } = useTransfers(true);
  const [missing, setMissing] = useState<Record<number, Set<number>>>({});
  const waiting = (data ?? []).filter((t) => t.received_at === null && t.to_org_id === me.org_id);

  function toggle(transfer: number, unit: number) {
    setMissing((all) => {
      const next = new Set(all[transfer] ?? []);
      if (next.has(unit)) next.delete(unit); else next.add(unit);
      return { ...all, [transfer]: next };
    });
  }
  async function receive(transfer: number, manifestNo: string) {
    await api(`/transfers/${transfer}/receive`, { method: 'POST',
      body: { received_at: occurredNow(), missing_unit_ids: [...(missing[transfer] ?? [])], extra_unit_ids: [] } });
    toast.show(`${manifestNo} received`);
    await Promise.all([qc.invalidateQueries({ queryKey: ['transfers'] }), qc.invalidateQueries({ queryKey: ['held'] })]);
  }

  return (
    <Panel title="Incoming manifests">
      {isPending ? <p className="text-ink-soft">Loading…</p> : waiting.length === 0
        ? <p className="text-ink-soft">No manifests are on their way to you.</p> : (
          <ul className="space-y-5">
            {waiting.map((t) => (
              <li key={t.transfer_id} className="rounded-md border border-solder bg-white p-4">
                <p className="font-medium">{t.manifest_no} <span className="font-normal text-ink-soft">from {t.from_org} · shipped {fmt.format(new Date(t.shipped_at))}</span></p>
                <fieldset className="mt-3">
                  <legend className="text-sm text-ink-soft">Tick any unit that did not arrive</legend>
                  <ul className="mt-2 space-y-1">
                    {t.items.map((i) => (
                      <li key={i.unit_id}>
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={missing[t.transfer_id]?.has(i.unit_id) ?? false} onChange={() => toggle(t.transfer_id, i.unit_id)} />
                          <span>{i.model_number} · {i.serial_no}</span>
                          <span className="text-sm text-ink-soft">declared {i.declared_condition.toLowerCase()}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
                <Button className="mt-4" onClick={() => void receive(t.transfer_id, t.manifest_no)}>
                  Confirm receipt{(missing[t.transfer_id]?.size ?? 0) > 0 ? ` (${missing[t.transfer_id]?.size ?? 0} missing)` : ''}
                </Button>
              </li>
            ))}
          </ul>
        )}
    </Panel>
  );
}

function Queue({ me, facilityId }: { me: Me; facilityId: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const held = useHeldUnits(me);
  const queue = (held.data ?? []).filter((u) => u.current_state !== null && RECYCLABLE.has(u.current_state));

  async function recycle(u: UnitStateRow) {
    await api(`/units/${u.unit_id}/events`, { method: 'POST', body: { event_type: 'RECYCLED', occurred_at: occurredNow(), facility_id: facilityId } });
    toast.show(`${u.model_number} recycled`);
    await qc.invalidateQueries({ queryKey: ['held'] });
  }

  return (
    <Panel title="Waiting to be recycled">
      {held.isPending ? <p className="text-ink-soft">Loading…</p> : queue.length === 0
        ? <p className="text-ink-soft">Nothing is waiting. Units appear here once a manifest to you has been received.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-ink-soft"><th className="py-1 font-medium">Model</th><th className="font-medium">Serial</th><th className="font-medium">State</th><th /></tr></thead>
            <tbody>
              {queue.map((u) => (
                <tr key={u.unit_id} className="border-t border-solder">
                  <td className="py-2">{u.model_number}</td><td>{u.serial_no}</td><td>{u.current_state?.toLowerCase()}</td>
                  <td className="text-right"><Button variant="quiet" onClick={() => void recycle(u)}>Mark recycled</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </Panel>
  );
}

function Certificates({ me }: { me: Me }) {
  const [wizard, setWizard] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const certs = useQuery({ queryKey: ['certificates', 'mine'], queryFn: () => api<CertificateRow[]>('/certificates') });
  const orgs = useOrganizations();
  const producers = (orgs.data ?? []).filter((o) => o.org_type === 'PRODUCER');
  const [pick, setPick] = useState<Record<number, string>>({});

  async function allocate(c: CertificateRow) {
    await api(`/certificates/${c.cert_id}/allocate`, { method: 'POST', body: { producer_id: Number(pick[c.cert_id]) } });
    toast.show(`${c.cert_no} allocated`);
    await qc.invalidateQueries({ queryKey: ['certificates'] });
  }

  return (
    <>
      <Panel title="Your certificates">
        <Button className="mb-4" onClick={() => setWizard((w) => !w)}>{wizard ? 'Close the wizard' : 'Issue a certificate'}</Button>
        {certs.isPending ? <p className="text-ink-soft">Loading…</p> : (certs.data ?? []).length === 0
          ? <p className="text-ink-soft">No certificates yet.</p> : (
            <ul className="divide-y divide-solder">
              {(certs.data ?? []).map((c) => (
                <li key={c.cert_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium">{c.cert_no}</p>
                    <p className="text-sm text-ink-soft">{c.category} · {c.financial_year} · {c.claimed_kg} kg claimed, {c.backed_kg} kg backed by {c.unit_count} units</p>
                  </div>
                  {c.producer ? <span className="text-sm">Allocated to {c.producer}</span> : (
                    <span className="flex items-center gap-2">
                      <select aria-label={`Producer for ${c.cert_no}`} className={`${inputClass} w-56`} value={pick[c.cert_id] ?? ''}
                              onChange={(e) => setPick((all) => ({ ...all, [c.cert_id]: e.target.value }))}>
                        <option value="">Allocate to…</option>
                        {producers.map((p) => <option key={p.org_id} value={p.org_id}>{p.org_name}</option>)}
                      </select>
                      <Button variant="quiet" disabled={!pick[c.cert_id]} onClick={() => void allocate(c)}>Allocate</Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
      </Panel>
      {wizard && <CertificateWizard me={me} onDone={() => { setWizard(false); void qc.invalidateQueries({ queryKey: ['certificates'] }); }} />}
    </>
  );
}
