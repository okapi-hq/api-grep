import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // the end-to-end suite runs the built CLI: `pnpm build && pnpm test:e2e`
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
    testTimeout: 60_000,
  },
});
