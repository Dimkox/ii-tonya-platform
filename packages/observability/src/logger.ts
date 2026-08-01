import pino, { type DestinationStream, type Logger } from "pino";

const REDACT_PATHS = [
  "authorization", "cookie", "cookies", "token", "secret", "rawBody", "body",
  "clientProfile", "profile", "contact", "contacts", "meetingUrl", "providerPayload",
  "url", "req.url", "err.request.url", "req.headers.authorization", "req.headers.cookie",
  "headers.authorization", "headers.cookie", "*.authorization", "*.token", "*.secret",
  "*.rawBody", "*.clientProfile", "*.meetingUrl", "*.providerPayload",
] as const;

const telegramBotUrl = /\/bot[^/\s]+\//gu;

export const redactProviderUrl = (value: unknown): unknown =>
  typeof value === "string" ? value.replace(telegramBotUrl, "/bot[REDACTED]/") : "[REDACTED]";

export function createLogger(destination?: NodeJS.WritableStream): Logger {
  const target: DestinationStream | undefined = destination === undefined ? undefined : {
    write(chunk: string) { queueMicrotask(() => destination.write(chunk)); },
  };
  const options = {
    level: "info",
    redact: { paths: [...REDACT_PATHS], censor: "[REDACTED]" },
    serializers: {
      providerUrl: redactProviderUrl,
      requestUrl: redactProviderUrl,
    },
    base: null,
  };
  return target === undefined ? pino(options) : pino(options, target);
}

export type { Logger } from "pino";
