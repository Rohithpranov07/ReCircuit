import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client';
import type { ReportRow, Role } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { Button, Field, Panel, inputClass } from '../../components/ui';

interface Param { key: string; label: string; kind: 'number' | 'text' | 'datetime' | 'flag'; required?: boolean }
interface ReportDef { name: string; title: string; about: string; roles: Role[]; params: Param[] }

const STAFF: Role[] = ['PRODUCER', 'COLLECTOR', 'TECHNICIAN', 'RECYCLER_OPERATOR', 'AUDITOR', 'ADMIN'];
const REPORTS: ReportDef[] = [
  { name: 'passport', title: 'Unit passport (Q1)', about: 'Everything known about one unit.', roles: STAFF, params: [{ key: 'unit_id', label: 'Unit id', kind: 'number', required: true }] },
  { name: 'part-tree', title: 'Part tree on a date (Q2)', about: 'What was inside a device at a given moment.', roles: STAFF,
    params: [{ key: 'root', label: 'Device unit id', kind: 'number', required: true }, { key: 'as_of', label: 'As of', kind: 'datetime' }] },
  { name: 'current-state', title: 'Current state and holder (Q3)', about: 'Latest state of every unit.', roles: STAFF,
    params: [{ key: 'state', label: 'State, for example HARVESTED', kind: 'text' }, { key: 'limit', label: 'Row limit', kind: 'number' }] },
  { name: 'reuse-inventory', title: 'Reuse inventory (Q4)', about: 'Loose parts with their latest health.', roles: ['TECHNICIAN', 'AUDITOR', 'ADMIN'],
    params: [{ key: 'category', label: 'Category, for example BATTERY', kind: 'text' }, { key: 'min_health', label: 'Minimum health', kind: 'number' }] },
  { name: 'material-recovery', title: 'Material recovered (Q5)', about: 'Nominal material content of recycled units, per recycler and quarter.', roles: ['AUDITOR', 'ADMIN'], params: [] },
  { name: 'certificate-backing', title: 'Certificate backing (Q6)', about: 'Claimed against backed kilograms.', roles: ['PRODUCER', 'RECYCLER_OPERATOR', 'AUDITOR', 'ADMIN'],
    params: [{ key: 'shortfall', label: 'Only certificates with a shortfall', kind: 'flag' }] },
  { name: 'custody-gaps', title: 'Custody gaps (Q7)', about: 'Units with events at an organisation that never received them.', roles: ['AUDITOR', 'ADMIN'], params: [] },
  { name: 'tamper-check', title: 'Tamper check (Q8)', about: 'Units whose history no longer matches its hash chain.', roles: ['AUDITOR', 'ADMIN'], params: [] },
];

const show = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function queryString(def: ReportDef, values: Record<string, string>, format?: 'csv'): string {
  const q = new URLSearchParams();
  for (const p of def.params) {
    const v = values[p.key];
    if (!v) continue;
    q.set(p.key, p.kind === 'datetime' ? new Date(v).toISOString() : v);
  }
  if (format) q.set('format', format);
  return q.toString();
}

/** S12: Q1 to Q8 with filters and CSV download. */
export default function ReportsPage() {
  const { session } = useAuth();
  const available = REPORTS.filter((r) => session && r.roles.includes(session.role));
  const [name, setName] = useState(available[0]?.name ?? '');
  const def = available.find((r) => r.name === name) ?? available[0];
  const [values, setValues] = useState<Record<string, string>>({});
  const [run, setRun] = useState<string | null>(null);

  const result = useQuery({ queryKey: ['report', run], enabled: run !== null,
                            queryFn: () => api<ReportRow[]>(`/reports/${run ?? ''}`) });
  const ready = def ? def.params.every((p) => !p.required || values[p.key]) : false;

  function start() {
    if (!def) return;
    setRun(`${def.name}?${queryString(def, values)}`);
  }
  async function download() {
    if (!def) return;
    const blob = await api<Blob>(`/reports/${def.name}?${queryString(def, values, 'csv')}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${def.name}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const rows = result.data ?? [];
  const columns = rows[0] ? Object.keys(rows[0]) : [];

  return (
    <AppShell wide>
      <h1 className="h-page">Reports</h1>
      <div className="mt-6 grid gap-6 lg:grid-cols-[18rem_1fr]">
        <nav aria-label="Reports" className="space-y-1">
          {available.map((r) => (
            <button key={r.name} type="button" onClick={() => { setName(r.name); setValues({}); setRun(null); }}
                    className={`block w-full rounded-full px-5 py-2.5 text-left ${r.name === def?.name ? 'bg-ember text-obsidian' : 'hover:bg-tray'}`}>{r.title}</button>
          ))}
        </nav>
        {def && (
          <div className="min-w-0 space-y-4">
            <Panel title={def.title}>
              <p className="text-ink-soft">{def.about}</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {def.params.map((p) => (
                  <Field key={p.key} label={p.label} htmlFor={`rp-${p.key}`}>
                    {p.kind === 'flag'
                      ? <input id={`rp-${p.key}`} type="checkbox" checked={values[p.key] === 'true'} onChange={(e) => setValues((all) => ({ ...all, [p.key]: e.target.checked ? 'true' : '' }))} />
                      : <input id={`rp-${p.key}`} type={p.kind === 'datetime' ? 'datetime-local' : p.kind === 'number' ? 'number' : 'text'} value={values[p.key] ?? ''}
                               onChange={(e) => setValues((all) => ({ ...all, [p.key]: e.target.value }))} className={inputClass} />}
                  </Field>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <Button disabled={!ready} onClick={start}>Run report</Button>
                <Button variant="quiet" disabled={!ready} onClick={() => void download()}>Download CSV</Button>
              </div>
            </Panel>
            {run && (
              <Panel>
                {result.isPending ? <p className="text-ink-soft">Running…</p> : rows.length === 0
                  ? <p className="text-ink-soft">This report returned no rows.</p> : (
                    <div className="overflow-x-auto">
                      <p className="mb-2 text-sm text-ink-soft">{rows.length} row{rows.length === 1 ? '' : 's'}</p>
                      <table className="w-full text-sm">
                        <thead><tr className="text-left text-ink-soft">{columns.map((c) => <th key={c} className="whitespace-nowrap py-1 pr-4 ">{c}</th>)}</tr></thead>
                        <tbody>
                          {rows.slice(0, 500).map((r, i) => (
                            <tr key={i} className="border-t-[1.5px] border-dotted border-obsidian/40">{columns.map((c) => <td key={c} className="py-1.5 pr-4 align-top">{show(r[c])}</td>)}</tr>
                          ))}
                        </tbody>
                      </table>
                      {rows.length > 500 && <p className="mt-2 text-sm text-ink-soft">Showing the first 500 rows. Download the CSV for all of them.</p>}
                    </div>
                  )}
              </Panel>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
