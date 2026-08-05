import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
    // Explicit imports (no globals) keep test files honest about their deps
    // and let `verbatimModuleSyntax` do its job.
    globals: false,
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/tests/**',
        'src/types/**',
        'src/**/index.ts',
        // Bootstrap wiring is exercised by the integration tests through the
        // real Fastify instance rather than measured directly.
        'src/index.ts',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
});
