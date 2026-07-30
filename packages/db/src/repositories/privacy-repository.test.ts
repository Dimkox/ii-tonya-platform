import { describe, expect, it, vi } from "vitest";
import { PostgresPrivacyRepository } from "./privacy-repository.js";

describe("PostgresPrivacyRepository disabled foundation", () => {
  it("rejects an unverified deletion envelope before opening a cleanup transaction", async () => {
    const db = { transaction: vi.fn() } as never;
    const verifyEnvelope = vi.fn().mockResolvedValue(false);
    const repository = new PostgresPrivacyRepository(db, {
      privacyMutationCapability: {
        enabled: true,
        captureManifests: async () => (["object_store", "selarti", "planerka", "make_projection"] as const).map((processor) => ({
          processor, ciphertext: `cipher:${processor}`, keyReference: "kms:test", algorithm: "aes-gcm", version: "v1", subjectDeletionKeyHash: "target-hash",
        })),
        verifyEnvelope,
      },
    });
    await expect(repository.startErasureAtomically({
      targetUserId: "00000000-0000-4000-8000-000000000001", correlationId: "privacy-test", idempotencyKey: "privacy-test", pseudonym: "hmac:test",
    })).rejects.toThrow("Privacy deletion manifest verification failed");
    expect(verifyEnvelope).toHaveBeenCalledTimes(4);
    expect((db as { transaction: ReturnType<typeof vi.fn> }).transaction).not.toHaveBeenCalled();
  });
});
