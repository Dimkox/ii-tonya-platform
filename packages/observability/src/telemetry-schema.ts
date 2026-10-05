import { types } from "node:util";

/** Only own data, never accessors, coercion hooks or Proxy traps. */
export function ownData(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object" || types.isProxy(value))
    return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

export function classifyFailure(error: unknown): string {
  switch (ownData(error, "code")) {
    case "ECONNREFUSED":
      return "connection_refused";
    case "EADDRINUSE":
      return "address_in_use";
    case "ETIMEDOUT":
    case "UND_ERR_CONNECT_TIMEOUT":
      return "timeout";
    case "ECONNRESET":
      return "connection_reset";
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "dns_failure";
    case "FST_ERR_CTP_BODY_TOO_LARGE":
      return "body_too_large";
    case "FST_ERR_CTP_INVALID_JSON_BODY":
    case "FST_ERR_CTP_EMPTY_JSON_BODY":
      return "invalid_json";
    case "FST_ERR_VALIDATION":
      return "invalid_request";
    default:
      return "internal_error";
  }
}

export function httpErrorStatus(
  error: unknown,
  replyStatus = 200,
  replyHasStatusCode = false,
): number {
  const status = ownData(error, "status");
  const statusCode = ownData(error, "statusCode");
  // Fastify setErrorHeaders prefers status; setErrorStatusCode then prefers
  // statusCode ONLY if no status was explicitly set (even explicit 200 counts).
  // Keep that precedence over validated own numeric data, never coercion.
  const candidates = replyHasStatusCode
    ? [status, statusCode, replyStatus]
    : [statusCode, status];
  for (const status of candidates) {
    if (
      typeof status === "number" &&
      Number.isInteger(status) &&
      status >= 400 &&
      status <= 599
    )
      return status;
  }
  return 500;
}

/** Only delta-seconds, capped at one day; no dates, URLs or other error headers. */
export function httpRetryAfter(error: unknown): string | undefined {
  const value = ownData(ownData(error, "headers"), "retry-after");
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 86_400
  )
    return String(value);
  if (
    typeof value === "string" &&
    /^(0|[1-9][0-9]{0,4})$/u.test(value) &&
    Number(value) <= 86_400
  )
    return value;
  return undefined;
}

type Schema = Readonly<
  Record<string, readonly string[] | "status" | "duration" | "count">
>;
const modules = ["api", "worker", "integrations"];
const failureClasses = [
  "connection_refused",
  "address_in_use",
  "timeout",
  "connection_reset",
  "dns_failure",
  "body_too_large",
  "invalid_json",
  "invalid_request",
  "internal_error",
];
const http = {
  method: [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "HEAD",
    "OPTIONS",
    "CONNECT",
    "TRACE",
    "OTHER",
  ],
  statusCode: "status",
  durationMs: "duration",
} as const;
const schemas: Readonly<Record<string, Schema>> = {
  telemetry_unclassified: {},
  public_catalog_failure: {
    reason: [
      "rate_limited",
      "busy",
      "missing_repository",
      "deadline",
      "repository_failure",
      "invalid_output",
    ],
  },
  http_request_completed: http,
  http_request_failed: { ...http, failureClass: failureClasses },
  http_not_found: http,
  process_fatal: {
    module: modules,
    fatal: ["uncaughtException", "unhandledRejection"],
    failureClass: failureClasses,
  },
  startup_failure: { module: modules, failureClass: failureClasses },
  selarti_inbound: {
    module: ["api"],
    operation: ["selarti.inbound"],
    outcome: ["accepted"],
    count: "count",
  },
  transport_failure: {
    provider: ["telegram"],
    operation: ["sendMessage", "answerCallbackQuery"],
    outcome: ["before_write", "after_write", "unknown", "rate_limit"],
  },
};

function project(
  value: unknown,
  schema: Schema,
): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  for (const [key, rule] of Object.entries(schema)) {
    const item = ownData(value, key);
    if (typeof rule !== "string") {
      if (typeof item === "string" && rule.includes(item)) result[key] = item;
    } else if (typeof item === "number" && Number.isFinite(item)) {
      if (
        rule === "status" &&
        Number.isInteger(item) &&
        item >= 100 &&
        item <= 599
      )
        result[key] = item;
      if (rule === "duration" && item >= 0 && item <= 86_400_000)
        result[key] = item;
      if (
        rule === "count" &&
        Number.isSafeInteger(item) &&
        item >= 0 &&
        item <= 1_000_000
      )
        result[key] = item;
    }
  }
  return result;
}

export function projectLog(
  value: unknown,
  message?: unknown,
): Record<string, string | number> {
  // One legacy fixed message is used by the public catalog plugin.
  const candidate =
    message === "public_catalog_failure" ? message : ownData(value, "event");
  const event =
    typeof candidate === "string" && Object.hasOwn(schemas, candidate)
      ? candidate
      : "telemetry_unclassified";
  return { event, ...project(value, schemas[event]!) };
}

export function projectBindings(
  value: unknown,
): Record<string, string | number> {
  return project(value, {
    module: modules,
    operation: ["selarti.inbound", "sendMessage", "answerCallbackQuery"],
    provider: ["telegram", "selarti"],
  });
}
