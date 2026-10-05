import type { UnitEvent } from '../api/types';
import { EVENT_COLORS } from './eventColors';
import { EventBadge } from './EventBadge';

const fmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

/** A unit's events in time order. Each entry shows who recorded it, where, and the hash it is chained by. */
export function Timeline({ events }: { events: UnitEvent[] }) {
  if (events.length === 0) return <p className="text-ink-soft">No events have been recorded for this unit yet.</p>;
  return (
    <ol className="relative ml-2 border-l-[1.5px] border-dotted border-obsidian/60">
      {events.map((e) => (
        <li key={e.event_id} className="relative pb-6 pl-6 last:pb-0">
          <span aria-hidden className="absolute -left-[7px] top-1.5 size-3 rounded-full ring-4 ring-pumice"
                style={{ background: EVENT_COLORS[e.event_type].dot }} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <EventBadge type={e.event_type} />
            <time dateTime={e.occurred_at} className="text-sm text-ink-soft">{fmt.format(new Date(e.occurred_at))}</time>
          </div>
          <p className="mt-1 text-sm">{e.facility_name} · {e.actor_name}</p>
          {e.tests.map((t, i) => (
            <p key={i} className="mt-1 text-sm text-ink-soft">
              {t.test_type}: {t.result.toLowerCase()}{t.health_score !== null && <> · health {t.health_score}</>}
            </p>
          ))}
          <p className="mt-1 font-mono text-xs text-ink-soft" title={e.event_hash}>#{e.event_hash.slice(0, 12)}…</p>
        </li>
      ))}
    </ol>
  );
}
