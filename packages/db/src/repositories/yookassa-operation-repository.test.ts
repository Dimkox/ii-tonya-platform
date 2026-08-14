import { describe, expect, it } from "vitest";
import {
  YooKassaOperationError,
  canonicalYooKassaRequestDigest,
} from "./yookassa-operation-repository.js";

const command = {
  commandId: "00000000-0000-4000-8000-000000000101",
  orderId: "00000000-0000-4000-8000-000000000102",
  paymentAttemptId: "00000000-0000-4000-8000-000000000103",
  kind: "create_payment" as const,
  mode: "test" as const,
  amountMinor: "50000",
  currency: "RUB" as const,
  requestDigest: `sha256:${"a".repeat(64)}`,
};

describe("YooKassa operation repository contracts", () => {
  it("computes a stable canonical operation digest", () => {
    expect(canonicalYooKassaRequestDigest(command)).toBe(
      canonicalYooKassaRequestDigest({ ...command }),
    );
    expect(canonicalYooKassaRequestDigest(command)).toMatch(
      /^sha256:[0-9a-f]{64}$/u,
    );
  });

  it("binds every financial identity fact into the canonical digest", () => {
    for (const changed of [
      { ...command, commandId: "00000000-0000-4000-8000-000000000201" },
      { ...command, orderId: "00000000-0000-4000-8000-000000000202" },
      { ...command, paymentAttemptId: "00000000-0000-4000-8000-000000000203" },
      { ...command, mode: "live" as const },
      { ...command, amountMinor: "50001" },
      { ...command, requestDigest: `sha256:${"b".repeat(64)}` },
    ]) {
      expect(canonicalYooKassaRequestDigest(changed)).not.toBe(
        canonicalYooKassaRequestDigest(command),
      );
    }
  });

  it("uses a bounded sanitized conflict error", () => {
    const error = new YooKassaOperationError("YOOKASSA_IDEMPOTENCY_CONFLICT");
    expect(error.code).toBe("YOOKASSA_IDEMPOTENCY_CONFLICT");
    expect(String(error)).not.toContain(command.requestDigest);
  });
});
