import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/renderer/**/*.test.tsx'],
    setupFiles: ['tests/renderer/setup.ts'],
    clearMocks: true,
    coverage: {
      provider: 'v8',
      include: [
        'apps/desktop/src/**/*.tsx',
        'apps/desktop/src/hooks/**/*.ts',
        'apps/desktop/src/renderer/**/*.ts',
      ],
      exclude: ['**/*.d.ts'],
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage/renderer',
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 75 },
    },
  },
});
