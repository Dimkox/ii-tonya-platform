import { describe, expect, it } from "vitest";
import {
  callbackReplayKey,
  createTelegramCallbackService,
  parseTelegramCallback,
  type TelegramCallbackStore,
} from "./telegram-callback-service.js";

function memoryStore(experts: string[]): TelegramCallbackStore & {
  seen: Set<string>;
} {
  const seen = new Set<string>();
  return {
    seen,
    isActiveExpertTelegramUser: async (id) => experts.includes(id),
    isProcessed: async (key) => seen.has(key),
    recordProcessed: async (key) => {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
  };
}
const update = (id = "cbq-1", from = 1001) => ({
  update_id: 7,
  callback_query: { id, from: { id: from, is_bot: false }, data: "ok" },
});

describe("Telegram callback service", () => {
  it("parses only well-formed callbacks", () => {
    expect(parseTelegramCallback(update())).toEqual({
      id: "cbq-1",
      fromId: "1001",
    });
    expect(parseTelegramCallback({ update_id: 1 })).toBeUndefined();
    expect(
      parseTelegramCallback({
        callback_query: { id: "x", from: { id: 1, is_bot: true } },
      }),
    ).toBeUndefined();
    expect(
      parseTelegramCallback({
        callback_query: { id: "x", from: { id: 1 }, data: "d".repeat(65) },
      }),
    ).toBeUndefined();
    expect(
      parseTelegramCallback({
        callback_query: { id: "a b", from: { id: 1 } },
      }),
    ).toBeUndefined();
  });

  it("authorizes only active expert identities", async () => {
    const s = createTelegramCallbackService(memoryStore(["1001"]));
    await expect(s.isAuthorizedIdentity("1001")).resolves.toBe(true);
    await expect(s.isAuthorizedIdentity("2002")).resolves.toBe(false);
    await expect(s.isAuthorizedIdentity("01")).resolves.toBe(false);
  });

  it("acknowledges a redelivered callback as an idempotent duplicate", async () => {
    const store = memoryStore(["1001"]);
    const s = createTelegramCallbackService(store);
    await expect(s.verifyCallback(update(), "c")).resolves.toBe(true);
    await s.process(update(), "c");
    expect(store.seen.has(callbackReplayKey("cbq-1"))).toBe(true);
    await expect(s.verifyCallback(update(), "c")).resolves.toBe(true);
    await expect(s.process(update(), "c")).resolves.toBeUndefined();
    expect(store.seen.size).toBe(1);
  });

  it("rejects callbacks from a different, unknown sender", async () => {
    const s = createTelegramCallbackService(memoryStore(["1001"]));
    await expect(s.verifyCallback(update("cbq-2", 3003), "c")).resolves.toBe(
      false,
    );
  });
});
