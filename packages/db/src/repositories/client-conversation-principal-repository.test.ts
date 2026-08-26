import { describe, expect, it, vi } from "vitest";

import { PostgresClientConversationPrincipalRepository } from "./client-conversation-principal-repository.js";

describe("PostgresClientConversationPrincipalRepository", () => {
  it("returns raw active-binding facts and uses exact authority input", async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [
        {
          bindingId: "10000000-0000-4000-8000-000000000001",
          userId: "10000000-0000-4000-8000-000000000002",
        },
      ],
    });
    const repository = new PostgresClientConversationPrincipalRepository({
      execute,
    } as never);
    await expect(
      repository.findActive({
        provider: "selarti.client-thread.v1",
        tenantToken: `hmac-sha256:v1:${"a".repeat(64)}`,
        subjectToken: `hmac-sha256:v1:${"b".repeat(64)}`,
        tokenVersion: 1,
      }),
    ).resolves.toEqual([
      {
        bindingId: "10000000-0000-4000-8000-000000000001",
        userId: "10000000-0000-4000-8000-000000000002",
      },
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("denies invalid runtime inputs before querying", async () => {
    const execute = vi.fn();
    const repository = new PostgresClientConversationPrincipalRepository({
      execute,
    } as never);
    await expect(
      repository.findActive({
        provider: "selarti",
        tenantToken: "bad",
        subjectToken: "bad",
        tokenVersion: 2,
      } as never),
    ).resolves.toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("denies malformed runtime values without throwing or querying", async () => {
    const execute = vi.fn();
    const repository = new PostgresClientConversationPrincipalRepository({
      execute,
    } as never);

    for (const malformed of [null, undefined, "token", {}, []]) {
      await expect(repository.findActive(malformed as never)).resolves.toEqual(
        [],
      );
    }
    expect(execute).not.toHaveBeenCalled();
  });
});
