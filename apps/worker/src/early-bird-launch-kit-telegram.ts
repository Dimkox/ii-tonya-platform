import { createHash } from "node:crypto";
import {
  LAUNCH_KIT_BANNER,
  LAUNCH_KIT_DIGEST,
  LAUNCH_KIT_VERSION,
  launchKitMessage,
} from "./early-bird-launch-kit-content.js";
export function assertLaunchKitContent() {
  const digest = `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        version: LAUNCH_KIT_VERSION,
        text: launchKitMessage(),
        bannerSvg: LAUNCH_KIT_BANNER,
      }),
    )
    .digest("hex")}`;
  if (
    digest !== LAUNCH_KIT_DIGEST ||
    Buffer.byteLength(LAUNCH_KIT_BANNER) > 16384 ||
    /<\s*script\b|<\s*foreignObject\b|href\s*=|\son[a-z]+\s*=|url\(/iu.test(
      LAUNCH_KIT_BANNER,
    )
  )
    throw new Error("early_bird_launch_kit_content_invalid");
}
/** One fixed-origin package: forwardable text plus original SVG document. The
 * durable job owns ambiguity; this transport never retries either request. */
export function createLaunchKitTelegramTransport(options: {
  token: string;
  fetch?: typeof fetch;
}) {
  if (!/^[1-9][0-9]{0,15}:[A-Za-z0-9_-]{20,200}$/u.test(options.token))
    throw new Error("early_bird_launch_kit_configuration_invalid");
  assertLaunchKitContent();
  const botId = options.token.split(":")[0]!;
  return {
    async send(input: {
      chatId: string;
      signal: AbortSignal;
    }): Promise<{ messageIds: string[] }> {
      if (!/^[1-9][0-9]{0,19}$/u.test(input.chatId) || input.signal.aborted)
        throw new Error("early_bird_launch_kit_delivery_uncertain");
      const controller = new AbortController();
      const signal = AbortSignal.any([input.signal, controller.signal]);
      const deadline = performance.now() + 8000;
      const timer = setTimeout(() => controller.abort(), 8000);
      const expired = () => signal.aborted || performance.now() >= deadline;
      const perform = async (
        method: "sendMessage" | "sendDocument",
        body: BodyInit,
        headers?: Record<string, string>,
      ) => {
        if (expired()) throw new Error();
        const endpoint = `https://api.telegram.org/bot${options.token}/${method}`;
        const response = await (options.fetch ?? globalThis.fetch)(endpoint, {
          method: "POST",
          redirect: "error",
          signal,
          ...(headers ? { headers } : {}),
          body,
        });
        if (
          expired() ||
          !response.ok ||
          response.redirected ||
          (response.url !== "" && response.url !== endpoint) ||
          !response.body
        )
          throw new Error();
        const reader = response.body.getReader();
        let size = 0;
        const chunks: Uint8Array[] = [];
        try {
          for (;;) {
            if (expired()) throw new Error();
            const value = await reader.read();
            if (expired()) throw new Error();
            if (value.done) break;
            size += value.value.byteLength;
            if (size > 16384) throw new Error();
            chunks.push(value.value);
          }
        } finally {
          void reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
        const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (
          expired() ||
          data?.ok !== true ||
          !Number.isSafeInteger(data.result?.message_id) ||
          data.result.message_id < 1 ||
          String(data.result?.from?.id) !== botId ||
          data.result?.from?.is_bot !== true ||
          String(data.result?.chat?.id) !== input.chatId ||
          data.result?.chat?.type !== "private"
        )
          throw new Error();
        return String(data.result.message_id);
      };
      try {
        const text = await perform(
          "sendMessage",
          JSON.stringify({
            chat_id: input.chatId,
            text: launchKitMessage(),
            protect_content: false,
          }),
          { "content-type": "application/json" },
        );
        if (expired()) throw new Error();
        const form = new FormData();
        form.set("chat_id", input.chatId);
        form.set("protect_content", "false");
        form.set(
          "document",
          new Blob([LAUNCH_KIT_BANNER], { type: "image/svg+xml" }),
          "ii-tonya-launch-2027-01-11.svg",
        );
        const banner = await perform("sendDocument", form);
        if (text === banner) throw new Error();
        return { messageIds: [text, banner] };
      } catch {
        controller.abort();
        throw new Error("early_bird_launch_kit_delivery_uncertain");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
