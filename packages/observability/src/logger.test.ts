import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.js";

describe("logger redaction", () => {
  it("removes credentials, raw bodies, profile text, and meeting links", async () => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk));
    createLogger(output).info(
      {
        authorization: "Bearer __PLACEHOLDER_TEST_AUTH_TOKEN__",
        rawBody: "private message",
        clientProfile: { goals: "private" },
        meetingUrl: "https://meeting.invalid/private",
        providerUrl:
          "https://api.telegram.org/bot__PLACEHOLDER_TELEGRAM_BOT_TOKEN__/sendMessage",
        correlationId: "corr-1",
      },
      "request",
    );
    await new Promise((resolve) => output.once("data", resolve));
    const line = Buffer.concat(chunks).toString("utf8");
    expect(line).not.toContain("__PLACEHOLDER_TEST_AUTH_TOKEN__");
    expect(line).not.toContain("private message");
    expect(line).not.toContain("meeting.invalid");
    expect(line).not.toContain("__PLACEHOLDER_TELEGRAM_BOT_TOKEN__");
    expect(line).toContain("/bot[REDACTED]/sendMessage");
    expect(line).toContain("corr-1");
  });

  it("recursively sanitizes nested provider, conversation, contact, URL, and token fields", async () => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk));
    createLogger(output).info({
      envelope: {
        providerPayload: {
          nested: {
            token: "nested-secret",
            text: "private conversation",
            contact: { email: "private@example.invalid" },
            url: "https://private.invalid",
          },
        },
        safe: {
          correlationId: "corr-nested",
          providerUrl: "https://api.telegram.org/botVERY_SECRET/sendMessage",
        },
      },
    });
    await new Promise((resolve) => output.once("data", resolve));
    const line = Buffer.concat(chunks).toString("utf8");
    for (const secret of [
      "nested-secret",
      "private conversation",
      "private@example.invalid",
      "https://private.invalid",
      "VERY_SECRET",
    ])
      expect(line).not.toContain(secret);
    expect(line).toContain("corr-nested");
    expect(line).toContain("/bot[REDACTED]/sendMessage");
  });

  it("removes every client-session credential field and nested cause before the sink", async () => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk));
    createLogger(output).error({
      request: {
        identityProof: "proof-sentinel-never-log",
        rawHeaders: ["Authorization", "Bearer cs1.session-sentinel-never-log"],
      },
      verifierOutput: {
        replayDigest: "hmac-sha256:v1:replay-sentinel-never-log",
        tokenHash: "sha256:hash-sentinel-never-log",
      },
      error: { cause: "nested-cause-sentinel-never-log" },
    });
    await new Promise((resolve) => output.once("data", resolve));
    const line = Buffer.concat(chunks).toString("utf8");
    for (const sentinel of [
      "proof-sentinel-never-log",
      "session-sentinel-never-log",
      "replay-sentinel-never-log",
      "hash-sentinel-never-log",
      "nested-cause-sentinel-never-log",
    ]) {
      expect(line).not.toContain(sentinel);
    }
  });

  const collect = async (
    write: (logger: ReturnType<typeof createLogger>) => void,
  ): Promise<string> => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk));
    write(createLogger(output));
    await new Promise((resolve) => output.once("data", resolve));
    return Buffer.concat(chunks).toString("utf8");
  };

  it("redacts a bare Telegram bot token that is not inside a /bot…/ URL", async () => {
    const line = await collect((logger) =>
      logger.info(
        "telegram getMe failed for 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw",
      ),
    );
    expect(line).not.toContain("AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw");
    expect(line).not.toContain("123456789:AAH");
    expect(line).toContain("telegram getMe failed");
  });

  it("redacts provider key-shaped secrets appearing in message text", async () => {
    const line = await collect((logger) =>
      logger.info(
        "rejected planerka key sk_live_51H8qWxLe9RtAbCdEfGh and selarti sk_test_9ZmNpQrStUvWxYz",
      ),
    );
    expect(line).not.toContain("sk_live_51H8qWxLe9RtAbCdEfGh");
    expect(line).not.toContain("sk_test_9ZmNpQrStUvWxYz");
    expect(line).toContain("rejected");
  });

  it("redacts credential-bearing object keys that the old list missed", async () => {
    const line = await collect((logger) =>
      logger.info({
        envelope: {
          apiKey: "apikey-sentinel-never-log",
          password: "password-sentinel-never-log",
          credential: "credential-sentinel-never-log",
          secretKey: "secretkey-sentinel-never-log",
          signingKey: "signingkey-sentinel-never-log",
        },
      }),
    );
    for (const sentinel of [
      "apikey-sentinel-never-log",
      "password-sentinel-never-log",
      "credential-sentinel-never-log",
      "secretkey-sentinel-never-log",
      "signingkey-sentinel-never-log",
    ]) {
      expect(line).not.toContain(sentinel);
    }
  });

  it("redacts the client telegram bot key because it authenticates the webhook", async () => {
    const line = await collect((logger) =>
      logger.info(
        {
          botKey: "botkey-sentinel-never-log",
          bot_key: "bot-key-sentinel-never-log",
        },
        "client ingress",
      ),
    );
    expect(line).not.toContain("botkey-sentinel-never-log");
    expect(line).not.toContain("bot-key-sentinel-never-log");
    expect(line).toContain("client ingress");
  });

  it("keeps non-secret identifier fields ending in Key observable", async () => {
    const line = await collect((logger) =>
      logger.info(
        {
          idempotencyKey: "idem-77",
          requestKey: "rq-77",
        },
        "dispatch",
      ),
    );
    expect(line).toContain("idem-77");
    expect(line).toContain("rq-77");
  });

  it("keeps a boot failure diagnosable: error name/message/stack survive, secrets scrubbed", async () => {
    const line = await collect((logger) =>
      logger.fatal(
        {
          err: new Error(
            "connection refused to 203.0.113.9:5432 key=sk_live_aaaaaaaaaaaaaaaa",
          ),
        },
        "api startup failed",
      ),
    );
    expect(line).toContain("api startup failed");
    // the reason and the error type survive...
    expect(line).toContain("Error");
    expect(line).toContain("connection refused");
    expect(line).toContain("at ");
    // ...but an embedded provider key still never reaches the log.
    expect(line).not.toContain("sk_live_aaaaaaaaaaaaaaaa");
  });

  it("does not throw in the log hook when an Error has non-string message/stack", async () => {
    const err = new Error("sentinel-ok");
    // A deserialized error (Object.assign(serializedError)) can carry non-string members.
    Object.assign(err, { message: 42, stack: ["at", "boom"] });
    const line = await collect((logger) =>
      logger.fatal({ err }, "api startup failed"),
    );
    expect(line).toContain("api startup failed");
    expect(line).not.toContain("sentinel-ok"); // original message overwritten by 42
    expect(line).toContain("42");
    expect(line).not.toContain("boom"); // array stack is skipped, not joined blindly
  });

  it.each([
    [
      "postgres dsn creds",
      "connect postgresql://tonya:SuPerTopSecret@db.internal:5432/app failed",
      "SuPerTopSecret",
    ],
    [
      "bearer token",
      "upstream Authorization: Bearer abcdefghijklmnop0123456789ABCD",
      "abcdefghijklmnop0123456789ABCD",
    ],
    [
      "jwt",
      "auth eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.qW3rT8yU accepted",
      "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
    ],
    ["aws key id", "aws AKIAABCDEFGHIJKLMNOP leak", "AKIAABCDEFGHIJKLMNOP"],
    [
      "password assignment",
      "config password=hunter2secret rejected",
      "hunter2secret",
    ],
    [
      "json token",
      'log {"token": "leakedtokenvalue"} done',
      "leakedtokenvalue",
    ],
    ["refresh token json", 'cfg {"refresh_token":"r3freshval"}', "r3freshval"],
  ])(
    "scrubs %s appearing in free-text message",
    async (_label, text, secret) => {
      const line = await collect((logger) => logger.info(text));
      expect(line).not.toContain(secret);
      expect(line).toContain("[REDACTED]");
    },
  );

  it("keeps benign operational text intact", async () => {
    const line = await collect((logger) =>
      logger.info(
        "reservationId=abc123 count=5 status=ok session token rotated for corr-9; selarti cost tokens=1234; booked time: 10:20; https://ii-tonya.ru/api/v1/reservations?city=tambov; handle bk1_AAAAAAAAAAAAAAAAAAAA",
      ),
    );
    expect(line).toContain("reservationId=abc123");
    expect(line).toContain("count=5");
    expect(line).toContain("status=ok");
    expect(line).toContain("token rotated");
    expect(line).toContain("tokens=1234"); // plural must not trip the secret matcher
    expect(line).toContain("time: 10:20"); // a colon in prose is not a secret assignment
    expect(line).toContain("reservations?city=tambov"); // query url without creds is fine
    expect(line).toContain("bk1_AAAAAAAAAAAAAAAAAAAA"); // booking handle is not a secret
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
    expect(line).toContain("/v1/webhooks/telegram/client/[REDACTED]");
    // Диагностика остаётся: по какой форме маршрут не найден — видно.
    expect(line).toContain("not found");
    expect(line).toContain("corr-1");
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
    // Ключ запроса остаётся видимым, значение вычёркано. Существующее правило
    // secretAssignment захватывает значение до конца токена, поэтому &count=5 уходит
    // вместе с ним - это пере-закрытие (безопасно), а не утечка; менять её здесь нечем.
    expect(line).toContain("?token=[REDACTED]");
  });

  it("leaves unrelated operational text alone", async () => {
    const line = await capture((logger) =>
      logger.info(
        { correlationId: "corr-2" },
        "Маршрут /v1/client/sessions жив, attempts=3, limit reached, reservationId=резерв-7",
      ),
    );
    expect(line).toContain("/v1/client/sessions");
    expect(line).toContain("attempts=3");
    expect(line).toContain("limit reached");
  });
});
