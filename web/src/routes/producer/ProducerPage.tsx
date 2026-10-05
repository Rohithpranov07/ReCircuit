import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import type { CertificateRow, ComplianceRow } from '../../api/types';
import { AppShell } from '../../components/AppShell';
import { useToast } from '../../components/Toast';
import { Button, Field, Panel, inputClass } from '../../components/ui';
import { PassportFinder } from '../passport/PassportFinder';
import { useMe, useModels } from '../passport/shared';

/** S5: catalogue, certificates held, and compliance against target. */
export default function ProducerPage() {
  const me = useMe();
  const models = useModels();
  const certs = useQuery({ queryKey: ['certificates', 'held'], queryFn: () => api<CertificateRow[]>('/certificates') });
  const orgId = me.data?.org_id;
  const compliance = useQuery({ queryKey: ['compliance', orgId], enabled: orgId !== undefined,
                                queryFn: () => api<ComplianceRow[]>(`/compliance/${String(orgId)}`) });
  const mine = (models.data ?? []).filter((m) => m.manufacturer_id === orgId);

  return (
    <AppShell wide>
      <h1 className="text-2xl font-semibold tracking-tight">Producer workspace</h1>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Compliance against target">
          {compliance.isPending ? <p className="text-ink-soft">Loading…</p> : (compliance.data ?? []).length === 0
            ? <p className="text-ink-soft">No targets are set yet. Add one below.</p> : (
              <ul className="space-y-4">
                {(compliance.data ?? []).map((c) => (
                  <li key={`${c.category}-${c.financial_year}`}>
                    <div className="flex justify-between text-sm"><span className="font-medium">{c.category} · {c.financial_year}</span>
                      <span className="tabular-nums">{c.acquired_kg} of {c.target_kg} kg</span></div>
                    <div className="mt-1 h-2 rounded-full bg-bench" role="img" aria-label={`${c.pct_of_target}% of target`}>
                      <div className="h-2 rounded-full bg-trace" style={{ width: `${Math.min(100, Number(c.pct_of_target))}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          {orgId !== undefined && <TargetForm orgId={orgId} />}
        </Panel>
        <Panel title="Certificates held">
          {certs.isPending ? <p className="text-ink-soft">Loading…</p> : (certs.data ?? []).length === 0
            ? <p className="text-ink-soft">No recycler has allocated a certificate to you yet.</p> : (
              <ul className="divide-y divide-solder">
                {(certs.data ?? []).map((c) => (
                  <li key={c.cert_id} className="py-2">
                    <p className="font-medium">{c.cert_no}</p>
                    <p className="text-sm text-ink-soft">{c.recycler} · {c.category} · {c.financial_year} · {c.claimed_kg} kg</p>
                  </li>
                ))}
              </ul>
            )}
        </Panel>
        <Panel title="Catalogue">
          <p className="text-ink-soft">{mine.length} model{mine.length === 1 ? '' : 's'} registered.</p>
          <Link to="/catalogue" className="mt-3 inline-block rounded-md bg-trace px-4 py-2 font-medium text-white hover:bg-trace-deep">Open the catalogue</Link>
        </Panel>
        <PassportFinder />
      </div>
    </AppShell>
  );
}

function TargetForm({ orgId }: { orgId: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [category, setCategory] = useState('ITEW2');
  const [fy, setFy] = useState('2026-27');
  const [kg, setKg] = useState('');
  async function save() {
    await api(`/compliance/${orgId}`, { method: 'PUT', body: { category: category.trim(), financial_year: fy, target_kg: Number(kg) } });
    toast.show('Target saved');
    setKg('');
    await qc.invalidateQueries({ queryKey: ['compliance'] });
  }
  return (
    <div className="mt-6 border-t border-solder pt-4">
      <h3 className="text-sm font-semibold">Set a target</h3>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        <Field label="Category" htmlFor="tg-cat"><input id="tg-cat" value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass} /></Field>
        <Field label="Financial year" htmlFor="tg-fy"><input id="tg-fy" value={fy} onChange={(e) => setFy(e.target.value)} className={inputClass} /></Field>
        <Field label="Target (kg)" htmlFor="tg-kg"><input id="tg-kg" inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} className={inputClass} /></Field>
      </div>
      <Button className="mt-3" disabled={!(Number(kg) > 0) || !/^[0-9]{4}-[0-9]{2}$/.test(fy)} onClick={() => void save()}>Save target</Button>
    </div>
  );
}
