/**
 * CalendarEngine lifecycle event bus — issue #216.
 *
 * A typed pub-sub that adapters subscribe to for booking lifecycle events
 * without having to wrap the submit path. The Workflow DSL (#219) `notify`
 * nodes will also emit through this bus in Phase 4, so channels and payload
 * shapes are designed to be pure, serializable, and replay-safe.
 *
 * Design notes:
 *   - Handlers are called on the next microtask (`queueMicrotask`) so emit
 *     never re-enters the caller's stack. This matches the async-by-default
 *     contract expected by Slack / webhook / email integrations.
 *   - Errors from one handler never block sibling handlers; they are caught
 *     and surfaced to an optional `onError` hook (defaults to `console.error`).
 *   - Payloads are plain data. The engine emits snapshots, not live references,
 *     so handlers that queue work across ticks see a consistent view.
 *
 * Usage (host):
 *
 *   const bus = new EventBus();
 *   const unsub = bus.subscribe('booking.approved', async payload => {
 *     await slack.post(`Booked ${payload.eventSnapshot?.title}`);
 *   });
 *   const engine = new CalendarEngine({ bus });
 */

import type { EngineEvent } from './schema/eventSchema.js';
import type { Assignment } from './schema/assignmentSchema.js';

// ─── Channels + payloads ──────────────────────────────────────────────────

/**
 * Booking-level lifecycle channels. Fire-once per state transition; the
 * engine guarantees no duplicate emissions for a single mutation even when
 * the same transition is reached through different paths (approval stage
 * flip + delete + restore all emit at most once per mutation).
 */
export type BookingChannel =
  | 'booking.requested'
  | 'booking.approved'
  | 'booking.denied'
  | 'booking.cancelled'
  | 'booking.completed';

export type AssignmentChannel =
  | 'assignment.created'
  | 'assignment.removed';

export type EventBusChannel = BookingChannel | AssignmentChannel;

/**
 * Canonical booking-lifecycle payload. `eventSnapshot` is a structured
 * clone of the `EngineEvent` at emit time — handlers may persist it, mail
 * it, or queue it for later without worrying about downstream mutations.
 */
export interface BookingLifecyclePayload {
  readonly eventId: string;
  readonly eventSnapshot: EngineEvent | null;
  readonly actor?: string;
  readonly reason?: string;
  /** ISO 8601 timestamp of the transition. */
  readonly at: string;
  /**
   * Opaque id of the engine operation that triggered the emit. Hosts can
   * use this to deduplicate webhooks when a single user action fans out.
   */
  readonly sourceActionId?: string;
}

export interface AssignmentLifecyclePayload {
  readonly assignment: Assignment;
  readonly at: string;
  readonly sourceActionId?: string;
}

export type EventBusPayload<C extends EventBusChannel> =
  C extends BookingChannel ? BookingLifecyclePayload :
  C extends AssignmentChannel ? AssignmentLifecyclePayload :
  never;

export type EventBusHandler<C extends EventBusChannel> =
  (payload: EventBusPayload<C>) => void | Promise<void>;

export type EventBusUnsubscribe = () => void;

export interface EventBusOptions {
  /**
   * Receives errors thrown (or rejected) by subscriber handlers. Default is
   * `console.error`. Host code can swap in a logger, telemetry client, or
   * silence the sink entirely in tests.
   */
  readonly onError?: (err: unknown, channel: EventBusChannel) => void;
}

// ─── Implementation ───────────────────────────────────────────────────────

/**
 * Typed channel pub-sub. Instantiate once per engine (or share across
 * engines when the host wants a single notification fan-out).
 */
export class EventBus {
  private readonly _handlers: Map<EventBusChannel, Set<(p: unknown) => void | Promise<void>>> = new Map();
  private readonly _onError: (err: unknown, channel: EventBusChannel) => void;

  constructor(opts: EventBusOptions = {}) {
    this._onError = opts.onError ?? ((err, ch) => {
       
      console.error(`[EventBus] handler for "${ch}" threw:`, err);
    });
  }

  /** Register a handler for a channel. Returns an unsubscribe function. */
  subscribe<C extends EventBusChannel>(
    channel: C,
    handler: EventBusHandler<C>,
  ): EventBusUnsubscribe {
    let set = this._handlers.get(channel);
    if (!set) {
      set = new Set();
      this._handlers.set(channel, set);
    }
    const wrapped = handler as (p: unknown) => void | Promise<void>;
    set.add(wrapped);
    return () => {
      const s = this._handlers.get(channel);
      if (!s) return;
      s.delete(wrapped);
      if (s.size === 0) this._handlers.delete(channel);
    };
  }

  /**
   * Dispatch a payload. Returns immediately; handlers run on the next
   * microtask. Failures in one handler do not affect siblings.
   */
  emit<C extends EventBusChannel>(
    channel: C,
    payload: EventBusPayload<C>,
  ): void {
    const set = this._handlers.get(channel);
    if (!set || set.size === 0) return;
    // Snapshot the handler set so mid-dispatch unsubscribes don't skip
    // siblings and mid-dispatch subscribes don't receive this emit.
    const snapshot = Array.from(set);
    queueMicrotask(() => {
      for (const h of snapshot) {
        try {
          const result = h(payload);
          if (result && typeof (result as Promise<void>).catch === 'function') {
            (result as Promise<void>).catch(err => this._onError(err, channel));
          }
        } catch (err) {
          this._onError(err, channel);
        }
      }
    });
  }

  /** Remove every handler. Useful for engine teardown and tests. */
  unsubscribeAll(): void {
    this._handlers.clear();
  }

  /** Introspection helper — how many handlers are registered on a channel. */
  handlerCount(channel: EventBusChannel): number {
    return this._handlers.get(channel)?.size ?? 0;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Map an approval stage transition to the lifecycle channel that should
 * fire. Returns null when the transition is not a lifecycle-worthy move
 * (e.g. `requested → requested`, or movement between internal tiers like
 * `approved → pending_higher`). The engine uses this to emit at most one
 * channel per `applyMutation` update.
 *
 * Semantics:
 *   null/undefined → requested           = booking.requested
 *   * → approved                         = booking.approved
 *   * → finalized                        = booking.completed
 *   * → denied                           = booking.denied
 *   any stage → null (cancelled event)   = booking.cancelled  (caller's responsibility)
 */
export function channelForApprovalTransition(
  from: string | null | undefined,
  to: string,
): BookingChannel | null {
  if (from === to) return null;
  switch (to) {
    case 'requested': return from == null ? 'booking.requested' : null;
    case 'approved':  return 'booking.approved';
    case 'finalized': return 'booking.completed';
    case 'denied':    return 'booking.denied';
    default:          return null; // pending_higher and unknown stages don't fan out
  }
}
