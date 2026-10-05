import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiException } from '../../api/client';
import type { Role, UnitPassport } from '../../api/types';
import { AppShell } from '../../components/AppShell';
import { EventBadge } from '../../components/EventBadge';
import { PartTree } from '../../components/PartTree';
import { Tabs } from '../../components/ui';
import { Timeline } from '../../components/Timeline';
import { useAuth } from '../../auth/AuthContext';
import { resolvePassportUid, useEvents, usePassport, useTransfers, useTree, useUnitCertificates } from './queries';

const TABS = ['Overview', 'Parts tree', 'Timeline', 'Tests', 'Custody', 'Certificates'] as const;
type Tab = (typeof TABS)[number];

const CUSTODY_ROLES: Role[] = ['COLLECTOR', 'TECHNICIAN', 'RECYCLER_OPERATOR'];
const CERTIFICATE_ROLES: Role[] = ['RECYCLER_OPERATOR', 'PRODUCER', 'AUDITOR'];
const dateFmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

export default function PassportPage() {
  const { passportUid = '' } = useParams();
  const { data: passport, error, isPending } = usePassport(passportUid);
  const [tab, setTab] = useState<Tab>('Overview');

  return (
    <AppShell wide>
      {isPending && <p className="text-ink-soft">Loading passport…</p>}
      {error && (
        <p role="alert" className="rounded-md border border-fault bg-white p-4 text-fault">
          {error instanceof ApiException && error.status === 404
            ? 'No passport matches that ID. Check the code and try again.'
            : 'The passport could not be loaded.'}
        </p>
      )}
      {passport && (
        <>
          <Header passport={passport} />
          <div className="mt-8"><Tabs label="Passport sections" tabs={TABS} active={tab} onChange={setTab} /></div>
          <div role="tabpanel" className="pt-8">
            {tab === 'Overview' && <Overview passport={passport} />}
            {tab === 'Parts tree' && <PartsTab passport={passport} />}
            {tab === 'Timeline' && <TimelineTab unitId={passport.unit_id} />}
            {tab === 'Tests' && <TestsTab unitId={passport.unit_id} />}
            {tab === 'Custody' && <CustodyTab unitId={passport.unit_id} />}
            {tab === 'Certificates' && <CertificatesTab unitId={passport.unit_id} />}
          </div>
        </>
      )}
    </AppShell>
  );
}

function QrImage({ unitId }: { unitId: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    void api<Blob>(`/units/${unitId}/qr`, { quiet: true }).then((blob) => {
      if (!alive) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
    }).catch(() => undefined);
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [unitId]);
  return src ? <img src={src} alt="QR code for this passport" className="size-32 rounded-[20px] bg-chalk p-2" /> : <div className="size-28" />;
}

function Header({ passport }: { passport: UnitPassport }) {
  return (
    <section className="flex flex-wrap items-start justify-between gap-6 rounded-[40px] bg-limestone p-8">
      <div className="min-w-0">
        <p className="text-sm text-ink-soft">{passport.model.manufacturer}</p>
        <h1 className="h-page">{passport.model.model_number}</h1>
        <p className="mt-1 text-ink-soft">{passport.model.category.toLowerCase()} · serial {passport.serial_no}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {passport.current_state ? <EventBadge type={passport.current_state} /> : <span className="text-sm text-ink-soft">No events yet</span>}
          <span className={`rounded-full px-3 py-1 text-sm ${passport.chain_verified ? 'bg-sulfur text-obsidian' : 'bg-obsidian text-chalk'}`}>
            {passport.chain_verified ? 'History verified' : 'History does not verify'}
          </span>
        </div>
        <p className="mt-3 break-all font-mono text-xs text-ink-soft">{passport.passport_uid}</p>
      </div>
      <QrImage unitId={passport.unit_id} />
    </section>
  );
}

function Overview({ passport }: { passport: UnitPassport }) {
  const navigate = useNavigate();
  const rows: [string, React.ReactNode][] = [
    ['Manufactured', passport.manufactured_on ? dateFmt.format(new Date(passport.manufactured_on)) : 'Not recorded'],
    ['In this state since', passport.state_since ? dateTimeFmt.format(new Date(passport.state_since)) : '—'],
    ['Held by', passport.current_holder?.org_name ?? 'Not known yet'],
    ['Installed in', passport.current_parent
      ? <button type="button" className="text-obsidian underline decoration-ember decoration-2 underline-offset-4"
                onClick={() => navigate(`/unit/${passport.current_parent?.passport_uid ?? ''}`)}>
          {passport.current_parent.model_number}
        </button>
      : 'Not installed in another unit'],
    ['Nominal mass', `${passport.model.mass_g} g`],
  ];
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <dl className="space-y-3">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[10rem_1fr] gap-2"><dt className="text-ink-soft">{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
      <div>
        <h2 className="h-section">Materials</h2>
        {passport.model.materials.length === 0
          ? <p className="mt-2 text-ink-soft">No material composition has been recorded for this model.</p>
          : (
            <table className="mt-2 w-full text-sm">
              <thead><tr className="text-left text-ink-soft"><th className="py-1 ">Material</th><th className="py-1 text-right ">Mass (mg)</th></tr></thead>
              <tbody>
                {passport.model.materials.map((m) => (
                  <tr key={m.material_name} className="border-t-[1.5px] border-dotted border-obsidian/40">
                    <td className="py-1.5">{m.material_name}{m.is_critical && <span className="ml-2 text-xs text-ink-soft">critical</span>}</td>
                    <td className="py-1.5 text-right tabular-nums">{m.mass_mg.toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </div>
  );
}

function PartsTab({ passport }: { passport: UnitPassport }) {
  const navigate = useNavigate();
  const [local, setLocal] = useState(() => toLocalInput(new Date()));
  const asOf = new Date(local).toISOString();
  const selected = useTree(passport.unit_id, asOf);
  const now = useTree(passport.unit_id, null);
  async function open(unitId: number) {
    const uid = await resolvePassportUid(unitId);
    if (uid) navigate(`/unit/${uid}`);
  }
  return (
    <div>
      <label className="text-sm " htmlFor="as-of">Show the parts inside on</label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input id="as-of" type="datetime-local" value={local} max={toLocalInput(new Date())} onChange={(e) => e.target.value && setLocal(e.target.value)}
               className="rounded-full border-[1.5px] border-obsidian bg-white px-5 py-2.5" />
        <button type="button" onClick={() => setLocal(toLocalInput(new Date()))} className="rounded-full border-[1.5px] border-obsidian px-5 py-2.5 text-sm">Now</button>
      </div>
      <div className="mt-6">
        {selected.isPending ? <p className="text-ink-soft">Loading parts…</p>
          : <PartTree rows={selected.data ?? []} absent={now.data ?? []} rootLabel={`${passport.model.model_number} · ${passport.serial_no}`}
                      onOpen={(id) => void open(id)} />}
      </div>
    </div>
  );
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function TimelineTab({ unitId }: { unitId: number }) {
  const { data, isPending } = useEvents(unitId);
  return isPending ? <p className="text-ink-soft">Loading timeline…</p> : <Timeline events={data ?? []} />;
}

function TestsTab({ unitId }: { unitId: number }) {
  const { data, isPending } = useEvents(unitId);
  if (isPending) return <p className="text-ink-soft">Loading tests…</p>;
  const rows = (data ?? []).flatMap((e) => e.tests.map((t) => ({ at: e.occurred_at, ...t })));
  if (rows.length === 0) return <p className="text-ink-soft">No diagnostic tests have been recorded for this unit.</p>;
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-left text-ink-soft"><th className="py-1 ">Tested</th><th className="">Test</th><th className="">Result</th><th className="text-right ">Measured</th><th className="text-right ">Health</th></tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t-[1.5px] border-dotted border-obsidian/40">
            <td className="py-1.5">{dateTimeFmt.format(new Date(r.at))}</td><td>{r.test_type}</td><td>{r.result.toLowerCase()}</td>
            <td className="text-right tabular-nums">{r.measured_value ?? '—'}</td><td className="text-right tabular-nums">{r.health_score ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CustodyTab({ unitId }: { unitId: number }) {
  const { session } = useAuth();
  const allowed = !!session && CUSTODY_ROLES.includes(session.role);
  const { data, isPending } = useTransfers(allowed);
  if (!allowed) return <p className="text-ink-soft">Custody records are visible to the organisations named on a manifest.</p>;
  if (isPending) return <p className="text-ink-soft">Loading manifests…</p>;
  const mine = (data ?? []).filter((t) => t.items.some((i) => i.unit_id === unitId));
  if (mine.length === 0) return <p className="text-ink-soft">None of your manifests include this unit.</p>;
  return (
    <ul className="space-y-3">
      {mine.map((t) => (
        <li key={t.transfer_id} className="rounded-[24px] bg-limestone p-4">
          <p className="">{t.manifest_no}</p>
          <p className="text-sm">{t.from_org} to {t.to_org}</p>
          <p className="text-sm text-ink-soft">
            Shipped {dateTimeFmt.format(new Date(t.shipped_at))} · {t.received_at ? `received ${dateTimeFmt.format(new Date(t.received_at))}` : 'not yet received'}
          </p>
          {t.discrepancies.filter((d) => d.unit_id === unitId).map((d) => (
            <p key={d.kind} className="mt-1 text-sm  text-fault">Flagged {d.kind.toLowerCase()} at receipt</p>
          ))}
        </li>
      ))}
    </ul>
  );
}

function CertificatesTab({ unitId }: { unitId: number }) {
  const { session } = useAuth();
  const allowed = !!session && CERTIFICATE_ROLES.includes(session.role);
  const { data, isPending } = useUnitCertificates(unitId, allowed);
  if (!allowed) return <p className="text-ink-soft">Certificates are visible to recyclers, producers and auditors.</p>;
  if (isPending) return <p className="text-ink-soft">Loading certificates…</p>;
  if (!data || data.length === 0) return <p className="text-ink-soft">No certificate you can see is backed by this unit.</p>;
  return (
    <ul className="space-y-3">
      {data.map((c) => (
        <li key={c.cert_id} className="rounded-[24px] bg-limestone p-4">
          <p className="">{c.cert_no}</p>
          <p className="text-sm">{c.recycler}{c.producer && <> to {c.producer}</>} · {c.category} · {c.financial_year}</p>
          <p className="text-sm text-ink-soft">{c.claimed_kg} kg claimed · {c.backed_kg} kg backed by {c.unit_count} units</p>
        </li>
      ))}
    </ul>
  );
}
