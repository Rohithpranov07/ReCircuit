import type { Me } from '../../api/types';
import { Field, inputClass } from '../../components/ui';

/** Which of the caller's facilities an action is recorded at. One facility: shown as text. */
export function FacilityField({ me, value, onChange }: { me: Me; value: number; onChange: (id: number) => void }) {
  if (me.facilities.length === 1) {
    return <p className="text-sm text-ink-soft">Recorded at {me.facilities[0]?.facility_name} ({me.org_name})</p>;
  }
  return (
    <Field label="Facility" htmlFor="facility">
      <select id="facility" value={value} onChange={(e) => onChange(Number(e.target.value))} className={inputClass}>
        {me.facilities.map((f) => <option key={f.facility_id} value={f.facility_id}>{f.facility_name}</option>)}
      </select>
    </Field>
  );
}
