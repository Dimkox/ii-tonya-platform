import { describe, expect, it } from "vitest";
import {
  canonicalAdminPayload,
  canonicalAdminPayloadHash,
  requiredApprovalObjectType,
} from "./admin-approval-repository.js";

describe("admin approval canonical payload", () => {
  it("hashes semantically identical payloads identically regardless of key order", () => {
    const first = {
      units: 500,
      target: { userId: "u-1", package: { kind: "admin", expiresInDays: 60 } },
      flags: ["audited", "immutable"],
    };
    const reordered = {
      flags: ["audited", "immutable"],
      target: { package: { expiresInDays: 60, kind: "admin" }, userId: "u-1" },
      units: 500,
    };

    expect(canonicalAdminPayload(first)).toBe(
      '{"flags":["audited","immutable"],"target":{"package":{"expiresInDays":60,"kind":"admin"},"userId":"u-1"},"units":500}',
    );
    expect(canonicalAdminPayloadHash(first)).toBe(
      canonicalAdminPayloadHash(reordered),
    );
  });

  it("rejects undefined, non-finite numbers, and non-plain objects", () => {
    expect(() => canonicalAdminPayload({ value: undefined })).toThrow(
      "Unsupported admin payload value",
    );
    expect(() => canonicalAdminPayload({ value: Number.NaN })).toThrow(
      "Unsupported admin payload number",
    );
    expect(() =>
      canonicalAdminPayload({ value: new Date() } as unknown as Parameters<
        typeof canonicalAdminPayload
      >[0]),
    ).toThrow("Unsupported admin payload object");
  });
});

describe("admin approval object mappings", () => {
  it("accepts the exact expert referral and residency action set", async () => {
    const module = await import("./admin-approval-repository.js");
    expect(module.requiredApprovalRole("expert_referral.batch_generate")).toBe(
      "security_admin",
    );
    expect(module.requiredApprovalRole("expert_residency.tariff_create")).toBe(
      "entitlement_admin",
    );
    expect(module.requiredApprovalRole("expert_referral.feature_switch")).toBe(
      "security_admin",
    );
    expect(module.requiredApprovalRole("expert_residency.sandbox_settle")).toBe(
      "entitlement_admin",
    );
    expect(module.requiredApprovalRole("expert_residency.sandbox_refund")).toBe(
      "entitlement_admin",
    );
  });

  it("fixes safety and feedback reads and resolutions to their assignment object types", () => {
    expect(requiredApprovalObjectType("safety.read")).toBe("safety_case");
    expect(requiredApprovalObjectType("safety.resolve")).toBe("safety_case");
    expect(requiredApprovalObjectType("feedback.read")).toBe("feedback_queue");
    expect(requiredApprovalObjectType("feedback.resolve")).toBe(
      "feedback_queue",
    );
    expect(requiredApprovalObjectType("package.grant")).toBeNull();
  });
});
