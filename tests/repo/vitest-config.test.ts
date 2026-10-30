import { describe, expect, it, vi } from "vitest";

import vitestConfig from "../../vitest.config.js";

describe("Vitest repository defaults", () => {
  it("serializes local aggregate runs with the deterministic repository default", () => {
    const config = vitestConfig as { test?: { maxWorkers?: number } };

    expect(config.test?.maxWorkers).toBe(1);
  });

  it("enables coverage and JSON evidence only for hosted CI", async () => {
    vi.stubEnv("II_TONYA_CI_DB_REPORT", "true");
    try {
      vi.resetModules();
      const config = (await import("../../vitest.config.js")).default as {
        test?: {
          reporters?: string[];
          outputFile?: { json?: string };
          coverage?: { enabled?: boolean };
        };
      };
      expect(config.test?.reporters).toEqual(["default", "json"]);
      expect(config.test?.outputFile?.json).toBe("vitest-results.json");
      expect(config.test?.coverage?.enabled).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
