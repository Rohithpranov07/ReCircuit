import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client';
import type { AuditLogRow, ReportRow, VerifyAll, VerifyOne } from '../../api/types';
import { AppShell } from '../../components/AppShell';
import { Button, Field, Panel, Tabs, inputClass } from '../../components/ui';

const TABS = ['Tamper check', 'Certificate backing', 'Custody gaps', 'Audit log'] as const;
type Tab = (typeof TABS)[number];
const fmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

/** S6: the checks an auditor runs without trusting the people who entered the data. */
export default function AuditorPage() {
  const [tab, setTab] = useState<Tab>('Tamper check');
  return (
    <AppShell wide>
      <h1 className="h-page">Auditor console</h1>
      <div className="mt-5"><Tabs label="Audit checks" tabs={TABS} active={tab} onChange={setTab} /></div>
      <div className="mt-6">
        {tab === 'Tamper check' && <Tamper />}
        {tab === 'Certificate backing' && <Backing />}
        {tab === 'Custody gaps' && <Gaps />}
        {tab === 'Audit log' && <Log />}
      </div>
    </AppShell>
  );
}

function Tamper() {
  const [unit, setUnit] = useState('');
  const [one, setOne] = useState<VerifyOne | null>(null);
  const [all, setAll] = useState<VerifyAll | null>(null);
  const [busy, setBusy] = useState(false);

  async function checkOne() {
    setAll(null);
    setOne(await api<VerifyOne>(`/audit/verify?unit=${unit}`));
  }
  async function checkAll() {
    setOne(null);
    setBusy(true);
    try { setAll(await api<VerifyAll>('/audit/verify')); } finally { setBusy(false); }
  }
  return (
    <Panel title="Check that history has not been edited">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Unit id" htmlFor="tc-unit"><input id="tc-unit" inputMode="numeric" value={unit} onChange={(e) => setUnit(e.target.value)} className={`${inputClass} w-40`} /></Field>
        <Button disabled={!unit} onClick={() => void checkOne()}>Check this unit</Button>
        <Button variant="quiet" disabled={busy} onClick={() => void checkAll()}>{busy ? 'Checking every unit…' : 'Check every unit'}</Button>
      </div>
      {one && (
        <p role="status" className={`mt-5 rounded-[24px] p-5 ${one.verified ? 'bg-sulfur text-obsidian' : 'bg-obsidian text-chalk'}`}>
          {one.verified ? `Unit ${one.unit_id}: every event matches its hash.` : `Unit ${one.unit_id}: the history was changed. The first broken link is event ${String(one.first_broken_event_id)}.`}
        </p>
      )}
      {all && (
        <div role="status" className={`mt-5 rounded-[24px] p-5 ${all.verified ? 'bg-sulfur text-obsidian' : 'bg-obsidian text-chalk'}`}>
          <p>{all.verified ? `All ${all.checked} units verify.` : `${all.broken.length} of ${all.checked} units fail the check.`}</p>
          {all.broken.length > 0 && (
            <ul className="mt-2 text-sm">{all.broken.map((b) => <li key={b.unit_id}>Unit {b.unit_id}: first broken link is event {b.first_broken_event_id}</li>)}</ul>
          )}
        </div>
      )}
    </Panel>
  );
}

function Table({ rows, empty }: { rows: ReportRow[]; empty: string }) {
  if (rows.length === 0) return <p className="text-ink-soft">{empty}</p>;
  const columns = Object.keys(rows[0] ?? {});
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-ink-soft">{columns.map((c) => <th key={c} className="whitespace-nowrap py-1 pr-4 ">{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t-[1.5px] border-dotted border-obsidian/40">{columns.map((c) => <td key={c} className="py-1.5 pr-4">{String(r[c] ?? '')}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Backing() {
  const { data, isPending } = useQuery({ queryKey: ['audit', 'backing'], queryFn: () => api<ReportRow[]>('/reports/certificate-backing') });
  const short = (data ?? []).filter((r) => Number(r.backed_kg) < Number(r.claimed_kg));
  return (
    <Panel title="Certificate backing">
      {isPending ? <p className="text-ink-soft">Loading…</p> : (
        <>
          <p className={`mb-3  ${short.length ? 'text-fault' : 'text-obsidian'}`}>
            {short.length ? `${short.length} certificate${short.length === 1 ? '' : 's'} claim more than their units back.` : 'Every certificate is backed by at least the weight it claims.'}
          </p>
          <Table rows={data ?? []} empty="No certificates have been issued." />
        </>
      )}
    </Panel>
  );
}

function Gaps() {
  const { data, isPending } = useQuery({ queryKey: ['audit', 'gaps'], queryFn: () => api<ReportRow[]>('/reports/custody-gaps') });
  return (
    <Panel title="Units without a manifest">
      {isPending ? <p className="text-ink-soft">Looking for gaps…</p> : <Table rows={data ?? []} empty="No custody gaps: every unit that changed hands has a received manifest." />}
    </Panel>
  );
}

function Log() {
  const { data, isPending } = useQuery({ queryKey: ['audit', 'log'], queryFn: () => api<AuditLogRow[]>('/audit/log?limit=200') });
  return (
    <Panel title="Sensitive actions">
      {isPending ? <p className="text-ink-soft">Loading…</p> : (data ?? []).length === 0 ? <p className="text-ink-soft">Nothing has been logged yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-ink-soft"><th className="py-1 ">When</th><th className="">Who</th><th className="">Action</th><th className="">Record</th></tr></thead>
            <tbody>
              {(data ?? []).map((l) => (
                <tr key={l.log_id} className="border-t-[1.5px] border-dotted border-obsidian/40">
                  <td className="py-1.5 pr-4 whitespace-nowrap">{fmt.format(new Date(l.logged_at))}</td><td className="pr-4">{l.actor_name}</td>
                  <td className="pr-4">{l.action}</td><td>{l.entity} {l.entity_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
