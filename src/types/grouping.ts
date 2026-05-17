/**
 * Minimal grouping types needed by the engine's sort layer.
 * Only `SortConfig` and its supporting types are needed; full grouping
 * support stays in the monolith.
 */

import type { NormalizedEvent } from './events.js';

export type SortDirection = 'asc' | 'desc';

export type SortConfig = {
  field: string;
  direction: SortDirection;
  getValue?: (event: NormalizedEvent) => unknown;
};
