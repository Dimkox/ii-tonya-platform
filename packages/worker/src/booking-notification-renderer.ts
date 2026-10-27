import {
  bookingNotificationViewSchema,
  type BookingCalendarCancellation,
  type BookingNotificationRenderResult,
} from "@ii-tonya/contracts";

function calendarText(calendar: BookingCalendarCancellation): string {
  switch (calendar) {
    case "native_cancelled":
      return "Запись отменена.";
    case "not_created":
      return "Запись в календаре не создавалась.";
    case "cancelled":
      return "Отмена в календаре подтверждена.";
    case "cancellation_pending":
    case "unknown":
      return "Отмена в календаре ещё не подтверждена.";
  }
}

/** Pure presentation only; no DB, clock, callback issuance or send authority.
 * The later resolver/admission must validate current facts under authority locks.
 * Do not log validation errors: rejected input could contain private data.
 */
export function renderBookingNotification(
  input: unknown,
): BookingNotificationRenderResult {
  const parsed = bookingNotificationViewSchema.safeParse(input);
  if (!parsed.success) return { kind: "suppressed", reason: "invalid_view" };
  const view = parsed.data;
  if (view.kind === "suppressed")
    return { kind: "suppressed", reason: view.reason };
  const time = `${view.startsAt.slice(0, 10)} ${view.startsAt.slice(11, 16)} UTC`;
  const result = (
    recipient: "client" | "expert",
    text: string,
  ): BookingNotificationRenderResult => ({
    kind: "rendered",
    topic: view.topic,
    recipient,
    text,
    replyMarkup: null,
  });
  switch (view.topic) {
    case "telegram.reservation_request":
      return {
        kind: "rendered",
        topic: view.topic,
        recipient: "expert",
        text: `Новая заявка на ${time}. Клиент.`,
        replyMarkup: {
          inline_keyboard: [
            [
              { text: "Подтвердить", callback_data: view.callbacks.confirm },
              { text: "Отказать", callback_data: view.callbacks.cancel },
            ],
          ],
        },
      };
    case "client.booking_confirmed":
      return result("client", `Запись подтверждена на ${time}.`);
    case "telegram.booking_cancelled":
      return result(
        "expert",
        view.calendar === "native_cancelled"
          ? `Запись отменена клиентом. Время: ${time}.`
          : `Локальная запись отменена клиентом. ${calendarText(view.calendar)} Время: ${time}.`,
      );
    case "client.booking_cancelled":
      return result(
        "client",
        view.calendar === "native_cancelled"
          ? `Запись отменена экспертом. Время: ${time}.`
          : `Локальная запись отменена экспертом. ${calendarText(view.calendar)} Время: ${time}.`,
      );
    case "client.reservation_expired":
      return result(
        "client",
        view.calendar === "native_cancelled"
          ? `Срок заявки истёк. Время: ${time}.`
          : `Срок локальной заявки истёк. ${calendarText(view.calendar)} Время: ${time}.`,
      );
    case "expert.reservation_expired":
      return result(
        "expert",
        view.calendar === "native_cancelled"
          ? `Срок заявки истёк. Прежние кнопки недоступны. Время: ${time}.`
          : `Срок локальной заявки истёк. Прежние кнопки недоступны. ${calendarText(view.calendar)} Время: ${time}.`,
      );
    case "client.booking_completed":
      return result(
        "client",
        `Встреча отмечена как завершённая. Время: ${time}.`,
      );
    case "client.booking_no_show":
      return result(
        "client",
        `Встреча отмечена как несостоявшаяся. Время: ${time}.`,
      );
  }
}
