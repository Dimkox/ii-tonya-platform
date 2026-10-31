import { expect, it, vi } from "vitest";
import type { PayerReceiptVault } from "@ii-tonya/integrations";
import type { DrizzleDb } from "../client.js";
import { PostgresDeferredReceiptContact } from "./early-bird-deferred-receipt-contact.js";

it("does not persist a receipt without an authenticated scope", async () => {
  const transaction = vi.fn();
  const source = { resolve: vi.fn().mockResolvedValue(null) };
  const seal = vi.fn();
  const contact = new PostgresDeferredReceiptContact(
    { transaction } as unknown as DrizzleDb,
    source,
    { seal } as unknown as PayerReceiptVault,
  );
  await expect(
    contact.capture(
      {
        botId: "bot",
        botKey: "bot",
        telegramUserId: "1",
        chatId: "1",
        offerId: crypto.randomUUID(),
        choiceId: crypto.randomUUID(),
        accountId: crypto.randomUUID(),
      },
      "owner@example.org",
      "receipt-id-1234",
    ),
  ).rejects.toThrow("early_bird_deferred_receipt_unavailable");
  expect(source.resolve).toHaveBeenCalledOnce();
  expect(transaction).not.toHaveBeenCalled();
  expect(seal).not.toHaveBeenCalled();
});
