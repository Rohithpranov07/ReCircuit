import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import type { Condition, EventResult, Me, ModelRow, UnitPassport } from '../../api/types';
import { AppShell } from '../../components/AppShell';
import { useToast } from '../../components/Toast';
import { Button, Field, Panel, Tabs, inputClass, occurredNow } from '../../components/ui';
import { FacilityField } from '../passport/FacilityField';
import { useMe, useModels, useOrganizations } from '../passport/shared';
import { useTransfers } from '../passport/queries';
import { UnitLookup } from '../passport/UnitLookup';

const TABS = ['Intake', 'Dismantle', 'Manifests'] as const;
type Tab = (typeof TABS)[number];

export default function CollectorPage() {
  const me = useMe();
  const [tab, setTab] = useState<Tab>('Intake');
  const [facility, setFacility] = useState<number | null>(null);
  const facilityId = facility ?? me.data?.facilities[0]?.facility_id ?? 0;
  return (
    <AppShell>
      <h1 className="h-page">Collector workspace</h1>
      {me.data && <div className="mt-3"><FacilityField me={me.data} value={facilityId} onChange={setFacility} /></div>}
      <div className="mt-5"><Tabs label="Collector tasks" tabs={TABS} active={tab} onChange={setTab} /></div>
      <div className="mt-6 space-y-6">
        {me.data && tab === 'Intake' && <Intake facilityId={facilityId} />}
        {me.data && tab === 'Dismantle' && <Dismantle facilityId={facilityId} />}
        {me.data && tab === 'Manifests' && <Manifests me={me.data} />}
      </div>
    </AppShell>
  );
}

function Intake({ facilityId }: { facilityId: number }) {
  const toast = useToast();
  const [unit, setUnit] = useState<UnitPassport | null>(null);
  const [unknownUid, setUnknownUid] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function collect() {
    if (!unit) return;
    await api<EventResult>(`/units/${unit.unit_id}/events`, { method: 'POST',
      body: { event_type: 'COLLECTED', occurred_at: occurredNow(), facility_id: facilityId } });
    setDone(`${unit.model.model_number} (${unit.serial_no}) is now recorded as collected.`);
    setUnit(null);
    toast.show('Collected');
  }

  return (
    <>
      <Panel title="Scan a device to collect it">
        <UnitLookup label="Passport" onFound={(p) => { setUnit(p); setUnknownUid(null); setDone(null); }}
                    onUnknown={(uid) => { setUnknownUid(uid); setUnit(null); }} />
        {unit && <Button className="mt-4" onClick={() => void collect()}>Mark as collected</Button>}
        {done && <p role="status" className="mt-4 text-obsidian">{done}</p>}
      </Panel>
      {unknownUid && <RegisterUnit facilityId={facilityId} onDone={(msg) => { setUnknownUid(null); setDone(msg); }} />}
    </>
  );
}

function RegisterUnit({ facilityId, onDone }: { facilityId: number; onDone: (message: string) => void }) {
  const models = useModels();
  const [modelId, setModelId] = useState('');
  const [serial, setSerial] = useState('');
  async function register() {
    const created = await api<{ unit_id: number }>('/units', { method: 'POST', body: { model_id: Number(modelId), serial_no: serial.trim() } });
    await api<EventResult>(`/units/${created.unit_id}/events`, { method: 'POST',
      body: { event_type: 'COLLECTED', occurred_at: occurredNow(), facility_id: facilityId } });
    onDone(`Registered ${serial.trim()} and recorded it as collected.`);
  }
  return (
    <Panel title="Register this unit">
      <p className="mb-3 text-sm text-ink-soft">This code is not in the system. Register the unit and it is collected in one step.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Model" htmlFor="reg-model">
          <select id="reg-model" value={modelId} onChange={(e) => setModelId(e.target.value)} className={inputClass}>
            <option value="">Choose a model</option>
            {(models.data ?? []).map((m: ModelRow) => <option key={m.model_id} value={m.model_id}>{m.manufacturer} · {m.model_number}</option>)}
          </select>
        </Field>
        <Field label="Serial number" htmlFor="reg-serial">
          <input id="reg-serial" value={serial} onChange={(e) => setSerial(e.target.value)} className={inputClass} />
        </Field>
      </div>
      <Button className="mt-4" disabled={!modelId || !serial.trim()} onClick={() => void register()}>Register and collect</Button>
    </Panel>
  );
}

interface PartRow { key: number; modelId: string; serial: string }

function Dismantle({ facilityId }: { facilityId: number }) {
  const toast = useToast();
  const models = useModels();
  const [device, setDevice] = useState<UnitPassport | null>(null);
  const [parts, setParts] = useState<PartRow[]>([{ key: 1, modelId: '', serial: '' }]);
  const [result, setResult] = useState<string | null>(null);

  const ready = device && parts.every((p) => p.modelId && p.serial.trim());
  const update = (key: number, patch: Partial<PartRow>) => setParts((all) => all.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  async function submit() {
    if (!device) return;
    const res = await api<{ parts: { unit_id: number; serial_no: string }[] }>(`/units/${device.unit_id}/dismantle`, {
      method: 'POST',
      body: { parts: parts.map((p) => ({ model_id: Number(p.modelId), serial_no: p.serial.trim() })), occurred_at: occurredNow(), facility_id: facilityId },
    });
    setResult(`${res.parts.length} part${res.parts.length === 1 ? '' : 's'} now have their own passports.`);
    toast.show('Device dismantled');
    setParts([{ key: Date.now(), modelId: '', serial: '' }]);
    setDevice(null);
  }

  return (
    <Panel title="Dismantle a device into its parts">
      <UnitLookup label="Device passport" onFound={(p) => { setDevice(p); setResult(null); }} />
      <div className="mt-5 space-y-3">
        {parts.map((p, i) => (
          <div key={p.key} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <select aria-label={`Part ${i + 1} model`} value={p.modelId} onChange={(e) => update(p.key, { modelId: e.target.value })} className={inputClass}>
              <option value="">Part model</option>
              {(models.data ?? []).map((m) => <option key={m.model_id} value={m.model_id}>{m.model_number} ({m.category.toLowerCase()})</option>)}
            </select>
            <input aria-label={`Part ${i + 1} serial`} placeholder="Serial number" value={p.serial} onChange={(e) => update(p.key, { serial: e.target.value })} className={inputClass} />
            <Button variant="quiet" disabled={parts.length === 1} onClick={() => setParts((all) => all.filter((x) => x.key !== p.key))}>Remove</Button>
          </div>
        ))}
        <Button variant="quiet" onClick={() => setParts((all) => [...all, { key: Date.now(), modelId: '', serial: '' }])}>Add a part</Button>
      </div>
      <Button className="mt-5" disabled={!ready} onClick={() => void submit()}>Dismantle device</Button>
      {result && <p role="status" className="mt-4 text-obsidian">{result}</p>}
    </Panel>
  );
}

interface ManifestItem { unit_id: number; label: string; condition: Condition }

function Manifests({ me }: { me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const orgs = useOrganizations();
  const transfers = useTransfers(true);
  const [to, setTo] = useState('');
  const [no, setNo] = useState(() => `MF-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${Math.floor(Math.random() * 900 + 100)}`);
  const [mass, setMass] = useState('');
  const [items, setItems] = useState<ManifestItem[]>([]);

  const add = (p: UnitPassport) => setItems((all) => (all.some((i) => i.unit_id === p.unit_id) ? all
    : [...all, { unit_id: p.unit_id, label: `${p.model.model_number} · ${p.serial_no}`, condition: 'WORKING' }]));

  async function create() {
    await api('/transfers', { method: 'POST', body: {
      manifest_no: no.trim(), to_org_id: Number(to), shipped_at: occurredNow(), total_mass_kg: Number(mass),
      items: items.map((i) => ({ unit_id: i.unit_id, declared_condition: i.condition })) } });
    toast.show(`Manifest ${no} created`);
    setItems([]);
    setMass('');
    setNo(`MF-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${Math.floor(Math.random() * 900 + 100)}`);
    await qc.invalidateQueries({ queryKey: ['transfers'] });
  }

  const open = (transfers.data ?? []).filter((t) => t.received_at === null && t.from_org_id === me.org_id);
  return (
    <>
      <Panel title="Open manifests">
        {open.length === 0 ? <p className="text-ink-soft">Nothing is waiting to be received.</p> : (
          <ul className="divide-y-[1.5px] divide-dotted divide-obsidian/40">
            {open.map((t) => (
              <li key={t.transfer_id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <Link to={`/manifest/${t.transfer_id}`} className=" text-obsidian underline decoration-ember decoration-2 underline-offset-4">{t.manifest_no}</Link>
                <span className="text-sm text-ink-soft">to {t.to_org} · {t.items.length} unit{t.items.length === 1 ? '' : 's'}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Create a manifest">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Send to" htmlFor="mf-to">
            <select id="mf-to" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass}>
              <option value="">Choose an organisation</option>
              {(orgs.data ?? []).filter((o) => o.org_id !== me.org_id).map((o) => <option key={o.org_id} value={o.org_id}>{o.org_name}</option>)}
            </select>
          </Field>
          <Field label="Manifest number" htmlFor="mf-no"><input id="mf-no" value={no} onChange={(e) => setNo(e.target.value)} className={inputClass} /></Field>
          <Field label="Total mass (kg)" htmlFor="mf-mass">
            <input id="mf-mass" inputMode="decimal" value={mass} onChange={(e) => setMass(e.target.value)} className={inputClass} />
          </Field>
        </div>
        <div className="mt-5"><UnitLookup label="Add a unit by scanning it" onFound={add} /></div>
        {items.length > 0 && (
          <ul className="mt-4 divide-y-[1.5px] divide-dotted divide-obsidian/40 rounded-[24px] bg-chalk">
            {items.map((i) => (
              <li key={i.unit_id} className="flex flex-wrap items-center justify-between gap-2 p-2">
                <span>{i.label}</span>
                <span className="flex items-center gap-2">
                  <select aria-label={`Condition of ${i.label}`} value={i.condition} className="rounded-full border-[1.5px] border-obsidian bg-white px-3 py-1"
                          onChange={(e) => setItems((all) => all.map((x) => (x.unit_id === i.unit_id ? { ...x, condition: e.target.value as Condition } : x)))}>
                    <option value="WORKING">Working</option><option value="FAULTY">Faulty</option><option value="SCRAP">Scrap</option>
                  </select>
                  <Button variant="quiet" onClick={() => setItems((all) => all.filter((x) => x.unit_id !== i.unit_id))}>Remove</Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <Button className="mt-5" disabled={!to || !no.trim() || !(Number(mass) > 0) || items.length === 0} onClick={() => void create()}>
          Create manifest
        </Button>
      </Panel>
    </>
  );
}
