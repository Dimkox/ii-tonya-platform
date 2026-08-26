import { describe, expect, it } from "vitest";
import { createClientConversationOperationsJob } from "./client-conversation-operations.js";

describe("client conversation operation job", () => {
  it("is a dedicated fenced job and never depends on the outbox registry", () => {
    const job = createClientConversationOperationsJob({
      repository: {
        claim: async () => null,
        cleanupExpired: async () => ({ expired: 0 }),
        reconcile: async () => ({ reconciled: 0 }),
      },
      gateways: {},
    });

    expect(job).toHaveProperty("runDispatch");
    expect(job).toHaveProperty("runCleanup");
    expect(job).not.toHaveProperty("outbox");
  });
});
