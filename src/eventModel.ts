/**
 * eventModel.js — Normalize any incoming event shape into a consistent internal format.
 */
import { parseISO, isValid, addHours } from 'date-fns';
import type { NormalizedEvent, WorksCalendarEvent } from './types/events.js';
import { isLifecycleState } from './types/events.js';
import { lifecycleFromApprovalStage } from './approvals/lifecycleFromApprovalStage.js';
import type { ApprovalStage } from './types/assets.js';

function uid(): string {
  const g = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (g?.randomUUID) return `wc-${g.randomUUID()}`;
  // Fallback for environments without crypto.randomUUID (very old browsers,
  // Node < 14.17). Not cryptographically strong, but collision-resistant enough
  // for client-generated event IDs.
  return `wc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Parse anything into a Date (or null). */
function toDate(val: unknown): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isValid(val) ? val : null;
  if (typeof val === 'number') { const d = new Date(val); return isValid(d) ? d : null; }
  if (typeof val === 'string') { const d = parseISO(val); return isValid(d) ? d : null; }
  return null;
}

const CATEGORY_COLORS = [
  '#3b82f6','#f59e0b','#ef4444','#10b981',
  '#8b5cf6','#ec4899','#06b6d4','#f97316',
];

// FNV-1a 32-bit. Deterministic across instances and reloads — that's the whole
// point of doing it this way instead of an insertion-order map.
function hashCategory(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Bucket count is much wider than the curated palette so a small set of
// distinct categories almost never collides on the same palette color. The
// remainder spills into a golden-angle hue, giving ~360 visually distinct
// fallback colors without sharing state.
const PALETTE_BUCKETS = 64;

function categoryColor(cat: string | null | undefined): string {
  if (!cat) return CATEGORY_COLORS[0]!;
  const h = hashCategory(cat);
  const bucket = h % PALETTE_BUCKETS;
  if (bucket < CATEGORY_COLORS.length) return CATEGORY_COLORS[bucket]!;
  const hue = Math.round((h * 137.508) % 360);
  return `hsl(${hue}, 62%, 45%)`;
}

/**
 * Normalize a raw event object into the internal event shape.
 */
export function normalizeEvent(raw: WorksCalendarEvent): NormalizedEvent {
  const start = toDate(raw.start) || new Date();
  const end   = toDate(raw.end)   || addHours(start, 1);

  // Lifecycle is opt-in: prefer the top-level field, accept a meta override
  // so hosts can ride it through their existing payloads without changing
  // their adapter. When neither is provided, derive from the approval
  // stage when one exists — `requested → pending`, `approved → approved`,
  // `finalized → scheduled` — so the request → approval → event loop
  // (#424 wk3) doesn't need a separate writer. Falls back to null when
  // there's no signal at all.
  const metaLifecycle = (raw.meta as { lifecycle?: unknown } | undefined)?.lifecycle;
  const approvalStage = (raw.meta as { approvalStage?: ApprovalStage } | undefined)?.approvalStage;
  const lifecycle = isLifecycleState(raw.lifecycle)
    ? raw.lifecycle
    : isLifecycleState(metaLifecycle)
      ? metaLifecycle
      : lifecycleFromApprovalStage(approvalStage?.stage ?? null);

  return {
    id:             raw.id             ?? uid(),
    title:          raw.title          ?? '(untitled)',
    start,
    end,
    allDay:         raw.allDay         ?? false,
    category:       raw.category       ?? null,
    color:          raw.color          ?? categoryColor(raw.category),
    resource:       raw.resource       ?? null,
    visualPriority: raw.visualPriority ?? null,
    status:         raw.status         ?? 'confirmed',
    lifecycle,
    rrule:          raw.rrule          ?? null,
    exdates:        raw.exdates        ?? [],
    reminders:      raw.reminders      ?? [],
    meta:           raw.meta           ?? {},
    _raw:           raw,
  };
}

/**
 * Normalize an array of raw events.
 */
export function normalizeEvents(rawList: WorksCalendarEvent[] | null | undefined): NormalizedEvent[] {
  if (!Array.isArray(rawList)) return [];
  // Drop non-object entries (a `null`/`undefined`/primitive that slipped in
  // from a host array or source adapter) — `normalizeEvent` reads fields off
  // its argument and would throw on them.
  return rawList.filter((raw): raw is WorksCalendarEvent => raw != null && typeof raw === 'object').map(normalizeEvent);
}
