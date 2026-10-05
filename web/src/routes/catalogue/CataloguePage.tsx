import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client';
import type { Category, MaterialRow, ModelRow } from '../../api/types';
import { AppShell } from '../../components/AppShell';
import { useToast } from '../../components/Toast';
import { Button, Field, Panel, inputClass } from '../../components/ui';
import { useMe, useModels } from '../passport/shared';
import { NUMERIC_KEYS, SPEC_KEYS } from './specKeys';

const CATEGORIES = Object.keys(SPEC_KEYS) as Category[];

/** S11: register models and set their material composition. */
export default function CataloguePage() {
  const me = useMe();
  const models = useModels();
  const mine = (models.data ?? []).filter((m) => m.manufacturer_id === me.data?.org_id);
  return (
    <AppShell wide>
      <h1 className="h-page">Catalogue</h1>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ModelForm />
        <MaterialsEditor models={mine} />
      </div>
      <div className="mt-6">
        <Panel title="Your models">
          {mine.length === 0 ? <p className="text-ink-soft">You have not registered any models yet.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-ink-soft"><th className="py-1 ">Model</th><th className="">Category</th><th className="text-right ">Mass (g)</th><th className="">Specification</th></tr></thead>
              <tbody>
                {mine.map((m) => (
                  <tr key={m.model_id} className="border-t-[1.5px] border-dotted border-obsidian/40 align-top">
                    <td className="py-2">{m.model_number}</td><td>{m.category.toLowerCase()}</td><td className="text-right tabular-nums">{m.mass_g}</td>
                    <td className="text-ink-soft">{Object.entries(m.spec).map(([k, v]) => `${k}: ${String(v)}`).join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}

function ModelForm() {
  const qc = useQueryClient();
  const toast = useToast();
  const [number, setNumber] = useState('');
  const [category, setCategory] = useState<Category>('DEVICE');
  const [mass, setMass] = useState('');
  const [spec, setSpec] = useState<Record<string, string>>({});

  async function save() {
    const body: Record<string, unknown> = {};
    for (const key of SPEC_KEYS[category]) {
      const raw = (spec[key] ?? '').trim();
      if (raw !== '') body[key] = NUMERIC_KEYS.has(key) ? Number(raw) : raw;
    }
    await api('/models', { method: 'POST', body: { model_number: number.trim(), category, mass_g: Number(mass), spec: body } });
    toast.show(`${number.trim()} registered`);
    setNumber(''); setMass(''); setSpec({});
    await qc.invalidateQueries({ queryKey: ['models'] });
  }

  return (
    <Panel title="Register a model">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Model number" htmlFor="m-no"><input id="m-no" value={number} onChange={(e) => setNumber(e.target.value)} className={inputClass} /></Field>
        <Field label="Category" htmlFor="m-cat">
          <select id="m-cat" value={category} onChange={(e) => { setCategory(e.target.value as Category); setSpec({}); }} className={inputClass}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}
          </select>
        </Field>
        <Field label="Mass (g)" htmlFor="m-mass"><input id="m-mass" inputMode="decimal" value={mass} onChange={(e) => setMass(e.target.value)} className={inputClass} /></Field>
      </div>
      {SPEC_KEYS[category].length > 0 && (
        <fieldset className="mt-4">
          <legend className="text-sm ">Specification</legend>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {SPEC_KEYS[category].map((k) => (
              <Field key={k} label={k} htmlFor={`spec-${k}`}>
                <input id={`spec-${k}`} inputMode={NUMERIC_KEYS.has(k) ? 'decimal' : 'text'} value={spec[k] ?? ''} onChange={(e) => setSpec((all) => ({ ...all, [k]: e.target.value }))} className={inputClass} />
              </Field>
            ))}
          </div>
        </fieldset>
      )}
      <Button className="mt-5" disabled={!number.trim() || !(Number(mass) > 0)} onClick={() => void save()}>Register model</Button>
    </Panel>
  );
}

function MaterialsEditor({ models }: { models: ModelRow[] }) {
  const toast = useToast();
  const materials = useQuery({ queryKey: ['materials'], queryFn: () => api<MaterialRow[]>('/materials') });
  const [model, setModel] = useState('');
  const [masses, setMasses] = useState<Record<number, string>>({});

  async function save() {
    const lines = Object.entries(masses).filter(([, v]) => Number(v) > 0).map(([id, v]) => ({ material_id: Number(id), mass_mg: Number(v) }));
    await api(`/models/${model}/materials`, { method: 'PUT', body: lines });
    toast.show('Composition saved');
  }

  return (
    <Panel title="Material composition">
      <Field label="Model" htmlFor="mat-model" hint="Saving replaces the model’s whole composition.">
        <select id="mat-model" value={model} onChange={(e) => { setModel(e.target.value); setMasses({}); }} className={inputClass}>
          <option value="">Choose one of your models</option>
          {models.map((m) => <option key={m.model_id} value={m.model_id}>{m.model_number}</option>)}
        </select>
      </Field>
      {model && (
        <table className="mt-4 w-full text-sm">
          <thead><tr className="text-left text-ink-soft"><th className="py-1 ">Material</th><th className="text-right ">Mass (mg)</th></tr></thead>
          <tbody>
            {(materials.data ?? []).map((m) => (
              <tr key={m.material_id} className="border-t-[1.5px] border-dotted border-obsidian/40">
                <td className="py-1.5">{m.material_name}{m.is_critical && <span className="ml-2 text-xs text-ink-soft">critical</span>}{m.is_hazardous && <span className="ml-2 text-xs text-fault">hazardous</span>}</td>
                <td className="text-right"><input aria-label={`${m.material_name} mass in mg`} inputMode="decimal" value={masses[m.material_id] ?? ''}
                  onChange={(e) => setMasses((all) => ({ ...all, [m.material_id]: e.target.value }))} className="w-28 rounded-full border-[1.5px] border-obsidian bg-white px-3 py-1 text-right" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Button className="mt-4" disabled={!model} onClick={() => void save()}>Save composition</Button>
    </Panel>
  );
}
