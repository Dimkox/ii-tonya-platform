import { describe, expect, it, vi } from "vitest";

import { createExpertCommandProcessor } from "./expert-command-processor.js";

const principal = {
  expertId: "00000000-0000-4000-8000-000000000101",
  telegramUserId: "123456789",
  timezone: "Europe/Moscow",
};

const build = (enabled = true) => {
  const schedule = vi.fn(async () => ({
    expertId: principal.expertId,
    timezone: principal.timezone,
    appointments: [],
  }));
  const clientChoices = vi.fn(async () => []);
  const stats = vi.fn(async () => ({
    upcoming: 1,
    completed: 2,
    cancelled: 3,
    noShow: 4,
  }));
  const clientView = vi.fn(async () => ({
    reservationId: "00000000-0000-4000-8000-000000000201",
    clientDisplayName: "Client",
    startsAt: new Date("2026-08-14T09:00:00.000Z"),
    serviceName: "Consultation",
  }));
  const views = {
    sendQuerySchedule: vi.fn(async () => ({
      kind: "applied" as const,
      providerOperationId: "1",
    })),
    sendClientChoices: vi.fn(async () => ({
      kind: "applied" as const,
      providerOperationId: "2",
    })),
    sendClientView: vi.fn(async () => ({
      kind: "applied" as const,
      providerOperationId: "3",
    })),
    sendStats: vi.fn(async () => ({
      kind: "applied" as const,
      providerOperationId: "4",
    })),
    sendUnsupported: vi.fn(async () => ({
      kind: "applied" as const,
      providerOperationId: "5",
    })),
  };
  return {
    processor: createExpertCommandProcessor({
      enabled,
      queries: { schedule, clientChoices, stats, clientView },
      views,
    }),
    schedule,
    clientChoices,
    stats,
    clientView,
    views,
  };
};

const command = (text: string) => ({
  text,
  chatType: "private" as const,
  principal,
  idempotencyKey: "telegram-update-1",
  correlationId: "corr-1",
});

describe("expert Telegram command processor", () => {
  it.each(["/schedule", "/client", "/stats"] as const)(
    "dispatches the exact %s command",
    async (text) => {
      const state = build();
      await state.processor.processCommand(command(text));
      expect(
        text === "/schedule"
          ? state.schedule
          : text === "/client"
            ? state.clientChoices
            : state.stats,
      ).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    "/client Client",
    "/client 123",
    "/stats 90",
    "/schedule now",
    " /client",
  ])("does not interpret arguments or near-matches: %s", async (text) => {
    const state = build();
    await state.processor.processCommand(command(text));
    expect(state.schedule).not.toHaveBeenCalled();
    expect(state.clientChoices).not.toHaveBeenCalled();
    expect(state.stats).not.toHaveBeenCalled();
    expect(state.views.sendUnsupported).toHaveBeenCalledTimes(1);
  });

  it("keeps the disabled boundary isolated with no query or outbound call", async () => {
    const state = build(false);
    await expect(
      state.processor.processCommand(command("/schedule")),
    ).resolves.toEqual({
      kind: "disabled",
    });
    expect(state.schedule).not.toHaveBeenCalled();
    expect(state.views.sendQuerySchedule).not.toHaveBeenCalled();
    expect(state.views.sendUnsupported).not.toHaveBeenCalled();
  });

  it("rejects non-private command processing before query access", async () => {
    const state = build();
    await expect(
      state.processor.processCommand({
        ...command("/stats"),
        chatType: "group",
      }),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(state.stats).not.toHaveBeenCalled();
  });

  it.each(["not_applied", "unknown_outcome"] as const)(
    "propagates a sanitized %s delivery failure instead of completing the inbox",
    async (kind) => {
      const state = build();
      state.views.sendStats.mockResolvedValueOnce(
        kind === "not_applied"
          ? { kind, retryable: true, reasonCode: "rate_limited" }
          : {
              kind,
              reconciliationKey: "telegram-update-1",
              reasonCode: "timeout_after_write",
            },
      );

      await expect(
        state.processor.processCommand(command("/stats")),
      ).rejects.toThrow("telegram_delivery_unconfirmed");
      expect(state.views.sendUnsupported).not.toHaveBeenCalled();
    },
  );

  it("propagates repository faults without sending help or reporting success", async () => {
    const state = build();
    state.stats.mockRejectedValueOnce(new Error("database connection details"));

    await expect(
      state.processor.processCommand(command("/stats")),
    ).rejects.toThrow("expert_query_unavailable");
    expect(state.views.sendStats).not.toHaveBeenCalled();
    expect(state.views.sendUnsupported).not.toHaveBeenCalled();
  });

  it("keeps consumed client disclosure at most once when delivery is uncertain", async () => {
    const state = build();
    state.views.sendClientView.mockResolvedValueOnce({
      kind: "unknown_outcome",
      reconciliationKey: "telegram-update-1",
      reasonCode: "timeout_after_write",
    });

    await expect(
      state.processor.processClientView({
        principal,
        authenticated: {
          tokenHash: "a".repeat(64),
          claims: {
            reservationId: "00000000-0000-4000-8000-000000000201",
            expertId: principal.expertId,
            telegramUserId: principal.telegramUserId,
            version: 1,
            expiresAtEpochSeconds: 1_786_000_000,
          },
        },
        idempotencyKey: "telegram-update-1",
        correlationId: "corr-1",
      }),
    ).rejects.toThrow("telegram_client_view_delivery_unconfirmed");
    expect(state.clientView).toHaveBeenCalledTimes(1);
    expect(state.views.sendUnsupported).not.toHaveBeenCalled();
  });
});
