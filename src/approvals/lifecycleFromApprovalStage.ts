/**
 * lifecycleFromApprovalStage — bridge approval stage → event lifecycle
 * (sprint #424 week 3).
 *
 * Week 1 added the `lifecycle` field. Week 3 closes the loop so
 * approve/deny/finalize transitions automatically advance lifecycle
 * everywhere it's surfaced (calendar pills, hover cards, dispatch
 * pipeline strip) without the host having to write a separate updater.
 *
 *   requested      → pending
 *   approved       → approved
 *   pending_higher → pending
 *   finalized      → scheduled
 *   denied         → preserved as-is (host decides whether to cancel)
 *
 * `null` is returned when the stage is unknown so callers leave the
 * existing lifecycle untouched.
 */
import type { ApprovalStageId } from '../types/assets.js';
import type { EventLifecycleState } from '../types/events.js';

export function lifecycleFromApprovalStage(
  stage: ApprovalStageId | null | undefined,
): EventLifecycleState | null {
  switch (stage) {
    case 'requested':      return 'pending';
    case 'pending_higher': return 'pending';
    case 'approved':       return 'approved';
    case 'finalized':      return 'scheduled';
    case 'denied':         return null;
    default:               return null;
  }
}
