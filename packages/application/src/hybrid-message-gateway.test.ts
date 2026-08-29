import { describe, expect, it } from "vitest";
import { HybridMessageGateway } from "./hybrid-message-gateway.js";

const update = (text: string, id: number | string = 7) => ({
  update_id: id,
  message: { chat: { id: 22, type: "private" }, from: { id: 22 }, text },
});
describe("HybridMessageGateway", () => {
  it("passes only server bot scope and canonical input to one atomic repository operation", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const gateway = new HybridMessageGateway({
      enabled: true,
      botKey: "bot-a",
      routingEnabled: true,
      messagingConsentPolicyVersion: "client-msg-v1",
      selartiConsentPolicyVersion: "selarti-v1",
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
