import { useParams } from 'react-router-dom';
import { ApiException } from '../../api/client';
import { EventBadge } from '../../components/EventBadge';
import { usePublicPassport } from '../passport/queries';

const dateFmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });

/** S8: what anyone holding the part may see. No sign-in, no staff names, no organisations. */
export default function PublicPassportPage() {
  const { passportUid = '' } = useParams();
  const { data, error, isPending } = usePublicPassport(passportUid);

  return (
    <main className="mx-auto max-w-lg px-4 py-8">
      <p className="text-sm font-medium text-trace">ReCircuit passport</p>
      {isPending && <p className="mt-6 text-ink-soft">Checking this part…</p>}
      {error && (
        <p role="alert" className="mt-6 rounded-md border border-fault bg-white p-4 text-fault">
          {error instanceof ApiException && error.status === 429
            ? 'Too many lookups just now. Wait a minute and scan again.'
            : error instanceof ApiException && error.status === 404
              ? 'This code does not match any passport. It may be damaged or not from ReCircuit.'
              : 'The passport could not be loaded. Try again shortly.'}
        </p>
      )}
      {data && (
        <article className="mt-3 overflow-hidden rounded-md border border-solder bg-tray">
          <header className="border-b border-dashed border-solder p-5">
            <p className="text-ink-soft">{data.manufacturer}</p>
            <h1 className="text-3xl font-semibold tracking-tight">{data.model_number}</h1>
            <p className="mt-1 text-ink-soft">
              {data.category.toLowerCase()}{data.manufactured_on && <> · made {dateFmt.format(new Date(data.manufactured_on))}</>}
            </p>
            <p data-testid="chain-badge"
               className={`mt-4 inline-block rounded-sm px-2.5 py-1 text-sm font-medium ${data.chain_verified ? 'bg-[#d9eee2] text-[#175c37]' : 'bg-[#f2dada] text-fault'}`}>
              {data.chain_verified ? 'Chain verified' : 'Chain not verified'}
            </p>
          </header>
          <div className="grid gap-6 p-5">
            <div>
              <h2 className="text-sm text-ink-soft">Latest health</h2>
              <p className="text-4xl font-semibold tabular-nums" data-testid="health">{data.latest_health ?? '—'}</p>
            </div>
            <div>
              <h2 className="text-sm text-ink-soft">Where it is now</h2>
              {data.current_state ? <div className="mt-1"><EventBadge type={data.current_state} /></div> : <p>No events yet</p>}
            </div>
            <div>
              <h2 className="text-sm text-ink-soft">History</h2>
              <ol className="mt-2 space-y-2">
                {data.history.map((h, i) => (
                  <li key={i} className="flex items-center justify-between gap-3">
                    <EventBadge type={h.type} />
                    <time className="text-sm text-ink-soft" dateTime={h.date}>{dateFmt.format(new Date(h.date))}</time>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </article>
      )}
    </main>
  );
}
