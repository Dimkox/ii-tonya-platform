import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@ii-tonya\/api$/u,
        replacement: fileURLToPath(
          new URL("./apps/api/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@ii-tonya\/observability$/u,
        replacement: fileURLToPath(
          new URL("./packages/observability/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@ii-tonya\/sandbox-payments$/u,
        replacement: fileURLToPath(
          new URL("./packages/sandbox-payments/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@ii-tonya\/integrations$/u,
        replacement: fileURLToPath(
          new URL("./packages/integrations/src/index.ts", import.meta.url),
        ),
      },
    ],
  },
  test: {
    include: [
      "packages/**/*.test.ts",
      "apps/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
  },
});
