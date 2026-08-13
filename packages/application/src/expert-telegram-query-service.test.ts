import { describe, expect, it, vi } from "vitest";

import {
  createExpertTelegramQueryService,
  type ExpertTelegramQueryRepository,
} from "./expert-telegram-query-service.js";

const now = new Date("2026-08-13T09:00:00.000Z");
const principal = {
  expertId: "00000000-0000-4000-8000-000000000101",
  telegramUserId: "123456789",
  timezone: "Europe/Moscow",
};

const build = () => {
  const getExpertSchedule = vi.fn(async () => ({
    expertId: principal.expertId,
    timezone: principal.timezone,
    appointments: [],
  }));
  const listClientCandidates = vi.fn(async () => [
    {
      reservationId: "00000000-0000-4000-8000-000000000201",
      version: 4,
      startsAt: new Date("2026-08-14T09:00:00.000Z"),
      serviceName: "Consultation",
    },
  ]);
  const readStats = vi.fn<ExpertTelegramQueryRepository["readStats"]>(
    async () => ({
      upcoming: 2,
      completed: 3,
      cancelled: 1,
      noShow: 0,
    }),
  );
  const consumeClientView = vi.fn<
    ExpertTelegramQueryRepository["consumeClientView"]
  >(async () => ({
    reservationId: "00000000-0000-4000-8000-000000000201",
    clientDisplayName: "Client",
    startsAt: new Date("2026-08-14T09:00:00.000Z"),
    serviceName: "Consultation",
    preparationNote: "Bring notes",
  }));
  const issue = vi.fn(async () => "cv1.safe-token");
  return {
    service: createExpertTelegramQueryService({
      booking: { getExpertSchedule },
      repository: { listClientCandidates, readStats, consumeClientView },
      clientViewCallbacks: { issue },
      clock: { now: () => now },
    }),
    getExpertSchedule,
    listClientCandidates,
    readStats,
    consumeClientView,
    issue,
  };
};

describe("expert Telegram query service", () => {
  it("owns the exact seven-day schedule boundary", async () => {
    const state = build();

    await state.service.schedule(principal);

    expect(state.getExpertSchedule).toHaveBeenCalledWith({
      ...principal,
      from: now.toISOString(),
      to: "2026-08-20T09:00:00.000Z",
    });
  });

  it("lists at most twenty active reservations and issues ten-minute cv1 claims", async () => {
    const state = build();

    await expect(state.service.clientChoices(principal)).resolves.toEqual([
      {
        callbackData: "cv1.safe-token",
        startsAt: "2026-08-14T09:00:00.000Z",
        serviceName: "Consultation",
      },
    ]);
    expect(state.listClientCandidates).toHaveBeenCalledWith({
      expertId: principal.expertId,
      telegramUserId: principal.telegramUserId,
      now,
      limit: 20,
    });
    expect(state.issue).toHaveBeenCalledWith({
      reservationId: "00000000-0000-4000-8000-000000000201",
      expertId: principal.expertId,
      version: 4,
      expiresAtEpochSeconds: Math.floor(now.getTime() / 1_000) + 600,
    });
  });

  it("uses the preceding thirty days for safe aggregate stats", async () => {
    const state = build();

    await expect(state.service.stats(principal)).resolves.toEqual({
      upcoming: 2,
      completed: 3,
      cancelled: 1,
      noShow: 0,
    });
    expect(state.readStats).toHaveBeenCalledWith({
      expertId: principal.expertId,
      telegramUserId: principal.telegramUserId,
      from: "2026-07-14T09:00:00.000Z",
      now,
    });
  });

  it("delegates authenticated cv1 consume, read, and audit as one repository operation", async () => {
    const state = build();
    const authenticated = {
      tokenHash: "a".repeat(64),
      claims: {
        reservationId: "00000000-0000-4000-8000-000000000201",
        expertId: principal.expertId,
        version: 4,
        expiresAtEpochSeconds: Math.floor(now.getTime() / 1_000) + 60,
      },
    };

    await expect(
      state.service.clientView({
        principal,
        authenticated,
        correlationId: "corr-client-view",
      }),
    ).resolves.toMatchObject({ clientDisplayName: "Client" });
    expect(state.consumeClientView).toHaveBeenCalledWith({
      tokenHash: authenticated.tokenHash,
      reservationId: authenticated.claims.reservationId,
      expertId: principal.expertId,
      telegramUserId: principal.telegramUserId,
      version: 4,
      now,
      correlationId: "corr-client-view",
    });
  });

  it("collapses revoked and foreign access to one unavailable error", async () => {
    const state = build();
    state.readStats.mockResolvedValueOnce(null);
    await expect(state.service.stats(principal)).rejects.toThrow(
      "expert_query_unavailable",
    );

    state.consumeClientView.mockResolvedValueOnce(null);
    await expect(
      state.service.clientView({
        principal,
        authenticated: {
          tokenHash: "b".repeat(64),
          claims: {
            reservationId: "00000000-0000-4000-8000-000000000201",
            expertId: principal.expertId,
            version: 4,
            expiresAtEpochSeconds: Math.floor(now.getTime() / 1_000) + 60,
          },
        },
        correlationId: "corr-unavailable",
      }),
    ).rejects.toThrow("expert_query_unavailable");
  });
});
