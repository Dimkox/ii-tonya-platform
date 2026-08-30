import { describe, expect, it, vi } from "vitest";
import { loadEnv } from "../../../packages/config/src/env.js";
import { selectTestExpertReconciliation } from "./main.js";

const config = (enabled: boolean) =>
  loadEnv({
    DATABASE_URL: "postgres://u:p@localhost:5432/db",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    TEST_EXPERT_RECONCILIATION_ENABLED: String(enabled),
  });

describe("test-expert worker reconciliation composition", () => {
  it("is default-off and does not construct capabilities", () => {
    const factory = vi.fn();
    expect(
      selectTestExpertReconciliation(config(false), factory),
    ).toBeUndefined();
    expect(factory).not.toHaveBeenCalled();
  });

  it("fails startup unless repository, authority and metrics are all operational", () => {
    expect(() => selectTestExpertReconciliation(config(true))).toThrow(
      "test_expert_reconciliation_capability_unavailable",
    );
    expect(() =>
      selectTestExpertReconciliation(config(true), () => ({
        repository: {},
        authority: {},
        metrics: {},
      })),
    ).toThrow("test_expert_reconciliation_capability_unavailable");
  });
});
