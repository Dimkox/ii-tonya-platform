import { expect, it } from "vitest";
import { serializeBookingNotificationWire } from "./booking-notification-wire.js";

it("serializes exact recipient and text with stable field ordering", () => {
  expect(
    serializeBookingNotificationWire({
      chatId: "201",
      text: "Запись\nподтверждена.",
    }),
  ).toBe('{"chat_id":"201","text":"Запись\\nподтверждена."}');
});
it("omits null markup exactly like absent markup", () => {
  expect(
    serializeBookingNotificationWire({
      chatId: "201",
      text: "text",
      replyMarkup: null,
    }),
  ).toBe(serializeBookingNotificationWire({ text: "text", chatId: "201" }));
});
it("canonicalizes nested button property order", () => {
  const confirm = "ct2." + "A".repeat(44);
  const cancel = "ct2." + "B".repeat(44);
  const result = serializeBookingNotificationWire({
    text: "request",
    chatId: "201",
    replyMarkup: {
      inline_keyboard: [
        [
          { callback_data: confirm, text: "Подтвердить" },
          { callback_data: cancel, text: "Отказать" },
        ],
      ],
    },
  });
  expect(result).toBe(
    JSON.stringify({
      chat_id: "201",
      text: "request",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Подтвердить", callback_data: confirm },
            { text: "Отказать", callback_data: cancel },
          ],
        ],
      },
    }),
  );
});
it.each([
  { chatId: "-201", text: "x" },
  { chatId: "9007199254740992", text: "x" },
  { chatId: "201", text: "" },
  { chatId: "201", text: "x".repeat(4097) },
  { chatId: "201", text: "\ud800" },
  { chatId: "201", text: "x", parse_mode: "HTML" },
  { chatId: "201", text: "x", replyMarkup: { inline_keyboard: [] } },
])(
  "rejects invalid or additional wire fields without echoing input",
  (input) => {
    expect(() => serializeBookingNotificationWire(input)).toThrow(
      "booking_notification_wire_invalid",
    );
  },
);
