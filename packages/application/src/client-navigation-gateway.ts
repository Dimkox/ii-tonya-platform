export type ClientIngressEvent = {
  readonly botId: string;
  readonly updateId: number;
};
export interface ClientIngressReplayRead {
  hasReceipt(event: ClientIngressEvent): Promise<boolean>;
}
export interface ClientIngressReplay extends ClientIngressReplayRead {
  record(event: ClientIngressEvent): Promise<"recorded" | "duplicate">;
}
export type ClientNavigationReply = {
  readonly method: "sendMessage";
  readonly chat_id: number;
  readonly text: string;
  readonly reply_markup: {
    readonly inline_keyboard: readonly (readonly (
      | { readonly text: string; readonly url: string }
      | { readonly text: string; readonly web_app: { readonly url: string } }
    )[])[];
  };
};
export type ClientNavigationResult =
  | { readonly status: "reply"; readonly reply: ClientNavigationReply }
  | { readonly status: "duplicate" | "ignored" | "invalid" | "unavailable" };
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
export const clientIngressUpdateId = (raw: unknown): number | undefined => {
  const id = object(raw)?.update_id;
  return typeof id === "number" && Number.isSafeInteger(id) && id >= 0
    ? id
    : undefined;
};
const commands = new Set([
  "/start",
  "/help",
  "/catalog",
  "/privacy",
  "/account",
]);
const refusal =
  "Персональный диалог здесь пока недоступен. Не присылай личную историю, сведения о здоровье, документы или данные других людей. Каталог и личный кабинет доступны по ссылкам ниже.";
export class ClientNavigationGateway {
  constructor(
    private readonly deps: {
      botId: string;
      origin: string;
      replay: ClientIngressReplay;
    },
  ) {
    let validOrigin = false;
    try {
      const url = new URL(deps.origin);
      validOrigin = url.protocol === "https:" && url.origin === deps.origin;
    } catch {
      /* fixed error below */
    }
    if (
      !validOrigin ||
      !/^[1-9]\d{0,15}$/u.test(deps.botId) ||
      !Number.isSafeInteger(Number(deps.botId))
    )
      throw new Error("client_navigation_configuration_incomplete");
  }
  async handle(raw: unknown): Promise<ClientNavigationResult> {
    const updateId = clientIngressUpdateId(raw);
    if (updateId === undefined) return { status: "invalid" };
    try {
      // Receipt precedes even reading message: no content-derived idempotency.
      const receipt = await this.deps.replay.record({
        botId: this.deps.botId,
        updateId,
      });
      if (receipt === "duplicate") return { status: "duplicate" };
      if (receipt !== "recorded") return { status: "unavailable" };
      const root = object(raw)!;
      if (
        Object.keys(root).some(
          (key) => key !== "update_id" && key !== "message",
        )
      )
        return { status: "ignored" };
      const message = object(root.message);
      if (!message) return { status: "ignored" };
      const chat = object(message.chat);
      const from = object(message.from);
      if (
        !chat ||
        !from ||
        chat.type !== "private" ||
        from.is_bot !== false ||
        typeof chat.id !== "number" ||
        !Number.isSafeInteger(chat.id) ||
        chat.id <= 0 ||
        typeof from.id !== "number" ||
        !Number.isSafeInteger(from.id) ||
        from.id <= 0 ||
        chat.id !== from.id ||
        Object.keys(message).some(
          (key) =>
            key.startsWith("forward_") ||
            [
              "sender_chat",
              "via_bot",
              "edit_date",
              "is_automatic_forward",
              "business_connection_id",
              "guest_query_id",
            ].includes(key),
        )
      )
        return { status: "ignored" };
      const supported =
        typeof message.text === "string" && commands.has(message.text);
      return {
        status: "reply",
        reply: {
          method: "sendMessage",
          chat_id: chat.id,
          text: supported
            ? "Каталог, личный кабинет и политика конфиденциальности доступны по ссылкам ниже. Персональный диалог здесь пока недоступен. Не присылай личную историю, сведения о здоровье, документы или данные других людей."
            : refusal,
          reply_markup: {
            inline_keyboard: [
              [{ text: "Каталог", url: `${this.deps.origin}/catalog` }],
              [
                {
                  text: "Личный кабинет",
                  web_app: { url: `${this.deps.origin}/account` },
                },
              ],
              [
                {
                  text: "Политика конфиденциальности",
                  url: `${this.deps.origin}/privacy`,
                },
              ],
            ],
          },
        },
      };
    } catch {
      return { status: "unavailable" };
    }
  }
}
