/**
 * CalendarEngine — resource pool CRUD (issue #212).
 *
 * Pools live in CalendarState alongside assignments/dependencies.
 * This file pins the surface so the submit-flow resolver and UI can
 * rely on stable lookup + mutation semantics.
 */
import { describe, it, expect } from 'vitest';
import { CalendarEngine } from '../CalendarEngine.js';
import type { ResourcePool } from '../../pools/resourcePoolSchema.js';

function pool(id: string, patch: Partial<ResourcePool> = {}): ResourcePool {
  return {
    id,
    name: id.toUpperCase(),
    memberIds: ['m1', 'm2'],
    strategy: 'first-available',
    ...patch,
  };
}

describe('CalendarEngine — pool CRUD', () => {
  it('hydrates pools from init', () => {
    const engine = new CalendarEngine({ pools: [pool('drivers')] });
    expect(engine.state.pools.size).toBe(1);
    expect(engine.getPool('drivers')?.name).toBe('DRIVERS');
  });

  it('setPools replaces the map atomically and notifies once', () => {
    const engine = new CalendarEngine({ pools: [pool('a')] });
    let notifications = 0;
    engine.subscribe(() => { notifications++; });
    engine.setPools([pool('b'), pool('c')]);
    expect(notifications).toBe(1);
    expect(engine.state.pools.size).toBe(2);
    expect(engine.getPool('a')).toBeNull();
    expect(engine.getPool('b')?.id).toBe('b');
  });

  it('upsertPool inserts and updates by id', () => {
    const engine = new CalendarEngine();
    engine.upsertPool(pool('rooms', { strategy: 'round-robin' }));
    expect(engine.getPool('rooms')?.strategy).toBe('round-robin');

    engine.upsertPool(pool('rooms', { strategy: 'least-loaded', rrCursor: 2 }));
    expect(engine.getPool('rooms')?.strategy).toBe('least-loaded');
    expect(engine.getPool('rooms')?.rrCursor).toBe(2);
    expect(engine.state.pools.size).toBe(1);
  });

  it('removePool deletes an existing pool and is a no-op when missing', () => {
    const engine = new CalendarEngine({ pools: [pool('a'), pool('b')] });
    let notifications = 0;
    engine.subscribe(() => { notifications++; });

    engine.removePool('missing');
    expect(notifications).toBe(0);
    expect(engine.state.pools.size).toBe(2);

    engine.removePool('a');
    expect(notifications).toBe(1);
    expect(engine.getPool('a')).toBeNull();
    expect(engine.state.pools.size).toBe(1);
  });

  it('restoreState accepts a pools snapshot', () => {
    const engine = new CalendarEngine({ pools: [pool('a')] });
    const snapshotPools = new Map([['b', pool('b')]]);
    engine.restoreState({ pools: snapshotPools });
    expect(engine.state.pools).toBe(snapshotPools);
    expect(engine.getPool('a')).toBeNull();
    expect(engine.getPool('b')?.id).toBe('b');
  });

  it('state.pools is a fresh reference after every mutation (identity check)', () => {
    const engine = new CalendarEngine({ pools: [pool('a')] });
    const before = engine.state.pools;
    engine.upsertPool(pool('b'));
    expect(engine.state.pools).not.toBe(before);
  });
});
