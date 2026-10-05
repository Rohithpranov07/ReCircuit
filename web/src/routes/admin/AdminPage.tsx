import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client';
import type { ActorRow, AdminOrgRow, Dashboard, OrgType, Role } from '../../api/types';
import { ROLE_LABELS } from '../../auth/roles';
import { AppShell } from '../../components/AppShell';
import { useToast } from '../../components/Toast';
import { Button, Field, Panel, Stat, Tabs, inputClass } from '../../components/ui';

const TABS = ['Overview', 'Organisations', 'Users'] as const;
type Tab = (typeof TABS)[number];
const ORG_TYPES: OrgType[] = ['PRODUCER', 'COLLECTOR', 'DISMANTLER', 'REFURBISHER', 'RECYCLER'];
const ROLES = Object.keys(ROLE_LABELS) as Role[];

/** S13: organisations, facilities, users and roles. */
export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('Overview');
  return (
    <AppShell wide>
      <h1 className="h-page">Administration</h1>
      <div className="mt-5"><Tabs label="Administration" tabs={TABS} active={tab} onChange={setTab} /></div>
      <div className="mt-6 space-y-6">{tab === 'Overview' ? <Overview /> : tab === 'Organisations' ? <Organisations /> : <Users />}</div>
    </AppShell>
  );
}

function Overview() {
  const { data, isPending } = useQuery({ queryKey: ['admin', 'dashboard'], queryFn: () => api<Dashboard>('/admin/dashboard') });
  if (isPending || !data) return <p className="text-ink-soft">Loading…</p>;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Units by state">
        <table className="w-full text-sm">
          <tbody>
            {data.units_by_state.map((s) => (
              <tr key={s.state} className="border-t-[1.5px] border-dotted border-obsidian/40 first:border-0">
                <td className="py-1.5">{s.state.toLowerCase()}</td><td className="text-right tabular-nums">{s.units.toLocaleString('en-IN')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <div className="space-y-6">
        <Stat label="Manifests not yet received" value={data.open_manifests} />
        <Stat label={`Certificates issued in ${data.financial_year}`} value={data.certificates_this_year} />
      </div>
    </div>
  );
}

function Organisations() {
  const qc = useQueryClient();
  const toast = useToast();
  const orgs = useQuery({ queryKey: ['admin', 'orgs'], queryFn: () => api<AdminOrgRow[]>('/organizations') });
  const [name, setName] = useState('');
  const [type, setType] = useState<OrgType>('COLLECTOR');
  const [cpcb, setCpcb] = useState('');
  const [gstin, setGstin] = useState('');
  const [fac, setFac] = useState<Record<number, { name: string; pin: string }>>({});

  async function createOrg() {
    await api('/organizations', { method: 'POST', body: { org_name: name.trim(), org_type: type, cpcb_reg_no: cpcb.trim() || null, gstin: gstin.trim() || null } });
    toast.show(`${name.trim()} created`);
    setName(''); setCpcb(''); setGstin('');
    await qc.invalidateQueries({ queryKey: ['admin'] });
  }
  async function addFacility(orgId: number) {
    const f = fac[orgId];
    if (!f) return;
    await api(`/organizations/${orgId}/facilities`, { method: 'POST', body: { facility_name: f.name.trim(), pincode: f.pin.trim() } });
    toast.show('Facility added');
    setFac((all) => ({ ...all, [orgId]: { name: '', pin: '' } }));
    await qc.invalidateQueries({ queryKey: ['admin'] });
  }

  return (
    <>
      <Panel title="Add an organisation">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Name" htmlFor="o-name"><input id="o-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} /></Field>
          <Field label="Type" htmlFor="o-type">
            <select id="o-type" value={type} onChange={(e) => setType(e.target.value as OrgType)} className={inputClass}>{ORG_TYPES.map((t) => <option key={t} value={t}>{t.toLowerCase()}</option>)}</select>
          </Field>
          <Field label="CPCB registration" htmlFor="o-cpcb"><input id="o-cpcb" value={cpcb} onChange={(e) => setCpcb(e.target.value)} className={inputClass} /></Field>
          <Field label="GSTIN (15 characters)" htmlFor="o-gst"><input id="o-gst" value={gstin} onChange={(e) => setGstin(e.target.value)} className={inputClass} /></Field>
        </div>
        <Button className="mt-4" disabled={!name.trim()} onClick={() => void createOrg()}>Add organisation</Button>
      </Panel>
      <Panel title="Organisations and facilities">
        {orgs.isPending ? <p className="text-ink-soft">Loading…</p> : (
          <ul className="divide-y-[1.5px] divide-dotted divide-obsidian/40">
            {(orgs.data ?? []).map((o) => (
              <li key={o.org_id} className="py-3">
                <p className="">{o.org_name} <span className="text-sm font-normal text-ink-soft">{o.org_type.toLowerCase()}</span></p>
                <ul className="mt-1 text-sm text-ink-soft">{o.facilities.map((f) => <li key={f.facility_id}>{f.facility_name} · {f.pincode}</li>)}</ul>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input aria-label={`New facility name for ${o.org_name}`} placeholder="Facility name" value={fac[o.org_id]?.name ?? ''} className={`${inputClass} w-56`}
                         onChange={(e) => setFac((all) => ({ ...all, [o.org_id]: { name: e.target.value, pin: all[o.org_id]?.pin ?? '' } }))} />
                  <input aria-label={`Pincode for ${o.org_name}`} placeholder="Pincode" value={fac[o.org_id]?.pin ?? ''} className={`${inputClass} w-32`}
                         onChange={(e) => setFac((all) => ({ ...all, [o.org_id]: { name: all[o.org_id]?.name ?? '', pin: e.target.value } }))} />
                  <Button variant="quiet" disabled={!fac[o.org_id]?.name.trim() || !/^[1-9][0-9]{5}$/.test(fac[o.org_id]?.pin ?? '')} onClick={() => void addFacility(o.org_id)}>Add facility</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function Users() {
  const qc = useQueryClient();
  const toast = useToast();
  const actors = useQuery({ queryKey: ['admin', 'actors'], queryFn: () => api<ActorRow[]>('/actors') });
  const orgs = useQuery({ queryKey: ['admin', 'orgs'], queryFn: () => api<AdminOrgRow[]>('/organizations') });
  const facilities = (orgs.data ?? []).flatMap((o) => o.facilities.map((f) => ({ ...f, org: o.org_name })));
  const [facility, setFacility] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<Role>('COLLECTOR');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function create() {
    await api('/actors', { method: 'POST', body: { facility_id: Number(facility), full_name: fullName.trim(), role, email: email.trim(), password } });
    toast.show(`${fullName.trim()} can now sign in`);
    setFullName(''); setEmail(''); setPassword('');
    await qc.invalidateQueries({ queryKey: ['admin'] });
  }
  async function setActive(a: ActorRow, active: boolean) {
    await api(`/actors/${a.actor_id}`, { method: 'PATCH', body: { is_active: active } });
    toast.show(`${a.full_name} ${active ? 'reactivated' : 'deactivated'}`);
    await qc.invalidateQueries({ queryKey: ['admin', 'actors'] });
  }

  return (
    <>
      <Panel title="Add a user">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Facility" htmlFor="u-fac">
            <select id="u-fac" value={facility} onChange={(e) => setFacility(e.target.value)} className={inputClass}>
              <option value="">Choose a facility</option>
              {facilities.map((f) => <option key={f.facility_id} value={f.facility_id}>{f.org} · {f.facility_name}</option>)}
            </select>
          </Field>
          <Field label="Full name" htmlFor="u-name"><input id="u-name" value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} /></Field>
          <Field label="Role" htmlFor="u-role">
            <select id="u-role" value={role} onChange={(e) => setRole(e.target.value as Role)} className={inputClass}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select>
          </Field>
          <Field label="Email" htmlFor="u-email"><input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} /></Field>
          <Field label="Password" htmlFor="u-pw" hint="At least 10 characters"><input id="u-pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} /></Field>
        </div>
        <Button className="mt-4" disabled={!facility || !fullName.trim() || !email.trim() || password.length < 10} onClick={() => void create()}>Add user</Button>
      </Panel>
      <Panel title="Users">
        {actors.isPending ? <p className="text-ink-soft">Loading…</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-ink-soft"><th className="py-1 ">Name</th><th className="">Role</th><th className="">Email</th><th className="">Facility</th><th /></tr></thead>
              <tbody>
                {(actors.data ?? []).map((a) => (
                  <tr key={a.actor_id} className={`border-t-[1.5px] border-dotted border-obsidian/40 ${a.is_active ? '' : 'text-ink-soft'}`}>
                    <td className="py-2">{a.full_name}</td><td>{ROLE_LABELS[a.role]}</td><td>{a.email}</td><td>{a.facility_name}</td>
                    <td className="text-right"><Button variant="quiet" onClick={() => void setActive(a, !a.is_active)}>{a.is_active ? 'Deactivate' : 'Reactivate'}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
