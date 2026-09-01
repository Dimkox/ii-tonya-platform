import { describe, expect, it } from "vitest";

import vitestConfig from "../../vitest.config.js";

describe("Vitest repository defaults", () => {
  it("serializes local aggregate runs with the deterministic repository default", () => {
    const config = vitestConfig as { test?: { maxWorkers?: number } };

    expect(config.test?.maxWorkers).toBe(1);
  });
});
