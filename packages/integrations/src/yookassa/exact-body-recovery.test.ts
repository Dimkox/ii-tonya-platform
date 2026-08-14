import { describe, expect, it, vi } from "vitest";
import { recoverExactYooKassaOperation } from "./exact-body-recovery.js";

const claim = {
  operationId: "operation-1",
  operationKind: "create_payment" as const,
  encryptedBody: "cipher:v1:opaque",
  bodyVersion: 1,
  keyReference: "kms:yookassa-replay-v1",
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  requestDigest: `sha256:${"a".repeat(64)}`,
  leaseToken: "lease-1",
  status: "unknown_outcome" as const,
  providerObjectId: null,
};

describe("exact-body YooKassa recovery", () => {
  it("does zero crypto, network, or mutation I/O while disabled", async () => {
    const decrypt = vi.fn();
    const postExact = vi.fn();
    const bind = vi.fn();
    await expect(
      recoverExactYooKassaOperation({
        enabled: false,
        claim,
        decryptor: { decrypt },
        transport: { postExact },
        completion: { bind, manualReview: vi.fn() },
      }),
    ).resolves.toEqual({ kind: "disabled" });
    expect(decrypt).not.toHaveBeenCalled();
    expect(postExact).not.toHaveBeenCalled();
    expect(bind).not.toHaveBeenCalled();
  });

  it("posts the exact decrypted body with the original key and binds atomically", async () => {
    const body = '{"amount":{"currency":"RUB","value":"500.00"}}';
    const postExact = vi
      .fn()
      .mockResolvedValue({ providerObjectId: "payment_1" });
    const bind = vi.fn().mockResolvedValue(undefined);
    const decrypt = vi.fn().mockResolvedValue({ body, bodyVersion: 1 });
    await expect(
      recoverExactYooKassaOperation({
        enabled: true,
        claim,
        decryptor: { decrypt },
        transport: { postExact },
        completion: { bind, manualReview: vi.fn() },
      }),
    ).resolves.toEqual({ kind: "bound", providerObjectId: "payment_1" });
    expect(decrypt).toHaveBeenCalledWith({
      encryptedBody: claim.encryptedBody,
      keyReference: claim.keyReference,
      associatedData: {
        operationId: claim.operationId,
        operationKind: claim.operationKind,
        idempotencyKey: claim.idempotencyKey,
        requestDigest: claim.requestDigest,
        bodyVersion: claim.bodyVersion,
      },
    });
    expect(postExact).toHaveBeenCalledWith({
      operationKind: "create_payment",
      body,
      idempotencyKey: claim.idempotencyKey,
    });
    expect(bind).toHaveBeenCalledWith(
      claim.operationId,
      claim.leaseToken,
      "payment_1",
    );
  });

  it("fails closed to manual review on snapshot version mismatch", async () => {
    const manualReview = vi.fn().mockResolvedValue(undefined);
    await expect(
      recoverExactYooKassaOperation({
        enabled: true,
        claim,
        decryptor: {
          decrypt: vi.fn().mockResolvedValue({ body: "{}", bodyVersion: 2 }),
        },
        transport: { postExact: vi.fn() },
        completion: { bind: vi.fn(), manualReview },
      }),
    ).resolves.toEqual({ kind: "manual_review" });
    expect(manualReview).toHaveBeenCalledWith(
      claim.operationId,
      claim.leaseToken,
      "snapshot_version_mismatch",
    );
  });

  it.each([
    ["succeeded", null],
    ["canceled", null],
    ["failed", null],
    ["unknown_outcome", "payment_1"],
  ] as const)(
    "never posts an ineligible %s/provider-bound operation",
    async (status, providerObjectId) => {
      const postExact = vi.fn();
      await expect(
        recoverExactYooKassaOperation({
          enabled: true,
          claim: { ...claim, status, providerObjectId },
          decryptor: { decrypt: vi.fn() },
          transport: { postExact },
          completion: { bind: vi.fn(), manualReview: vi.fn() },
        }),
      ).resolves.toEqual({ kind: "ineligible" });
      expect(postExact).not.toHaveBeenCalled();
    },
  );
});
