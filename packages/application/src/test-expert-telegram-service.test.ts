import { describe, expect, it, vi } from "vitest";
import {
  TEST_EXPERT_PLACEHOLDER_COPY,
  TestExpertTelegramService,
  type TestExpertTelegramPort,
  type TestExpertTelegramSession,
} from "./test-expert-telegram-service.js";

const scope = {
  botKey: "bot-client",
  telegramUserId: "123456789",
  chatId: "123456789",
};

class TelegramPortDouble implements TestExpertTelegramPort {
  session: TestExpertTelegramSession | null = null;
  ambiguous = false;
  readonly deliveries: Array<Record<string, unknown>> = [];
  readonly residuals: Array<Record<string, unknown>> = [];
  residualResult:
    | "applied"
    | "pending"
    | "not_applied"
    | "unknown"
    | "duplicate"
    | "limit_reached" = "applied";

  async load() {
    if (this.ambiguous) return { kind: "ambiguous" as const };
    return {
      kind: "resolved" as const,
      userId: "00000000-0000-4000-8000-000000000100",
      session: this.session,
    };
  }

  async deliverDeterministic(input: Record<string, unknown>) {
    this.deliveries.push(input);
    this.session = input.nextSession as TestExpertTelegramSession;
    return { kind: "applied" as const, replay: false };
  }

  async enqueueResidual(input: Record<string, unknown>) {
    this.residuals.push(input);
    return {
      kind: this.residualResult,
      providerRequestId: "sha256:" + "a".repeat(64),
      replay: this.residualResult === "duplicate",
      reservationCreated:
        this.residualResult !== "duplicate" &&
        this.residualResult !== "limit_reached",
    };
  }
}

const request = (text: string, updateId: string) => ({
  ...scope,
  text,
  requestKey: `telegram:${updateId}:test-expert`,
  requestDigest: "b".repeat(64),
  correlationId: `telegram:${updateId}`,
  occurredAt: "2026-08-30T12:00:00.000Z",
});

describe("test expert Telegram one-dialog service", () => {
  it("delivers versioned placeholder entry copy and advances durable zero-unit warmup", async () => {
    const port = new TelegramPortDouble();
    const metrics: string[] = [];
    const service = new TestExpertTelegramService({
      telegram: port,
      expertPolicy: null,
      partnerPolicy: null,
      residualEnabled: false,
      metrics: { record: ({ name }) => metrics.push(name) },
    });

    await expect(service.handle(request("тест эксперт", "1"))).resolves.toEqual(
      { status: "handled", route: "deterministic" },
    );
    expect(port.deliveries).toEqual([
      expect.objectContaining({
        replyText: TEST_EXPERT_PLACEHOLDER_COPY.entry,
        copyVersion: "test-expert-placeholder-v1",
        sellingActivation: "inactive",
        trialUnits: 0,
        nextSession: expect.objectContaining({ state: "awaiting_name" }),
      }),
    ]);
    expect(metrics).toEqual(
      expect.arrayContaining([
        "deterministic_message",
        "deterministic_offload",
      ]),
    );
  });

  it("routes prefixless follow-ups through durable qualification, segment and authoritative quote", async () => {
    const port = new TelegramPortDouble();
    const expertPolicy = {
      quote: vi.fn(async () => ({ priceMinor: 590_000 })),
    };
    const service = new TestExpertTelegramService({
      telegram: port,
      expertPolicy,
      partnerPolicy: null,
      residualEnabled: false,
      metrics: { record: () => undefined },
    });
    await service.handle(request("тест эксперт", "10"));
    await service.handle(request("Татьяна", "11"));
    await service.handle(request("Психолог", "12"));
    await service.handle(request("эксперт", "13"));

    expect(port.session).toEqual(
      expect.objectContaining({
        state: "qualified",
        segment: "EXPERT",
        name: "Татьяна",
        specialization: "Психолог",
      }),
    );
    expect(expertPolicy.quote).toHaveBeenCalledOnce();
    expect(port.deliveries.at(-1)).toEqual(
      expect.objectContaining({ replyText: expect.stringContaining("5 900") }),
    );
    expect(port.residuals).toHaveLength(0);
  });

  it("delivers FAQ and limit results locally but sends qualified free-form through one residual enqueue", async () => {
    const port = new TelegramPortDouble();
    port.session = {
      id: "session-1",
      version: 4,
      state: "qualified",
      name: "Татьяна",
      specialization: "Психолог",
      segment: "EXPERT",
    };
    const metrics: string[] = [];
    const service = new TestExpertTelegramService({
      telegram: port,
      expertPolicy: null,
      partnerPolicy: null,
      residualEnabled: true,
      metrics: { record: ({ name }) => metrics.push(name) },
    });
    await service.handle(request("faq", "20"));
    expect(port.deliveries.at(-1)).toEqual(
      expect.objectContaining({ replyText: TEST_EXPERT_PLACEHOLDER_COPY.faq }),
    );

    await service.handle(request("Расскажи подробнее", "21"));
    expect(port.residuals).toHaveLength(1);
    expect(port.residuals[0]).toEqual(
      expect.objectContaining({ providerCalls: 1, text: "Расскажи подробнее" }),
    );

    const reservedBeforeLimit = metrics.filter(
      (name) => name === "units_reserved",
    ).length;
    port.residualResult = "limit_reached";
    await service.handle(request("Ещё вопрос", "22"));
    expect(port.deliveries.at(-1)).toEqual(
      expect.objectContaining({
        replyText: TEST_EXPERT_PLACEHOLDER_COPY.limit,
      }),
    );
    expect(metrics).toContain("cap_rejected");
    expect(metrics.filter((name) => name === "units_reserved")).toHaveLength(
      reservedBeforeLimit,
    );
  });

  it("fails closed for ambiguous bot/chat identity and does not claim unrelated messages", async () => {
    const port = new TelegramPortDouble();
    const service = new TestExpertTelegramService({
      telegram: port,
      expertPolicy: null,
      partnerPolicy: null,
      residualEnabled: false,
      metrics: { record: () => undefined },
    });
    await expect(
      service.handle(request("обычный текст", "30")),
    ).resolves.toEqual({ status: "unhandled" });
    port.ambiguous = true;
    await expect(
      service.handle(request("тест эксперт", "31")),
    ).resolves.toEqual({ status: "unavailable" });
    expect(port.deliveries).toHaveLength(0);
    expect(port.residuals).toHaveLength(0);
  });

  it("keeps deterministic qualified sessions useful while residual capability is off", async () => {
    const port = new TelegramPortDouble();
    port.session = {
      id: "session-1",
      version: 4,
      state: "qualified",
      segment: "EXPERT",
    };
    const service = new TestExpertTelegramService({
      telegram: port,
      expertPolicy: null,
      partnerPolicy: null,
      residualEnabled: false,
      metrics: { record: () => undefined },
    });

    await expect(
      service.handle(request("Расскажи подробнее", "40")),
    ).resolves.toEqual({ status: "handled", route: "deterministic" });
    expect(port.residuals).toHaveLength(0);
    expect(port.deliveries.at(-1)).toEqual(
      expect.objectContaining({
        replyText: TEST_EXPERT_PLACEHOLDER_COPY.unavailable,
        trialUnits: 0,
      }),
    );
  });
});
