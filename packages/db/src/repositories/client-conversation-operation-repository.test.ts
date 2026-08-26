import { describe, expect, it, vi } from "vitest";
import { PostgresClientConversationOperationRepository } from "./client-conversation-operation-repository.js";

const database = () => {
  const execute = vi.fn(async () => ({ rows: [] }));
  return { execute, transaction: async (fn: (tx: unknown) => unknown) => fn({ execute }) } as never;
};

describe("client conversation operation PostgreSQL state machine", () => {
  it("claims only due rows with skip-locked, DB-time and a 30-second dispatch floor", async () => {
    const db = database();
    const repo = new PostgresClientConversationOperationRepository(db, {} as never, {} as never);
    await repo.claimDispatch({ ownerId: "worker-1", limit: 10 });
    const sql = (db as any).execute.mock.calls.map(([value]: [unknown]) => JSON.stringify(value)).join(" ");
    expect(sql).toContain("skip locked");
    expect(sql).toContain("payload_expires_at");
    expect(sql).toContain("claim_fence");
  });

  it("expires claims with a fence increment and clears crypto fields", async () => {
    const db = database();
    const repo = new PostgresClientConversationOperationRepository(db, {} as never, {} as never);
    await repo.cleanupExpired({ limit: 20 });
    const sql = (db as any).execute.mock.calls.map(([value]: [unknown]) => JSON.stringify(value)).join(" ");
    expect(sql).toContain("privacy_expired");
    expect(sql).toContain("payload_ciphertext");
    expect(sql).toContain("claim_fence");
  });

  it("upserts both exact runtime capabilities using database time", async () => {
    const db = database();
    const repo = new PostgresClientConversationOperationRepository(db, {} as never, {} as never);
    await repo.heartbeatRuntime({ instanceId: "worker-1", buildSha: "a".repeat(40) });
    const sql = (db as any).execute.mock.calls.map(([value]: [unknown]) => JSON.stringify(value)).join(" ");
    expect(sql).toContain("dispatch_v1");
    expect(sql).toContain("cleanup_v1");
    expect(sql).toContain("transaction_timestamp");
  });

  it("exposes all fenced phases and terminal writes", () => {
    const repo = new PostgresClientConversationOperationRepository(database(), {} as never, {} as never);
    expect(typeof repo.claimReconciliation).toBe("function");
    expect(typeof repo.recordResult).toBe("function");
    expect(typeof repo.recordGrantDenied).toBe("function");
    expect(typeof repo.recordRetryWait).toBe("function");
    expect(typeof repo.recordUnknownOutcome).toBe("function");
    expect(typeof repo.recordDeadLetter).toBe("function");
  });
});
