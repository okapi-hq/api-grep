import { defineConfig } from "vitest/config";

/** End-to-end: every test spawns `dist/cli.js` as a user would run it. Build first (`pnpm build`). */
export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.e2e.test.ts"],
    globalSetup: ["tests/e2e/global-setup.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
