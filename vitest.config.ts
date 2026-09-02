import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@ii-tonya/integrations": new URL(
        "./packages/integrations/src/index.ts",
        import.meta.url,
      ).pathname,
      "@ii-tonya/observability": new URL(
        "./packages/observability/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    include: [
      "packages/**/*.test.ts",
      "apps/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
  },
});
