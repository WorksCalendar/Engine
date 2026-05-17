import { beginTransaction } from '../transactions/beginTransaction.js';
import { commitTransaction } from '../transactions/commitTransaction.js';
import { rollbackTransaction } from '../transactions/rollbackTransaction.js';
import type { EngineEvent } from '../schema/eventSchema.js';
import type { EventChange, OperationResult } from './operationResult.js';
import type { OnError } from '../errors/onError.js';
import { toStructuredError } from '../errors/onError.js';

export interface SafeMutateOptions {
  readonly onError?: OnError;
  /**
   * true: rollback on thrown errors or failed outcomes.
   * false: caller owns compensation strategy.
   */
  readonly rollbackOnError?: boolean;
}

export interface SafeMutateResult {
  readonly result: OperationResult | null;
  readonly events: ReadonlyMap<string, EngineEvent>;
  readonly rolledBack: boolean;
}

/**
 * Skeleton wrapper for safe mutation + rollback.
 *
 * Expected usage:
 *   safeMutate(events, () => engine.applyMutation(...), { onError })
 */
export function safeMutate(
  events: ReadonlyMap<string, EngineEvent>,
  run: () => OperationResult,
  opts: SafeMutateOptions = {},
): SafeMutateResult {
  const rollbackOnError = opts.rollbackOnError ?? true;
  const tx = beginTransaction(events);

  try {
    const result = run();

    if (result.status === 'accepted' || result.status === 'accepted-with-warnings') {
      const next = commitTransaction(tx, events, result.changes as ReadonlyArray<EventChange>);
      return { result, events: next.events, rolledBack: false };
    }

    if (rollbackOnError) rollbackTransaction(tx);

    return {
      result,
      events,
      rolledBack: rollbackOnError,
    };
  } catch (cause) {
    if (rollbackOnError) rollbackTransaction(tx);

    opts.onError?.(
      toStructuredError({
        code: 'MUTATION_SAFE_ROLLBACK',
        message: 'safeMutate caught an exception and rolled back.',
        domain: 'mutation',
        severity: 'error',
        recoverable: true,
        cause,
      }),
      { phase: 'mutate' },
    );

    return {
      result: null,
      events,
      rolledBack: rollbackOnError,
    };
  }
}
