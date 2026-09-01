import { describe, expect, it, vi } from "vitest";

import type {
  ExpertPrincipal,
  ExpertReferralService,
  ExpertResidencyService,
} from "@ii-tonya/application";
import {
  issueExpertCommandCallback,
  type ExpertCommandCallbackClaims,
  type ExpertCommandCallbackClaimsStore,
} from "@ii-tonya/integrations";
import Fastify from "fastify";
import { createWindowedRateLimiter } from "./rate-limit.js";
import {
  createExpertTelegramCommandProcessor,
  type ExpertTelegramServerCommand,
} from "./expert-telegram-command.js";
import { telegramWebhookRoutes } from "./routes/telegram-webhook.js";

const secret = new Uint8Array(32).fill(31);
const now = new Date("2026-08-03T12:00:00.000Z");
const principal: ExpertPrincipal = {
  expertId: "00000000-0000-4000-8000-000000001301",
  userId: "user-1301",
  provider: "telegram",
  externalId: "1301",
};

const callbackStore = (): ExpertCommandCallbackClaimsStore => {
  const values = new Map<string, ExpertCommandCallbackClaims>();
  return {
    async put(key, value) {
      values.set(key, value);
    },
    async peek(key) {
      return values.get(key) ?? null;
    },
    async consumeIfValid(input) {
      const value = values.get(input.tokenHash);
      if (
        value === undefined ||
        value.expertId !== input.expertId ||
        value.operation !== input.operation ||
        value.objectId !== input.objectId ||
        value.version !== input.version ||
        value.expiresAtEpochSeconds <= Math.floor(input.now.getTime() / 1_000)
      ) {
        return null;
      }
      values.delete(input.tokenHash);
      return value;
    },
  };
};

describe("expert Telegram command processor", () => {
  it("routes all four opaque ct3 operations through Task 8 services and safe output", async () => {
    const store = callbackStore();
    const commands = new Map<string, ExpertTelegramServerCommand>();
    const commandList: readonly ExpertTelegramServerCommand[] = [
      {
        operation: "redeem_expert_referral",
        objectId: "redeem-command-1301",
        version: 1,
        code: "ER-SERVER-ONLY-CODE",
        idempotencyKey: "telegram-redeem-1301",
      },
      {
        operation: "view_referral_summary",
        objectId: "summary-command-1301",
        version: 1,
        code: { status: "issued", maskedSuffix: "…1301" },
      },
      {
        operation: "quote_residency",
        objectId: "quote-command-1301",
        version: 1,
        tariffVersionId: "00000000-0000-4000-8000-000000001302",
        tariffKey: "expert-month-v1",
      },
      {
        operation: "start_residency_checkout",
        objectId: "checkout-command-1301",
        version: 1,
        tariffVersionId: "00000000-0000-4000-8000-000000001302",
        tariffKey: "expert-month-v1",
        idempotencyKey: "telegram-checkout-1301",
        providerDeadline: new Date("2026-08-03T12:15:00.000Z"),
      },
    ];
    for (const command of commandList) commands.set(command.objectId, command);

    const referrals = {
      redeemCode: vi.fn(async () => ({
        kind: "redeemed" as const,
        referralId: "private-referral-id",
      })),
      summary: vi.fn(async () => ({
        expertId: principal.expertId,
        spendableBalanceMinor: "100000",
        reservedBalanceMinor: "25000",
        debtMinor: "5000",
        nearestExpiryAt: new Date("2027-08-01T00:00:00.000Z"),
      })),
    } satisfies ExpertReferralService;
    const residency = {
      quote: vi.fn(async () => ({
        tariffVersionId: "00000000-0000-4000-8000-000000001302",
        displayName: "Expert month",
        description: "30 days",
        priceMinor: "200000",
        currency: "RUB" as const,
        durationSeconds: 2_592_000,
        creditMinor: "100000",
        cashMinor: "100000",
      })),
      checkout: vi.fn(async () => ({
        kind: "checkout_created" as const,
        order: {
          orderId: "00000000-0000-4000-8000-000000001303",
          expertId: principal.expertId,
          tariffVersionId: "00000000-0000-4000-8000-000000001302",
          displayName: "Expert month",
          description: "30 days",
          priceMinor: "200000",
          currency: "RUB" as const,
          durationSeconds: 2_592_000,
          creditMinor: "100000",
          cashMinor: "100000",
          paymentDeadline: new Date("2026-08-03T12:15:00.000Z"),
          status: "pending",
          allocations: [{ grantId: "private-grant", amountMinor: "100000" }],
        },
        payment: {
          kind: "pending_reconciliation" as const,
          provider: "disabled",
          paymentId: "private-payment",
        },
      })),
    } as unknown as ExpertResidencyService;
    const published: unknown[] = [];
    const processor = createExpertTelegramCommandProcessor({
      secret,
      store,
      clock: { now: () => new Date(now) },
      bindings: {
        async resolveCurrent(telegramUserId) {
          return telegramUserId === "1301"
            ? {
                telegramUserId,
                principal,
                active: true,
                verified: true,
              }
            : null;
        },
      },
      commands: {
        async currentVersion(input) {
          const command = commands.get(input.objectId);
          return command !== undefined &&
            command.operation === input.operation &&
            input.expertId === principal.expertId
            ? command.version
            : null;
        },
        async resolveCurrent(input) {
          const command = commands.get(input.objectId);
          return command !== undefined &&
            command.operation === input.operation &&
            command.version === input.version &&
            input.expertId === principal.expertId
            ? command
            : null;
        },
      },
      referrals,
      residency,
      output: {
        async publish(message) {
          published.push(message);
        },
      },
    });
    const app = Fastify({ logger: false });
    await app.register(telegramWebhookRoutes, {
      secret: "telegram-webhook-secret",
      callbacks: processor,
      inbox: {
        claim: async (_source, eventId) => ({
          kind: "claimed" as const,
          claimId: `claim-${eventId}`,
        }),
        complete: async () => undefined,
        fail: async () => undefined,
      },
      rateLimiter: createWindowedRateLimiter(),
    });

    const tokens = await Promise.all(
      commandList.map((command) =>
        issueExpertCommandCallback(
          {
            kind: "expert_command",
            expertId: principal.expertId,
            operation: command.operation,
            objectId: command.objectId,
            version: command.version,
            expiresAtEpochSeconds: Math.floor(now.getTime() / 1_000) + 60,
          },
          secret,
          store,
        ),
      ),
    );
    expect(tokens.join(" ")).not.toContain("ER-SERVER-ONLY-CODE");

    for (const [index, token] of tokens.entries()) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers: {
          "x-telegram-bot-api-secret-token": "telegram-webhook-secret",
          "x-correlation-id": `telegram-command-${String(index + 1)}`,
        },
        payload: {
          update_id: 1_301 + index,
          callback_query: {
            id: `query-${String(index + 1)}`,
            from: { id: 1301 },
            data: token,
          },
        },
      });
      expect(response.statusCode).toBe(200);
    }

    expect(referrals.redeemCode).toHaveBeenCalledWith(
      principal,
      "ER-SERVER-ONLY-CODE",
      "telegram-redeem-1301",
    );
    expect(referrals.summary).toHaveBeenCalledWith(principal);
    expect(residency.quote).toHaveBeenCalledWith(principal, "expert-month-v1");
    expect(residency.checkout).toHaveBeenCalledWith(principal, {
      tariffKey: "expert-month-v1",
      idempotencyKey: "telegram-checkout-1301",
      providerDeadline: new Date("2026-08-03T12:15:00.000Z"),
    });
    expect(published).toEqual([
      {
        telegramUserId: "1301",
        correlationId: "telegram-command-1",
        outcome: { kind: "referral_redeemed" },
      },
      {
        telegramUserId: "1301",
        correlationId: "telegram-command-2",
        outcome: {
          kind: "referral_summary",
          view: {
            code: { status: "issued", maskedSuffix: "…1301" },
            spendableBalanceMinor: "100000",
            reservedBalanceMinor: "25000",
            debtMinor: "5000",
            nearestExpiryAt: "2027-08-01T00:00:00.000Z",
          },
        },
      },
      {
        telegramUserId: "1301",
        correlationId: "telegram-command-3",
        outcome: {
          kind: "residency_quote",
          view: {
            tariffVersionId: "00000000-0000-4000-8000-000000001302",
            displayName: "Expert month",
            description: "30 days",
            priceMinor: "200000",
            currency: "RUB",
            durationSeconds: 2_592_000,
            creditMinor: "100000",
            cashMinor: "100000",
          },
        },
      },
      {
        telegramUserId: "1301",
        correlationId: "telegram-command-4",
        outcome: {
          kind: "residency_checkout",
          orderId: "00000000-0000-4000-8000-000000001303",
          result: { kind: "pending_reconciliation" },
        },
      },
    ]);
    expect(JSON.stringify(published)).not.toContain("private-grant");
    expect(JSON.stringify(published)).not.toContain("private-payment");
    expect(JSON.stringify(published)).not.toContain("disabled");
    await app.close();
  });
});
