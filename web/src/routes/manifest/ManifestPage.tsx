import { useParams } from 'react-router-dom';
import { AppShell } from '../../components/AppShell';
import { Panel } from '../../components/ui';
import { useTransfers } from '../passport/queries';

const fmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

/** S9: one manifest, as the sender or receiver sees it. */
export default function ManifestPage() {
  const { transferId = '' } = useParams();
  const { data, isPending } = useTransfers(true);
  const t = (data ?? []).find((x) => String(x.transfer_id) === transferId);
  return (
    <AppShell>
      {isPending && <p className="text-ink-soft">Loading manifest…</p>}
      {!isPending && !t && <p role="alert" className="rounded-md border border-fault bg-white p-4 text-fault">This manifest is not one of yours, or it does not exist.</p>}
      {t && (
        <>
          <h1 className="h-page">{t.manifest_no}</h1>
          <p className="mt-1 text-ink-soft">{t.from_org} to {t.to_org}</p>
          <dl className="mt-4 grid max-w-md grid-cols-[9rem_1fr] gap-y-2">
            <dt className="text-ink-soft">Shipped</dt><dd>{fmt.format(new Date(t.shipped_at))}</dd>
            <dt className="text-ink-soft">Status</dt><dd>{t.received_at ? `Received ${fmt.format(new Date(t.received_at))}` : 'On its way'}</dd>
            <dt className="text-ink-soft">Declared mass</dt><dd>{t.total_mass_kg} kg</dd>
          </dl>
          <div className="mt-6"><Panel title={`Units (${t.items.length})`}>
            <ul className="divide-y-[1.5px] divide-dotted divide-obsidian/40">
              {t.items.map((i) => {
                const flag = t.discrepancies.find((d) => d.unit_id === i.unit_id);
                return (
                  <li key={i.unit_id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span>{i.model_number} · {i.serial_no}</span>
                    <span className="text-sm">declared {i.declared_condition.toLowerCase()}{flag && <strong className="ml-2 text-fault">{flag.kind === 'MISSING' ? 'did not arrive' : 'arrived unlisted'}</strong>}</span>
                  </li>
                );
              })}
            </ul>
          </Panel></div>
        </>
      )}
    </AppShell>
  );
}
