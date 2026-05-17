/**
 * Resource pool schema — re-export shim (issue #212).
 *
 * The canonical implementation lives at `src/core/pools/resourcePoolSchema.ts`
 * alongside the resolver (which depends on `conflictEngine`). This file
 * exists so the issue's documented import path
 * (`src/core/engine/schema/resourcePoolSchema.ts`) resolves without moving
 * the resolver into the schema tree.
 */

export type { PoolStrategy, ResourcePool } from '../../pools/resourcePoolSchema.js';
