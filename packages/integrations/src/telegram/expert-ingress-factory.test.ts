import { describe, expect, it, vi } from "vitest";

import { createExpertTelegramIngress } from "./expert-ingress-factory.js";

describe("expert Telegram production ingress factory", () => {
  it("constructs a reachable processor and keeps financial views default-off", async () => {
    const sendUnsupported = vi.fn(async () => ({
      kind: "applied" as const,
      providerOperationId: "1",
    }));
    const ingress = createExpertTelegramIngress({
      enabled: true,
      resolvePrincipal: async (telegramUserId) => ({
        userId: "00000000-0000-4000-8000-000000000100",
        expertId: "00000000-0000-4000-8000-000000000101",
        telegramUserId,
        timezone: "Europe/Moscow",
      }),
      authenticateClientView: async () => null,
      queries: {
        schedule: async () => ({ timezone: "Europe/Moscow", appointments: [] }),
        clientChoices: async () => [],
        stats: async () => ({
          upcoming: 0,
          completed: 0,
          cancelled: 0,
          noShow: 0,
        }),
        clientView: async () => {
          throw new Error("not used");
        },
      },
      views: {
        sendUnsupported,
        sendQuerySchedule: async () => ({
          kind: "applied",
          providerOperationId: "2",
        }),
        sendClientChoices: async () => ({
          kind: "applied",
          providerOperationId: "3",
        }),
        sendClientView: async () => ({
          kind: "applied",
          providerOperationId: "4",
        }),
        sendStats: async () => ({ kind: "applied", providerOperationId: "5" }),
        answerCallbackQuery: async () => ({
          kind: "applied",
          providerOperationId: "6",
        }),
        sendReferralSummary: async () => ({
          kind: "applied",
          providerOperationId: "7",
        }),
        sendReferralRedeemed: async () => ({
          kind: "applied",
          providerOperationId: "9",
        }),
        sendResidencyQuote: async () => ({
          kind: "applied",
          providerOperationId: "8",
        }),
      },
    });

    await expect(
      ingress.processCommand({
        text: "/referral",
        chatType: "private",
        principal: (await ingress.resolvePrincipal("123456789"))!,
        idempotencyKey: "telegram:1:command",
        correlationId: "corr-1",
      }),
    ).resolves.toMatchObject({ kind: "unsupported" });
    expect(sendUnsupported).toHaveBeenCalledTimes(1);
  });

  it("fails closed when financial views are enabled without both services", () => {
    expect(() =>
      createExpertTelegramIngress({
        enabled: true,
        financialViewsEnabled: true,
        resolvePrincipal: async () => null,
        authenticateClientView: async () => null,
        queries: {} as never,
        views: {} as never,
      }),
    ).toThrow("Expert Telegram financial query capability is required");
  });

  it("fails closed when checkout readiness is enabled without its capability", () => {
    expect(() =>
      createExpertTelegramIngress({
        enabled: true,
        checkoutReadiness: true,
        resolvePrincipal: async () => null,
        authenticateClientView: async () => null,
        queries: {} as never,
        views: {} as never,
      }),
    ).toThrow("Expert Telegram checkout capability is required");
  });

  it("exposes checkout processing and delivery only from a complete composed capability", async () => {
    const process = vi.fn(async () => ({
      kind: "ready" as const,
      tokenHash: "b".repeat(64),
      checkoutUrl: "https://pay.example/checkout",
      replay: false,
    }));
    const sendResidencyCheckoutLink = vi.fn(async () => ({
      kind: "applied" as const,
      providerOperationId: "checkout-message-1",
    }));
    const ingress = createExpertTelegramIngress({
      enabled: true,
      checkoutReadiness: true,
      checkout: { issue: async () => "xr1.safe", process },
      resolvePrincipal: async () => null,
      authenticateClientView: async () => null,
      queries: {} as never,
      views: {
        answerCallbackQuery: async () => ({
          kind: "applied" as const,
          providerOperationId: "answer-1",
        }),
        sendResidencyCheckoutLink,
      } as never,
    });
    const principal = {
      userId: "00000000-0000-4000-8000-000000000100",
      expertId: "00000000-0000-4000-8000-000000000101",
      telegramUserId: "123456789",
      timezone: "Europe/Moscow",
    };

    await expect(
      ingress.processResidencyCheckout({ data: "xr1.safe", principal }),
    ).resolves.toMatchObject({ kind: "ready" });
    await expect(
      ingress.sendResidencyCheckoutLink({
        idempotencyKey: "delivery-1",
        telegramUserId: principal.telegramUserId,
        checkoutUrl: "https://pay.example/checkout",
      }),
    ).resolves.toMatchObject({ kind: "applied" });
    expect(process).toHaveBeenCalledWith({ data: "xr1.safe", principal });
    expect(sendResidencyCheckoutLink).toHaveBeenCalledTimes(1);
  });

  it("does not expose an injected checkout capability while readiness is false", async () => {
    const process = vi.fn(async () => ({
      kind: "unavailable" as const,
      tokenHash: "b".repeat(64),
      replay: false,
    }));
    const ingress = createExpertTelegramIngress({
      enabled: false,
      checkoutReadiness: false,
      checkout: { issue: async () => "xr1.safe", process },
      resolvePrincipal: async () => null,
      authenticateClientView: async () => null,
      queries: {} as never,
      views: {
        answerCallbackQuery: async () => ({
          kind: "applied" as const,
          providerOperationId: "answer-1",
        }),
      } as never,
    });

    await expect(
      ingress.processResidencyCheckout({
        data: "xr1.safe",
        principal: {
          userId: "00000000-0000-4000-8000-000000000100",
          expertId: "00000000-0000-4000-8000-000000000101",
          telegramUserId: "123456789",
          timezone: "Europe/Moscow",
        },
      }),
    ).rejects.toThrow("Expert Telegram checkout is disabled");
    expect(process).not.toHaveBeenCalled();
  });
});
