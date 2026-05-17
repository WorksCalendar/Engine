/**
 * `gateEventRequirements` — engine-shaped gate on top of
 * `evaluateRequirements` (issue #448).
 *
 * `evaluateRequirements` is the pure source-of-truth: it tells you
 * which slots aren't filled. This helper wraps it in the engine's
 * standard `ValidationResult` shape so hosts can plug requirement
 * gating into the same UI / commit pipeline that handles overlap
 * and working-hours violations.
 *
 *   Hard shortfall → `severity: 'hard'` violation. `allowed: false`
 *                    when any hard shortfall exists.
 *   Soft shortfall → `severity: 'soft'` violation. Stays warn-only.
 *   No template     → no violations (matches `evaluateRequirements`'s
 *                    "no template = no requirement to fail" rule).
 *
 * Pure / sync. Doesn't mutate the engine state.
 */
import type { ValidationResult, Violation } from '../engine/validation/validationTypes.js'
import {
  evaluateRequirements,
  type EvaluateRequirementsInput,
  type RequirementShortfall,
} from './evaluateRequirements.js'

export type GateEventRequirementsInput = EvaluateRequirementsInput

export function gateEventRequirements(
  input: GateEventRequirementsInput,
): ValidationResult {
  const evaluation = evaluateRequirements(input)

  if (evaluation.missing.length === 0) {
    return {
      allowed: true,
      severity: 'none',
      violations: [],
      suggestedPatch: null,
    }
  }

  const violations: Violation[] = evaluation.missing.map(toViolation)
  const hasHard = violations.some(v => v.severity === 'hard')
  const hasSoft = violations.some(v => v.severity === 'soft')

  return {
    allowed: !hasHard,
    severity: hasHard ? 'hard' : hasSoft ? 'soft' : 'none',
    violations,
    suggestedPatch: null,
  }
}

function toViolation(s: RequirementShortfall): Violation {
  if (s.kind === 'role') {
    return {
      rule: 'requirements.role',
      severity: s.severity,
      message: `Missing ${s.missing} ${plural(s.missing, 'assignment')} for role "${s.role}" (have ${s.assigned} of ${s.required}).`,
      details: {
        kind: 'role',
        role: s.role,
        required: s.required,
        assigned: s.assigned,
        missing: s.missing,
      },
    }
  }
  // pool
  if (s.poolUnknown) {
    return {
      rule: 'requirements.pool-unknown',
      severity: s.severity,
      message: `Pool "${s.pool}" referenced by requirement is not registered.`,
      details: {
        kind: 'pool',
        pool: s.pool,
        required: s.required,
        assigned: 0,
        missing: s.required,
        poolUnknown: true,
      },
    }
  }
  return {
    rule: 'requirements.pool',
    severity: s.severity,
    message: `Missing ${s.missing} ${plural(s.missing, 'assignment')} from pool "${s.pool}" (have ${s.assigned} of ${s.required}).`,
    details: {
      kind: 'pool',
      pool: s.pool,
      required: s.required,
      assigned: s.assigned,
      missing: s.missing,
    },
  }
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`
}
