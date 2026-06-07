import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/*.test.ts'],
    globals: false,
    // Pin to UTC so date-sensitive tests (timezone math, business hours,
    // recurrence DST boundaries) produce identical results regardless of
    // the runner's local timezone. Replaces the cross-env TZ=UTC wrapper.
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/__tests__/**',
        'src/**/test-fixtures/**',
        'src/**/*.test.ts',
        // Barrel re-export — no executable logic of its own.
        'src/index.ts',
      ],
      reporter: ['text-summary', 'lcov'],
      // Ratchet floor: set just under the measured baseline so the suite
      // can't regress. Raise these numbers as coverage improves — never
      // lower them. (Baseline at introduction: stmts 74 / branch 66 /
      // funcs 77 / lines 76.)
      thresholds: {
        statements: 73,
        branches: 65,
        functions: 76,
        lines: 75,
      },
    },
  },
});
