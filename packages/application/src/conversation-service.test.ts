import { describe, expect, it, vi } from "vitest";

import {
  ConversationServiceError,
  createConversationService,
} from "./conversation-service.js";
import { conversationFixture } from "./conversation-service.testkit.js";

describe("conversation workflow", () => {
  it("validates bounded canonical input before every effect", async () => {
    const deps = conversationFixture({ balance: 3, safety: "ordinary" });
    const service = createConversationService(deps);

    await expect(
      service.handleInbound({
        ...deps.inbound,
        text: "x".repeat(4_097),
      }),
    ).rejects.toMatchObject({
      code: "invalid_input",
      message: "Invalid conversation input",
    });
    expect(deps.calls).toEqual([]);
    expect(deps.messageRepository.ledgerDeltas()).toEqual([]);
    expect(deps.outbox.topics()).toEqual([]);
  });

  it.each([
    ["locale", { locale: "RU_ru" }],
    ["correlation", { correlationId: "bad correlation" }],
    ["provider event", { providerEventId: "../unstable" }],
    ["provider", { provider: "bad/provider" }],
    ["empty text", { text: "" }],
    ["whitespace text", { text: " \t\r\n " }],
    ["NUL text", { text: "hello\u0000world" }],
    ["C1 text", { text: "hello\u0085world" }],
    ["DEL text", { text: "hello\u007Fworld" }],
    ["non-canonical instant", { occurredAt: "2026-07-28T10:00:00Z" }],
    ["offset instant", { occurredAt: "2026-07-28T13:00:00.000+03:00" }],
    ["oversized provider key", { provider: `p${"x".repeat(128)}` }],
    ["oversized correlation key", { correlationId: `c${"x".repeat(128)}` }],
  ])("rejects invalid canonical %s before effects", async (_name, patch) => {
    const deps = conversationFixture({ balance: 3, safety: "ordinary" });

    await expect(
      createConversationService(deps).handleInbound({
        ...deps.inbound,
        ...patch,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(deps.calls).toEqual([]);
    expect(deps.messageRepository.ledgerDeltas()).toEqual([]);
    expect(deps.outbox.topics()).toEqual([]);
  });

  it("accepts the exact maximum inbound text length", async () => {
    const deps = conversationFixture({ balance: 1, safety: "ordinary" });

    const result = await createConversationService(deps).handleInbound({
      ...deps.inbound,
      text: "x".repeat(4_096),
    });

    expect(result).toMatchObject({ kind: "answer_queued", chargedMessages: 1 });
  });

  it("accepts stable keys at their exact boundary and permitted text whitespace", async () => {
    const deps = conversationFixture({ balance: 1, safety: "ordinary" });

    const result = await createConversationService(deps).handleInbound({
      ...deps.inbound,
      provider: `p${"x".repeat(127)}`,
      providerEventId: `e${"x".repeat(127)}`,
      correlationId: `c${"x".repeat(127)}`,
      text: "line one\tvalue\r\nline two",
    });

    expect(result).toMatchObject({ kind: "answer_queued", chargedMessages: 1 });
  });

  it.each([
    { handoffOwnerId: "bad owner" },
    { handoffAcknowledgeWithinMs: 0 },
    { handoffAcknowledgeWithinMs: 86_400_001 },
    { handoffAcknowledgeWithinMs: Number.NaN },
  ])("rejects invalid dependency config without effects %#", async (patch) => {
    const deps = conversationFixture({ balance: 1, safety: "ordinary" });

    await expect(
      createConversationService({ ...deps, ...patch }).handleInbound(
        deps.inbound,
      ),
    ).rejects.toMatchObject({
      code: "dependency_unavailable",
      message: "Conversation dependency unavailable",
    });
    expect(deps.calls).toEqual([]);
  });

  it.each(["throw", "invalid"] as const)(
    "sanitizes a %s clock failure before effects",
    async (mode) => {
      const deps = conversationFixture({ balance: 1, safety: "ordinary" });
      const clock = {
        now: () => {
          if (mode === "throw") throw new Error("clock-secret");
          return new Date(Number.NaN);
        },
      };

      const error = await createConversationService({ ...deps, clock })
        .handleInbound(deps.inbound)
        .catch((value: unknown) => value);

      expect(error).toMatchObject({
        code: "dependency_unavailable",
        message: "Conversation dependency unavailable",
      });
      expect(JSON.stringify(error)).not.toContain("secret");
      expect(deps.calls).toEqual([]);
    },
  );

  it("rejects an acknowledgement deadline that overflows Date", async () => {
    const deps = conversationFixture({ balance: 1, safety: "ordinary" });

    await expect(
      createConversationService({
        ...deps,
        clock: { now: () => new Date(8_640_000_000_000_000 - 1_000) },
      }).handleInbound(deps.inbound),
    ).rejects.toMatchObject({ code: "dependency_unavailable" });
    expect(deps.calls).toEqual([]);
  });

  it("runs deterministic safety before billing and commits one free owned handoff at zero balance", async () => {
    const deps = conversationFixture({ balance: 0, safety: "crisis" });
    const service = createConversationService(deps);

    const first = await service.handleInbound(deps.inbound);
    const retry = await service.handleInbound(deps.inbound);

    expect(deps.calls).toEqual([
      "deterministic-safety",
      "safety-persist",
      "free-outbound",
      "deterministic-safety",
      "safety-persist",
    ]);
    expect(first).toMatchObject({
      kind: "human_handoff",
      chargedMessages: 0,
      reasonCode: "self_harm",
    });
    expect(retry).toEqual({ kind: "duplicate", chargedMessages: 0 });
    expect(deps.intentEngine.propose).not.toHaveBeenCalled();
    expect(deps.handoffs.current()).toMatchObject({
      status: "opened",
      acknowledgeBy: expect.any(Date),
      ownerId: expect.any(String),
    });
    expect(deps.incidents.count()).toBe(1);
    expect(deps.audit.actions()).toEqual(["safety.handoff_opened"]);
    expect(deps.outbox.topics()).toEqual(["human_handoff.opened"]);
    expect(deps.outbox.charges()).toEqual([0]);
    expect(deps.messageRepository.ledgerDeltas()).toEqual([]);
    expect(deps.safetyHandoff.messageClasses()).toEqual(["safety"]);
  });

  it("rolls back every crisis fact when the atomic safety transaction fails", async () => {
    const deps = conversationFixture({ balance: 0, safety: "crisis" });
    deps.safetyHandoff.failNextAfterIncident(
      new Error("dependency credential material"),
    );

    await expect(
      createConversationService(deps).handleInbound(deps.inbound),
    ).rejects.toMatchObject({
      code: "dependency_unavailable",
      message: "Conversation dependency unavailable",
    });
    expect(deps.handoffs.current()).toBeNull();
    expect(deps.incidents.count()).toBe(0);
    expect(deps.audit.actions()).toEqual([]);
    expect(deps.outbox.topics()).toEqual([]);
    expect(deps.messageRepository.ledgerDeltas()).toEqual([]);
  });

  it("runs the typed safety classifier only after deterministic safety", async () => {
    const deps = conversationFixture({ balance: 3, safety: "ordinary" });
    deps.intentEngine.propose = vi
      .fn()
      .mockResolvedValue({ kind: "answer", text: "Короткий ответ" });

    await createConversationService(deps).handleInbound(deps.inbound);

    expect(deps.calls.slice(0, 3)).toEqual([
      "deterministic-safety",
      "typed-safety",
      "accept-inbound",
    ]);
  });

  it.each(["deterministic", "typed"] as const)(
    "fails a runtime-invalid %s safety result closed",
    async (source) => {
      const deps = conversationFixture({ balance: 0, safety: "ordinary" });
      if (source === "deterministic") {
        deps.deterministicSafety.detect = (() =>
          "arbitrary_reason") as unknown as
          typeof deps.deterministicSafety.detect;
      } else {
        deps.typedSafety.classify = vi
          .fn()
          .mockResolvedValue({ risk: "arbitrary_reason" }) as unknown as
          typeof deps.typedSafety.classify;
      }

      const result = await createConversationService(deps).handleInbound(
        deps.inbound,
      );

      expect(result).toEqual({
        kind: "human_handoff",
        reasonCode: "classifier_unavailable",
        chargedMessages: 0,
      });
      expect(deps.outbox.payloads()).toEqual([
        expect.objectContaining({ reasonCode: "classifier_unavailable" }),
      ]);
      expect(JSON.stringify(deps.outbox.payloads())).not.toContain(
        "arbitrary_reason",
      );
    },
  );

  it("charges an accepted inbound once and never charges send acceptance", async () => {
    const deps = conversationFixture({ balance: 3, safety: "ordinary" });
    deps.intentEngine.propose = vi
      .fn()
      .mockResolvedValue({ kind: "answer", text: "Короткий ответ" });
    const service = createConversationService(deps);

    const first = await service.handleInbound(deps.inbound);
    const retry = await service.handleInbound(deps.inbound);

    expect(first).toMatchObject({ kind: "answer_queued", chargedMessages: 1 });
    expect(retry).toEqual({ kind: "duplicate", chargedMessages: 0 });
    expect(deps.intentEngine.propose).toHaveBeenCalledTimes(1);
    expect(deps.messageRepository.ledgerDeltas()).toEqual([-1]);
    expect(deps.outbox.topics()).toEqual(["selarti.send"]);
    expect(deps.outbox.charges()).toEqual([0]);
  });

  it("sends one free no-package notice and never invokes the intent engine", async () => {
    const deps = conversationFixture({ balance: 0, safety: "ordinary" });
    const service = createConversationService(deps);

    const first = await service.handleInbound(deps.inbound);
    const retry = await service.handleInbound(deps.inbound);

    expect(first).toMatchObject({ kind: "no_package", chargedMessages: 0 });
    expect(retry).toEqual({ kind: "duplicate", chargedMessages: 0 });
    expect(deps.intentEngine.propose).not.toHaveBeenCalled();
    expect(deps.outbox.topics()).toEqual(["client.no_package"]);
    expect(deps.outbox.charges()).toEqual([0]);
    expect(deps.messageRepository.ledgerDeltas()).toEqual([]);
  });

  it("meters one stable delivered event only in explicit fixture mode", async () => {
    const deps = conversationFixture({
      balance: 3,
      safety: "ordinary",
      outboundBillingMode: "provider_delivery_event",
    });
    const service = createConversationService(deps);

    const first = await service.handleOutboundDelivery(deps.delivery);
    const retry = await service.handleOutboundDelivery(deps.delivery);

    expect(first).toEqual({ kind: "charged", chargedMessages: 1 });
    expect(retry).toEqual({ kind: "duplicate", chargedMessages: 0 });
    expect(deps.messageRepository.ledgerDeltas()).toEqual([-1]);
    expect(deps.messageRepository.deliveryInboxCount()).toBe(1);
  });

  it.each(["accepted", "queued", "sent", "failed", "ambiguous"] as const)(
    "records %s delivery telemetry without a debit",
    async (status) => {
      const deps = conversationFixture({
        balance: 3,
        safety: "ordinary",
        outboundBillingMode: "provider_delivery_event",
      });

      const result = await createConversationService(
        deps,
      ).handleOutboundDelivery({ ...deps.delivery, status });

      expect(result).toEqual({ kind: "not_delivered", chargedMessages: 0 });
      expect(deps.messageRepository.ledgerDeltas()).toEqual([]);
      expect(deps.messageRepository.deliveryInboxCount()).toBe(1);
    },
  );

  it("keeps current runtime outbound billing disabled even for delivered telemetry", async () => {
    const deps = conversationFixture({ balance: 3, safety: "ordinary" });

    const result = await createConversationService(
      deps,
    ).handleOutboundDelivery(deps.delivery);

    expect(result).toEqual({ kind: "billing_disabled", chargedMessages: 0 });
    expect(deps.messageRepository.ledgerDeltas()).toEqual([]);
    expect(deps.messageRepository.deliveryInboxCount()).toBe(1);
  });

  it("does not couple outbound telemetry to handoff clock configuration", async () => {
    const deps = conversationFixture({ balance: 3, safety: "ordinary" });
    const service = createConversationService({
      ...deps,
      handoffOwnerId: "bad owner",
      handoffAcknowledgeWithinMs: 0,
      clock: { now: () => { throw new Error("clock unavailable"); } },
    });

    const result = await service.handleOutboundDelivery(deps.delivery);

    expect(result).toEqual({ kind: "billing_disabled", chargedMessages: 0 });
    expect(deps.messageRepository.deliveryInboxCount()).toBe(1);
  });

  it("fails a model exception closed to a typed free handoff without leaking raw text", async () => {
    const deps = conversationFixture({ balance: 3, safety: "ordinary" });
    deps.intentEngine.propose = vi
      .fn()
      .mockRejectedValue(
        new Error("credential material https://provider.invalid"),
      );

    const service = createConversationService(deps);
    const result = await service.handleInbound(deps.inbound);
    const retry = await service.handleInbound(deps.inbound);

    expect(result).toEqual({
      kind: "human_handoff",
      reasonCode: "intent_unavailable",
      chargedMessages: 1,
    });
    expect(JSON.stringify(result)).not.toContain("credential");
    expect(retry).toEqual({ kind: "duplicate", chargedMessages: 0 });
    expect(deps.handoffs.current()).toMatchObject({
      status: "opened",
      ownerId: "safety-owner-1",
      acknowledgeBy: expect.any(Date),
    });
    expect(deps.audit.actions()).toEqual(["conversation.handoff_opened"]);
    expect(deps.outbox.topics()).toEqual(["human_handoff.opened"]);
    expect(deps.outbox.charges()).toEqual([0]);
    expect(deps.outbox.keys()).toEqual([
      "message-event-1:human_handoff.opened",
    ]);
  });

  it("rejects unsafe model output without executing raw text", async () => {
    const deps = conversationFixture({ balance: 3, safety: "ordinary" });
    deps.intentEngine.propose = vi.fn().mockResolvedValue({
      kind: "answer",
      text: "POST https://provider.invalid/pay with API_KEY",
    });

    const result = await createConversationService(deps).handleInbound(
      deps.inbound,
    );

    expect(result).toEqual({
      kind: "human_handoff",
      reasonCode: "arbitrary_url",
      chargedMessages: 1,
    });
    expect(deps.outbox.topics()).toEqual(["human_handoff.opened"]);
    expect(deps.outbox.payloads()).not.toContainEqual(
      expect.stringContaining("provider.invalid"),
    );
    expect(deps.handoffs.current()).toMatchObject({
      status: "opened",
      ownerId: "safety-owner-1",
    });
  });

  it("opens an owned durable handoff for a typed handoff proposal", async () => {
    const deps = conversationFixture({ balance: 3, safety: "ordinary" });
    deps.intentEngine.propose = vi.fn().mockResolvedValue({
      kind: "human_handoff",
      reasonCode: "needs_human",
    });

    const result = await createConversationService(deps).handleInbound(
      deps.inbound,
    );

    expect(result).toEqual({
      kind: "human_handoff",
      reasonCode: "needs_human",
      chargedMessages: 1,
    });
    expect(deps.handoffs.current()).toMatchObject({
      status: "opened",
      ownerId: "safety-owner-1",
    });
    expect(deps.audit.actions()).toEqual(["conversation.handoff_opened"]);
    expect(deps.outbox.topics()).toEqual(["human_handoff.opened"]);
  });

  it("omits an absent optional service code from the durable payload", async () => {
    const deps = conversationFixture({ balance: 3, safety: "ordinary" });
    deps.intentEngine.propose = vi
      .fn()
      .mockResolvedValue({ kind: "show_catalog" });

    const result = await createConversationService(deps).handleInbound(
      deps.inbound,
    );

    expect(result).toEqual({ kind: "catalog_requested", chargedMessages: 1 });
    expect(deps.outbox.payloads()[0]).not.toHaveProperty("serviceCode");
  });

  it("classifies port failures without exposing credentials", async () => {
    const deps = conversationFixture({ balance: 3, safety: "ordinary" });
    deps.messageRepository.failNext(
      new Error("dependency credential material"),
    );

    const error = await createConversationService(deps)
      .handleInbound(deps.inbound)
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(ConversationServiceError);
    expect(error).toMatchObject({
      code: "dependency_unavailable",
      message: "Conversation dependency unavailable",
    });
    expect(JSON.stringify(error)).not.toContain("credential");
  });

  it("rejects malformed outbound data before recording telemetry", async () => {
    const deps = conversationFixture({ balance: 3, safety: "ordinary" });

    await expect(
      createConversationService(deps).handleOutboundDelivery({
        ...deps.delivery,
        providerEventId: 42,
      } as unknown as typeof deps.delivery),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(deps.calls).toEqual([]);
    expect(deps.messageRepository.deliveryInboxCount()).toBe(0);
  });
});
