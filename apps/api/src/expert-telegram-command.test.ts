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
    const commandStates = new Map<
      string,
      { kind: "available" | "leased" | "completed"; leaseId?: string }
    >();
    const leaseTokens = new Map<string, string>();
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
        async acquire(input) {
          const { tokenHash, claims } = input.authenticated;
          const state = commandStates.get(tokenHash) ?? { kind: "available" };
          if (state.kind === "completed") return { kind: "completed" };
          if (state.kind === "leased") return { kind: "busy" };
          const command = commands.get(claims.objectId);
          if (
            command === undefined ||
            command.operation !== claims.operation ||
            command.version !== claims.version ||
            claims.expertId !== principal.expertId ||
            input.telegramUserId !== "1301" ||
            input.preparedBinding.telegramUserId !== "1301" ||
            input.preparedBinding.principal.expertId !== principal.expertId ||
            !input.preparedBinding.active ||
            !input.preparedBinding.verified
          ) {
            return { kind: "rejected" };
          }
          const leaseId = `lease-${tokenHash}`;
          commandStates.set(tokenHash, { kind: "leased", leaseId });
          leaseTokens.set(leaseId, tokenHash);
          return { kind: "acquired", leaseId, principal, command };
        },
        async complete(leaseId) {
          const tokenHash = leaseTokens.get(leaseId);
          if (tokenHash === undefined) throw new Error("unknown_test_lease");
          commandStates.set(tokenHash, { kind: "completed" });
        },
        async release(leaseId) {
          const tokenHash = leaseTokens.get(leaseId);
          if (tokenHash === undefined) throw new Error("unknown_test_lease");
          commandStates.set(tokenHash, { kind: "available" });
        },
      },
      referrals,
      residency,
      output: {
        async publishOnce(message) {
          published.push({
            telegramUserId: message.telegramUserId,
            correlationId: message.correlationId,
            outcome: message.outcome,
          });
        },
      },
    });
    const app = Fastify({ logger: false });
    const receipts = new Map<string, "processing" | "complete">();
    await app.register(telegramWebhookRoutes, {
      secret: "telegram-webhook-secret",
      callbacks: processor,
      inbox: {
        claim: async (_source, eventId) => {
          const state = receipts.get(eventId);
          if (state !== undefined) {
            return {
              kind:
                state === "complete"
                  ? ("duplicate" as const)
                  : ("busy" as const),
            };
          }
          receipts.set(eventId, "processing");
          return { kind: "claimed" as const, claimId: eventId };
        },
        complete: async (claimId) => {
          receipts.set(claimId, "complete");
        },
        fail: async (claimId) => {
          receipts.delete(claimId);
        },
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

    const completedDuplicate = await app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram",
      headers: {
        "x-telegram-bot-api-secret-token": "telegram-webhook-secret",
        "x-correlation-id": "telegram-command-duplicate",
      },
      payload: {
        update_id: 1_301,
        callback_query: {
          id: "query-duplicate",
          from: { id: 1301 },
          data: tokens[0],
        },
      },
    });
    expect(completedDuplicate.statusCode).toBe(200);

    expect(referrals.redeemCode).toHaveBeenCalledWith(
      principal,
      "ER-SERVER-ONLY-CODE",
      "telegram-redeem-1301",
    );
    expect(referrals.redeemCode).toHaveBeenCalledTimes(1);
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

type AtomicAcquireInput = Readonly<{
  authenticated: Readonly<{
    tokenHash: string;
    claims: ExpertCommandCallbackClaims;
  }>;
  telegramUserId: string;
  preparedBinding: Readonly<{
    telegramUserId: string;
    principal: ExpertPrincipal;
    active: boolean;
    verified: boolean;
  }>;
  now: Date;
  receipt: Readonly<{ source: "telegram"; updateId: string }>;
}>;

type RetryHarnessOptions = Readonly<{
  serviceFailsOnce?: boolean;
  outputFailsOnce?: boolean;
  firstClaim?: "busy" | "throw";
  mutateBeforeAcquire?: "version" | "object" | "operation" | "binding";
}>;

const retryHarness = async (options: RetryHarnessOptions = {}) => {
  const callbackValues = new Map<string, ExpertCommandCallbackClaims>();
  const legacyConsumed = new Set<string>();
  let callbackConsumes = 0;
  const store: ExpertCommandCallbackClaimsStore = {
    async put(key, value) {
      callbackValues.set(key, value);
    },
    async peek(key) {
      return legacyConsumed.has(key) ? null : (callbackValues.get(key) ?? null);
    },
    async consumeIfValid(input) {
      callbackConsumes += 1;
      const value = callbackValues.get(input.tokenHash);
      if (
        legacyConsumed.has(input.tokenHash) ||
        value === undefined ||
        value.expertId !== input.expertId ||
        value.operation !== input.operation ||
        value.objectId !== input.objectId ||
        value.version !== input.version ||
        value.expiresAtEpochSeconds <= Math.floor(input.now.getTime() / 1_000)
      ) {
        return null;
      }
      legacyConsumed.add(input.tokenHash);
      return value;
    },
  };

  const originalCommand: ExpertTelegramServerCommand = {
    operation: "redeem_expert_referral",
    objectId: "retry-command-1301",
    version: 1,
    code: "ER-RETRY-SERVER-ONLY",
    idempotencyKey: "telegram-retry-1301",
  };
  let currentCommand: ExpertTelegramServerCommand = originalCommand;
  const originalBinding = {
    telegramUserId: "1301",
    principal,
    active: true,
    verified: true,
  } as const;
  let currentBinding: Readonly<{
    telegramUserId: string;
    principal: ExpertPrincipal;
    active: boolean;
    verified: boolean;
  }> = originalBinding;

  const executionState = new Map<
    string,
    {
      kind: "available" | "leased" | "completed";
      leaseId?: string;
      receiptKey: string | undefined;
    }
  >();
  const leaseTokenHashes = new Map<string, string>();
  let acquisitionCalls = 0;
  let releaseCalls = 0;
  let completeCalls = 0;
  const samePrincipal = (left: ExpertPrincipal, right: ExpertPrincipal) =>
    left.expertId === right.expertId &&
    left.userId === right.userId &&
    left.provider === right.provider &&
    left.externalId === right.externalId;
  const commandPort = {
    async currentVersion(input: {
      expertId: string;
      operation: ExpertCommandCallbackClaims["operation"];
      objectId: string;
    }) {
      return input.expertId === principal.expertId &&
        input.operation === currentCommand.operation &&
        input.objectId === currentCommand.objectId
        ? currentCommand.version
        : null;
    },
    async resolveCurrent(input: {
      expertId: string;
      operation: ExpertCommandCallbackClaims["operation"];
      objectId: string;
      version: number;
    }) {
      return input.expertId === principal.expertId &&
        input.operation === currentCommand.operation &&
        input.objectId === currentCommand.objectId &&
        input.version === currentCommand.version
        ? currentCommand
        : null;
    },
    async acquire(input: AtomicAcquireInput) {
      acquisitionCalls += 1;
      const { tokenHash, claims } = input.authenticated;
      const state = executionState.get(tokenHash) ?? {
        kind: "available",
        receiptKey: undefined,
      };
      if (state.kind === "completed") return { kind: "completed" } as const;
      if (state.kind === "leased") return { kind: "busy" } as const;
      const receiptKey =
        input.receipt === undefined
          ? undefined
          : `${input.receipt.source}:${input.receipt.updateId}`;
      if (state.receiptKey !== undefined && state.receiptKey !== receiptKey) {
        return { kind: "rejected" } as const;
      }
      const stored = callbackValues.get(tokenHash);
      const bindingUnchanged =
        currentBinding.telegramUserId === input.telegramUserId &&
        currentBinding.telegramUserId ===
          input.preparedBinding.telegramUserId &&
        currentBinding.active &&
        currentBinding.verified &&
        input.preparedBinding.active &&
        input.preparedBinding.verified &&
        samePrincipal(
          currentBinding.principal,
          input.preparedBinding.principal,
        );
      if (
        stored === undefined ||
        stored.expertId !== claims.expertId ||
        stored.operation !== claims.operation ||
        stored.objectId !== claims.objectId ||
        stored.version !== claims.version ||
        stored.expiresAtEpochSeconds !== claims.expiresAtEpochSeconds ||
        claims.expertId !== currentBinding.principal.expertId ||
        claims.expiresAtEpochSeconds <=
          Math.floor(input.now.getTime() / 1_000) ||
        !bindingUnchanged ||
        currentCommand.operation !== claims.operation ||
        currentCommand.objectId !== claims.objectId ||
        currentCommand.version !== claims.version
      ) {
        return { kind: "rejected" } as const;
      }
      const leaseId = `lease-${String(acquisitionCalls)}`;
      executionState.set(tokenHash, {
        kind: "leased",
        leaseId,
        receiptKey: state.receiptKey ?? receiptKey,
      });
      leaseTokenHashes.set(leaseId, tokenHash);
      return {
        kind: "acquired",
        leaseId,
        principal: Object.freeze({ ...currentBinding.principal }),
        command: Object.freeze({ ...currentCommand }),
      } as const;
    },
    async complete(leaseId: string) {
      completeCalls += 1;
      const tokenHash = leaseTokenHashes.get(leaseId);
      if (tokenHash === undefined) throw new Error("unknown_test_lease");
      executionState.set(tokenHash, {
        kind: "completed",
        receiptKey: executionState.get(tokenHash)?.receiptKey,
      });
    },
    async release(leaseId: string) {
      releaseCalls += 1;
      const tokenHash = leaseTokenHashes.get(leaseId);
      if (tokenHash === undefined) throw new Error("unknown_test_lease");
      executionState.set(tokenHash, {
        kind: "available",
        receiptKey: executionState.get(tokenHash)?.receiptKey,
      });
    },
  };

  let serviceFails = options.serviceFailsOnce ?? false;
  let outputFails = options.outputFailsOnce ?? false;
  let serviceAttempts = 0;
  let semanticEffects = 0;
  const appliedIdempotencyKeys = new Set<string>();
  const published: unknown[] = [];
  const outputRecords = new Map<string, string>();
  const referrals = {
    async redeemCode(
      candidatePrincipal: ExpertPrincipal,
      code: string,
      idempotencyKey: string,
    ) {
      serviceAttempts += 1;
      if (serviceFails) {
        serviceFails = false;
        throw new Error("test_service_unavailable");
      }
      if (!appliedIdempotencyKeys.has(idempotencyKey)) {
        appliedIdempotencyKeys.add(idempotencyKey);
        semanticEffects += 1;
      }
      expect(candidatePrincipal).toEqual(principal);
      expect(code).toBe("ER-RETRY-SERVER-ONLY");
      return { kind: "redeemed" as const, referralId: "private-referral" };
    },
    async summary() {
      throw new Error("unexpected_summary");
    },
  } as unknown as ExpertReferralService;
  const output = {
    async publishOnce(message: {
      receipt: { source: "telegram"; updateId: string };
      outcomeId: string;
      telegramUserId: string;
      outcome: unknown;
    }) {
      const key = `${message.receipt.source}:${message.receipt.updateId}:${message.outcomeId}`;
      const semanticPayload = JSON.stringify({
        telegramUserId: message.telegramUserId,
        outcome: message.outcome,
      });
      const prior = outputRecords.get(key);
      if (prior !== undefined && prior !== semanticPayload) {
        throw new Error("test_output_idempotency_conflict");
      }
      if (prior === undefined) {
        outputRecords.set(key, semanticPayload);
        published.push(message);
      }
      if (outputFails) {
        outputFails = false;
        throw new Error("test_output_ambiguous");
      }
    },
  };
  const processor = createExpertTelegramCommandProcessor({
    secret,
    store,
    clock: { now: () => new Date(now) },
    bindings: {
      async resolveCurrent(telegramUserId) {
        return telegramUserId === currentBinding.telegramUserId
          ? currentBinding
          : null;
      },
    },
    commands: commandPort as never,
    referrals,
    residency: {} as ExpertResidencyService,
    output,
  });

  const receipts = new Map<string, "processing" | "complete">();
  let firstClaim = options.firstClaim;
  let mutated = false;
  const app = Fastify({ logger: false });
  await app.register(telegramWebhookRoutes, {
    secret: "telegram-webhook-secret",
    callbacks: processor,
    inbox: {
      async claim(_provider, eventId) {
        if (firstClaim !== undefined) {
          const behavior = firstClaim;
          firstClaim = undefined;
          if (behavior === "throw") throw new Error("test_inbox_unavailable");
          return { kind: "busy" as const };
        }
        if (!mutated && options.mutateBeforeAcquire !== undefined) {
          mutated = true;
          if (options.mutateBeforeAcquire === "version") {
            currentCommand = { ...originalCommand, version: 2 };
          } else if (options.mutateBeforeAcquire === "object") {
            currentCommand = {
              ...originalCommand,
              objectId: "replacement-command-1301",
            };
          } else if (options.mutateBeforeAcquire === "operation") {
            currentCommand = {
              operation: "view_referral_summary",
              objectId: originalCommand.objectId,
              version: originalCommand.version,
              code: { status: "none", maskedSuffix: null },
            };
          } else {
            currentBinding = {
              ...originalBinding,
              principal: { ...principal, userId: "replacement-user-1301" },
            };
          }
        }
        const stored = receipts.get(eventId);
        if (stored !== undefined) {
          return {
            kind:
              stored === "complete"
                ? ("duplicate" as const)
                : ("busy" as const),
          };
        }
        receipts.set(eventId, "processing");
        return { kind: "claimed" as const, claimId: eventId };
      },
      async complete(claimId) {
        receipts.set(claimId, "complete");
      },
      async fail(claimId) {
        receipts.delete(claimId);
      },
    },
    rateLimiter: createWindowedRateLimiter(),
  });

  const token = await issueExpertCommandCallback(
    {
      kind: "expert_command",
      expertId: principal.expertId,
      operation: originalCommand.operation,
      objectId: originalCommand.objectId,
      version: originalCommand.version,
      expiresAtEpochSeconds: Math.floor(now.getTime() / 1_000) + 60,
    },
    secret,
    store,
  );
  for (const tokenHash of callbackValues.keys()) {
    executionState.set(tokenHash, {
      kind: "available",
      receiptKey: undefined,
    });
  }
  const send = (updateId: number) =>
    app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram",
      headers: {
        "x-telegram-bot-api-secret-token": "telegram-webhook-secret",
        "x-correlation-id": "shared-retry-correlation",
      },
      payload: {
        update_id: updateId,
        callback_query: {
          id: `query-${String(updateId)}`,
          from: { id: 1301 },
          data: token,
        },
      },
    });

  return {
    app,
    send,
    metrics: {
      callbackConsumes: () => callbackConsumes,
      acquisitions: () => acquisitionCalls,
      releases: () => releaseCalls,
      completes: () => completeCalls,
      serviceAttempts: () => serviceAttempts,
      semanticEffects: () => semanticEffects,
      published: () => published.length,
    },
  };
};

describe("expert Telegram callback retry safety", () => {
  it("binds a released service-failure lease to the original receipt before retry", async () => {
    const harness = await retryHarness({ serviceFailsOnce: true });
    expect((await harness.send(2_001)).statusCode).toBe(500);
    expect((await harness.send(2_101)).statusCode).toBe(403);
    expect(harness.metrics.serviceAttempts()).toBe(1);
    expect(harness.metrics.semanticEffects()).toBe(0);
    expect(harness.metrics.published()).toBe(0);
    expect((await harness.send(2_001)).statusCode).toBe(200);
    expect(harness.metrics.serviceAttempts()).toBe(2);
    expect(harness.metrics.semanticEffects()).toBe(1);
    expect(harness.metrics.published()).toBe(1);
    expect(harness.metrics.releases()).toBe(1);
    expect(harness.metrics.completes()).toBe(1);
    await harness.app.close();
  });

  it("deduplicates ambiguous output and rejects a different receipt before retry", async () => {
    const harness = await retryHarness({ outputFailsOnce: true });
    expect((await harness.send(2_002)).statusCode).toBe(500);
    expect(harness.metrics.published()).toBe(1);
    expect((await harness.send(2_102)).statusCode).toBe(403);
    expect(harness.metrics.serviceAttempts()).toBe(1);
    expect(harness.metrics.semanticEffects()).toBe(1);
    expect(harness.metrics.published()).toBe(1);
    expect((await harness.send(2_002)).statusCode).toBe(200);
    expect(harness.metrics.serviceAttempts()).toBe(2);
    expect(harness.metrics.semanticEffects()).toBe(1);
    expect(harness.metrics.published()).toBe(1);
    expect(harness.metrics.releases()).toBe(1);
    expect(harness.metrics.completes()).toBe(1);
    await harness.app.close();
  });

  it.each([
    ["busy", 200],
    ["throw", 500],
  ] as const)(
    "does not consume or acquire when the inbox claim is %s",
    async (firstClaim, expectedStatus) => {
      const harness = await retryHarness({ firstClaim });
      expect((await harness.send(2_003)).statusCode).toBe(expectedStatus);
      expect(harness.metrics.callbackConsumes()).toBe(0);
      expect(harness.metrics.acquisitions()).toBe(0);
      expect((await harness.send(2_003)).statusCode).toBe(200);
      expect(harness.metrics.semanticEffects()).toBe(1);
      expect(harness.metrics.acquisitions()).toBe(1);
      await harness.app.close();
    },
  );

  it("returns 200 for a completed duplicate without re-executing", async () => {
    const harness = await retryHarness();
    expect((await harness.send(2_004)).statusCode).toBe(200);
    expect((await harness.send(2_004)).statusCode).toBe(200);
    expect(harness.metrics.serviceAttempts()).toBe(1);
    expect(harness.metrics.published()).toBe(1);
    expect(harness.metrics.acquisitions()).toBe(1);
    await harness.app.close();
  });

  it("rejects a replay under a different update ID without re-executing", async () => {
    const harness = await retryHarness();
    expect((await harness.send(2_005)).statusCode).toBe(200);
    expect((await harness.send(2_006)).statusCode).toBe(403);
    expect(harness.metrics.serviceAttempts()).toBe(1);
    expect(harness.metrics.published()).toBe(1);
    expect(harness.metrics.acquisitions()).toBe(2);
    await harness.app.close();
  });

  it.each(["version", "object", "operation", "binding"] as const)(
    "rejects a post-prepare %s change before any Task 8 invocation",
    async (mutateBeforeAcquire) => {
      const harness = await retryHarness({ mutateBeforeAcquire });
      expect((await harness.send(2_007)).statusCode).toBe(403);
      expect(harness.metrics.serviceAttempts()).toBe(0);
      expect(harness.metrics.semanticEffects()).toBe(0);
      expect(harness.metrics.published()).toBe(0);
      await harness.app.close();
    },
  );
});
