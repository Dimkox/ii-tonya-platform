const TELEGRAM_ORIGIN = "https://api.telegram.org";

/** answerCallbackQuery for the promo bot. The token stays in the request URL only. */
export function createPromoCallbackAcknowledgement(input: {
  botToken: string;
  fetchImpl?: typeof fetch;
}): (args: { callbackQueryId: string }) => Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  return async ({ callbackQueryId }) => {
    if (!/^[\x21-\x7E]{1,128}$/u.test(callbackQueryId))
      throw new Error("promo_callback_ack_invalid");
    let url: URL;
    try {
      url = new URL(
        `/bot${input.botToken}/answerCallbackQuery`,
        TELEGRAM_ORIGIN,
      );
    } catch {
      throw new Error("promo_callback_ack_invalid");
    }
    if (url.origin !== TELEGRAM_ORIGIN)
      throw new Error("promo_callback_ack_invalid");
    const response = await fetchImpl(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(1000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId }),
    });
    if (!response.ok) throw new Error("promo_callback_ack_failed");
  };
}
