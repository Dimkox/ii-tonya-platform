import { createHash } from "node:crypto";
import type { TelegramCallbackService } from "./routes/telegram-webhook.js";

/** Storage port; Postgres implementation is PostgresTelegramCallbackReplayRepository. */
export interface TelegramCallbackStore {
  isActiveExpertTelegramUser(telegramUserId: string): Promise<boolean>;
  isProcessed(callbackQueryId: string): Promise<boolean>;
  recordProcessed(callbackQueryId: string): Promise<boolean>;
}

const numericIdentity = /^[1-9][0-9]{0,19}$/u;
// Telegram callback ids are opaque strings; bound size and charset.
const callbackIdPattern = /^[A-Za-z0-9_-]{1,128}$/u;

interface ParsedCallback {
  id: string;
  fromId: string;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Strict shape check of update.callback_query; undefined when invalid. */
export function parseTelegramCallback(
  update: Readonly<Record<string, unknown>>,
): ParsedCallback | undefined {
  const callback = asRecord(update.callback_query);
  const from = asRecord(callback?.from);
  if (callback === undefined || from === undefined) return undefined;
  const id = callback.id;
  const fromId =
    typeof from.id === "number" && Number.isSafeInteger(from.id)
      ? String(from.id)
      : undefined;
  if (typeof id !== "string" || !callbackIdPattern.test(id)) return undefined;
  if (fromId === undefined || !numericIdentity.test(fromId)) return undefined;
  if (from.is_bot === true) return undefined;
  const data = callback.data;
  if (
    data !== undefined &&
    (typeof data !== "string" || Buffer.byteLength(data, "utf8") > 64)
  )
    return undefined;
  return { id, fromId };
}

/** Stable, content-free key for the replay store (no raw provider id at rest). */
export const callbackReplayKey = (callbackId: string): string =>
  createHash("sha256").update(callbackId).digest("hex");

/**
 * Live Telegram callback boundary for the generic callback path.
 * The route already checks X-Telegram-Bot-Api-Secret-Token in constant time
 * and dedupes update_id in webhook_inbox. This service adds identity
 * authorization, strict callback shape, and callback_query.id replay
 * protection stored in Postgres.
 */
export function createTelegramCallbackService(
  store: TelegramCallbackStore,
): TelegramCallbackService {
  return Object.freeze({
    async isAuthorizedIdentity(telegramUserId: string) {
      if (!numericIdentity.test(telegramUserId)) return false;
      return store.isActiveExpertTelegramUser(telegramUserId);
    },
    async verifyCallback(update: Readonly<Record<string, unknown>>) {
      const parsed = parseTelegramCallback(update);
      if (parsed === undefined) return false;
      if (!(await store.isActiveExpertTelegramUser(parsed.fromId)))
        return false;
      // Authentication only. A redelivered callback is a duplicate, not a
      // forgery: the route's update_id inbox dedups it, and process() is a
      // first-writer-wins no-op for an already-recorded callback id.
      return true;
    },
    async process(update: Readonly<Record<string, unknown>>) {
      const parsed = parseTelegramCallback(update);
      if (parsed === undefined) return;
      // First writer wins; a concurrent replay records nothing and is a no-op.
      await store.recordProcessed(callbackReplayKey(parsed.id));
    },
  });
}
