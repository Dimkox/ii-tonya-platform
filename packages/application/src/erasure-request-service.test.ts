import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  createErasureRequestService,
  type ErasureRequestRepository,
} from "./erasure-request-service.js";

const owner = "11111111-1111-4111-8111-111111111111";
const token = `er1.${Buffer.alloc(32, 7).toString("base64url")}`;
const row = {
  id: "request",
  createdAt: "2026-10-09T00:00:00.000Z",
  jobId: null,
};
function fixture() {
  const repository: ErasureRequestRepository = {
    accept: vi.fn(async () => ({ kind: "accepted" as const, request: row })),
    findOwned: vi.fn(async () => row),
    findByReceiptDigest: vi.fn(async () => row),
    getVerifiedJob: vi.fn(async () => ({
      status: "pending" as const,
      retainedFacts: null,
    })),
  };
  return {
    repository,
    service: createErasureRequestService({ repository, requestEnabled: true }),
  };
}
it("stores only the domain separated digest and returns minimal pending status", async () => {
  const { service, repository } = fixture();
  expect(
    await service.request({
      principalUserId: owner,
      targetUserId: owner,
      receiptToken: token,
    }),
  ).toEqual({
    kind: "accepted",
    request: {
      requestId: "request",
      requestedAt: row.createdAt,
      stage: "awaiting_execution",
      retainedFacts: null,
    },
  });
  expect(repository.accept).toHaveBeenCalledWith({
    userId: owner,
    receiptDigest: createHash("sha256")
      .update("ii-tonya:erasure-receipt:v1\0" + token)
      .digest("hex"),
  });
});
it.each(["", token + "=", token.replace(/.$/u, "d"), "er1." + "A".repeat(44)])(
  "denies malformed or noncanonical receipt without storage: %s",
  async (receiptToken) => {
    const { service, repository } = fixture();
    expect(await service.readReceipt(receiptToken)).toEqual({ kind: "denied" });
    expect(repository.findByReceiptDigest).not.toHaveBeenCalled();
  },
);
it("denies mismatched and empty owners before storage", async () => {
  const { service, repository } = fixture();
  for (const principalUserId of ["", "foreign"])
    expect(
      await service.request({
        principalUserId,
        targetUserId: owner,
        receiptToken: token,
      }),
    ).toEqual({ kind: "denied" });
  expect(repository.accept).not.toHaveBeenCalled();
});
it("closing creation preserves owner and receipt reads", async () => {
  const { repository } = fixture();
  const service = createErasureRequestService({ repository });
  expect(
    await service.request({
      principalUserId: owner,
      targetUserId: owner,
      receiptToken: token,
    }),
  ).toEqual({ kind: "unavailable" });
  expect(
    (await service.readOwned({ principalUserId: owner, targetUserId: owner }))
      .kind,
  ).toBe("found");
  expect((await service.readReceipt(token)).kind).toBe("found");
});
it.each([
  ["pending", "deleting"],
  ["processor_complete", "awaiting_backup"],
  ["dead_letter", "needs_attention"],
  ["backup_verified", "completed"],
] as const)("maps validated %s to %s", async (status, stage) => {
  const { service, repository } = fixture();
  vi.mocked(repository.findByReceiptDigest).mockResolvedValue({
    ...row,
    jobId: "job",
  });
  vi.mocked(repository.getVerifiedJob).mockResolvedValue({
    status,
    retainedFacts: { ledgerFactsPreserved: 3, auditFactsPreserved: 2 },
  });
  expect(await service.readReceipt(token)).toEqual({
    kind: "found",
    request: {
      requestId: "request",
      requestedAt: row.createdAt,
      stage,
      retainedFacts: { ledgerFactsPreserved: 3, auditFactsPreserved: 2 },
    },
  });
});
it("sanitizes failed proofs, invalid timestamps, unknown and revoked receipts", async () => {
  const { service, repository } = fixture();
  vi.mocked(repository.findByReceiptDigest).mockResolvedValue({
    ...row,
    jobId: "job",
  });
  vi.mocked(repository.getVerifiedJob).mockRejectedValue(new Error(token));
  expect(await service.readReceipt(token)).toEqual({ kind: "unavailable" });
  vi.mocked(repository.findByReceiptDigest).mockResolvedValue({
    ...row,
    createdAt: "infinity",
  });
  expect(await service.readReceipt(token)).toEqual({ kind: "unavailable" });
  vi.mocked(repository.findByReceiptDigest).mockResolvedValue(null);
  expect(await service.readReceipt(token)).toEqual({ kind: "denied" });
});
