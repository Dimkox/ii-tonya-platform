import { z } from "zod";

const button = z.strictObject({
  text: z
    .string()
    .min(1)
    .max(64)
    .refine((s) => s.isWellFormed()),
  callback_data: z.string().regex(/^ct2\.[A-Za-z0-9_-]{44}$/u),
});
const wire = z.strictObject({
  chatId: z
    .string()
    .regex(/^[1-9][0-9]{0,15}$/u)
    .refine((s) => Number.isSafeInteger(Number(s))),
  text: z
    .string()
    .min(1)
    .max(4096)
    .refine((s) => s.isWellFormed()),
  replyMarkup: z
    .strictObject({ inline_keyboard: z.tuple([z.tuple([button, button])]) })
    .nullish(),
});

/** Exact sendMessage bytes only. This does not authorize a recipient or callback. */
export function serializeBookingNotificationWire(input: unknown): string {
  const parsed = wire.safeParse(input);
  if (!parsed.success) throw new Error("booking_notification_wire_invalid");
  const value = parsed.data;
  return JSON.stringify({
    chat_id: value.chatId,
    text: value.text,
    ...(value.replyMarkup
      ? {
          reply_markup: {
            inline_keyboard: value.replyMarkup.inline_keyboard.map((row) =>
              row.map((b) => ({
                text: b.text,
                callback_data: b.callback_data,
              })),
            ),
          },
        }
      : {}),
  });
}
