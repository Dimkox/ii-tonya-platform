import { describe, expect, it } from "vitest";
import { erasureFixture } from "./privacy-erasure.testkit.js";
import { runErasureWorkflow } from "./privacy-erasure.js";

describe("processor-wide erasure", () => {
  it("resumes after a crash without repeating an acknowledged processor deletion", async () => {
    const deps = erasureFixture({
      processors: ["object_store", "selarti", "planerka", "make_projection"],
      crashAfter: "selarti",
    });
    await expect(runErasureWorkflow(deps, "erase-job-1")).rejects.toThrow("simulated crash");
    await runErasureWorkflow(deps, "erase-job-1");
    expect(deps.processorCalls("object_store")).toBe(1);
    expect(deps.processorCalls("selarti")).toBe(1);
    expect(deps.processorCalls("planerka")).toBe(1);
    expect(deps.processorCalls("make_projection")).toBe(1);
    expect(deps.job()).toMatchObject({ status: "processor_complete" });
  });

  it("records backup expiry evidence instead of claiming immediate backup deletion", async () => {
    const deps = erasureFixture({ processors: [] });
    await runErasureWorkflow(deps, "erase-job-2");
    expect(deps.job().backupEvidence).toEqual({
      policyVersion: "backup-retention-v1",
      expiresNoLaterThan: "2026-08-27T10:00:00.000Z",
      verificationState: "scheduled",
    });
  });
});
