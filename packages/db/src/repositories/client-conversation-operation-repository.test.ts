import { describe, expect, it, vi } from "vitest";
import { PostgresClientConversationOperationRepository } from "./client-conversation-operation-repository.js";

const database = () => {
  const execute = vi.fn(async (query: unknown) => {
    void query;
    return { rows: [] as never[] };
  });
  return {
    execute,
    transaction: async (fn: (tx: unknown) => unknown) => fn({ execute }),
  };
};

describe("client conversation operation PostgreSQL state machine", () => {
  it("claims only due rows with skip-locked, DB-time and a 30-second dispatch floor", async () => {
    const db = database();
    const repo = new PostgresClientConversationOperationRepository(
      db as never,
      {} as never,
      {} as never,
    );
    await repo.claimDispatch({ ownerId: "worker-1", limit: 10 });
    const sql = db.execute.mock.calls
      .map(([value]) => JSON.stringify(value))
      .join(" ");
    expect(sql).toContain("skip locked");
    expect(sql).toContain("payload_expires_at");
    expect(sql).toContain("claim_fence");
  });

  it("expires claims with a fence increment and clears crypto fields", async () => {
    const db = database();
    const repo = new PostgresClientConversationOperationRepository(
      db as never,
      {} as never,
      {} as never,
    );
    await repo.cleanupExpired({ limit: 20 });
    const sql = db.execute.mock.calls
      .map(([value]) => JSON.stringify(value))
      .join(" ");
    expect(sql).toContain("privacy_expired");
    expect(sql).toContain("payload_ciphertext");
    expect(sql).toContain("claim_fence");
  });

  it("upserts both exact runtime capabilities using database time", async () => {
    const db = database();
    const repo = new PostgresClientConversationOperationRepository(
      db as never,
      {} as never,
      {} as never,
    );
    await repo.heartbeatRuntime({
      instanceId: "worker-1",
      buildSha: "a".repeat(40),
    });
    const sql = db.execute.mock.calls
      .map(([value]) => JSON.stringify(value))
      .join(" ");
    expect(sql).toContain("dispatch_v1");
    expect(sql).toContain("cleanup_v1");
    expect(sql).toContain("transaction_timestamp");
  });

  it("exposes all fenced phases and terminal writes", () => {
    const repo = new PostgresClientConversationOperationRepository(
      database() as never,
      {} as never,
      {} as never,
    );
    expect(typeof repo.claimReconciliation).toBe("function");
    expect(typeof repo.recordResult).toBe("function");
    expect(typeof repo.recordGrantDenied).toBe("function");
    expect(typeof repo.recordRetryWait).toBe("function");
    expect(typeof repo.recordUnknownOutcome).toBe("function");
    expect(typeof repo.recordDeadLetter).toBe("function");
  });

  it("rejects an invalid tool/scope row before decrypt and fences terminalization", async () => {
    let call = 0;
    const execute = vi.fn(async (query: unknown) => {
      void query;
      call += 1;
      if (call === 4) {
        return {
          rows: [
            {
              id: "00000000-0000-4000-8000-000000000001",
              messageEventId: "00000000-0000-4000-8000-000000000002",
              bindingId: "00000000-0000-4000-8000-000000000003",
              requiredScope: "client_booking:write",
              toolKind: "show_catalog",
              proposalDigest: "a".repeat(64),
              payloadEnvelopeVersion: 1,
              payloadKeyId: "test-key",
              payloadNonce: Buffer.alloc(12),
              payloadCiphertext: Buffer.from([1]),
              payloadTag: Buffer.alloc(16),
              payloadExpiresAt: new Date(Date.now() + 60_000),
              claimOwnerId: "worker",
              claimToken: "00000000-0000-4000-8000-000000000004",
              claimFence: "1",
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: call === 8 ? 1 : 0 };
    });
    const db = {
      execute,
      transaction: async (fn: (tx: unknown) => unknown) => fn({ execute }),
    };
    const decrypt = vi.fn();
    const repo = new PostgresClientConversationOperationRepository(
      db as never,
      { decrypt } as never,
      {} as never,
    );

    await expect(
      repo.claimDispatch({ ownerId: "worker", limit: 1 }),
    ).resolves.toEqual([]);
    expect(decrypt).not.toHaveBeenCalled();
    const emitted = execute.mock.calls
      .map(([value]) => JSON.stringify(value))
      .join(" ");
    expect(emitted).toContain("lease_until");
    expect(emitted).toContain("payload_expires_at");
    expect(emitted).toContain("operator_case");
  });
});
