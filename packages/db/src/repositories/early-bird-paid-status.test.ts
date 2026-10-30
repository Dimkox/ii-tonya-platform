import { expect, it, vi } from "vitest";
import type { DrizzleDb } from "../client.js";
import { PostgresEarlyBirdPaidStatus } from "./early-bird-paid-status.js";
it("fails closed before DB access when the Telegram identity is not scoped to the configured bot", async () => {
  const transaction = vi.fn();
  const repository = new PostgresEarlyBirdPaidStatus(
    { transaction } as unknown as DrizzleDb,
    { botId: "1", botKey: "test", messagingConsentPolicyVersion: "v1" },
  );
  const input = {
    botId: "1",
    botKey: "test",
    telegramUserId: "123",
    chatId: "456",
  };
  expect(await repository.find(input)).toBeNull();
  expect(transaction).not.toHaveBeenCalled();
});
