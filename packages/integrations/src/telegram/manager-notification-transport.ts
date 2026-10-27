/** Fixed-origin, single-attempt staff queue delivery. Ambiguous outcomes must not be retried. */
export function createManagerNotificationTransport(options: {
  enabled: boolean;
  token: string;
  fetch?: typeof globalThis.fetch;
}) {
  if (
    options.enabled &&
    !/^[1-9]\d{0,15}:[A-Za-z0-9_-]{20,200}$/u.test(options.token)
  )
    throw new Error("manager_transport_configuration_invalid");
  const botId = options.token.split(":")[0];
  const endpoint = `https://api.telegram.org/bot${options.token}/sendMessage`;
  const request = options.fetch ?? globalThis.fetch;
  return {
    async sendMessage(input: {
      chatId: string;
      text: string;
      replyMarkup: {
        inline_keyboard: readonly (readonly {
          text: string;
          callback_data: string;
        }[])[];
      };
      protectContent: true;
    }) {
      if (!options.enabled) throw new Error("manager_transport_disabled");
      if (
        !/^[1-9]\d{0,15}$/u.test(input.chatId) ||
        !input.text.startsWith("Новая заявка на проверку") ||
        input.text.length > 1000 ||
        /[\u0000-\u0008\u000b-\u001f]/u.test(input.text) ||
        input.protectContent !== true ||
        input.replyMarkup.inline_keyboard.length !== 1 ||
        input.replyMarkup.inline_keyboard[0]?.length !== 2 ||
        input.replyMarkup.inline_keyboard[0].some(
          (b) =>
            !["Одобрить", "Отклонить"].includes(b.text) ||
            !/^mt1\.[A-Za-z0-9_-]{59}$/u.test(b.callback_data),
        )
      )
        throw new Error("manager_transport_request_invalid");
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const response = await request(endpoint, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
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
        let text = "",
          size = 0;
        const decoder = new TextDecoder("utf-8", { fatal: true });
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 16384) throw new Error();
          text += decoder.decode(part.value, { stream: true });
        }
        text += decoder.decode();
        const data = JSON.parse(text);
        if (
          data?.ok !== true ||
          !Number.isSafeInteger(data.result?.message_id) ||
          data.result.message_id <= 0 ||
          String(data.result?.from?.id) !== botId ||
          data.result?.from?.is_bot !== true ||
          String(data.result?.chat?.id) !== input.chatId ||
          data.result?.chat?.type !== "private"
        )
          throw new Error();
        return { messageId: String(data.result.message_id) };
      } catch {
        throw new Error("manager_transport_delivery_uncertain");
      } finally {
        await reader?.cancel().catch(() => undefined);
        reader?.releaseLock();
      }
    },
  };
}
