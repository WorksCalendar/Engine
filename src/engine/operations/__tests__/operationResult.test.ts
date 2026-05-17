import { describe, it, expect } from 'vitest';
import {
  isAccepted,
  makeRejectedResult,
  makePendingResult,
} from '../operationResult.js';
import type { OperationResult } from '../operationResult.js';
import { VALID_RESULT } from '../../validation/validationTypes.js';

const op = { type: 'delete' as const, id: 'ev1' };

const hardResult = {
  ...VALID_RESULT,
  allowed: false,
  severity: 'hard' as const,
  violations: [{ rule: 'test', severity: 'hard' as const, message: 'blocked' }],
};

// ─── isAccepted ───────────────────────────────────────────────────────────────

describe('isAccepted', () => {
  it('returns true for accepted status', () => {
    const r: OperationResult = {
      status: 'accepted',
      operation: op,
      validation: VALID_RESULT,
      changes: [],
    };
    expect(isAccepted(r)).toBe(true);
  });

  it('returns true for accepted-with-warnings status', () => {
    const r: OperationResult = {
      status: 'accepted-with-warnings',
      operation: op,
      validation: VALID_RESULT,
      changes: [],
    };
    expect(isAccepted(r)).toBe(true);
  });

  it('returns false for rejected status', () => {
    const r: OperationResult = {
      status: 'rejected',
      operation: op,
      validation: hardResult,
      changes: [],
    };
    expect(isAccepted(r)).toBe(false);
  });

  it('returns false for pending-confirmation status', () => {
    const r: OperationResult = {
      status: 'pending-confirmation',
      operation: op,
      validation: VALID_RESULT,
      changes: [],
    };
    expect(isAccepted(r)).toBe(false);
  });
});

// ─── makeRejectedResult ───────────────────────────────────────────────────────

describe('makeRejectedResult', () => {
  it('creates a rejected result with empty changes', () => {
    const result = makeRejectedResult(op, hardResult);
    expect(result.status).toBe('rejected');
    expect(result.operation).toBe(op);
    expect(result.validation).toBe(hardResult);
    expect(result.changes).toEqual([]);
  });
});

// ─── makePendingResult ────────────────────────────────────────────────────────

describe('makePendingResult', () => {
  it('creates a pending-confirmation result with empty changes', () => {
    const result = makePendingResult(op, VALID_RESULT);
    expect(result.status).toBe('pending-confirmation');
    expect(result.operation).toBe(op);
    expect(result.validation).toBe(VALID_RESULT);
    expect(result.changes).toEqual([]);
  });
});
