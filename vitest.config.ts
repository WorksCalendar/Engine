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
  },
});
