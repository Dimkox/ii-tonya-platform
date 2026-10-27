import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { loadEnv } from "../../packages/config/src/index.js";
import { createProductionWorkerRuntimeFactory } from "../../apps/worker/src/main.js";
import { createClientAsyncOutboxRegistry } from "../../apps/worker/src/client-async-outbox.js";
import * as integrations from "../../packages/integrations/src/index.js";
import type { TelegramTransport } from "../../packages/integrations/src/telegram/telegram-adapter.js";
import { PostgresHybridMessageRepository } from "../../packages/db/src/repositories/hybrid-message-repository.js";
import { PostgresOrderedTelegramOutboxRepository } from "../../packages/db/src/repositories/outbox-repository.js";
import { PostgresPrivacyRepository } from "../../packages/db/src/repositories/privacy-repository.js";
import { seedClientConsent } from "../../packages/db/src/testkit/client-consent.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

const token = "123456:synthetic_token_abcdefghijklmnopqrstuvwxyz";
const botKey = "client.bot:one";
const reply = {
  ok: true,
  result: {
    message_id: 42,
    from: { id: 123456, is_bot: true },
    chat: { id: 91001, type: "private" },
  },
};
let database: TestDatabase;
beforeAll(async () => {
  database = await startTestPostgres();
  expect(
    (
      await database.db.execute<{ version: string }>(
        sql`select current_setting('server_version_num') as version`,
      )
    ).rows[0]!.version,
  ).toBe("170005");
  await database.migrate();
}, 180000);
beforeEach(async () => database.reset());
afterEach(() => vi.restoreAllMocks());
afterAll(async () => database?.stop());

async function fixture() {
  const userId = await database.createUser();
  await database.db.execute(
    sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status) values(${userId}::uuid,'telegram','91001',${botKey},'91001','active')`,
  );
  await seedClientConsent(database.db, userId, "client_messaging");
  const producer = new PostgresHybridMessageRepository(database.db);
  const input = {
    updateId: 1n,
    payloadHash: "b".repeat(64),
    provider: "telegram" as const,
    botKey,
    externalUserId: "91001",
    externalChatId: "91001",
    text: "synthetic",
    route: "deterministic" as const,
    routingEnabled: false,
    correlationId: "synthetic-first",
    locale: "ru-RU",
    deadline: new Date(Date.now() + 60000).toISOString(),
    occurredAt: new Date().toISOString(),
    messagingConsentPolicyVersion: "client-messaging-v1",
  };
  expect(await producer.persist(input)).toBe("claimed");
  const queue = new PostgresOrderedTelegramOutboxRepository(
    database.db,
    { enabled: true },
    botKey,
  );
  const row = async () =>
    (
      await database.db.execute<{
        id: string;
        status: string;
        nextAttemptAtMs: number | null;
      }>(
        sql`select id,status,(extract(epoch from next_attempt_at)*1000)::float8 as "nextAttemptAtMs" from integration_outbox where correlation_id='synthetic-first' and topic='telegram.send_text.v1'`,
      )
    ).rows[0]!;
  const withdraw = () =>
    new PostgresPrivacyRepository(database.db, {
      privacyMutationCapability: { enabled: true },
    }).withdrawConsentAtomically({
      targetUserId: userId,
      purpose: "client_messaging",
      policyVersion: "client-messaging-v1",
      correlationId: "synthetic-withdraw",
    });
  return { userId, producer, input, queue, row, withdraw };
}
async function runtime(fetch: typeof globalThis.fetch, key = botKey) {
  const dependencies = { clientTelegramFetch: fetch };
  const config = loadEnv({
    DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:1/synthetic",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    CLIENT_TELEGRAM_BOT_KEY: key,
    TELEGRAM_BOT_TOKEN: token,
    B2_TELEGRAM_DISPATCH_ENABLED: "true",
    TELEGRAM_EGRESS_CONSENT_GATE_ENABLED: "true",
  });
  config.databaseUrl = database.db.$client.options.connectionString!;
  return createProductionWorkerRuntimeFactory(
    dependencies as Parameters<typeof createProductionWorkerRuntimeFactory>[0],
  ).create(config);
}
async function cycle(fetch: typeof globalThis.fetch, key = botKey) {
  const worker = await runtime(fetch, key);
  try {
    await worker.runOnce();
  } finally {
    await worker.close();
  }
}

describe("ordinary Telegram composition with real committed admission", () => {
  it("delivers via default production factory, commits success and never sends authority in the wire", async () => {
    const f = await fixture();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json(reply));
    await cycle(fetch);
    expect((await f.row()).status).toBe("succeeded");
    expect(fetch).toHaveBeenCalledTimes(1);
    const wire = JSON.parse(fetch.mock.calls[0]![1]!.body as string) as Record<
      string,
      unknown
    >;
    expect(Object.keys(wire).sort()).toEqual(["chat_id", "text"]);
    expect(wire.chat_id).toBe("91001");
    expect(
      (
        await database.db.execute<{ outcome: string }>(
          sql`select outcome from delivery_attempts order by created_at`,
        )
      ).rows.map((r) => r.outcome),
    ).toEqual(["started", "dispatch_consumed"]);
    await cycle(fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("persists provider seconds as a minimum delay and does not immediately resend", async () => {
    const f = await fixture();
    let receivedAt = 0;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => {
        receivedAt = Date.now();
        return Response.json(
          { ok: false, error_code: 429, parameters: { retry_after: 60 } },
          { status: 429 },
        );
      });
    await cycle(fetch);
    const row = await f.row();
    expect(row.status).toBe("retry_wait");
    expect(row.nextAttemptAtMs).toBeGreaterThanOrEqual(receivedAt + 60000);
    await cycle(fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["wrong-bot", "wrong-chat", "invalid-429", "network"])(
    "keeps %s unknown across restart and blocks later sequence",
    async (mode) => {
      const f = await fixture();
      expect(
        await f.producer.persist({
          ...f.input,
          updateId: 2n,
          correlationId: "synthetic-second",
        }),
      ).toBe("claimed");
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockImplementation(async () => {
          if (mode === "network")
            throw new Error("synthetic private network detail");
          if (mode === "invalid-429")
            return Response.json(
              { ok: false, error_code: 429 },
              { status: 429 },
            );
          const body = structuredClone(reply);
          if (mode === "wrong-bot") body.result.from.id++;
          if (mode === "wrong-chat") body.result.chat.id++;
          return Response.json(body);
        });
      await cycle(fetch);
      expect((await f.row()).status).toBe("unknown_outcome");
      await cycle(fetch);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it("filters another bot for the same user/chat without consuming its queue", async () => {
    const f = await fixture();
    await database.db.execute(
      sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status) values(${f.userId}::uuid,'telegram','91001','other.bot','91001','active')`,
    );
    expect(
      await f.producer.persist({
        ...f.input,
        botKey: "other.bot",
        correlationId: "other",
      }),
    ).toBe("claimed");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json(reply));
    await cycle(fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      (
        await database.db.execute<{ status: string }>(
          sql`select status from integration_outbox where correlation_id='other'`,
        )
      ).rows[0]!.status,
    ).toBe("pending");
  });
  it("does not revive a queued reply after withdrawal and regrant", async () => {
    const f = await fixture();
    await f.withdraw();
    await seedClientConsent(database.db, f.userId, "client_messaging");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json(reply));
    await cycle(fetch);
    expect(fetch).not.toHaveBeenCalled();
    expect((await f.row()).status).toBe("dead_letter");
    expect(
      await f.producer.persist({
        ...f.input,
        updateId: 2n,
        correlationId: "synthetic-fresh",
      }),
    ).toBe("claimed");
    await cycle(fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("consumes exact admitted payload once, refusing mutation and concurrent duplicate invocation", async () => {
    const f = await fixture();
    const factory = (
      integrations as unknown as {
        createClientAsyncTelegramTransport?: (input: {
          token: string;
          fetch: typeof globalThis.fetch;
        }) => TelegramTransport;
      }
    ).createClientAsyncTelegramTransport;
    expect(factory).toBeTypeOf("function");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json(reply));
    const registry = createClientAsyncOutboxRegistry(
      database.db,
      botKey,
      {
        telegram: {
          transport: factory!({ token, fetch }),
          sendMessageUrl: new URL(
            `https://api.telegram.org/bot${token}/sendMessage`,
          ),
        },
      },
      false,
    );
    const message = (await f.queue.claim(1, "synthetic-worker", 60000, 3))[0]!;
    const admission = await f.queue.recordAttemptStarted(
      message.id,
      "synthetic-worker",
      message.dispatchClaimToken!,
      randomUUID(),
      message.reconciliationKey,
      new Date(),
      message.attempt,
    );
    if (admission?.kind !== "admitted")
      throw new Error("expected admitted start");
    expect(
      await registry.dispatch(
        {
          ...message,
          payload: { ...(message.payload as object), text: "mutated" },
        },
        admission,
      ),
    ).toMatchObject({ kind: "terminal" });
    expect(fetch).not.toHaveBeenCalled();
    const results = await Promise.all([
      registry.dispatch(message, admission),
      registry.dispatch(message, admission),
    ]);
    expect(results.map((r) => r.kind).sort()).toEqual(["applied", "terminal"]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("recovers crash after HTTP success without blindly resending", async () => {
    const f = await fixture();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json(reply));
    // Ordinary factory uses the packaged DB repository, so fail its acknowledgement only.
    const packaged = await import("../../packages/db/dist/index.js");
    const acknowledge = vi
      .spyOn(packaged.PostgresOutboxRepository.prototype, "succeed")
      .mockRejectedValueOnce(
        new Error("synthetic crash before acknowledgement"),
      );
    await expect(cycle(fetch)).rejects.toThrow(
      "synthetic crash before acknowledgement",
    );
    acknowledge.mockRestore();
    expect(fetch).toHaveBeenCalledTimes(1);
    await database.expireDispatchLease((await f.row()).id);
    await cycle(fetch);
    expect((await f.row()).status).toBe("unknown_outcome");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("drains in-flight HTTP on shutdown and refuses another cycle", async () => {
    await fixture();
    let respond!: (response: Response) => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => {
      entered();
      return new Promise<Response>((resolve) => {
        respond = resolve;
      });
    });
    const worker = await runtime(fetch);
    const running = worker.runOnce();
    try {
      await ready;
      const closed = worker.close();
      await expect(worker.runOnce()).rejects.toThrow("closing");
      respond(Response.json(reply));
      await running;
      await closed;
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      respond?.(Response.json(reply));
      await worker.close();
    }
  });
});
