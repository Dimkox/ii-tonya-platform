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
// Секрет в сегменте пути (/v1/webhooks/telegram/client/<botKey>) не похож ни на один формат
// выше: он попадает в msg вместе с текстом 404 от Fastify ("Route GET:/... not found") и с
// текстом 5xx-исключения. Правило намеренно узкое - только этот маршрут, чтобы не сносить
// диагностику с других путей.
const webhookPathSecret = /\/v1\/webhooks\/telegram\/client\/[^/\s"?]+/giu;

const clientCredential =
  /(?:Bearer\s+)?cs1\.[A-Za-z0-9_-]{8,}|(?:ch1|bk1)\.[A-Za-z0-9_-]{8,}|(?:hmac-)?sha256:v?[^\s,;}\]]+|sha256:[0-9a-f]{16,}/giu;
const sensitiveIdentifier =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b|\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\b/giu;

// Value-shape secrets that can appear inside free-text msg / stack / serialized JSON — not only
// under sensitive field names. Purely tightening (redacts more, never exposes); patterns kept
// narrow so benign operational text (id=…, count=5, correlationId, "token limit reached") survives.
const dsnUserinfo = /(:\/\/[^/\s:@]+):([^\s@/]+)(?=@)/gu;
const jwtToken = /\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{4,}){1,2}\b/gu;
const awsAccessKey = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu;
const bearerToken = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/giu;
// Explicit-secret assignment (key=value | key:value | "key": "value"); longest words first; a bare
// "key="/"id="/"count=" is intentionally NOT matched.
const secretAssignment =
  /\b(access[_-]?key|api[_-]?key|client[_-]?secret|secret[_-]?key|refresh[_-]?token|auth[_-]?token|authorization|password|passwd|secret|token)(["']?\s*[:=]\s*["']?)([^\s"',}]+)/giu;

const sanitizeString = (value: string): string =>
  value
    .replace(telegramBotUrl, "/bot[REDACTED]/")
    .replace(telegramBotToken, "[REDACTED]")
    .replace(webhookPathSecret, "/v1/webhooks/telegram/client/[REDACTED]")
    .replace(providerKeySecret, "[REDACTED]")
    .replace(dsnUserinfo, "$1:[REDACTED]")
    .replace(jwtToken, "[REDACTED]")
    .replace(awsAccessKey, "[REDACTED]")
    .replace(bearerToken, "$1[REDACTED]")
    .replace(secretAssignment, "$1$2[REDACTED]")
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
  // Errors serialize to {} under Object.entries (message/stack are non-enumerable), which
  // silently destroys the boot-failure reason. Rebuild them explicitly, scrubbing each string.
  if (value instanceof Error) {
    const message =
      typeof value.message === "string"
        ? value.message
        : String(value.message ?? "");
    return {
      type: value.constructor?.name ?? "Error",
      message: sanitizeString(message),
      ...(typeof value.stack === "string"
        ? { stack: value.stack.split("\n").map(sanitizeString).join("\n") }
        : {}),
    };
  }
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
