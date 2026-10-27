import { expect, it, vi } from "vitest";
import { createClientBotAccountReadService } from "./client-bot-account-read-service.js";
it("routes exact protected private reads without accepting forwarded context", async () => {
  const read = vi.fn().mockResolvedValue({ kind: "unavailable" });
  const service = createClientBotAccountReadService({
    botId: "123",
    botKey: "assistant",
    repository: { read },
  });
  const raw = {
    update_id: 1,
    message: {
      from: { id: 7, is_bot: false },
      chat: { id: 7, type: "private" },
      text: "/coupons_balance",
    },
  };
  expect((await service.handle(raw)).status).toBe("reply");
  expect(read).toHaveBeenCalledOnce();
  expect(
    (
      await service.handle({
        ...raw,
        message: { ...raw.message, forward_origin: { type: "user" } },
      })
    ).status,
  ).toBe("invalid");
  expect(read).toHaveBeenCalledOnce();
});
it("leaves other commands untouched and acknowledges duplicates", async () => {
  const read = vi.fn().mockResolvedValue({ kind: "duplicate" });
  const service = createClientBotAccountReadService({
    botId: "123",
    botKey: "assistant",
    repository: { read },
  });
  expect(
    (await service.handle({ update_id: 2, message: { text: "/help" } })).status,
  ).toBe("unhandled");
  expect(read).not.toHaveBeenCalled();
  expect(
    (
      await service.handle({
        update_id: 2,
        message: {
          text: "/orders",
          from: { id: 7, is_bot: false },
          chat: { id: 7, type: "private" },
        },
      })
    ).status,
  ).toBe("duplicate");
});
it("formats exact uncapped coupon kopecks and protects content", async () => {
  const read = vi.fn().mockResolvedValue({
    kind: "coupons",
    coupons_balance: "9007199254740993123",
    asOf: "2026-10-23T00:00:00.000Z",
    details: [],
    hasMore: true,
  });
  const s = createClientBotAccountReadService({
    botId: "123",
    botKey: "assistant",
    repository: { read },
  });
  const r = await s.handle({
    update_id: 3,
    message: {
      text: "/coupons_balance",
      from: { id: 7, is_bot: false },
      chat: { id: 7, type: "private" },
    },
  });
  expect(r.status).toBe("reply");
  if (r.status === "reply") {
    expect(r.reply.protect_content).toBe(true);
    expect(r.reply.text).toContain("90071992547409931,23");
    expect(r.reply.text).toContain("Действующие купоны");
  }
});
it.each([
  "/orders foreign",
  "/reservations foreign",
  "/coupons_balance 7",
  "/orders@trusted_bot",
])("rejects malformed recognized %s without repository", async (text) => {
  const read = vi.fn();
  const s = createClientBotAccountReadService({
    botId: "123",
    botKey: "assistant",
    repository: { read },
  });
  expect(
    (
      await s.handle({
        update_id: 1,
        message: {
          text,
          from: { id: 7, is_bot: false },
          chat: { id: 7, type: "private" },
        },
      })
    ).status,
  ).toBe("invalid");
  expect(read).not.toHaveBeenCalled();
});
it("renders own bounded order pagination without provider or account identifiers", async () => {
  const cursor = "co1." + "a".repeat(43);
  const read = vi.fn().mockResolvedValue({
    kind: "orders",
    orders: [
      {
        handle: cursor,
        packageCode: "start",
        priceMinor: "499900",
        currency: "RUB",
        createdAt: "2026-10-23T00:00:00.000Z",
        state: "unsettled",
      },
    ],
    nextCursor: cursor,
  });
  const s = createClientBotAccountReadService({
    botId: "123",
    botKey: "assistant",
    repository: { read },
  });
  const r = await s.handle({
    update_id: 1,
    message: {
      text: "/orders",
      from: { id: 7, is_bot: false },
      chat: { id: 7, type: "private" },
    },
  });
  if (r.status !== "reply") throw Error("missing_reply");
  expect(r.reply.text).toContain("оплата не подтверждена");
  expect(r.reply.text).toContain(`/orders ${cursor}`);
});
it.each([null, "1", 1.5, Number.MAX_SAFE_INTEGER + 1])(
  "rejects raw invalid update ID %s",
  async (update_id) => {
    const read = vi.fn();
    const s = createClientBotAccountReadService({
      botId: "123",
      botKey: "assistant",
      repository: { read },
    });
    expect(
      (
        await s.handle({
          update_id,
          message: {
            text: "/orders",
            from: { id: 7, is_bot: false },
            chat: { id: 7, type: "private" },
          },
        })
      ).status,
    ).toBe("invalid");
    expect(read).not.toHaveBeenCalled();
  },
);
