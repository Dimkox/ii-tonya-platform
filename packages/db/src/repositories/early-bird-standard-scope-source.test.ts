import { expect, it, vi } from "vitest";
import { PostgresEarlyBirdStandardScopeSource } from "./early-bird-standard-scope-source.js";
import type { DrizzleDb } from "../client.js";
it("rejects wrong bot and unbound chat before accessing PostgreSQL", async () => {
  const transaction = vi.fn();
  const source = new PostgresEarlyBirdStandardScopeSource(
    { transaction } as unknown as DrizzleDb,
    { botId: "1", botKey: "test", messagingConsentPolicyVersion: "v1" },
    Buffer.alloc(32, 1),
  );
  const input = {
    botId: "2",
    botKey: "test",
    telegramUserId: "123",
    chatId: "123",
    offerId: "2526c71d-803f-4c3d-9b57-74e902170001",
    choiceId: "2526c71d-803f-4c3d-9b57-74e902170002",
  };
  expect(await source.resolve(input)).toBeNull();
  expect(
    await source.resolve({ ...input, botId: "1", chatId: "124" }),
  ).toBeNull();
  expect(transaction).not.toHaveBeenCalled();
});
