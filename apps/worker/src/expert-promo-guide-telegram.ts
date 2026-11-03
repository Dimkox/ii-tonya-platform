/** WAIT-T03 transport: one sendDocument on the promo bot; never retries. */
export function createExpertPromoGuideTelegramTransport(options: {
  token: string;
  fetch?: typeof fetch;
}) {
  if (!/^[1-9][0-9]{0,15}:[A-Za-z0-9_-]{20,200}$/u.test(options.token))
    throw new Error("expert_promo_guide_configuration_invalid");
  return {
    async sendDocument(input: {
      chatId: string;
      document: string;
      caption: string;
    }): Promise<{ messageId: string }> {
      if (!/^[1-9][0-9]{0,19}$/u.test(input.chatId))
        throw new Error("expert_promo_guide_delivery_uncertain");
      const response = await (options.fetch ?? globalThis.fetch)(
        `https://api.telegram.org/bot${options.token}/sendDocument`,
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(8000),
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: input.chatId,
            document: input.document,
            caption: input.caption,
          }),
        },
      );
      const body = (await response.json().catch(() => null)) as {
        ok?: boolean;
        result?: { message_id?: number };
      } | null;
      const id = body?.result?.message_id;
      if (!response.ok || body?.ok !== true || !Number.isSafeInteger(id))
        throw new Error("expert_promo_guide_delivery_uncertain");
      return { messageId: String(id) };
    },
  };
}
