/**
 * Minimal view-related types needed by the engine boundary.
 * Copied from the monolith's src/types/view.ts; only the engine-relevant
 * subset (visualPriority) is included here.
 */

export type EventVisualPriority = 'muted' | 'high';

export function isVisualPriority(v: unknown): v is EventVisualPriority {
  return v === 'muted' || v === 'high';
}
