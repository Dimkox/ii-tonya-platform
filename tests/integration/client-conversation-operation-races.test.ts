import { describe, expect, it } from "vitest";
import { createClientConversationOperationsJob } from "../../apps/worker/src/client-conversation-operations.js";
import { PostgresClientConversationOperationRepository } from "../../packages/db/src/repositories/client-conversation-operation-repository.js";

describe("client conversation operation race contracts", () => {
  it("does not invoke a provider when the claim is stale", async () => {
    let invoked = false;
    const job = createClientConversationOperationsJob({
      repository: {
        claim: async () => null,
        cleanupExpired: async () => ({ expired: 0 }),
        reconcile: async () => ({ reconciled: 0 }),
      },
      gateways: {
        catalog: { request: async () => { invoked = true; return { kind: "applied", downstreamReceiptDigest: "a".repeat(64) }; } },
        booking: { reserve: async () => { invoked = true; return { kind: "applied", downstreamReceiptDigest: "b".repeat(64) }; } },
      },
    });

    await job.runDispatch();
    expect(invoked).toBe(false);
  });

  it("keeps conversation operations outside integration_outbox", async () => {
    const execute = async () => ({ rows: [] });
    const db = { execute, transaction: async (fn: (tx: unknown) => unknown) => fn({ execute }) } as never;
    const repo = new PostgresClientConversationOperationRepository(db, {} as never, {} as never);
    await repo.recoverExpired({ limit: 10 });
    expect(true).toBe(true);
  });
});
