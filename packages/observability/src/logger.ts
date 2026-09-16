import pino, {
  type DestinationStream,
  type Logger,
  type LoggerOptions,
} from "pino";

const REDACT_PATHS = [
  "authorization",
  "cookie",
  "cookies",
  "token",
  "secret",
  "rawBody",
  "body",
  "identityProof",
  "accessToken",
  "tokenHash",
  "tokenDigest",
  "replayDigest",
  "rawHeaders",
  "verifierInput",
  "verifierOutput",
  "cause",
  "choiceHandle",
  "bookingHandle",
  "choiceDigest",
  "catalogRequestId",
  "reservationId",
  "clientProfile",
  "profile",
  "contact",
  "contacts",
  "meetingUrl",
  "providerPayload",
  "url",
  "req.url",
  "err.request.url",
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "headers.cookie",
  "*.authorization",
  "*.token",
  "*.secret",
  "*.rawBody",
  "*.clientProfile",
  "*.meetingUrl",
  "*.providerPayload",
] as const;

const telegramBotUrl = /\/bot[^/\s]+\//gu;
const telegramBotToken = /\b\d{6,12}:[A-Za-z0-9_-]{25,}\b/gu;
const providerKeySecret = /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9_]{8,}\b/gu;
const sensitiveKey =
  /(?:authorization|cookie|token|secret|password|passwd|passphrase|credential|apikey|api[-_]?key|secret[-_]?key|access[-_]?key|signing[-_]?key|session[-_]?key|encryption[-_]?key|master[-_]?key|private[-_]?key|bot[-_]?key|hmac|rawbody|rawheaders|identityproof|proof|replay|digest|handle|catalogrequestid|reservationid|userid|expertid|slotid|cause|verifier|clientprofile|profile|contact|meetingurl|providerpayload|body|conversation|message|text|url)/iu;
const clientCredential =
  /(?:Bearer\s+)?cs1\.[A-Za-z0-9_-]{8,}|(?:ch1|bk1)\.[A-Za-z0-9_-]{8,}|(?:hmac-)?sha256:v?[^\s,;}\]]+|sha256:[0-9a-f]{16,}/giu;
const sensitiveIdentifier =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b|\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\b/giu;

const sanitizeString = (value: string): string =>
  value
    .replace(telegramBotUrl, "/bot[REDACTED]/")
    .replace(telegramBotToken, "[REDACTED]")
    .replace(providerKeySecret, "[REDACTED]")
    .replace(clientCredential, "[REDACTED]")
    .replace(sensitiveIdentifier, "[REDACTED]");

export const redactProviderUrl = (value: unknown): unknown =>
  typeof value === "string" ? sanitizeString(value) : "[REDACTED]";

export function sanitizeTelemetry(
  value: unknown,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === "string") return sanitizeString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[REDACTED:CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value))
    return value.map((item) => sanitizeTelemetry(item, seen));
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (sensitiveKey.test(key)) {
      output[key] =
        key.toLowerCase().includes("providerurl") && typeof item === "string"
          ? redactProviderUrl(item)
          : "[REDACTED]";
    } else {
      output[key] = sanitizeTelemetry(item, seen);
    }
  }
  return output;
}

export function createLogger(destination?: NodeJS.WritableStream): Logger {
  const target: DestinationStream | undefined =
    destination === undefined
      ? undefined
      : {
          write(chunk: string) {
            queueMicrotask(() => destination.write(chunk));
          },
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
        invoke.apply(
          this,
          args.map((argument) => sanitizeTelemetry(argument)),
        );
      },
    },
    base: null,
  };
  return target === undefined ? pino(options) : pino(options, target);
}

export type { Logger } from "pino";
