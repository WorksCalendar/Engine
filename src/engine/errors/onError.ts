export type CalendarErrorDomain =
  | 'validation'
  | 'mutation'
  | 'recurrence'
  | 'source'
  | 'render'
  | 'perf';

export type CalendarErrorSeverity = 'warning' | 'error' | 'fatal';

export interface StructuredCalendarError {
  readonly code: string;
  readonly message: string;
  readonly domain: CalendarErrorDomain;
  readonly severity: CalendarErrorSeverity;
  readonly recoverable: boolean;
  readonly cause?: unknown;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly timestamp: string;
}

export interface OnErrorMeta {
  readonly sourceId?: string;
  readonly operationId?: string;
  readonly eventId?: string;
  readonly phase?: 'validate' | 'mutate' | 'expand' | 'render';
}

export type OnError = (error: StructuredCalendarError, meta?: OnErrorMeta) => void;

/**
 * Helper to normalize unknown errors into the structured contract.
 */
export function toStructuredError(
  params: Omit<StructuredCalendarError, 'timestamp'>,
): StructuredCalendarError {
  return {
    ...params,
    timestamp: new Date().toISOString(),
  };
}
