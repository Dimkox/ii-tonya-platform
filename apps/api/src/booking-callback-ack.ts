/** Best effort only. The callback service owns the deadline and abort signal. */
export function createBookingCallbackAck(
  token: string,
  fetcher: typeof fetch = fetch,
) {
  if (!/^[1-9][0-9]*:[A-Za-z0-9_-]+$/u.test(token)) {
    throw new Error("booking_callback_ack_configuration_invalid");
  }
  const endpoint = `https://api.telegram.org/bot${token}/answerCallbackQuery`;
  return async ({
    callbackQueryId,
    signal,
  }: {
    callbackQueryId: string;
    signal: AbortSignal;
  }): Promise<void> => {
    if (
      signal.aborted ||
      !/^[^\u0000-\u001f\u007f]{1,256}$/u.test(callbackQueryId)
    )
      return;
    try {
      const response = await fetcher(endpoint, {
        method: "POST",
        redirect: "error",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callback_query_id: callbackQueryId }),
      });
      // ACK status cannot change the committed booking. Never buffer a body or retry.
      void response.body?.cancel().catch(() => {});
    } catch {
      // Network errors can contain the bearer URL. Do not log or propagate them.
    }
  };
}
