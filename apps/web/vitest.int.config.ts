import { defineConfig } from 'vitest/config';
import path from 'node:path';

/** Integration tests: need the local Supabase stack. Run with `pnpm -F web test:int`. */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'server-only': path.resolve(__dirname, 'test/server-only-stub.ts'),
    },
  },
  test: { environment: 'node', include: ['test/integration/**/*.int.test.ts', 'test/integration/**/*.live.test.ts'], testTimeout: 30000, hookTimeout: 30000 },
});
