import type { EventType } from '../api/types';
import { EVENT_COLORS, EVENT_LABELS } from './eventColors';

export function EventBadge({ type }: { type: EventType }) {
  const c = EVENT_COLORS[type];
  return (
    <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm" style={{ background: c.tint }}>
      <span aria-hidden className="size-2.5 rounded-full" style={{ background: c.dot }} />
      {EVENT_LABELS[type]}
    </span>
  );
}
