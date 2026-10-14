import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { TransportFailure } from "@ii-tonya/integrations";
import { createTelegramSendTextDispatcher } from "./telegram-send-text-dispatcher.js";
import {
  runOutboxBatch,
  type OutboxMessage,
  type OutboxRepository,
} from "./outbox-runner.js";

const allowAll = { allowsSend: async () => true };

const message = (payload: Record<string, unknown>): OutboxMessage => ({
  id: randomUUID(),
  topic: "telegram.send_text.v1",
  payload,
  correlationId: "correlation-b2",
  attempt: 1,
  reconciliationKey: "sha256:" + "a".repeat(64),
  reconciliationAttempt: 0,
  dispatchClaimToken: "claim",
  reconciliationClaimToken: null,
});
const payload = () => ({
  deliveryId: randomUUID(),
  dialogueId: randomUUID(),
  sequence: 1,
  botKey: "bot-b2",
  chatId: "801",
  text: "Ответ в том же чате",
});

describe("telegram.send_text.v1 dispatcher", () => {
  it("validates bot scope and sends minimal text to the original chat", async () => {
    const request = vi.fn(async () => ({
      status: 200,
      body: { ok: true, result: { message_id: 42 } },
    }));
    const dispatcher = createTelegramSendTextDispatcher({
      consentGate: allowAll,
      enabled: true,
      botKey: "bot-b2",
      sendMessageUrl: new URL(
        "https://api.telegram.org/botREDACTED/sendMessage",
      ),
      transport: { request },
    });
    await expect(dispatcher.dispatch(message(payload()))).resolves.toEqual({
      kind: "applied",
      providerOperationId: "42",
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { chat_id: "801", text: "Ответ в том же чате" },
        context: expect.objectContaining({ disableRequestLogging: true }),
      }),
    );
    await expect(
      dispatcher.dispatch(message({ ...payload(), botKey: "other-bot" })),
    ).resolves.toEqual({ kind: "terminal", reasonCode: "invalid_payload" });
  });

  it("maps uncertain transport completion to unknown outcome and never retries blindly", async () => {
    const dispatcher = createTelegramSendTextDispatcher({
      consentGate: allowAll,
      enabled: true,
      botKey: "bot-b2",
      sendMessageUrl: new URL(
        "https://api.telegram.org/botREDACTED/sendMessage",
      ),
      transport: {
        request: async () => {
          throw new TransportFailure("after_write");
        },
      },
    });
    await expect(
      dispatcher.dispatch(message(payload())),
    ).resolves.toMatchObject({
      kind: "unknown_outcome",
      reasonCode: "transport_outcome_unknown",
    });
    await expect(dispatcher.reconcile(message(payload()))).resolves.toBe(
      "still_unknown",
    );
  });

  it("maps 429 and before-write failure to retryable not-applied", async () => {
    const make = (
      request: () =>
        Promise<never> | Promise<{ status: number; body: unknown }>,
    ) =>
      createTelegramSendTextDispatcher({
        consentGate: allowAll,
        enabled: true,
        botKey: "bot-b2",
        sendMessageUrl: new URL(
          "https://api.telegram.org/botREDACTED/sendMessage",
        ),
        transport: { request },
      });
    await expect(
      make(async () => ({ status: 429, body: {} })).dispatch(
        message(payload()),
      ),
    ).resolves.toEqual({
      kind: "not_applied",
      retryable: true,
      reasonCode: "rate_limited",
    });
    await expect(
      make(async () => {
        throw new TransportFailure("before_write");
      }).dispatch(message(payload())),
    ).resolves.toEqual({
      kind: "not_applied",
      retryable: true,
      reasonCode: "timeout_before_write",
    });
  });

  it("is disabled without transport and rejects token or URL authority in payload", async () => {
    const request = vi.fn();
    const dispatcher = createTelegramSendTextDispatcher({
      consentGate: allowAll,
      enabled: false,
      botKey: "bot-b2",
      sendMessageUrl: new URL(
        "https://api.telegram.org/botREDACTED/sendMessage",
      ),
      transport: { request },
    });
    await expect(
      dispatcher.dispatch(message(payload())),
    ).resolves.toMatchObject({
      kind: "not_applied",
      retryable: true,
    });
    expect(request).not.toHaveBeenCalled();
    const enabled = createTelegramSendTextDispatcher({
      consentGate: allowAll,
      ...dispatcherDeps(request),
      enabled: true,
    });
    await expect(
      enabled.dispatch(
        message({
          ...payload(),
          botToken: "secret",
          url: "https://evil.example",
        }),
      ),
    ).resolves.toEqual({ kind: "terminal", reasonCode: "invalid_payload" });
    expect(request).not.toHaveBeenCalled();
  });

  it("drives OutboxRunner into durable unknown-outcome state", async () => {
    const pending = message(payload());
    const markUnknownOutcome = vi.fn(async () => undefined);
    const repository = {
      recoverExpiredDispatchLeases: vi.fn(async () => 0),
      recoverExpiredReconciliationLeases: vi.fn(async () => 0),
      claimUnknown: vi.fn(async () => []),
      claim: vi.fn(async () => [pending]),
      recordAttemptStarted: vi.fn(async () => undefined),
      markUnknownOutcome,
    } as unknown as OutboxRepository;
    const dispatcher = createTelegramSendTextDispatcher({
      consentGate: allowAll,
      ...dispatcherDeps(async () => {
        throw new TransportFailure("after_write");
      }),
      enabled: true,
    });
    await runOutboxBatch({
      repository,
      dispatcher,
      reconciler: dispatcher,
      now: () => new Date(0),
      retryDelayMs: () => 1000,
      maxAttempts: 3,
      maxReconciliationAttempts: 3,
      batchSize: 1,
      workerId: "b2-worker",
      newAttemptId: () => "attempt-b2",
    });
    expect(markUnknownOutcome).toHaveBeenCalledWith(
      pending.id,
      "b2-worker",
      pending.dispatchClaimToken,
      "attempt-b2",
      pending.reconciliationKey,
      "transport_outcome_unknown",
    );
  });
});

function dispatcherDeps(
  request: Parameters<
    typeof createTelegramSendTextDispatcher
  >[0]["transport"]["request"],
) {
  return {
    botKey: "bot-b2",
    sendMessageUrl: new URL("https://api.telegram.org/botREDACTED/sendMessage"),
    transport: { request },
  };
}

describe("pre-send consent re-check (EGRESS-01)", () => {
  const build = (
    gate: { allowsSend(dialogueId: string): Promise<boolean> },
    body: () => Record<string, unknown> = payload,
  ) => {
    const request = vi.fn(async () => ({
      status: 200,
      body: { ok: true, result: { message_id: 42 } },
    }));
    const dispatcher = createTelegramSendTextDispatcher({
      enabled: true,
      botKey: "bot-b2",
      sendMessageUrl: new URL("https://api.telegram.example/bot/sendMessage"),
      transport: { request } as never,
      consentGate: gate,
    });
    const send = () => dispatcher.dispatch(message(body()) as never);
    return { request, send };
  };

  it("refuses the network call when the consent stopped being valid", async () => {
    const { request, send } = build({ allowsSend: async () => false });
    await expect(send()).resolves.toEqual({
      kind: "terminal",
      reasonCode: "local_source_invalid",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("asks about the dialogue of the message, not about the chat", async () => {
    const asked: string[] = [];
    const { request, send } = build({
      allowsSend: async (dialogueId: string) => {
        asked.push(dialogueId);
        return true;
      },
    });
    await send();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/^[0-9a-f-]{36}$/u);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("treats a failing check as no consent", async () => {
    const { request, send } = build({
      allowsSend: async () => {
        throw new Error("connection reset");
      },
    });
    await expect(send()).resolves.toEqual({
      kind: "terminal",
      reasonCode: "local_source_invalid",
    });
    expect(request).not.toHaveBeenCalled();
  });
});
