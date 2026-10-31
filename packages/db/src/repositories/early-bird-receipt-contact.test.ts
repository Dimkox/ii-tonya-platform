import { expect, it, vi } from "vitest";
import { PostgresEarlyBirdReceiptContact } from "./early-bird-receipt-contact.js";
import type { DrizzleDb } from "../client.js";
it("fails closed without an authorized scope or a receipt vault", async () => {
  const transaction = vi.fn();
  const source = {
    resolve: vi.fn(async () => null),
    resolveCurrent: vi.fn(async () => null),
  };
  const repository = new PostgresEarlyBirdReceiptContact(
    { transaction } as unknown as DrizzleDb,
    source,
    undefined,
  );
  const scope = {
    botId: "1",
    botKey: "test",
    telegramUserId: "123",
    chatId: "123",
    offerId: "2526c71d-803f-4c3d-9b57-74e902170001",
    choiceId: "2526c71d-803f-4c3d-9b57-74e902170002",
  };
  await expect(
    repository.capture(scope, "fixture@example.invalid", "fixture-1"),
  ).rejects.toThrow("early_bird_receipt_unavailable");
  expect(transaction).not.toHaveBeenCalled();
});
