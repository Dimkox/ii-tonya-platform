import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: [
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
