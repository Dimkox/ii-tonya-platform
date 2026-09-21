import {
  TransportFailure,
  type TelegramTransport,
} from "@ii-tonya/integrations";
import type {
  DispatchOutcome,
  OutboxDispatcher,
  OutboxMessage,
  OutboxReconciler,
} from "./outbox-runner.js";

/**
 * EGRESS-01 (приёмка T18): согласие сверяется непосредственно перед сетевым вызовом, а не
 * только при выдаче строки из очереди — иначе отзыв в окне лизинга уходит клиенту.
 */
export type TelegramConsentGate = Readonly<{
  allowsSend(dialogueId: string): Promise<boolean>;
}>;

export type TelegramSendTextPayload = Readonly<{
  deliveryId: string;
  dialogueId: string;
  sequence: number;
  botKey: string;
  chatId: string;
  text: string;
}>;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/u;

export function decodeTelegramSendTextPayload(
  raw: unknown,
  expectedBotKey: string,
): TelegramSendTextPayload {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("telegram_send_text_invalid_payload");
  const value = raw as Record<string, unknown>;
  const expected = [
    "botKey",
    "chatId",
    "deliveryId",
    "dialogueId",
    "sequence",
    "text",
  ];
  if (
    Object.keys(value).sort().join("\0") !== expected.sort().join("\0") ||
    typeof value.deliveryId !== "string" ||
    !UUID.test(value.deliveryId) ||
    typeof value.dialogueId !== "string" ||
    !UUID.test(value.dialogueId) ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 1 ||
    value.botKey !== expectedBotKey ||
    typeof value.chatId !== "string" ||
    !/^[1-9]\d{0,19}$/u.test(value.chatId) ||
    typeof value.text !== "string" ||
    value.text.length < 1 ||
    value.text.length > 4_096 ||
    CONTROL.test(value.text)
  )
    throw new Error("telegram_send_text_invalid_payload");
  return value as TelegramSendTextPayload;
}

export function createTelegramSendTextDispatcher(deps: {
  readonly enabled: boolean;
  readonly botKey: string;
  readonly sendMessageUrl: URL;
  readonly transport: TelegramTransport;
  /** Обязателен: собрать отправку без сверки согласия нельзя даже по незнанию. */
  readonly consentGate: TelegramConsentGate;
}): OutboxDispatcher & OutboxReconciler {
  return {
    async dispatch(message: OutboxMessage): Promise<DispatchOutcome> {
      if (!deps.enabled)
        return {
          kind: "not_applied",
          retryable: true,
          reasonCode: "telegram_dispatch_disabled",
        };
      if (message.topic !== "telegram.send_text.v1")
        return { kind: "terminal", reasonCode: "invalid_payload" };
      let payload: TelegramSendTextPayload;
      try {
        payload = decodeTelegramSendTextPayload(message.payload, deps.botKey);
      } catch {
        return { kind: "terminal", reasonCode: "invalid_payload" };
      }
      let allowed: boolean;
      try {
        allowed = await deps.consentGate.allowsSend(payload.dialogueId);
      } catch {
        // Неизвестный результат проверки = не отправляем (fail-closed).
        allowed = false;
      }
      if (!allowed)
        return { kind: "terminal", reasonCode: "local_source_invalid" };

      try {
        const response = await deps.transport.request({
          method: "POST",
          url: deps.sendMessageUrl,
          headers: { "content-type": "application/json" },
          body: { chat_id: payload.chatId, text: payload.text },
          context: {
            idempotencyKey: message.reconciliationKey,
            disableRequestLogging: true,
          },
        });
        if (
          response.status === 200 &&
          response.body !== null &&
          typeof response.body === "object" &&
          (response.body as { ok?: unknown }).ok === true
        ) {
          const id = (response.body as { result?: { message_id?: unknown } })
            .result?.message_id;
          return {
            kind: "applied",
            ...(typeof id === "number" || typeof id === "string"
              ? { providerOperationId: String(id) }
              : {}),
          };
        }
        if (response.status === 429)
          return {
            kind: "not_applied",
            retryable: true,
            reasonCode: "rate_limited",
          };
        if (response.status >= 500)
          return {
            kind: "unknown_outcome",
            reconciliationKey: message.reconciliationKey,
            reasonCode: `http_${response.status}_after_write`,
          };
        return {
          kind: "not_applied",
          retryable: false,
          reasonCode: `http_${response.status}`,
        };
      } catch (error) {
        if (error instanceof TransportFailure && error.phase === "before_write")
          return {
            kind: "not_applied",
            retryable: true,
            reasonCode: "timeout_before_write",
          };
        return {
          kind: "unknown_outcome",
          reconciliationKey: message.reconciliationKey,
          reasonCode: "transport_outcome_unknown",
        };
      }
    },
    async reconcile() {
      return "still_unknown" as const;
    },
  };
}
