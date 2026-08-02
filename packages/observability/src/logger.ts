import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino";

const REDACT_PATHS = [
  "authorization", "cookie", "cookies", "token", "secret", "rawBody", "body",
  "clientProfile", "profile", "contact", "contacts", "meetingUrl", "providerPayload",
  "url", "req.url", "err.request.url", "req.headers.authorization", "req.headers.cookie",
  "headers.authorization", "headers.cookie", "*.authorization", "*.token", "*.secret",
  "*.rawBody", "*.clientProfile", "*.meetingUrl", "*.providerPayload",
] as const;

const telegramBotUrl = /\/bot[^/\s]+\//gu;
const sensitiveKey = /(?:authorization|cookie|token|secret|rawbody|clientprofile|profile|contact|meetingurl|providerpayload|body|conversation|message|text|url)/iu;

export const redactProviderUrl = (value: unknown): unknown =>
  typeof value === "string" ? value.replace(telegramBotUrl, "/bot[REDACTED]/") : "[REDACTED]";

export function sanitizeTelemetry(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return value.replace(telegramBotUrl, "/bot[REDACTED]/");
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[REDACTED:CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeTelemetry(item, seen));
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (sensitiveKey.test(key)) {
      output[key] = key.toLowerCase().includes("providerurl") && typeof item === "string"
        ? redactProviderUrl(item) : "[REDACTED]";
    } else {
      output[key] = sanitizeTelemetry(item, seen);
    }
  }
  return output;
}

export function createLogger(destination?: NodeJS.WritableStream): Logger {
  const target: DestinationStream | undefined = destination === undefined ? undefined : {
    write(chunk: string) { queueMicrotask(() => destination.write(chunk)); },
  };
  const options: LoggerOptions = {
    level: "info",
    redact: { paths: [...REDACT_PATHS], censor: "[REDACTED]" },
    serializers: {
      providerUrl: redactProviderUrl,
      requestUrl: redactProviderUrl,
    },
    hooks: {
      logMethod(args, method) {
        const invoke = method as unknown as (...values: unknown[]) => void;
        invoke.apply(this, args.map((argument) => typeof argument === "object" && argument !== null ? sanitizeTelemetry(argument) : argument));
      },
    },
    base: null,
  };
  return target === undefined ? pino(options) : pino(options, target);
}

export type { Logger } from "pino";
