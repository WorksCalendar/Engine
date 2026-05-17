/**
 * lifecycleFromApprovalStage — sprint #424 week 3.
 *
 * The bridge maps approval stages onto the event lifecycle so the
 * request → approval → event loop is visible everywhere the lifecycle
 * is rendered (calendar pills, hover cards, dispatch pipeline strip)
 * without the host having to write a separate updater.
 */
import { describe, it, expect } from 'vitest';

import { lifecycleFromApprovalStage } from '../lifecycleFromApprovalStage.js';

describe('lifecycleFromApprovalStage', () => {
  it('maps requested + pending_higher to pending', () => {
    expect(lifecycleFromApprovalStage('requested')).toBe('pending');
    expect(lifecycleFromApprovalStage('pending_higher')).toBe('pending');
  });

  it('maps approved to approved', () => {
    expect(lifecycleFromApprovalStage('approved')).toBe('approved');
  });

  it('maps finalized to scheduled', () => {
    expect(lifecycleFromApprovalStage('finalized')).toBe('scheduled');
  });

  it('returns null for denied so the host decides cancellation policy', () => {
    expect(lifecycleFromApprovalStage('denied')).toBeNull();
  });

  it('returns null for unknown / null stage', () => {
    expect(lifecycleFromApprovalStage(null)).toBeNull();
    expect(lifecycleFromApprovalStage(undefined)).toBeNull();
  });
});
