import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` path in tsconfig.json, so tests import exactly like the app.
    alias: { '@': path.dirname(fileURLToPath(import.meta.url)) },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
