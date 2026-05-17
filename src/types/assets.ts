/**
 * Approval state machine + category/policy types used by the engine.
 *
 * Copied from the monolith's src/types/assets.ts. Only the engine-relevant
 * subset is here — host-side UI types (LocationProvider, RenderAssetLocation,
 * AssetsZoomLevel, etc.) stay in the monolith.
 */

export type ApprovalStageId =
  | 'requested'
  | 'approved'
  | 'finalized'
  | 'pending_higher'
  | 'denied';

export type ApprovalActionId =
  | 'submit' | 'approve' | 'deny' | 'downgrade' | 'finalize';

export type ApprovalHistoryActionId = ApprovalActionId | 'revoke';

export interface ApprovalHistoryEntry {
  action: ApprovalHistoryActionId;
  at: string;
  actor?: string;
  tier?: number;
  reason?: string;
  prevHash?: string;
  hash?: string;
}

export interface ApprovalStage {
  stage: ApprovalStageId;
  updatedAt: string;
  history: ApprovalHistoryEntry[];
  counts?: {
    approvals: number;
    denials: number;
    requiredApprovals: number;
  };
}

export interface BookingPolicy {
  minLeadTimeMinutes?: number;
  maxDurationMinutes?: number;
  maxAdvanceDays?: number;
  blackoutDates?: readonly string[];
}

export interface CategoryDef {
  id: string;
  label: string;
  color: string;
  description?: string;
  approvalTier?: 1 | 2;
  disabled?: boolean;
  policy?: BookingPolicy;
}
