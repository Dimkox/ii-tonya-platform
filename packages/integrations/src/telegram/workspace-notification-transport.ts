/** Fixed Telegram origin, bounded response, one send; ambiguity belongs to durable work. */
export function createWorkspaceNotificationTransport(options: {
  token: string;
  botKey: string;
  workBotUsername: string;
  fetch?: typeof fetch;
}) {
  if (
    !/^[1-9][0-9]{0,15}:[A-Za-z0-9_-]{20,200}$/u.test(options.token) ||
    !/^[A-Za-z][A-Za-z0-9_]{4,31}$/u.test(options.workBotUsername)
  )
    throw new Error("workspace_transport_configuration_invalid");
  const botId = options.token.split(":")[0]!;
  const endpoint = `https://api.telegram.org/bot${options.token}/sendMessage`;
  return {
    async send(input: {
      botId: string;
      botKey: string;
      chatId: string;
      text: string;
      signal: AbortSignal;
    }) {
      const prefix = `Доступ открыт! Перейдите в рабочий кабинет: https://t.me/${options.workBotUsername}?start=card_`;
      if (
        input.botId !== botId ||
        input.botKey !== options.botKey ||
        !/^[1-9][0-9]{0,19}$/u.test(input.chatId) ||
        !input.text.startsWith(prefix) ||
        !/^[A-Za-z0-9_-]{43}$/u.test(input.text.slice(prefix.length)) ||
        input.signal.aborted
      )
        throw new Error("workspace_transport_request_invalid");
      const signal = AbortSignal.any([input.signal, AbortSignal.timeout(8000)]);
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const response = await (options.fetch ?? globalThis.fetch)(endpoint, {
          method: "POST",
          redirect: "error",
          signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: input.chatId,
            text: input.text,
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
        let size = 0;
        const chunks: Uint8Array[] = [];
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 16384) throw new Error();
          chunks.push(chunk.value);
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
        return {
          botId,
          chatId: input.chatId,
          messageId: String(data.result.message_id),
        };
      } catch {
        throw new Error("workspace_transport_delivery_uncertain");
      } finally {
        await reader?.cancel().catch(() => undefined);
        reader?.releaseLock();
      }
    },
  };
}
