import type { FinalCallTelegram } from "./early-bird-deferred-final-call.js";

/** Fixed Telegram origin, bounded time/body, one send, no automatic retry. */
export function createFinalCallTelegramTransport(options: {
  token: string;
  fetch?: typeof fetch;
}): FinalCallTelegram {
  if (!/^[1-9][0-9]{0,15}:[A-Za-z0-9_-]{20,200}$/u.test(options.token))
    throw new Error("early_bird_final_call_transport_configuration_invalid");
  const botId = options.token.split(":")[0]!;
  const endpoint = `https://api.telegram.org/bot${options.token}/sendMessage`;
  return {
    async send(input) {
      const buttons = input.replyMarkup.inline_keyboard;
      if (
        !/^[1-9][0-9]{0,19}$/u.test(input.chatId) ||
        !input.text.trim() ||
        input.text.length > 4096 ||
        Buffer.byteLength(input.text) > 12000 ||
        /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.test(input.text) ||
        input.signal.aborted ||
        buttons.length !== 1 ||
        buttons[0]?.length !== 1 ||
        buttons[0][0]?.text !== "Оплатить тариф" ||
        !/^eb:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(?:0|[1-9]\d{0,5}):subscription$/u.test(
          buttons[0][0].callback_data,
        ) ||
        Buffer.byteLength(buttons[0][0].callback_data) > 64
      )
        throw new Error("early_bird_final_call_transport_request_invalid");
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const response = await (options.fetch ?? globalThis.fetch)(endpoint, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.any([input.signal, AbortSignal.timeout(8000)]),
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: input.chatId,
            text: input.text,
            reply_markup: input.replyMarkup,
            protect_content: true,
          }),
        });
        if (
          !response.ok ||
          response.redirected ||
          (response.url !== "" && response.url !== endpoint) ||
          !response.body
        )
          throw new Error();
        reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 16384) throw new Error();
          chunks.push(part.value);
        }
        const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (
          data?.ok !== true ||
          !Number.isSafeInteger(data.result?.message_id) ||
          data.result.message_id < 1 ||
          String(data.result?.from?.id) !== botId ||
          data.result?.from?.is_bot !== true ||
          String(data.result?.chat?.id) !== input.chatId ||
          data.result?.chat?.type !== "private"
        )
          throw new Error();
        return { messageId: String(data.result.message_id) };
      } catch {
        throw new Error("early_bird_final_call_transport_delivery_uncertain");
      } finally {
        await reader?.cancel().catch(() => undefined);
        reader?.releaseLock();
      }
    },
  };
}
