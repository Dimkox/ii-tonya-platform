import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
vi.mock("./client-consent-authority.js", () => ({
  lockClientConsentSubject: vi.fn().mockResolvedValue(undefined),
  captureClientConsentAuthority: vi.fn().mockResolvedValue({ v: 1 }),
}));
import { expect, it, vi } from "vitest";
import { PostgresClientBotAccountReadRepository } from "./client-bot-account-read-repository.js";
import type { DrizzleDb } from "../client.js";
it("rejects wrong receiving scope before starting transaction", async () => {
  const transaction = vi.fn();
  const repo = new PostgresClientBotAccountReadRepository(
    { transaction } as unknown as DrizzleDb,
    {
      botId: "123",
      botKey: "assistant",
      messagingConsentPolicyVersion: "approved-v1",
      providerMode: "test",
    },
  );
  await expect(
    repo.read({
      botId: "456",
      botKey: "assistant",
      telegramUserId: "7",
      chatId: "7",
      updateId: 1,
      query: { kind: "coupons" },
    }),
  ).rejects.toThrow("client_account_scope_invalid");
  expect(transaction).not.toHaveBeenCalled();
});
it("rejects incomplete server mode before any read", () => {
  expect(
    () =>
      new PostgresClientBotAccountReadRepository(undefined as never, {
        botId: "123",
        botKey: "assistant",
        messagingConsentPolicyVersion: "approved-v1",
        providerMode: "other" as "test",
      }),
  ).toThrow("client_account_configuration_invalid");
});
it("does not claim a receipt or query money for an unknown owner", async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  const db = {
    transaction: async (fn: (tx: { execute: typeof execute }) => unknown) =>
      fn({ execute }),
  } as unknown as DrizzleDb;
  const repo = new PostgresClientBotAccountReadRepository(db, {
    botId: "123",
    botKey: "assistant",
    messagingConsentPolicyVersion: "approved-v1",
    providerMode: "test",
  });
  expect(
    await repo.read({
      botId: "123",
      botKey: "assistant",
      telegramUserId: "7",
      chatId: "7",
      updateId: 1,
      query: { kind: "coupons" },
    }),
  ).toEqual({ kind: "unavailable" });
  expect(execute).toHaveBeenCalledTimes(3);
});
it("snapshots server mode and nested owner query before the first await", async () => {
  const config = {
    botId: "123",
    botKey: "assistant",
    messagingConsentPolicyVersion: "approved-v1",
    providerMode: "test" as "test" | "live",
  };
  const event = {
    botId: "123",
    botKey: "assistant",
    telegramUserId: "7",
    chatId: "7",
    updateId: 1,
    query: { kind: "coupons" as const },
  };
  const calls: unknown[][] = [];
  let n = 0;
  const execute = vi.fn(async (q: SQL) => {
    calls.push(new PgDialect().sqlToQuery(q).params);
    n++;
    if (n === 1) {
      config.providerMode = "live";
      config.botKey = "foreign";
      event.telegramUserId = "8";
      event.chatId = "8";
      (event.query as { kind: string }).kind = "orders";
    }
    if (n === 3)
      return { rows: [{ userId: "00000000-0000-4000-8000-000000000001" }] };
    if (n === 4) return { rows: [{ id: "receipt" }] };
    if (n === 5)
      return {
        rows: [
          {
            totalMinor: "123",
            asOf: "2026-10-23T00:00:00Z",
            amountMinor: null,
            expiresAt: null,
            hasMore: false,
          },
        ],
      };
    return { rows: [] };
  });
  const repo = new PostgresClientBotAccountReadRepository(
    {
      transaction: async (fn: (tx: { execute: typeof execute }) => unknown) =>
        fn({ execute }),
    } as unknown as DrizzleDb,
    config,
  );
  expect((await repo.read(event)).kind).toBe("coupons");
  expect(calls[2]).toEqual(["assistant", "7", "7"]);
  expect(calls[4]).toContain("test");
  expect(calls[4]).not.toContain("live");
});
