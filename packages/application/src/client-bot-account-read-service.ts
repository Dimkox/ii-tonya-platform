import type {
  ClientBotAccountReadRepository,
  ClientBotAccountQuery,
} from "@ii-tonya/contracts";
export type ClientBotAccountReply =
  | {
      status: "reply";
      reply: {
        method: "sendMessage";
        chat_id: number;
        text: string;
        protect_content: true;
      };
    }
  | { status: "unhandled" | "invalid" | "duplicate" | "unavailable" };
const obj = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
const money = (v: string) => {
  if (!/^(0|[1-9]\d*)$/.test(v)) throw Error("invalid_projection");
  return `${BigInt(v) / 100n},${(BigInt(v) % 100n).toString().padStart(2, "0")} ₽`;
};
const time = (v: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(v)) + " МСК";
const bookingState = (state: string, until: string | null) => {
  switch (state) {
    case "calendar_pending":
      return "Эксперт согласовал встречу. Ожидаем подтверждения календаря.";
    case "confirmation_unverified":
      return "Подтверждение этой записи в календаре ещё не проверено. Требуется проверка поддержки.";
    case "cancellation_pending":
      return "Запись отменена у нас. Проверяем отмену в календаре.";
    case "reserved":
      return `Резерв до ${time(until!)}. Встреча ещё не подтверждена.`;
    case "booked":
      return "Встреча подтверждена. Статус оплаты здесь не определяется.";
    default:
      throw Error("invalid_booking_projection");
  }
};
export const isClientBotAccountCommand = (raw: unknown): boolean => {
  const text = obj(obj(raw)?.message)?.text;
  return (
    typeof text === "string" &&
    /^\/(coupons_balance|orders|reservations)(?:[@\s]|$)/u.test(text)
  );
};

export function createClientBotAccountReadService(deps: {
  botId: string;
  botKey: string;
  repository: ClientBotAccountReadRepository;
}) {
  deps = Object.freeze({ ...deps });
  return {
    async handle(raw: unknown): Promise<ClientBotAccountReply> {
      const root = obj(raw),
        m = obj(root?.message),
        text = m?.text;
      if (
        typeof text !== "string" ||
        !/^\/(coupons_balance|orders|reservations)(?:[@\s]|$)/u.test(text)
      )
        return { status: "unhandled" };
      const chat = obj(m?.chat),
        from = obj(m?.from);
      if (
        !root ||
        !m ||
        !chat ||
        !from ||
        chat.type !== "private" ||
        from.is_bot !== false ||
        typeof from.id !== "number" ||
        !Number.isSafeInteger(from.id) ||
        from.id <= 0 ||
        chat.id !== from.id ||
        typeof root.update_id !== "number" ||
        !Number.isSafeInteger(root.update_id) ||
        root.update_id < 0 ||
        Object.keys(root).some((k) => !["update_id", "message"].includes(k)) ||
        Object.keys(m).some(
          (k) =>
            k.startsWith("forward_") ||
            [
              "sender_chat",
              "via_bot",
              "edit_date",
              "is_automatic_forward",
              "business_connection_id",
              "guest_query_id",
            ].includes(k),
        )
      )
        return { status: "invalid" };
      let query: ClientBotAccountQuery;
      const parts = text.split(" ");
      if (text === "/coupons_balance") query = { kind: "coupons" };
      else if (
        parts[0] === "/orders" &&
        parts.length <= 2 &&
        (!parts[1] || /^co1\.[A-Za-z0-9_-]{43}$/.test(parts[1]))
      )
        query = { kind: "orders", ...(parts[1] ? { after: parts[1] } : {}) };
      else if (
        parts[0] === "/reservations" &&
        parts.length <= 2 &&
        (!parts[1] || /^bk1\.[A-Za-z0-9_-]{43}$/.test(parts[1]))
      )
        query = {
          kind: "reservations",
          ...(parts[1] ? { after: parts[1] } : {}),
        };
      else return { status: "invalid" };
      try {
        const p = await deps.repository.read({
          botId: deps.botId,
          botKey: deps.botKey,
          telegramUserId: String(from.id),
          chatId: String(chat.id),
          updateId: root.update_id,
          query,
        });
        if (p.kind === "duplicate") return { status: "duplicate" };
        let out =
          "Данные недоступны. Нужны действующая привязка аккаунта и согласие на сообщения.";
        if (p.kind === "coupons")
          out =
            `Действующие купоны: ${money(p.coupons_balance)}.\n` +
            p.details
              .map((d) => `${money(d.amountMinor)} до ${time(d.expiresAt)}`)
              .join("\n") +
            (p.hasMore ? "\nПоказана часть купонов; итог включает все." : "");
        if (p.kind === "orders")
          out =
            p.orders
              .map(
                (o) =>
                  `${o.handle}: ${o.packageCode}, ${money(o.priceMinor)}, ${o.state === "paid" ? "оплачен" : "оплата не подтверждена"}, ${time(o.createdAt)}`,
              )
              .join("\n") || "Заказов нет.";
        if (p.kind === "reservations")
          out =
            p.bookings
              .map(
                (b) =>
                  `${b.bookingHandle}: ${time(b.startsAt)}. ${bookingState(b.state, b.reservedUntil)}`,
              )
              .join("\n") || "Активных записей нет.";
        if ((p.kind === "orders" || p.kind === "reservations") && p.nextCursor)
          out += `\nДалее: /${p.kind === "orders" ? "orders" : "reservations"} ${p.nextCursor}`;
        if (out.length > 3900) throw Error("projection_too_large");
        return {
          status: "reply",
          reply: {
            method: "sendMessage",
            chat_id: from.id,
            text: out,
            protect_content: true,
          },
        };
      } catch {
        return { status: "unavailable" };
      }
    },
  };
}
