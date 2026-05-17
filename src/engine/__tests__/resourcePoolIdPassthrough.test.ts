/**
 * Pool-id passthrough (issue #212) — regression pins for the ingestion
 * and recurrence paths flagged in code review. Any new call site that
 * builds an EngineEvent from another event must forward resourcePoolId
 * or a pool-backed booking silently loses its pool reference.
 */
import { describe, it, expect } from 'vitest';
import { fromLegacyEvent } from '../adapters/fromLegacyEvents.js';
import { normalizeInputEvent } from '../adapters/normalizeInputEvent.js';
import { detachOccurrence } from '../recurrence/detachOccurrence.js';
import { resolveRecurringEdit } from '../recurrence/resolveRecurringEdit.js';
import { makeEvent } from '../schema/eventSchema.js';

function makeMaster(pool: string | null): ReturnType<typeof makeEvent> {
  return makeEvent('master', {
    title: 'weekly standup',
    start: new Date('2026-04-20T09:00:00Z'),
    end:   new Date('2026-04-20T09:30:00Z'),
    rrule: 'FREQ=WEEKLY',
    seriesId: 'master',
    resourcePoolId: pool,
  });
}

describe('resourcePoolId passthrough — ingestion', () => {
  it('fromLegacyEvent preserves resourcePoolId when present on the payload', () => {
    const ev = fromLegacyEvent({
      id: '1',
      title: 't',
      start: '2026-04-20T09:00:00Z',
      end:   '2026-04-20T10:00:00Z',
      resourcePoolId: 'drivers',
    });
    expect(ev.resourcePoolId).toBe('drivers');
  });

  it('fromLegacyEvent defaults resourcePoolId to null when absent', () => {
    const ev = fromLegacyEvent({
      id: '1',
      title: 't',
      start: '2026-04-20T09:00:00Z',
      end:   '2026-04-20T10:00:00Z',
    });
    expect(ev.resourcePoolId).toBeNull();
  });

  it('normalizeInputEvent preserves resourcePoolId when present on the payload', () => {
    const ev = normalizeInputEvent({
      id: '1',
      title: 't',
      start: '2026-04-20T09:00:00Z',
      end:   '2026-04-20T10:00:00Z',
      resourcePoolId: 'rooms',
    });
    expect(ev.resourcePoolId).toBe('rooms');
  });
});

describe('resourcePoolId passthrough — recurrence builders', () => {
  const occurrenceStart = new Date('2026-04-27T09:00:00Z');

  it('detachOccurrence inherits the master’s resourcePoolId', () => {
    const master = makeMaster('drivers');
    const { detached } = detachOccurrence(master, occurrenceStart);
    expect(detached.resourcePoolId).toBe('drivers');
  });

  it('detachOccurrence allows patch override of resourcePoolId', () => {
    const master = makeMaster('drivers');
    const { detached } = detachOccurrence(master, occurrenceStart, { resourcePoolId: 'vip-drivers' });
    expect(detached.resourcePoolId).toBe('vip-drivers');
  });

  it('resolveRecurringEdit (single) carries resourcePoolId onto the detached record', () => {
    const master = makeMaster('drivers');
    const changes = resolveRecurringEdit(master, occurrenceStart, {}, 'single');
    const created = changes.find(c => c.type === 'created');
    if (created?.type !== 'created') throw new Error('expected created change');
    expect(created.event.resourcePoolId).toBe('drivers');
  });

  it('resolveRecurringEdit (following) carries resourcePoolId onto the new series', () => {
    const master = makeMaster('drivers');
    const changes = resolveRecurringEdit(master, occurrenceStart, {}, 'following');
    const created = changes.find(c => c.type === 'created');
    if (created?.type !== 'created') throw new Error('expected created change');
    expect(created.event.resourcePoolId).toBe('drivers');
  });

  it('resolveRecurringEdit (series) accepts resourcePoolId in the patch', () => {
    const master = makeMaster('drivers');
    const changes = resolveRecurringEdit(
      master, occurrenceStart, { resourcePoolId: 'premium-drivers' }, 'series',
    );
    const updated = changes.find(c => c.type === 'updated');
    if (updated?.type !== 'updated') throw new Error('expected updated change');
    expect(updated.after.resourcePoolId).toBe('premium-drivers');
  });
});
