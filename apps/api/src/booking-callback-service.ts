import type { WebhookInbox } from "./routes/selarti-webhook.js";
import { authenticateCallbackToken } from "@ii-tonya/integrations";

export interface LinkedBookingCallback {
  deliveryId: string;
  reservationId: string;
  expertId: string;
  action: "confirm" | "cancel";
  version: number;
}
export interface ScopedBookingDecision {
  reservationId: string;
  expertId: string;
  callbackTokenHash: string;
  expectedVersion: number;
  correlationId: string;
  telegramContext: {
    botKey: string;
    telegramUserId: string;
    chatId: string;
    messageId: number;
    deliveryId: string;
  };
}
export type BookingCallbackResult = {
  kind: "processed" | "replayed" | "rejected" | "busy" | "unavailable";
};
export interface BookingCallbackService {
  handle(
    update: unknown,
    botKey: string,
    correlationId: string,
  ): Promise<BookingCallbackResult>;
}
export interface BookingCallbackDependencies {
  botKey: string;
  secret: Uint8Array;
  repository: {
    findLinkedCallback(hash: string): Promise<LinkedBookingCallback | null>;
  };
  bookings: {
    confirmByExpert(
      command: ScopedBookingDecision,
    ): Promise<{ replayed?: true }>;
    cancelByExpert(
      command: ScopedBookingDecision,
    ): Promise<{ replayed?: true }>;
  };
  inbox: WebhookInbox;
  acknowledge(input: {
    callbackQueryId: string;
    signal: AbortSignal;
  }): Promise<void>;
}
const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const positiveId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

export function createBookingCallbackService(
  deps: BookingCallbackDependencies,
): BookingCallbackService {
  if (
    !/^[A-Za-z0-9_-]{1,128}$/u.test(deps.botKey) ||
    deps.secret.byteLength < 32
  )
    throw new Error("booking_callback_configuration_invalid");
  const secret = Uint8Array.from(deps.secret);
  const botKey = deps.botKey;
  const acknowledge = async (callbackQueryId: string) => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve()
          .then(() =>
            deps.acknowledge({ callbackQueryId, signal: controller.signal }),
          )
          .catch(() => {}),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 3000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
  return {
    async handle(update, requestedBotKey, correlationId) {
      const root = record(update);
      const callback = record(root?.callback_query);
      const from = record(callback?.from);
      const message = record(callback?.message);
      const chat = record(message?.chat);
      if (
        requestedBotKey !== botKey ||
        !root ||
        typeof root.update_id !== "number" ||
        !Number.isSafeInteger(root.update_id) ||
        root.update_id < 0 ||
        !callback ||
        typeof callback.id !== "string" ||
        !/^[^\u0000-\u001F\u007F-\u009F]{1,256}$/u.test(callback.id) ||
        typeof callback.data !== "string" ||
        !/^ct2\.[A-Za-z0-9_-]{44}$/u.test(callback.data) ||
        !positiveId(from?.id) ||
        !positiveId(chat?.id) ||
        chat.id !== from.id ||
        chat.type !== "private" ||
        !positiveId(message?.message_id)
      )
        return { kind: "rejected" };
      let tokenHash: string;
      try {
        tokenHash = authenticateCallbackToken(callback.data, secret);
      } catch {
        return { kind: "rejected" };
      }
      let claim: Awaited<ReturnType<WebhookInbox["claim"]>> | undefined;
      try {
        const linked = await deps.repository.findLinkedCallback(tokenHash);
        if (!linked) return { kind: "rejected" };
        claim = await deps.inbox.claim(
          "telegram",
          `booking:${botKey}:${root.update_id}`,
        );
        if (claim.kind === "busy") return { kind: "busy" };
        // Even inbox duplicates go through current transactional recipient authorization.
        const command: ScopedBookingDecision = {
          reservationId: linked.reservationId,
          expertId: linked.expertId,
          callbackTokenHash: tokenHash,
          expectedVersion: linked.version,
          correlationId,
          telegramContext: {
            botKey,
            telegramUserId: String(from.id),
            chatId: String(chat.id),
            messageId: message.message_id,
            deliveryId: linked.deliveryId,
          },
        };
        const result =
          linked.action === "confirm"
            ? await deps.bookings.confirmByExpert(command)
            : await deps.bookings.cancelByExpert(command);
        if (claim.kind === "claimed") await deps.inbox.complete(claim.claimId);
        await acknowledge(callback.id);
        return { kind: result.replayed ? "replayed" : "processed" };
      } catch (error) {
        if (claim?.kind === "claimed") {
          try {
            await deps.inbox.fail(claim.claimId);
          } catch {
            /* bounded safe response; no raw DB error */
          }
        }
        if (
          error instanceof Error &&
          error.message === "Invalid, stale, or consumed expert callback"
        )
          return { kind: "rejected" };
        return { kind: "unavailable" };
      }
    },
  };
}
