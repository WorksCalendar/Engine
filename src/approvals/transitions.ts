/**
 * Approval transition reducer — issue #209.
 *
 * Pure, side-effect-free state machine for `ApprovalStage`. Guards the 5-state
 * workflow (`requested → approved → finalized | pending_higher | denied`) so
 * host code cannot, e.g., jump from `finalized` straight back to `requested`
 * without going through `revoke`.
 *
 * The reducer is the core primitive the Workflow DSL (#219) interpreter will
 * drive — keeping it pure + serializable means the interpreter can be tested
 * without any React or engine state.
 */
import type {
  ApprovalActionId,
  ApprovalHistoryActionId,
  ApprovalStage,
  ApprovalStageId,
  ApprovalHistoryEntry,
} from '../types/assets.js'
import { appendAuditEntry } from './auditChain.js'

// ─── Errors ───────────────────────────────────────────────────────────────

export type TransitionErrorCode =
  | 'ILLEGAL_TRANSITION'
  | 'DENY_REQUIRES_REASON'
  | 'INVALID_STAGE'

export interface TransitionError {
  readonly code: TransitionErrorCode
  readonly message: string
  readonly from?: ApprovalStageId | null
  readonly action?: ApprovalHistoryActionId
}

// ─── Result type (Result<T, E>) ───────────────────────────────────────────

export type TransitionResult =
  | { readonly ok: true; readonly stage: ApprovalStage }
  | { readonly ok: false; readonly error: TransitionError }

// ─── Legal transition table ───────────────────────────────────────────────
//
// Exported so the Workflow DSL builder UI can render the edges, and so
// test fixtures stay honest.

/** A null `from` means "no prior stage" (first `submit` action). */
export type TransitionSource = ApprovalStageId | null

export interface TransitionSpec {
  readonly from: TransitionSource
  readonly action: ApprovalActionId | 'revoke'
  readonly to: ApprovalStageId
}

export const LEGAL_TRANSITIONS: readonly TransitionSpec[] = [
  // Entry: a brand-new request.
  { from: null,             action: 'submit',    to: 'requested' },

  // requested → ...
  { from: 'requested',      action: 'approve',   to: 'approved' },
  { from: 'requested',      action: 'deny',      to: 'denied' },
  { from: 'requested',      action: 'downgrade', to: 'pending_higher' },

  // approved → ...
  { from: 'approved',       action: 'approve',   to: 'finalized' },
  { from: 'approved',       action: 'finalize',  to: 'finalized' },
  { from: 'approved',       action: 'deny',      to: 'denied' },
  { from: 'approved',       action: 'downgrade', to: 'pending_higher' },

  // pending_higher → ...
  { from: 'pending_higher', action: 'approve',   to: 'finalized' },
  { from: 'pending_higher', action: 'finalize',  to: 'finalized' },
  { from: 'pending_higher', action: 'deny',      to: 'denied' },

  // Mid-flow + terminal stages reopen via `revoke`. `approved` is explicitly
  // revocable to match the shipped default action config in
  // `src/core/configSchema.ts` (approved.allow: ['finalize', 'revoke']).
  { from: 'approved',       action: 'revoke',    to: 'requested' },
  { from: 'finalized',      action: 'revoke',    to: 'requested' },
  { from: 'denied',         action: 'revoke',    to: 'requested' },
]

const VALID_STAGES: ReadonlySet<ApprovalStageId> = new Set<ApprovalStageId>([
  'requested', 'approved', 'finalized', 'pending_higher', 'denied',
])

function findTransition(
  from: TransitionSource,
  action: ApprovalActionId | 'revoke',
): TransitionSpec | undefined {
  for (const t of LEGAL_TRANSITIONS) {
    if (t.from === from && t.action === action) return t
  }
  return undefined
}

// ─── Finalization helper ──────────────────────────────────────────────────

/**
 * Single-tier flows finalize on the first approval. When `counts.requiredApprovals
 * === 1`, an `approve` from `requested` goes straight to `finalized` instead of
 * `approved`. Without `counts`, the caller's requested flow is honored.
 */
function resolveApproveTarget(
  from: ApprovalStageId,
  currentCounts: ApprovalStage['counts'] | undefined,
  projectedApprovals: number,
): ApprovalStageId | null {
  if (from !== 'requested') return null
  const required = currentCounts?.requiredApprovals
  if (typeof required === 'number' && projectedApprovals >= required) {
    return 'finalized'
  }
  return null
}

// ─── Public API ───────────────────────────────────────────────────────────

export interface TransitionInput {
  readonly action: ApprovalActionId | 'revoke'
  readonly actor?: string | undefined
  readonly tier?: number | undefined
  readonly reason?: string | undefined
  /** ISO timestamp for determinism in tests; defaults to `new Date().toISOString()`. */
  readonly at?: string | undefined
}

/**
 * Advance an approval stage. Returns a new stage + appended history entry,
 * or a `TransitionError` for illegal moves.
 *
 * Pure: no Date.now() reads when `input.at` is supplied, no mutation of
 * the `current` argument.
 */
export function transitionApproval(
  current: ApprovalStage | null | undefined,
  input: TransitionInput,
): TransitionResult {
  const from: TransitionSource = current?.stage ?? null

  if (current && !VALID_STAGES.has(current.stage)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_STAGE',
        message: `Unknown stage "${current.stage}".`,
        from: current.stage,
        action: input.action,
      },
    }
  }

  if (input.action === 'deny' && !input.reason?.trim()) {
    return {
      ok: false,
      error: {
        code: 'DENY_REQUIRES_REASON',
        message: 'A reason is required when denying a request.',
        from,
        action: 'deny',
      },
    }
  }

  const transition = findTransition(from, input.action)
  if (!transition) {
    return {
      ok: false,
      error: {
        code: 'ILLEGAL_TRANSITION',
        message: `Cannot ${input.action} from stage "${from ?? 'null'}".`,
        from,
        action: input.action,
      },
    }
  }

  const at = input.at ?? new Date().toISOString()
  const entrySeed: Omit<ApprovalHistoryEntry, 'hash' | 'prevHash'> = {
    action: input.action,
    at,
    ...(input.actor !== undefined ? { actor: input.actor } : {}),
    ...(input.tier !== undefined ? { tier: input.tier } : {}),
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
  }

  const prevCounts = current?.counts
  const nextApprovals = (prevCounts?.approvals ?? 0) + (input.action === 'approve' ? 1 : 0)
  const nextDenials   = (prevCounts?.denials   ?? 0) + (input.action === 'deny'    ? 1 : 0)

  // Single-tier shortcut: approve from `requested` lands on `finalized` when
  // requiredApprovals === 1. Multi-tier flows still hit `approved` first.
  const autoFinalized = input.action === 'approve'
    ? resolveApproveTarget(from as ApprovalStageId, prevCounts, nextApprovals)
    : null
  const nextStage: ApprovalStageId = autoFinalized ?? transition.to

  // `revoke` resets the counts — the new request starts fresh.
  const resetCounts = input.action === 'revoke'
  const counts = prevCounts
    ? resetCounts
      ? { ...prevCounts, approvals: 0, denials: 0 }
      : { ...prevCounts, approvals: nextApprovals, denials: nextDenials }
    : undefined

  const nextStageObj: ApprovalStage = {
    stage: nextStage,
    updatedAt: at,
    history: appendAuditEntry(current?.history ?? [], entrySeed),
    ...(counts ? { counts } : {}),
  }

  return { ok: true, stage: nextStageObj }
}

/**
 * Convenience: returns the set of legal actions from a given stage, for
 * UI rendering. Does not read owner config — the `ConfigPanel.approvals`
 * block still filters which of these actions are surfaced to the user.
 */
export function legalActionsFrom(
  from: TransitionSource,
): readonly (ApprovalActionId | 'revoke')[] {
  const out = new Set<ApprovalActionId | 'revoke'>()
  for (const t of LEGAL_TRANSITIONS) {
    if (t.from === from) out.add(t.action)
  }
  return Array.from(out)
}
