import { describe, expect, it, vi } from "vitest";
import { HybridMessageGateway } from "./hybrid-message-gateway.js";

const update = (text: string, id: number | string = 7) => ({
  update_id: id,
  message: { chat: { id: 22, type: "private" }, from: { id: 22 }, text },
});
describe("HybridMessageGateway", () => {
  it.each([
    ["/help", "deterministic"],
    ["synthetic ordinary request", "complex_dialogue"],
  ] as const)(
    "continues fresh %s after replay false with original consent and persistence semantics",
    async (text, route) => {
      const order: string[] = [];
      const persist = vi.fn(async () => {
        order.push("persist");
        return "claimed" as const;
      });
      const hasReceipt = vi.fn(async () => {
        order.push("replay");
        return false;
      });
      const hasMessagingConsent = vi.fn(async () => {
        order.push("consent");
        return true;
      });
      const gateway = new HybridMessageGateway({
        enabled: true,
        botKey: "rotated-key",
        botId: "123456",
        ingressReplay: { hasReceipt },
        routingEnabled: true,
        messagingConsentPolicyVersion: "client-msg-v1",
        hasMessagingConsent,
        persist,
      });
      expect(await gateway.handle(update(text))).toEqual({
        status: "accepted",
        route,
      });
      expect(hasReceipt).toHaveBeenCalledExactlyOnceWith({
        botId: "123456",
        updateId: 7,
      });
      expect(order).toEqual(
        route === "deterministic"
          ? ["replay", "persist"]
          : ["replay", "consent", "persist"],
      );
      expect(persist).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          botKey: "rotated-key",
          updateId: 7n,
          text,
          route,
          externalUserId: "22",
          externalChatId: "22",
          messagingConsentPolicyVersion: "client-msg-v1",
        }),
      );
    },
  );
  it.each([true, "failure", undefined])(
    "fences navigation receipts before reading content, outcome=%s",
    async (outcome) => {
      const persist = vi.fn(async () => "claimed" as const);
      const hasReceipt = vi.fn(async () => {
        if (outcome === "failure") throw new Error("SYNTHETIC_PRIVATE_CANARY");
        return outcome as boolean;
      });
      const gateway = new HybridMessageGateway({
        enabled: true,
        botKey: "rotated-key",
        botId: "123456",
        ingressReplay: { hasReceipt },
        persist,
      });
      const result = await gateway.handle({
        update_id: 7,
        get message() {
          throw new Error("must not read personal content");
        },
      });
      expect(result).toEqual({
        status: outcome === true ? "duplicate" : "unavailable",
      });
      expect(hasReceipt).toHaveBeenCalledWith({ botId: "123456", updateId: 7 });
      expect(persist).not.toHaveBeenCalled();
    },
  );
  it("fails closed with known bot identity and absent replay reader", async () => {
    const persist = vi.fn(async () => "claimed" as const);
    const gateway = new HybridMessageGateway({
      enabled: true,
      botKey: "rotated-key",
      botId: "123456",
      persist,
    });
    expect(await gateway.handle(update("/start"))).toEqual({
      status: "unavailable",
    });
    expect(persist).not.toHaveBeenCalled();
  });
  it("rejects complex content before persistence without current messaging consent", async () => {
    let persisted = false;
    const gateway = new HybridMessageGateway({
      enabled: true,
      botKey: "bot-a",
      routingEnabled: true,
      messagingConsentPolicyVersion: "client-msg-v1",
      hasMessagingConsent: async () => false,
      persist: async () => {
        persisted = true;
        return "claimed";
      },
    });
    expect(await gateway.handle(update("личный свободный текст"))).toEqual({
      status: "rejected",
    });
    expect(persisted).toBe(false);
  });

  it("returns unavailable when the consent oracle fails closed", async () => {
    let persisted = false;
    const gateway = new HybridMessageGateway({
      enabled: true,
      botKey: "bot-a",
      routingEnabled: true,
      messagingConsentPolicyVersion: "client-msg-v1",
      hasMessagingConsent: async () => {
        throw new Error("database unavailable");
      },
      persist: async () => {
        persisted = true;
        return "claimed";
      },
    });
    expect(await gateway.handle(update("личный свободный текст"))).toEqual({
      status: "unavailable",
    });
    expect(persisted).toBe(false);
  });

  it.each(["claimed", "warning", "soft_stop", "hard_stop"] as const)(
    "emits one bounded budget metric for %s",
    async (result) => {
      const outcomes: string[] = [];
      const gateway = new HybridMessageGateway({
        enabled: true,
        botKey: "bot-a",
        routingEnabled: true,
        costAdmissionEnabled: true,
        messagingConsentPolicyVersion: "client-msg-v1",
        selartiConsentPolicyVersion: "selarti-v1",
        hasMessagingConsent: async () => true,
        budgetMetric: (outcome) => outcomes.push(outcome),
        persist: async () => result,
      });
      expect((await gateway.handle(update("сложный запрос"))).status).toBe(
        "accepted",
      );
      expect(outcomes).toEqual([result === "claimed" ? "admitted" : result]);
    },
  );
  it("does not emit a Selarti budget metric for deterministic work", async () => {
    const outcomes: string[] = [];
    const gateway = new HybridMessageGateway({
      enabled: true,
      botKey: "bot-a",
      routingEnabled: true,
      costAdmissionEnabled: true,
      messagingConsentPolicyVersion: "client-msg-v1",
      budgetMetric: (outcome) => outcomes.push(outcome),
      persist: async () => "claimed",
    });
    expect(await gateway.handle(update("/help"))).toEqual({
      status: "accepted",
      route: "deterministic",
    });
    expect(outcomes).toEqual([]);
  });
  it("passes only server bot scope and canonical input to one atomic repository operation", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const gateway = new HybridMessageGateway({
      enabled: true,
      botKey: "bot-a",
      routingEnabled: true,
      messagingConsentPolicyVersion: "client-msg-v1",
      selartiConsentPolicyVersion: "selarti-v1",
      hasMessagingConsent: async () => true,
      clock: () => new Date("2026-08-29T00:00:00Z"),
      persist: async (input) => {
        calls.push(input);
        return "claimed";
      },
    });
    expect(
      await gateway.handle({
        ...update("сложный запрос"),
        bot_key: "attacker",
      }),
    ).toEqual({ status: "accepted", route: "complex_dialogue" });
    expect(calls[0]).toMatchObject({
      botKey: "bot-a",
      messagingConsentPolicyVersion: "client-msg-v1",
      routingEnabled: true,
      updateId: 7n,
      externalUserId: "22",
      externalChatId: "22",
      route: "complex_dialogue",
      deadline: "2026-08-29T00:00:30.000Z",
    });
  });
  it("returns exact duplicate, poison conflict, and rejects malformed/group", async () => {
    const results: Array<"duplicate" | "conflict"> = ["duplicate", "conflict"];
    const persist = async () => results.shift() ?? "rejected";
    const gateway = new HybridMessageGateway({
      enabled: true,
      botKey: "bot-a",
      routingEnabled: true,
      messagingConsentPolicyVersion: "client-msg-v1",
      selartiConsentPolicyVersion: "selarti-v1",
      hasMessagingConsent: async () => true,
      persist,
    });
    expect(await gateway.handle(update("x"))).toEqual({ status: "duplicate" });
    expect(await gateway.handle(update("x"))).toEqual({ status: "conflict" });
    expect(
      await gateway.handle({
        update_id: 1,
        message: {
          chat: { id: -1, type: "group" },
          from: { id: 2 },
          text: "x",
        },
      }),
    ).toEqual({ status: "rejected" });
  });
  it("forces deterministic route when hybrid routing is disabled and preserves bigint ids", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const gateway = new HybridMessageGateway({
      enabled: true,
      botKey: "bot-a",
      routingEnabled: false,
      messagingConsentPolicyVersion: "client-msg-v1",
      persist: async (input) => {
        calls.push(input);
        return "claimed";
      },
    });
    expect(await gateway.handle(update("/help", "9007199254740993"))).toEqual({
      status: "accepted",
      route: "deterministic",
    });
    expect(calls[0]?.route).toBe("deterministic");
    expect(calls[0]?.updateId).toBe(9007199254740993n);
  });
  it("returns unavailable without persistence for complex text when routing is disabled", async () => {
    let called = false;
    const gateway = new HybridMessageGateway({
      enabled: true,
      botKey: "bot-a",
      routingEnabled: false,
      messagingConsentPolicyVersion: "client-msg-v1",
      persist: async () => {
        called = true;
        return "claimed";
      },
    });
    expect(await gateway.handle(update("сложный запрос"))).toEqual({
      status: "unavailable",
    });
    expect(called).toBe(false);
  });
  it("is disabled by default", async () => {
    expect(
      await new HybridMessageGateway({
        enabled: false,
        persist: async () => "claimed",
      }).handle({}),
    ).toEqual({ status: "disabled" });
  });
});
