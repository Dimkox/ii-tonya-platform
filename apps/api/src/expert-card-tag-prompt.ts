export const EXPERT_CARD_TAG_PROMPT_TEXT =
  "Напишите один свой тег в ответ на это сообщение.";

/** One attempt only: an uncertain delivery must never be retried automatically. */
export function createExpertCardTagPrompt(
  token: string,
  botId: string,
  fetcher: typeof fetch = fetch,
) {
  if (!new RegExp(`^${botId}:[A-Za-z0-9_-]+$`, "u").test(token))
    throw new Error("card_tag_prompt_configuration_invalid");
  return async (input: {
    chatId: string;
    signal: AbortSignal;
  }): Promise<string | null> => {
    if (!/^[1-9][0-9]{0,19}$/u.test(input.chatId) || input.signal.aborted)
      return null;
    const abort = new AbortController();
    const signal = AbortSignal.any([input.signal, abort.signal]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = async () => {
      try {
        const response = await fetcher(
          `https://api.telegram.org/bot${token}/sendMessage`,
          {
            method: "POST",
            redirect: "error",
            signal,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              chat_id: input.chatId,
              text: EXPERT_CARD_TAG_PROMPT_TEXT,
              protect_content: true,
              reply_markup: {
                force_reply: true,
                selective: true,
                input_field_placeholder: "Ваш тег",
              },
            }),
          },
        );
        if (!response.ok || !response.body) {
          void response.body?.cancel().catch(() => {});
          return null;
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.byteLength;
            if (bytes > 16384) {
              void reader.cancel().catch(() => {});
              return null;
            }
            chunks.push(part.value);
          }
        } finally {
          reader.releaseLock();
        }
        if (signal.aborted) return null;
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const message = body?.result;
        if (
          body?.ok !== true ||
          !Number.isSafeInteger(message?.message_id) ||
          message.message_id <= 0 ||
          String(message?.from?.id) !== botId ||
          message.from.is_bot !== true ||
          String(message?.chat?.id) !== input.chatId ||
          message.chat.type !== "private"
        )
          return null;
        return String(message.message_id);
      } catch {
        return null; /* Transport errors may contain the bearer URL. */
      }
    };
    try {
      return await Promise.race([
        attempt(),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => {
            abort.abort();
            resolve(null);
          }, 2000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
