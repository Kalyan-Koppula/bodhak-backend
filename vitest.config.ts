import { defineConfig } from 'vitest/config';

export default defineConfig({
  // cast test config to any so we can use globalSetup/globalTeardown without TS errors
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./test/setup/setup.ts'],
    // start the wrangler dev server once for the whole run
    globalSetup: './test/setup/globalSetup.ts',
    globalTeardown: './test/setup/globalTeardown.ts',
    testTimeout: 60000,
  } as any,
});
