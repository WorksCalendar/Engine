/**
 * `validateEvent` — schema-driven event validator (#259).
 */
import { describe, it, expect, vi } from 'vitest';
import { validateEvent } from '../validateEvent.js';
import { makeEvent } from '../../schema/eventSchema.js';
import type { OnError } from '../../errors/onError.js';

const baseEvent = () => makeEvent('e1', {
  title: 'Title',
  start: new Date('2026-04-28T10:00:00Z'),
  end: new Date('2026-04-28T11:00:00Z'),
});

describe('validateEvent — top-level shape', () => {
  it('rejects non-objects', () => {
    expect(validateEvent(null).ok).toBe(false);
    expect(validateEvent('hello').ok).toBe(false);
    expect(validateEvent(42).ok).toBe(false);
    expect(validateEvent(undefined).ok).toBe(false);
  });

  it('a fully valid event passes', () => {
    expect(validateEvent(baseEvent()).ok).toBe(true);
  });
});

describe('validateEvent — id / title / time', () => {
  it('flags an empty id', () => {
    const ev = { ...baseEvent(), id: '   ' };
    const r = validateEvent(ev);
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'INVALID_ID')).toBe(true);
  });

  it('flags an empty title in strict mode', () => {
    const ev = { ...baseEvent(), title: '' };
    const r = validateEvent(ev, { mode: 'strict' });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'INVALID_TITLE')).toBe(true);
  });

  it('allows an empty title in prod mode', () => {
    const ev = { ...baseEvent(), title: '' };
    const r = validateEvent(ev, { mode: 'prod' });
    expect(r.ok).toBe(true);
    expect(r.issues.some(i => i.code === 'INVALID_TITLE')).toBe(false);
  });

  it('flags non-string title in either mode', () => {
    const ev = { ...baseEvent(), title: 42 as unknown as string };
    expect(validateEvent(ev, { mode: 'strict' }).ok).toBe(false);
    expect(validateEvent(ev, { mode: 'prod' }).ok).toBe(false);
  });

  it('flags invalid start / end dates', () => {
    const bad = { ...baseEvent(), start: new Date('nope'), end: new Date('also-nope') };
    const r = validateEvent(bad);
    expect(r.issues.some(i => i.code === 'INVALID_START')).toBe(true);
    expect(r.issues.some(i => i.code === 'INVALID_END')).toBe(true);
  });

  it('flags reversed range', () => {
    const ev = {
      ...baseEvent(),
      start: new Date('2026-04-28T11:00:00Z'),
      end:   new Date('2026-04-28T10:00:00Z'),
    };
    const r = validateEvent(ev);
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'INVALID_RANGE')).toBe(true);
  });
});

describe('validateEvent — exdates', () => {
  it('passes when exdates is absent or an empty array', () => {
    expect(validateEvent({ ...baseEvent(), exdates: [] }).ok).toBe(true);
  });

  it('flags non-array exdates', () => {
    const ev = { ...baseEvent(), exdates: 'oops' as unknown as readonly Date[] };
    const r = validateEvent(ev);
    expect(r.issues.some(i => i.code === 'INVALID_EXDATES')).toBe(true);
  });

  it('flags an array containing a bad date', () => {
    const ev = {
      ...baseEvent(),
      exdates: [new Date('2026-04-28T00:00:00Z'), new Date('nope')],
    };
    const r = validateEvent(ev);
    const ex = r.issues.find(i => i.code === 'INVALID_EXDATES');
    expect(ex?.details?.['index']).toBe(1);
  });
});

describe('validateEvent — rrule', () => {
  it('accepts well-formed RRULE strings', () => {
    expect(validateEvent({ ...baseEvent(), rrule: 'FREQ=WEEKLY;BYDAY=MO' }).ok).toBe(true);
    expect(validateEvent({ ...baseEvent(), rrule: 'RRULE:FREQ=DAILY' }).ok).toBe(true);
  });

  it('rejects malformed RRULE strings', () => {
    expect(validateEvent({ ...baseEvent(), rrule: 'rrule' }).issues.some(i => i.code === 'INVALID_RRULE')).toBe(true);
    expect(validateEvent({ ...baseEvent(), rrule: 'FREQ=' }).issues.some(i => i.code === 'INVALID_RRULE')).toBe(true);
    expect(validateEvent({ ...baseEvent(), rrule: 'BYDAY=MO' }).issues.some(i => i.code === 'INVALID_RRULE')).toBe(true);
    expect(validateEvent({ ...baseEvent(), rrule: 'FREQ=BLARGH' }).issues.some(i => i.code === 'INVALID_RRULE')).toBe(true);
  });

  it('skips the check when rrule is null/undefined', () => {
    expect(validateEvent({ ...baseEvent(), rrule: null }).ok).toBe(true);
    const noRrule = { ...baseEvent() };
    delete (noRrule as { rrule?: unknown }).rrule;
    expect(validateEvent(noRrule).ok).toBe(true);
  });
});

describe('validateEvent — timezone', () => {
  it('accepts known IANA zones', () => {
    expect(validateEvent({ ...baseEvent(), timezone: 'America/New_York' }).ok).toBe(true);
    expect(validateEvent({ ...baseEvent(), timezone: 'UTC' }).ok).toBe(true);
  });

  it('flags bogus zones', () => {
    const r = validateEvent({ ...baseEvent(), timezone: 'Mars/Olympus_Mons' });
    expect(r.issues.some(i => i.code === 'INVALID_TIMEZONE')).toBe(true);
  });
});

describe('validateEvent — resourceId', () => {
  it('accepts a string', () => {
    expect(validateEvent({ ...baseEvent(), resourceId: 'truck-1' }).ok).toBe(true);
  });

  it('accepts null', () => {
    expect(validateEvent({ ...baseEvent(), resourceId: null }).ok).toBe(true);
  });

  it('flags non-string resourceId', () => {
    const ev = { ...baseEvent(), resourceId: 42 as unknown as string };
    expect(validateEvent(ev).issues.some(i => i.code === 'INVALID_RESOURCE_ID')).toBe(true);
  });
});

describe('validateEvent — color (strict only)', () => {
  it('accepts hex, function, and named colors in strict mode', () => {
    expect(validateEvent({ ...baseEvent(), color: '#ff8800' }).ok).toBe(true);
    expect(validateEvent({ ...baseEvent(), color: 'rgb(255, 128, 0)' }).ok).toBe(true);
    expect(validateEvent({ ...baseEvent(), color: 'tomato' }).ok).toBe(true);
  });

  it('flags garbage colors in strict mode', () => {
    const r = validateEvent({ ...baseEvent(), color: 'not a color' });
    expect(r.issues.some(i => i.code === 'INVALID_COLOR')).toBe(true);
  });

  it('skips the color check entirely in prod mode', () => {
    const ev = { ...baseEvent(), color: 'not a color' };
    const r = validateEvent(ev, { mode: 'prod' });
    expect(r.issues.some(i => i.code === 'INVALID_COLOR')).toBe(false);
    expect(r.ok).toBe(true);
  });
});

describe('validateEvent — sourcePolicy (#259 prod overrides)', () => {
  it('downgrades a code to warn in prod', () => {
    const ev = { ...baseEvent(), title: 42 as unknown as string };
    const r = validateEvent(ev, {
      mode: 'prod',
      sourcePolicy: { INVALID_TITLE: 'warn' },
    });
    expect(r.ok).toBe(true);
    const issue = r.issues.find(i => i.code === 'INVALID_TITLE');
    expect(issue?.severity).toBe('warn');
  });

  it('ignores a code entirely in prod', () => {
    const ev = { ...baseEvent(), timezone: 'Bogus/Zone' };
    const r = validateEvent(ev, {
      mode: 'prod',
      sourcePolicy: { INVALID_TIMEZONE: 'ignore' },
    });
    expect(r.ok).toBe(true);
    expect(r.issues.some(i => i.code === 'INVALID_TIMEZONE')).toBe(false);
  });

  it('strict mode ignores sourcePolicy', () => {
    const ev = { ...baseEvent(), title: '' };
    const r = validateEvent(ev, {
      mode: 'strict',
      sourcePolicy: { INVALID_TITLE: 'ignore' },
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'INVALID_TITLE')).toBe(true);
  });

  it('honors sourcePolicy on the INVALID_EVENT non-object fast path (Codex P2)', () => {
    // Pre-fix, the non-object fast path hardcoded INVALID_EVENT as
    // an error and returned before resolveAction could downgrade it.
    const onError = vi.fn() as unknown as OnError;

    const warned = validateEvent(null, {
      mode: 'prod',
      sourcePolicy: { INVALID_EVENT: 'warn' },
      onError,
    });
    expect(warned.ok).toBe(true);
    expect(warned.issues[0]?.code).toBe('INVALID_EVENT');
    expect(warned.issues[0]?.severity).toBe('warn');
    // Warn-severity must not ping onError.
    expect(onError).not.toHaveBeenCalled();

    const ignored = validateEvent('not an object', {
      mode: 'prod',
      sourcePolicy: { INVALID_EVENT: 'ignore' },
      onError,
    });
    expect(ignored.ok).toBe(true);
    expect(ignored.issues).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('strict mode still hard-errors INVALID_EVENT regardless of sourcePolicy', () => {
    const r = validateEvent(null, {
      mode: 'strict',
      sourcePolicy: { INVALID_EVENT: 'ignore' },
    });
    expect(r.ok).toBe(false);
    expect(r.issues[0]?.code).toBe('INVALID_EVENT');
    expect(r.issues[0]?.severity).toBe('error');
  });
});

describe('validateEvent — onError wiring (#259)', () => {
  it('fires onError once per error-severity issue with phase + sourceId meta', () => {
    const onError = vi.fn() as unknown as OnError;
    const ev = {
      ...baseEvent(),
      id: '',                 // → INVALID_ID
      end: new Date('nope'),  // → INVALID_END
    };
    validateEvent(ev, { onError, sourceId: 'feed-7' });
    expect(onError).toHaveBeenCalledTimes(2);
    const firstCall = (onError as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const meta = firstCall![1] as { phase: string; sourceId: string };
    expect(meta.phase).toBe('validate');
    expect(meta.sourceId).toBe('feed-7');
  });

  it('does not fire for warn-only issues', () => {
    const onError = vi.fn() as unknown as OnError;
    const ev = { ...baseEvent(), title: 42 as unknown as string };
    validateEvent(ev, {
      mode: 'prod',
      sourcePolicy: { INVALID_TITLE: 'warn' },
      onError,
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('passes the eventId through when one is available', () => {
    const onError = vi.fn() as unknown as OnError;
    validateEvent({ ...baseEvent(), end: new Date('nope') }, { onError });
    const meta = (onError as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![1] as { eventId: string };
    expect(meta.eventId).toBe('e1');
  });
});
