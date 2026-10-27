import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  createLogger,
  sanitizeTelemetry,
  redactProviderUrl,
  classifyFailure,
} from "./logger.js";
import { httpErrorStatus, httpRetryAfter } from "./telemetry-schema.js";

const canary = "ordinary personal prose about my appointment";
async function capture(
  write: (logger: ReturnType<typeof createLogger>) => void,
) {
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (chunk: Buffer) => chunks.push(chunk));
  write(createLogger(output));
  await new Promise<void>((resolve) => setImmediate(resolve));
  return Buffer.concat(chunks).toString("utf8");
}
const records = (text: string): Record<string, unknown>[] =>
  text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);

describe("content-free logger boundary", () => {
  it("reads HTTP protocol metadata without getters, inherited fields or coercion", () => {
    const invoked = vi.fn(() => {
      throw new Error(canary);
    });
    const hostile = {
      get status() {
        return invoked();
      },
      get statusCode() {
        return invoked();
      },
      get headers() {
        return invoked();
      },
      toString: invoked,
    };
    const proxy = new Proxy(
      {},
      { get: invoked, getOwnPropertyDescriptor: invoked },
    );
    for (const error of [
      hostile,
      proxy,
      { status: "422", statusCode: NaN },
      { status: 600, statusCode: 499.5 },
      Object.create({ status: 422, headers: { "retry-after": "3" } }),
    ]) {
      expect(httpErrorStatus(error, 401, true)).toBe(401);
      expect(httpErrorStatus(error, 200, false)).toBe(500);
      expect(httpRetryAfter(error)).toBeUndefined();
    }
    expect(
      httpRetryAfter({
        headers: {
          get "retry-after"() {
            return invoked();
          },
        },
      }),
    ).toBeUndefined();
    expect(
      httpRetryAfter({ headers: { "retry-after": { toString: invoked } } }),
    ).toBeUndefined();
    expect(httpErrorStatus({}, 302)).toBe(500);
    expect(invoked).not.toHaveBeenCalled();
  });
  it("allows finite child context independently of the event payload schema", async () => {
    const output = await capture((logger) => {
      logger
        .child({
          module: "api",
          provider: "telegram",
          operation: "answerCallbackQuery",
          detail: canary,
        })
        .info({
          event: "public_catalog_failure",
          reason: "busy",
          module: "worker",
          provider: "selarti",
          detail: canary,
        });
    });
    expect(records(output)).toEqual([
      expect.objectContaining({
        event: "public_catalog_failure",
        reason: "busy",
        module: "api",
        provider: "telegram",
        operation: "answerCallbackQuery",
      }),
    ]);
    expect(output).not.toContain(canary);
  });
  it("preserves child inheritance and keeps setBindings local to its logger", async () => {
    const line = await capture((logger) => {
      const child = logger.child({ module: "worker" });
      const nested = child.child({});
      nested.setBindings({ provider: "telegram" });
      nested.info({
        event: "transport_failure",
        operation: "sendMessage",
        outcome: "unknown",
      });
      child.info({ event: "startup_failure", failureClass: "internal_error" });
      logger.info({ event: "startup_failure", failureClass: "internal_error" });
      logger
        .child({}, { level: "silent" })
        .child({})
        .fatal({ event: "process_fatal" });
    });
    const entries = records(line);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      module: "worker",
      provider: "telegram",
    });
    expect(entries[1]).toMatchObject({ module: "worker" });
    expect(entries[1]).not.toHaveProperty("provider");
    expect(entries[2]).not.toHaveProperty("module");
    expect(entries[2]).not.toHaveProperty("provider");
  });
  it("keeps bounded counts only on a recognized event", async () => {
    const line = await capture((logger) => {
      for (const count of [0, 1_000_000, -1, 0.5, 1_000_001, NaN, Infinity]) {
        logger.info({ event: "selarti_inbound", count });
      }
    });
    expect(records(line).map((record) => record.count)).toEqual([
      0,
      1_000_000,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
  it.each([
    ["ECONNREFUSED", "connection_refused"],
    ["EADDRINUSE", "address_in_use"],
    ["ETIMEDOUT", "timeout"],
    ["UND_ERR_CONNECT_TIMEOUT", "timeout"],
    ["ECONNRESET", "connection_reset"],
    ["ENOTFOUND", "dns_failure"],
    ["EAI_AGAIN", "dns_failure"],
    ["FST_ERR_CTP_BODY_TOO_LARGE", "body_too_large"],
    ["FST_ERR_CTP_INVALID_JSON_BODY", "invalid_json"],
    ["FST_ERR_VALIDATION", "invalid_request"],
    [canary, "internal_error"],
  ])(
    "keeps startup failure class for machine code %s",
    async (code, failureClass) => {
      const error = Object.assign(new Error(canary), { code });
      const line = await capture((logger) =>
        logger.fatal({
          event: "startup_failure",
          module: "api",
          failureClass: classifyFailure(error),
          err: error,
        }),
      );
      expect(line).not.toContain(canary);
      expect(records(line)).toEqual([
        expect.objectContaining({
          event: "startup_failure",
          module: "api",
          failureClass,
        }),
      ]);
    },
  );
  it("drops_plaintext_and_dynamic_keys_but_keeps_closed_events", async () => {
    const error = new Error(canary, { cause: canary });
    error.name = canary;
    error.stack = canary;
    const reasons = [
      "rate_limited",
      "busy",
      "missing_repository",
      "deadline",
      "repository_failure",
      "invalid_output",
    ];
    const line = await capture((logger) => {
      logger.info(canary);
      logger.info({
        msg: canary,
        detail: canary,
        [canary]: "value",
        correlationId: canary,
      });
      logger.error(error);
      logger.error({ err: error, cause: error }, "%s", canary);
      logger.info({
        rawBody: Buffer.from(canary),
        body: canary,
        headers: { authorization: canary },
        url: canary,
      });
      for (const reason of reasons)
        logger.warn({ reason }, "public_catalog_failure");
    });
    expect(line).not.toContain(canary);
    expect(records(line)).toHaveLength(11);
    expect(records(line).slice(0, 5)).toEqual(
      Array.from({ length: 5 }, () =>
        expect.objectContaining({ event: "telemetry_unclassified" }),
      ),
    );
    expect(
      records(line)
        .slice(5)
        .map(({ event, reason }) => ({ event, reason })),
    ).toEqual(
      reasons.map((reason) => ({ event: "public_catalog_failure", reason })),
    );
  });

  it("contains nested children and setBindings including hostile child options", async () => {
    const unsafe = vi.fn(() => ({ [canary]: canary }));
    const line = await capture((logger) => {
      logger.setBindings({ detail: canary, module: "api" });
      const child = logger.child(
        { detail: canary, [canary]: canary },
        {
          serializers: { event: unsafe },
          formatters: { bindings: unsafe, log: unsafe },
        },
      );
      const nested = child.child(
        { correlationId: canary },
        { formatters: { bindings: unsafe, log: unsafe } },
      );
      nested.setBindings({ [canary]: canary });
      nested.info({
        event: "http_request_completed",
        method: "POST",
        statusCode: 401,
        durationMs: 12,
      });
    });
    expect(line).not.toContain(canary);
    expect(unsafe).not.toHaveBeenCalled();
    expect(records(line)).toEqual([
      expect.objectContaining({
        event: "http_request_completed",
        module: "api",
        method: "POST",
        statusCode: 401,
        durationMs: 12,
      }),
    ]);
  });

  it("never evaluates unknown getters, coercion, serialization or proxy traps", async () => {
    const invoked = vi.fn(() => {
      throw new Error(canary);
    });
    const hostile = {
      get event() {
        return invoked();
      },
      get detail() {
        return invoked();
      },
      toJSON: invoked,
      toString: invoked,
    };
    const proxy = new Proxy(
      {},
      { get: invoked, ownKeys: invoked, getOwnPropertyDescriptor: invoked },
    );
    const line = await capture((logger) => {
      logger.info(hostile, "%s", hostile);
      logger.info(proxy);
      logger
        .child(hostile, hostile as never)
        .child(proxy)
        .setBindings(hostile);
      logger.error({ err: hostile });
    });
    expect(invoked).not.toHaveBeenCalled();
    expect(line).not.toContain(canary);
    expect(sanitizeTelemetry(hostile)).toEqual({
      event: "telemetry_unclassified",
    });
    expect(redactProviderUrl(hostile)).toBe("[REDACTED]");
  });

  it("preserves level and silent configuration without installing unsafe options", async () => {
    const line = await capture((logger) => {
      logger.level = "warn";
      logger.info(canary);
      logger.child({}, { level: "silent" }).fatal(canary);
      logger.child({}, { level: "debug" }).debug({
        event: "selarti_inbound",
        module: "api",
        operation: "selarti.inbound",
        outcome: "accepted",
      });
    });
    expect(records(line)).toEqual([
      expect.objectContaining({
        level: 20,
        event: "selarti_inbound",
        operation: "selarti.inbound",
        outcome: "accepted",
      }),
    ]);
  });

  it("rejects unknown enum values and unbounded numeric fields", async () => {
    const line = await capture((logger) => {
      logger.info({ event: canary, count: 1 });
      for (const number of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER]) {
        logger.info({
          event: "http_request_completed",
          method: canary,
          statusCode: number,
          durationMs: number,
          count: number,
        });
      }
    });
    expect(line).not.toContain(canary);
    for (const record of records(line)) {
      expect(record).not.toHaveProperty("count");
      expect(record).not.toHaveProperty("method");
      expect(record).not.toHaveProperty("statusCode");
      expect(record).not.toHaveProperty("durationMs");
    }
  });
});

describe("webhook path secret in free text (TRACK-05, D16)", () => {
  const capture = async (
    write: (logger: ReturnType<typeof createLogger>) => void,
  ) => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk));
    write(createLogger(output));
    await new Promise((resolve) => output.once("data", resolve));
    return Buffer.concat(chunks).toString("utf8");
  };

  it("redacts the bot key embedded in a 404 route message", async () => {
    const line = await capture((logger) =>
      logger.warn(
        { correlationId: "corr-1" },
        "Route GET:/v1/webhooks/telegram/client/kk_7Td9mQz2LpXvN4sYbR8cE1uHwA6iO3gF not found",
      ),
    );
    expect(line).not.toContain("kk_7Td9mQz2LpXvN4sYbR8cE1uHwA6iO3gF");
    expect(line).not.toContain("/v1/webhooks/telegram/client/");
    expect(line).not.toContain("not found");
  });

  it("keeps a query string out of the redaction and still scrubs its secrets", async () => {
    const line = await capture((logger) =>
      logger.error(
        {},
        "upstream failed for /v1/webhooks/telegram/client/SECRETSEGMENT?token=plainvalue&count=5",
      ),
    );
    expect(line).not.toContain("SECRETSEGMENT");
    expect(line).not.toContain("plainvalue");
    expect(line).not.toContain("?token=");
  });

  it("also drops unrelated free text at the content-free boundary", async () => {
    const line = await capture((logger) =>
      logger.info(
        { correlationId: "corr-2" },
        "Маршрут /v1/client/sessions жив, attempts=3, limit reached, reservationId=резерв-7",
      ),
    );
    expect(line).not.toContain("/v1/client/sessions");
    expect(line).not.toContain("attempts=3");
    expect(line).not.toContain("limit reached");
  });
});
