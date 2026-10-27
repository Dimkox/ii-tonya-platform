import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEnv } from "@ii-tonya/config";
import * as db from "@ii-tonya/db";
import { createProductionWorkerRuntimeFactory } from "./main.js";
import {
  runOutboxBatch,
  type OutboxRepository,
  type DispatchOutcome,
} from "../../../packages/worker/src/outbox-runner.js";

vi.mock("@ii-tonya/db", async (original) => {
  const actual = await original<typeof db>();
  return { ...actual, createDb: vi.fn(actual.createDb) };
});
const token = "123456:synthetic_token_abcdefghijklmnopqrstuvwxyz";
function config() {
  return loadEnv({
    DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:1/synthetic",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    CLIENT_TELEGRAM_BOT_KEY: "client.bot-one",
    TELEGRAM_BOT_TOKEN: token,
    B2_TELEGRAM_DISPATCH_ENABLED: "true",
    TELEGRAM_EGRESS_CONSENT_GATE_ENABLED: "true",
  });
}
afterEach(() => vi.clearAllMocks());

describe("ordinary client Telegram factory readiness", () => {
  it("creates default capability from client credentials without fetching at startup", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const dependencies = { clientTelegramFetch: fetch };
    const runtime = await createProductionWorkerRuntimeFactory(
      dependencies as Parameters<
        typeof createProductionWorkerRuntimeFactory
      >[0],
    ).create(config());
    await runtime.close();
    expect(db.createDb).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["key", "token", "gate", "malformed-token", "malformed-key"])(
    "fails %s readiness before creating DB",
    async (missing) => {
      const input = config();
      if (missing === "key") delete input.clientTelegramBotKey;
      if (missing === "token") delete input.clientTelegramBotToken;
      if (missing === "gate") input.features.telegramEgressConsentGate = false;
      if (missing === "malformed-token")
        input.clientTelegramBotToken = "invalid-private-marker";
      if (missing === "malformed-key")
        input.clientTelegramBotKey = "invalid key";
      await expect(
        createProductionWorkerRuntimeFactory().create(input),
      ).rejects.toThrow(/^b2_telegram_delivery_capability_unavailable$/u);
      expect(db.createDb).not.toHaveBeenCalled();
    },
  );
  it("stays disabled with missing client credentials and does not use expert credentials", async () => {
    const input = config();
    input.features.b2TelegramDispatch = false;
    delete input.clientTelegramBotToken;
    delete input.clientTelegramBotKey;
    const fetch = vi.fn<typeof globalThis.fetch>();
    const deps = { clientTelegramFetch: fetch };
    const runtime = await createProductionWorkerRuntimeFactory(
      deps as Parameters<typeof createProductionWorkerRuntimeFactory>[0],
    ).create(input);
    await runtime.close();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not use the expert session bot as a client fallback", async () => {
    const input = config();
    delete input.clientTelegramBotToken;
    input.expertSession = {
      botToken: token,
      botKey: "expert",
      origin: "https://example.invalid",
      botUsername: "synthetic_bot",
      widgetEnabled: false,
    };
    await expect(
      createProductionWorkerRuntimeFactory().create(input),
    ).rejects.toThrow("b2_telegram_delivery_capability_unavailable");
    expect(db.createDb).not.toHaveBeenCalled();
  });
  it("preserves explicit trusted capability injection", async () => {
    const input = config();
    delete input.clientTelegramBotToken;
    const runtime = await createProductionWorkerRuntimeFactory({
      clientAsyncCapabilities: {
        telegram: {
          transport: { request: vi.fn() },
          sendMessageUrl: new URL("https://synthetic.invalid/sendMessage"),
        },
      },
    }).create(input);
    await runtime.close();
  });
  it("keeps Selarti missing capability rejection before DB even with valid Telegram config", async () => {
    const input = config();
    input.features.clientHybridRouting = true;
    input.features.selartiCostAdmission = true;
    input.selartiAiConsentPolicyVersion = "synthetic-v1";
    await expect(
      createProductionWorkerRuntimeFactory().create(input),
    ).rejects.toThrow("selarti_delivery_capability_unavailable");
    expect(db.createDb).not.toHaveBeenCalled();
  });
});

function retryFixture(retryAfterMs?: number, backoff = 1000, current = 10000) {
  const retry = vi.fn();
  const repository: OutboxRepository = {
    claim: async () => [
      {
        id: "synthetic",
        topic: "catalog.show",
        payload: {},
        correlationId: "synthetic",
        attempt: 1,
        reconciliationKey: "synthetic",
        reconciliationAttempt: 0,
        dispatchClaimToken: "claim",
        reconciliationClaimToken: null,
      },
    ],
    claimUnknown: async () => [],
    recordAttemptStarted: async () => {},
    recoverExpiredDispatchLeases: async () => 0,
    recoverExpiredReconciliationLeases: async () => 0,
    retry,
    succeed: vi.fn(),
    markUnknownOutcome: vi.fn(),
    markStillUnknown: vi.fn(),
    deadLetterAndAlert: vi.fn(),
    succeedAfterReconciliation: vi.fn(),
    retryAfterReconciliation: vi.fn(),
    deadLetterAfterReconciliationAndAlert: vi.fn(),
  };
  let time = 0;
  const outcome: DispatchOutcome & { retryAfterMs?: number } = {
    kind: "not_applied",
    retryable: true,
    reasonCode: "rate_limited",
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
  const run = () =>
    runOutboxBatch({
      repository,
      dispatcher: {
        dispatch: async () => {
          time = current;
          return outcome;
        },
      },
      reconciler: { reconcile: async () => "still_unknown" },
      now: () => new Date(time),
      retryDelayMs: () => backoff,
      maxAttempts: 3,
      maxReconciliationAttempts: 3,
      batchSize: 1,
      workerId: "worker",
      newAttemptId: () => "attempt",
    });
  return { run, retry };
}
describe("provider retry delay scheduling", () => {
  it("anchors provider delay after the response, not at batch start", async () => {
    const f = retryFixture(60000);
    await f.run();
    expect(f.retry).toHaveBeenCalledWith(
      "synthetic",
      "worker",
      "claim",
      new Date(70000),
      "rate_limited",
    );
  });
  it("retains larger existing backoff", async () => {
    const f = retryFixture(1000, 30000);
    await f.run();
    expect(f.retry.mock.calls[0]![3].getTime()).toBe(40000);
  });
  it("leaves scheduling without provider delay unchanged", async () => {
    const f = retryFixture();
    await f.run();
    expect(f.retry.mock.calls[0]![3].getTime()).toBe(1000);
  });
  it.each([-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER])(
    "rejects unsafe delay %s without persisting a retry",
    async (delay) => {
      const f = retryFixture(delay);
      await expect(f.run()).rejects.toThrow("outbox_retry_delay_invalid");
      expect(f.retry).not.toHaveBeenCalled();
    },
  );
  it("rejects a valid delay that would overflow a Date", async () => {
    const f = retryFixture(60000, 1000, 8640000000000000 - 1);
    await expect(f.run()).rejects.toThrow("outbox_retry_delay_invalid");
    expect(f.retry).not.toHaveBeenCalled();
  });
});
