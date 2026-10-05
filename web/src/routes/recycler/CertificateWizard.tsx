import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client';
import type { IssueCertificateRequest, Me } from '../../api/types';
import { useToast } from '../../components/Toast';
import { Button, Field, Panel, inputClass } from '../../components/ui';
import { useHeldUnits } from './RecyclerPage';

const STEPS = ['Details', 'Units', 'Confirm'] as const;

const financialYear = (d: Date): string => {
  const start = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

/** S10. The disabled Issue button is a hint only: the database decides whether the claim is backed. */
export function CertificateWizard({ me, onDone }: { me: Me; onDone: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const held = useHeldUnits(me);
  const today = new Date();
  const [step, setStep] = useState(0);
  const [certNo, setCertNo] = useState(() => `RC-REC-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 900000 + 100000))}`);
  const [category, setCategory] = useState('ITEW2');
  const [kg, setKg] = useState('');
  const [fy, setFy] = useState(financialYear(today));
  const [issuedOn, setIssuedOn] = useState(today.toISOString().slice(0, 10));
  const [chosen, setChosen] = useState<Record<number, string>>({});     // unit_id -> recovered grams

  const candidates = (held.data ?? []).filter((u) => u.current_state === 'RECYCLED' && u.certificate_id === null);
  const backedKg = Object.values(chosen).reduce((sum, g) => sum + (Number(g) || 0), 0) / 1000;
  const claimed = Number(kg);
  const detailsOk = certNo.trim() !== '' && claimed > 0 && /^[0-9]{4}-[0-9]{2}$/.test(fy);
  const covered = backedKg >= claimed;

  function toggle(unitId: number, massG: string) {
    setChosen((all) => unitId in all
      ? Object.fromEntries(Object.entries(all).filter(([id]) => Number(id) !== unitId))
      : { ...all, [unitId]: String(Math.round(Number(massG) * 100) / 100) });
  }

  async function issue() {
    const body: IssueCertificateRequest = {
      cert_no: certNo.trim(), category: category.trim(), quantity_kg: claimed, financial_year: fy, issued_on: issuedOn,
      units: Object.entries(chosen).map(([id, g]) => ({ unit_id: Number(id), recovered_mass_g: Number(g) })),
    };
    await api<{ cert_id: number }>('/certificates', { method: 'POST', body });
    toast.show(`Certificate ${certNo} issued`);
    await qc.invalidateQueries({ queryKey: ['held'] });
    onDone();
  }

  return (
    <Panel title="Issue a certificate">
      <ol className="mb-5 flex gap-2 text-sm" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? 'step' : undefined}
              className={`rounded-full px-4 py-1.5 ${i === step ? 'bg-ember text-obsidian' : 'bg-pumice text-ink-soft'}`}>{i + 1}. {s}</li>
        ))}
      </ol>

      {step === 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Certificate number" htmlFor="c-no"><input id="c-no" value={certNo} onChange={(e) => setCertNo(e.target.value)} className={inputClass} /></Field>
          <Field label="Category" htmlFor="c-cat" hint="CPCB EEE code, for example ITEW2"><input id="c-cat" value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass} /></Field>
          <Field label="Claimed quantity (kg)" htmlFor="c-kg"><input id="c-kg" inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} className={inputClass} /></Field>
          <Field label="Financial year" htmlFor="c-fy"><input id="c-fy" value={fy} onChange={(e) => setFy(e.target.value)} className={inputClass} /></Field>
          <Field label="Issued on" htmlFor="c-date"><input id="c-date" type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} className={inputClass} /></Field>
        </div>
      )}

      {step === 1 && (
        <div>
          {held.isPending ? <p className="text-ink-soft">Loading units…</p> : candidates.length === 0
            ? <p className="text-ink-soft">No recycled units are waiting for a certificate. Mark units as recycled first.</p> : (
              <ul className="divide-y-[1.5px] divide-dotted divide-obsidian/40 rounded-[24px] bg-chalk">
                {candidates.map((u) => (
                  <li key={u.unit_id} className="flex flex-wrap items-center gap-3 p-2">
                    <label className="flex flex-1 items-center gap-2">
                      <input type="checkbox" checked={u.unit_id in chosen} onChange={() => toggle(u.unit_id, u.mass_g)} />
                      <span>{u.model_number} · {u.serial_no}</span>
                    </label>
                    {u.unit_id in chosen && (
                      <label className="flex items-center gap-2 text-sm">Recovered (g)
                        <input aria-label={`Recovered grams for ${u.serial_no}`} inputMode="decimal" className="w-24 rounded-full border-[1.5px] border-obsidian bg-white px-3 py-1"
                               value={chosen[u.unit_id]} onChange={(e) => setChosen((all) => ({ ...all, [u.unit_id]: e.target.value }))} />
                      </label>
                    )}
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}

      {step === 2 && (
        <dl className="space-y-2">
          <div className="flex gap-3"><dt className="w-40 text-ink-soft">Certificate</dt><dd>{certNo} · {category} · {fy}</dd></div>
          <div className="flex gap-3"><dt className="w-40 text-ink-soft">Claimed</dt><dd>{claimed} kg</dd></div>
          <div className="flex gap-3"><dt className="w-40 text-ink-soft">Backed by</dt><dd>{Object.keys(chosen).length} units, {backedKg.toFixed(3)} kg</dd></div>
        </dl>
      )}

      <p aria-live="polite" className={`mt-5 text-sm ${covered || !detailsOk ? 'text-ink-soft' : 'text-fault'}`} data-testid="backing-line">
        Backed {backedKg.toFixed(3)} kg of {claimed > 0 ? claimed : 0} kg claimed{claimed > 0 && !covered ? ' — add units or lower the claim' : ''}
      </p>

      <div className="mt-4 flex gap-2">
        {step > 0 && <Button variant="quiet" onClick={() => setStep(step - 1)}>Back</Button>}
        {step < 2 && <Button disabled={step === 0 && !detailsOk} onClick={() => setStep(step + 1)}>Next</Button>}
        {step === 2 && <Button disabled={!covered || Object.keys(chosen).length === 0} onClick={() => void issue()}>Issue certificate</Button>}
      </div>
    </Panel>
  );
}
