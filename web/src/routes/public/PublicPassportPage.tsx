import { useParams } from 'react-router-dom';
import { ApiException } from '../../api/client';
import { Mark } from '../../components/AppShell';
import { EventBadge } from '../../components/EventBadge';
import { Stat } from '../../components/ui';
import { usePublicPassport } from '../passport/queries';

const dateFmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });

/** S8: what anyone holding the part may see. No sign-in, no staff names, no organisations. */
export default function PublicPassportPage() {
  const { passportUid = '' } = useParams();
  const { data, error, isPending } = usePublicPassport(passportUid);

  return (
    <main className="mx-auto max-w-3xl px-4 pb-20 pt-6 sm:px-6">
      <div className="flex items-center gap-2.5 rounded-full bg-limestone py-2 pl-5 pr-5">
        <Mark />
        <span className="font-display text-2xl tracking-wide">ReCircuit</span>
        <span className="ml-auto text-sm text-ink-soft">Part passport</span>
      </div>
      {isPending && <p className="mt-10 text-ink-soft">Checking this part…</p>}
      {error && (
        <p role="alert" className="mt-10 rounded-[24px] border-[1.5px] border-fault bg-chalk p-6 text-fault">
          {error instanceof ApiException && error.status === 429
            ? 'Too many lookups just now. Wait a minute and scan again.'
            : error instanceof ApiException && error.status === 404
              ? 'This code does not match any passport. It may be damaged or not from ReCircuit.'
              : 'The passport could not be loaded. Try again shortly.'}
        </p>
      )}
      {data && (
        <article className="mt-10 space-y-6">
          <header>
            <p className="text-ink-soft">{data.manufacturer}</p>
            <h1 className="h-page mt-2 break-words">{data.model_number}</h1>
            <p className="mt-3 text-ink-soft">
              {data.category.toLowerCase()}{data.manufactured_on && <> · made {dateFmt.format(new Date(data.manufactured_on))}</>}
            </p>
            <p data-testid="chain-badge"
               className={`mt-5 inline-block rounded-full px-4 py-1.5 text-sm ${data.chain_verified ? 'bg-sulfur text-obsidian' : 'bg-obsidian text-chalk'}`}>
              {data.chain_verified ? 'Chain verified' : 'Chain not verified'}
            </p>
          </header>

          <div className="grid gap-6 sm:grid-cols-[1fr_1fr]">
            <Stat label="Latest health score" value={<span data-testid="health">{data.latest_health ?? '—'}</span>} detail={data.latest_health === null ? 'This part has not been tested.' : 'Out of 100'} />
            <div className="rounded-[40px] bg-limestone p-8 sm:p-10">
              <p className="text-sm">Where it is now</p>
              <div className="mt-4">{data.current_state ? <EventBadge type={data.current_state} /> : <p>No events yet</p>}</div>
            </div>
          </div>

          <section className="rounded-[40px] bg-limestone p-8 sm:p-10">
            <h2 className="h-section">History</h2>
            <ol className="mt-5 divide-y-[1.5px] divide-dotted divide-obsidian/40">
              {data.history.map((h, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-3">
                  <EventBadge type={h.type} />
                  <time className="text-sm text-ink-soft" dateTime={h.date}>{dateFmt.format(new Date(h.date))}</time>
                </li>
              ))}
            </ol>
          </section>
        </article>
      )}
    </main>
  );
}
