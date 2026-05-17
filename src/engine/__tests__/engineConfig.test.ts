/**
 * engineConfig — mergeRuntimeConfig branch coverage.
 */
import { describe, it, expect } from 'vitest';
import {
  mergeRuntimeConfig,
  DEFAULT_RUNTIME_CONFIG,
  DEFAULT_FEATURE_FLAGS,
} from '../engineConfig.js';

describe('mergeRuntimeConfig', () => {
  it('returns defaults when called with no arguments', () => {
    const cfg = mergeRuntimeConfig();
    expect(cfg.conflictPolicy).toBe('warn');
    expect(cfg.features).toEqual(DEFAULT_FEATURE_FLAGS);
  });

  it('overrides individual fields while keeping defaults for the rest', () => {
    const cfg = mergeRuntimeConfig({ conflictPolicy: 'block', weekStartsOn: 1 });
    expect(cfg.conflictPolicy).toBe('block');
    expect(cfg.weekStartsOn).toBe(1);
    expect(cfg.defaultView).toBe(DEFAULT_RUNTIME_CONFIG.defaultView);
  });

  it('merges partial feature-flag overrides onto defaults', () => {
    const cfg = mergeRuntimeConfig({ features: { validateOnMove: false } });
    expect(cfg.features.validateOnMove).toBe(false);
    // Other flags keep their defaults
    expect(cfg.features.validateOnCreate).toBe(DEFAULT_FEATURE_FLAGS.validateOnCreate);
  });

  it('uses default features when override does not supply features field', () => {
    // override.features is absent → ?? {} branch takes the empty object
    const cfg = mergeRuntimeConfig({ maxRecurrenceExpansions: 100 });
    expect(cfg.features).toEqual(DEFAULT_FEATURE_FLAGS);
  });
});
