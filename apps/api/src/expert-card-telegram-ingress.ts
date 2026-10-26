import { createHash } from "node:crypto";
import type {
  ExpertCardService,
  ExpertCardContent,
} from "@ii-tonya/application";
export interface ExpertCardLegacyReplayRead {
  read(input: {
    botId: string;
    updateId: string;
  }): Promise<"absent" | "complete" | "pending">;
}
export interface ExpertCardTelegramIngress {
  legacyReplay: ExpertCardLegacyReplayRead;
  workBotId: string;
  workBotKey: string;
  webhookSecret: string;
  service: Pick<ExpertCardService, "handleWork">;
  answerTagCallback?: (input: {
    botId: string;
    callbackQueryId: string;
    signal: AbortSignal;
  }) => Promise<void>;
}
export function validRawExpertCardUpdateId(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const id = (body as Record<string, unknown>).update_id;
  return typeof id === "number" && Number.isSafeInteger(id) && id >= 0;
}
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const id = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? String(value)
    : null;
const file = (value: unknown): string | null =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,512}$/u.test(value)
    ? `telegram:file:${value}`
    : null;
export function parseExpertCardTelegramUpdate(
  body: unknown,
  scope: Pick<ExpertCardTelegramIngress, "workBotId" | "workBotKey">,
  options: { lifecycleCommands?: boolean } = {},
):
  | { kind: "unhandled" | "invalid" }
  | { kind: "parsed"; input: Parameters<ExpertCardService["handleWork"]>[0] } {
  const root = record(body);
  if (!root) return { kind: "unhandled" };
  const callback = record(root.callback_query);
  if (
    root.callback_query &&
    (typeof callback?.data !== "string" || !callback.data.startsWith("ct1:"))
  )
    return { kind: "unhandled" };
  const message = callback ? record(callback.message) : record(root.message);
  if (!message) return { kind: "unhandled" };
  // Existing slash commands retain their original authorization and rate limits.
  if (
    typeof message.text === "string" &&
    message.text.startsWith("/") &&
    !/^\/(?:card|card_answers|card_correct|card_submit|promo_proof|my_tariff|main_tariff|main_accept|main_invoice|tags)(?:\s|$)|^\/start card_/u.test(
      message.text,
    ) &&
    !(options.lifecycleCommands && isExpertResidencyLifecycleUpdate(root))
  )
    return { kind: "unhandled" };
  const from = record(callback ? callback.from : message.from),
    chat = record(message.chat),
    telegramUserId = id(from?.id),
    chatId = id(chat?.id);
  if (
    !validRawExpertCardUpdateId(root) ||
    !telegramUserId ||
    telegramUserId !== chatId ||
    chat?.type !== "private" ||
    (from?.is_bot !== undefined && typeof from.is_bot !== "boolean") ||
    from?.is_bot === true
  )
    return { kind: "invalid" };
  if (
    callback &&
    (typeof callback.id !== "string" ||
      callback.id.length < 1 ||
      callback.id.length > 128 ||
      typeof callback.data !== "string" ||
      callback.data.length > 64 ||
      record(message.from)?.is_bot !== true ||
      id(record(message.from)?.id) !== scope.workBotId)
  )
    return { kind: "invalid" };
  let content: ExpertCardContent;
  const hasText = callback ? true : message.text !== undefined,
    hasPhoto = message.photo !== undefined,
    hasDocument = message.document !== undefined;
  if ([hasText, hasPhoto, hasDocument].filter(Boolean).length === 0)
    return { kind: "unhandled" };
  if ([hasText, hasPhoto, hasDocument].filter(Boolean).length !== 1)
    return { kind: "invalid" };
  if (hasText) {
    if (
      !callback &&
      (typeof message.text !== "string" ||
        message.text.length < 1 ||
        message.text.length > 4000)
    )
      return { kind: "invalid" };
    content = {
      kind: "text",
      text: callback ? "/tags" : (message.text as string),
    };
  } else {
    let reference: string | null = null;
    if (hasPhoto) {
      if (
        !Array.isArray(message.photo) ||
        message.photo.length < 1 ||
        message.photo.length > 10 ||
        message.photo.some((p) => !file(record(p)?.file_id))
      )
        return { kind: "invalid" };
      reference = file(record(message.photo.at(-1))?.file_id);
    } else reference = file(record(message.document)?.file_id);
    if (
      !reference ||
      (message.caption !== undefined &&
        (typeof message.caption !== "string" || message.caption.length > 4000))
    )
      return { kind: "invalid" };
    content = {
      kind: hasPhoto ? "photo" : "document",
      reference,
      ...(message.caption === undefined
        ? {}
        : { caption: message.caption as string }),
    };
  }
  const input = {
    botId: scope.workBotId,
    botKey: scope.workBotKey,
    telegramUserId,
    chatId: chatId!,
    updateId: String(root.update_id),
    content,
    ...(callback
      ? {
          callbackData: callback.data as string,
          callbackQueryId: callback.id as string,
        }
      : {}),
  };
  return {
    kind: "parsed",
    input: {
      ...input,
      requestDigest: createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex"),
    },
  };
}

export function isExpertResidencyLifecycleUpdate(body: unknown): boolean {
  const root = record(body),
    message = record(root?.message);
  return (
    typeof message?.text === "string" &&
    /^\/(?:residency|renewal|renewal_quote|renewal_accept|renewal_invoice|pause|resume)(?:\s|$)/u.test(
      message.text.trim(),
    )
  );
}
