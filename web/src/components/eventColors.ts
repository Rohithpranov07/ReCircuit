import type { EventType } from '../api/types';

/** The one colour map for lifecycle events. Colour is always paired with the event's text label. */
export const EVENT_COLORS: Record<EventType, { dot: string; tint: string }> = {
  MANUFACTURED: { dot: '#5b6b7a', tint: '#dfe5ea' },
  SOLD:         { dot: '#7a5ba6', tint: '#e8e1f0' },
  COLLECTED:    { dot: '#2f6fb5', tint: '#dbe7f4' },
  DIAGNOSED:    { dot: '#b5802a', tint: '#f3e6cf' },
  HARVESTED:    { dot: '#2e8b57', tint: '#d9eee2' },
  REFURBISHED:  { dot: '#1f8f8f', tint: '#d5ecec' },
  REINSTALLED:  { dot: '#4c8a1e', tint: '#e0efd2' },
  RECYCLED:     { dot: '#4a4f55', tint: '#dcdee0' },
  DISPOSED:     { dot: '#a33b3b', tint: '#f2dada' },
};

export const EVENT_LABELS: Record<EventType, string> = {
  MANUFACTURED: 'Manufactured', SOLD: 'Sold', COLLECTED: 'Collected', DIAGNOSED: 'Diagnosed',
  HARVESTED: 'Harvested', REFURBISHED: 'Refurbished', REINSTALLED: 'Reinstalled',
  RECYCLED: 'Recycled', DISPOSED: 'Disposed',
};
