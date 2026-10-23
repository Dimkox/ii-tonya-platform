import type { ErasureRequestView } from "@ii-tonya/application";

export interface TelegramDeletionCapability {
  request(input: {
    telegramUserId: string;
    chatId: string;
    updateId: string;
  }): Promise<
    | { kind: "accepted"; request: ErasureRequestView; receiptToken?: string }
    | { kind: "denied" | "unavailable" }
  >;
}
type Outcome =
  | { kind: "unhandled" | "denied" | "unavailable" }
  | {
      kind: "reply";
      reply: { method: "sendMessage"; chat_id: string; text: string };
    };
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const identity = (value: unknown): string | undefined => {
  if (typeof value === "number" && !Number.isSafeInteger(value))
    return undefined;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  return /^[1-9]\d{0,19}$/u.test(String(value)) ? String(value) : undefined;
};

export async function handleTelegramDeletion(
  raw: unknown,
  capability?: TelegramDeletionCapability,
): Promise<Outcome> {
  const message = record(record(raw)?.message);
  if (message?.text !== "/delete_data") return { kind: "unhandled" };
  const from = record(message.from);
  const chat = record(message.chat);
  const telegramUserId = identity(from?.id);
  if (
    !telegramUserId ||
    from?.is_bot !== false ||
    chat?.type !== "private" ||
    identity(chat.id) !== telegramUserId ||
    [
      "forward_origin",
      "forward_from",
      "forward_from_chat",
      "forward_sender_name",
      "forward_date",
      "is_automatic_forward",
      "sender_chat",
      "via_bot",
      "business_connection_id",
    ].some((key) => Object.hasOwn(message, key))
  )
    return { kind: "denied" };
  if (!capability) return { kind: "unavailable" };
  const updateId = record(raw)?.update_id;
  if (
    typeof updateId !== "number" ||
    !Number.isSafeInteger(updateId) ||
    updateId < 0
  )
    return { kind: "denied" };
  try {
    const result = await capability.request({
      telegramUserId,
      chatId: telegramUserId,
      updateId: String(updateId),
    });
    if (result.kind !== "accepted") return result;
    const stages = {
      awaiting_execution:
        "Запрос на удаление принят. Выполнение ещё ожидается.",
      deleting: "Удаление выполняется.",
      awaiting_backup:
        "Удаление у обработчиков завершено. Проверка резервных копий ещё ожидается.",
      needs_attention:
        "Запрос требует внимания оператора. Удаление не подтверждено.",
      completed: "Удаление выполнено и проверка резервных копий подтверждена.",
    } as const;
    const status = stages[result.request.stage];
    if (!status) return { kind: "unavailable" };
    const receipt = result.receiptToken
      ? ` Сохрани ключ статуса: ${result.receiptToken}. Он позволяет проверить удаление в разделе конфиденциальности сайта после закрытия входа. Не передавай его другим.`
      : " Для проверки после закрытия входа используй ранее сохранённый ключ статуса. Новый ключ не выдан.";
    return {
      kind: "reply",
      reply: {
        method: "sendMessage",
        chat_id: telegramUserId,
        text: `${status} Финансовые и обязательные учётные сведения сохраняются.${receipt}`,
      },
    };
  } catch {
    return { kind: "unavailable" };
  }
}
