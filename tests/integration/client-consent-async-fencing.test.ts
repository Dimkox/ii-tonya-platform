import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { PostgresHybridMessageRepository } from "../../packages/db/src/repositories/hybrid-message-repository.js";
import {
  PostgresOutboxRepository,
  PostgresOrderedTelegramOutboxRepository,
} from "../../packages/db/src/repositories/outbox-repository.js";
import { PostgresSelartiProposalRepository } from "../../packages/db/src/repositories/selarti-proposal-repository.js";
import { PostgresTestExpertTrialRepository } from "../../packages/db/src/repositories/test-expert-trial-repository.js";
import { PostgresTestExpertTelegramRepository } from "../../packages/db/src/repositories/test-expert-telegram-repository.js";
import { createClientDispatchAdmissionGate } from "../../packages/db/src/repositories/client-consent-authority.js";
import { createProductionWorkerRuntimeFactory } from "../../apps/worker/src/main.js";
import { PostgresPrivacyRepository } from "../../packages/db/src/repositories/privacy-repository.js";
import {
  seedClientConsent,
  seedClientRequestStarted,
} from "../../packages/db/src/testkit/client-consent.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let database: TestDatabase;
beforeAll(async () => {
  database = await startTestPostgres();
  await database.migrate();
}, 180_000);
afterAll(async () => database?.stop());
beforeEach(async () => database.reset());

async function fixture() {
  const userId = await database.createUser();
  await database.db.execute(
    sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status) values(${userId}::uuid,'telegram','91001','fence-bot','91001','active')`,
  );
  const decision = await seedClientConsent(
    database.db,
    userId,
    "client_messaging",
  );
  const producer = new PostgresHybridMessageRepository(database.db);
  const input = {
    updateId: 1n,
    payloadHash: "b".repeat(64),
    provider: "telegram" as const,
    botKey: "fence-bot",
    externalUserId: "91001",
    externalChatId: "91001",
    text: "synthetic",
    route: "deterministic" as const,
    routingEnabled: false,
    correlationId: "fence",
    locale: "ru-RU",
    deadline: new Date(Date.now() + 60_000).toISOString(),
    occurredAt: new Date().toISOString(),
    messagingConsentPolicyVersion: "client-messaging-v1",
  };
  expect(await producer.persist(input)).toBe("claimed");
  const queue = new PostgresOrderedTelegramOutboxRepository(database.db, {
    enabled: true,
  });
  const withdraw = () =>
    new PostgresPrivacyRepository(database.db, {
      privacyMutationCapability: { enabled: true },
    }).withdrawConsentAtomically({
      targetUserId: userId,
      purpose: "client_messaging",
      policyVersion: "client-messaging-v1",
      correlationId: "withdraw",
    });
  return { userId, decision, producer, input, queue, withdraw };
}

async function requestFixture(deadlineMs = 60_000) {
  const f = await fixture();
  const selarti = await seedClientConsent(
    database.db,
    f.userId,
    "selarti_ai_processing",
  );
  const dialogue = (
    await database.db.execute<{ id: string }>(
      sql`select id from dialogues where user_id=${f.userId}::uuid`,
    )
  ).rows[0]!;
  const requestId = `sha256:${"c".repeat(64)}`;
  const payload = {
    requestId,
    dialogueId: dialogue.id,
    userId: f.userId,
    correlationId: "request",
    text: "synthetic request",
    locale: "ru-RU",
    promptVersion: "hybrid-b1",
    deadline: new Date(Date.now() + deadlineMs).toISOString(),
    consentAuthority: {
      v: 1,
      subjectId: f.userId,
      purposes: {
        client_messaging: f.decision,
        selarti_ai_processing: selarti,
      },
    },
  };
  await database.db.execute(
    sql`insert into integration_outbox(idempotency_key,topic,payload,correlation_id,reconciliation_key,payload_hash) values(${requestId},'selarti.request.v1',${JSON.stringify(payload)}::jsonb,'request',${requestId},${"d".repeat(64)})`,
  );
  const queue = new PostgresOutboxRepository(database.db);
  const message = (await queue.claim(10, "provider-worker", 60_000, 3)).find(
    (m) => m.topic === "selarti.request.v1",
  )!;
  const acceptInput = {
    requestId,
    dialogueId: dialogue.id,
    threadId: requestId,
    tenantKey: "fence-bot",
    text: "private response marker",
    responsePayloadHash: "e".repeat(64),
    receivedAt: new Date().toISOString(),
  };
  return {
    ...f,
    requestId,
    payload,
    message,
    providerQueue: queue,
    acceptInput,
    accept: () =>
      new PostgresSelartiProposalRepository(database.db).accept(acceptInput),
  };
}

async function barrier(userId: string) {
  let release!: () => void;
  let acquired!: () => void;
  const ready = new Promise<void>((r) => {
    acquired = r;
  });
  const held = database.db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${userId}::uuid::text,0))`,
    );
    acquired();
    await new Promise<void>((r) => {
      release = r;
    });
  });
  await ready;
  return async () => {
    release();
    await held;
  };
}
async function waitForWaiters(count: number) {
  for (let i = 0; i < 100; i++) {
    const result = await database.db.execute<{ n: number }>(
      sql`select count(*)::int n from pg_stat_activity where datname=current_database() and wait_event='advisory'`,
    );
    if (result.rows[0]!.n >= count) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("controlled subject barrier not reached");
}

describe("original client authority", () => {
  it("never revives an old queued reply after withdrawal and regrant", async () => {
    const userId = await database.createUser();
    await database.db.execute(
      sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status) values(${userId}::uuid,'telegram','91001','fence-bot','91001','active')`,
    );
    await seedClientConsent(database.db, userId, "client_messaging");
    const producer = new PostgresHybridMessageRepository(database.db);
    const input = {
      updateId: 1n,
      payloadHash: "a".repeat(64),
      provider: "telegram" as const,
      botKey: "fence-bot",
      externalUserId: "91001",
      externalChatId: "91001",
      text: "synthetic",
      route: "deterministic" as const,
      routingEnabled: false,
      correlationId: "fence-1",
      locale: "ru-RU",
      deadline: new Date(Date.now() + 60_000).toISOString(),
      occurredAt: new Date().toISOString(),
      messagingConsentPolicyVersion: "client-messaging-v1",
    };
    expect(await producer.persist(input)).toBe("claimed");
    await new PostgresPrivacyRepository(database.db, {
      privacyMutationCapability: { enabled: true },
    }).withdrawConsentAtomically({
      targetUserId: userId,
      purpose: "client_messaging",
      policyVersion: "client-messaging-v1",
      correlationId: "fence-withdraw",
    });
    await seedClientConsent(database.db, userId, "client_messaging");
    const queue = new PostgresOrderedTelegramOutboxRepository(database.db, {
      enabled: true,
    });
    expect(await queue.claim(10, "fence-worker", 60_000, 3)).toHaveLength(0);
    expect(
      await producer.persist({
        ...input,
        updateId: 2n,
        correlationId: "fence-2",
      }),
    ).toBe("claimed");
    const fresh = await queue.claim(10, "fence-worker", 60_000, 3);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]!.correlationId).toBe("fence-2");
  });

  it("captures before writing content and refuses missing projection", async () => {
    const f = await fixture();
    const row = (
      await database.db.execute<{ payload: { consentAuthority: unknown } }>(
        sql`select payload from integration_outbox`,
      )
    ).rows[0]!;
    expect(row.payload.consentAuthority).toEqual({
      v: 1,
      subjectId: f.userId,
      purposes: { client_messaging: f.decision },
    });
    await database.db.execute(
      sql`delete from consent_states where user_id=${f.userId}::uuid`,
    );
    expect(
      await f.producer.persist({
        ...f.input,
        updateId: 2n,
        text: "must not persist",
      }),
    ).toBe("rejected");
    expect(
      (
        await database.db.execute<{ n: number }>(
          sql`select count(*)::int n from dialogue_inbound`,
        )
      ).rows[0]!.n,
    ).toBe(1);
  });

  it.each([
    "missing",
    "malformed",
    "projection",
    "tie",
    "owner",
    "inactive",
    "scope",
    "redacted",
  ] as const)("denies %s authority before durable start", async (mode) => {
    const f = await fixture();
    const m = (await f.queue.claim(1, "worker", 60_000, 3))[0]!;
    if (mode === "missing")
      await database.db.execute(
        sql`update integration_outbox set payload=payload-'consentAuthority' where id=${m.id}::uuid`,
      );
    if (mode === "malformed")
      await database.db.execute(
        sql`update integration_outbox set payload=jsonb_set(payload,'{consentAuthority,v}','2') where id=${m.id}::uuid`,
      );
    if (mode === "projection")
      await database.db.execute(
        sql`delete from consent_states where user_id=${f.userId}::uuid`,
      );
    if (mode === "tie")
      await database.db.execute(
        sql`insert into consents(user_id,consent_type,decision,policy_version,created_at) select user_id,consent_type,'denied',policy_version,created_at from consents where id=${f.decision.decisionId}::uuid`,
      );
    if (mode === "owner")
      await database.db.execute(
        sql`update dialogues set user_id=${await database.createUser()}::uuid`,
      );
    if (mode === "inactive")
      await database.db.execute(
        sql`update users set active=false where id=${f.userId}::uuid`,
      );
    if (mode === "scope") {
      // Immutable journal: introduce a new, scoped decision and use its exact projection.
      const d = (
        await database.db.execute<{ id: string }>(
          sql`insert into consents(user_id,consent_type,decision,policy_version,channel,scope_fields,document_version_id,presentation_id,text_sha256,basis,created_at) select user_id,consent_type,decision,policy_version,channel,'{"expiresAt":"2000-01-01T00:00:00Z"}'::jsonb,document_version_id,presentation_id,text_sha256,basis,clock_timestamp() from consents where id=${f.decision.decisionId}::uuid returning id`,
        )
      ).rows[0]!;
      await database.db.execute(
        sql`update consent_states set last_decision_id=${d.id}::uuid where user_id=${f.userId}::uuid`,
      );
      await database.db.execute(
        sql`update integration_outbox set payload=jsonb_set(payload,'{consentAuthority,purposes,client_messaging,decisionId}',${JSON.stringify(d.id)}::jsonb) where id=${m.id}::uuid`,
      );
    }
    if (mode === "redacted")
      await database.db.execute(
        sql`update integration_outbox set payload='{"redacted":true}'::jsonb where id=${m.id}::uuid`,
      );
    const result = await f.queue.recordAttemptStarted(
      m.id,
      "worker",
      m.dispatchClaimToken!,
      randomUUID(),
      m.reconciliationKey,
      new Date(),
      m.attempt,
    );
    expect(result).toMatchObject({ kind: "blocked" });
    expect(
      (
        await database.db.execute<{ n: number }>(
          sql`select count(*)::int n from delivery_attempts where outcome='started'`,
        )
      ).rows[0]!.n,
    ).toBe(0);
  });

  it("keeps revisions above 2^53 exact and admits an attempt once", async () => {
    const f = await fixture();
    await database.db.execute(
      sql`update consent_states set revision=9007199254740993 where user_id=${f.userId}::uuid`,
    );
    expect(await f.producer.persist({ ...f.input, updateId: 2n })).toBe(
      "claimed",
    );
    const m = (await f.queue.claimWithMetrics(5, "worker", 60_000, 3))
      .messages[0]!;
    expect(m.payload).toMatchObject({
      consentAuthority: {
        purposes: { client_messaging: { revision: "9007199254740993" } },
      },
    });
    const args = [
      m.id,
      "worker",
      m.dispatchClaimToken!,
      randomUUID(),
      m.reconciliationKey,
      new Date(),
      m.attempt,
    ] as const;
    expect(await f.queue.recordAttemptStarted(...args)).toMatchObject({
      kind: "admitted",
      attempt: m.attempt,
    });
    expect(await f.queue.recordAttemptStarted(...args)).toMatchObject({
      kind: "blocked",
    });
    await expect(
      f.queue.recordAttemptStarted(
        m.id,
        "worker",
        "stale",
        randomUUID(),
        m.reconciliationKey,
        new Date(),
        m.attempt,
      ),
    ).rejects.toThrow();
    await database.expireDispatchLease(m.id);
    await f.queue.recoverExpiredDispatchLeases();
    expect(await database.outboxStatus(m.id)).toBe("unknown_outcome");
    expect(await f.queue.claim(10, "restart", 60_000, 3)).toHaveLength(0);
  });

  it.each(["withdraw", "start"] as const)(
    "serializes %s first against the competing start/withdrawal",
    async (first) => {
      const f = await fixture();
      const m = (await f.queue.claim(1, "worker", 60_000, 3))[0]!;
      const start = () =>
        f.queue.recordAttemptStarted(
          m.id,
          "worker",
          m.dispatchClaimToken!,
          randomUUID(),
          m.reconciliationKey,
          new Date(),
          m.attempt,
        );
      if (first === "start")
        expect(await start()).toMatchObject({ kind: "admitted" });
      const release = await barrier(f.userId);
      let withdrawing: Promise<unknown> | undefined;
      try {
        withdrawing = f.withdraw();
        await waitForWaiters(1);
        if (first === "withdraw") {
          // Admission has a bounded 10ms subject wait. A queued withdrawal wins
          // by deferring the unstarted claim, rather than adding a second waiter.
          expect(await start()).toEqual({
            kind: "deferred",
            reasonCode: "client_authority_busy",
          });
        }
      } finally {
        await release();
        if (withdrawing) await withdrawing;
      }
      expect(
        (
          await database.db.execute<{ n: number }>(
            sql`select count(*)::int n from delivery_attempts where outcome='started'`,
          )
        ).rows[0]!.n,
      ).toBe(first === "start" ? 1 : 0);
      if (first === "withdraw")
        expect(await f.queue.claim(1, "retry-worker", 60_000, 3)).toHaveLength(
          0,
        );
    },
  );

  it.each(["withdraw", "accept"] as const)(
    "serializes %s first before response persistence",
    async (first) => {
      const f = await requestFixture();
      expect(
        await f.providerQueue.recordAttemptStarted(
          f.message.id,
          "provider-worker",
          f.message.dispatchClaimToken!,
          randomUUID(),
          f.message.reconciliationKey,
          new Date(),
          f.message.attempt,
        ),
      ).toMatchObject({ kind: "admitted" });
      const release = await barrier(f.userId);
      let a: Promise<unknown>, b: Promise<unknown>;
      try {
        a = first === "withdraw" ? f.withdraw() : f.accept();
        await waitForWaiters(1);
        b = first === "withdraw" ? f.accept() : f.withdraw();
        await waitForWaiters(2);
      } finally {
        await release();
      }
      const results = await Promise.all([a!, b!]);
      expect(results[first === "accept" ? 0 : 1]).toBe(
        first === "accept" ? "accepted" : "rejected",
      );
      const proposals = await database.db.execute<{ n: number }>(
        sql`select count(*)::int n from selarti_response_proposals`,
      );
      expect(proposals.rows[0]!.n).toBe(first === "accept" ? 1 : 0);
      if (first === "accept") {
        const derived = (
          await database.db.execute<{ payload: { consentAuthority: unknown } }>(
            sql`select payload from integration_outbox where topic='telegram.send_text.v1' and correlation_id=${f.requestId}`,
          )
        ).rows[0]!;
        expect(derived.payload.consentAuthority).toEqual(
          f.payload.consentAuthority,
        );
        expect(await f.accept()).toBe("duplicate");
      }
    },
  );

  it("rejects responses without a durable provider start or after the actual deadline", async () => {
    const f = await requestFixture();
    expect(await f.accept()).toBe("rejected");
    await f.providerQueue.recordAttemptStarted(
      f.message.id,
      "provider-worker",
      f.message.dispatchClaimToken!,
      randomUUID(),
      f.message.reconciliationKey,
      new Date(),
      f.message.attempt,
    );
    await database.db.execute(
      sql`update integration_outbox set payload=jsonb_set(payload,'{deadline}',to_jsonb((clock_timestamp()-interval '1 second')::text)) where id=${f.message.id}::uuid`,
    );
    await seedClientRequestStarted(database.db, f.requestId);
    expect(await f.accept()).toBe("late");
    expect(
      (
        await database.db.execute<{ n: number }>(
          sql`select count(*)::int n from selarti_response_proposals`,
        )
      ).rows[0]!.n,
    ).toBe(0);
  });
  it("keeps unknown trial units reserved when a started response loses original authority", async () => {
    const f = await requestFixture();
    const campaignId = randomUUID();
    await database.db.execute(
      sql`insert into test_expert_campaign_versions(id,code,version) values(${campaignId}::uuid,'test-expert-fence',1)`,
    );
    const trial = new PostgresTestExpertTrialRepository(database.db);
    const redemption = await trial.createOrGetRedemption({
      campaignVersionId: campaignId,
      userId: f.userId,
      idempotencyKey: `trial:${f.userId}`,
    });
    const reservation = await trial.reserveAiTurn({
      redemptionId: redemption.id,
      requestKey: "unknown-request",
      requestDigest: "a".repeat(64),
    });
    await trial.recordOutcome({
      reservationId: reservation.reservationId,
      outcome: "unknown",
      providerRequestId: f.requestId,
    });
    await f.providerQueue.recordAttemptStarted(
      f.message.id,
      "provider-worker",
      f.message.dispatchClaimToken!,
      randomUUID(),
      f.message.reconciliationKey,
      new Date(),
      f.message.attempt,
    );
    await f.withdraw();
    await seedClientConsent(database.db, f.userId, "client_messaging");
    expect(await f.accept()).toBe("rejected");
    expect(await trial.summary(redemption.id)).toMatchObject({
      consumedUnits: 0,
      reservedUnits: 2,
    });
    expect(
      await new PostgresTestExpertTelegramRepository(database.db, {
        messagingConsentPolicyVersion: "client-messaging-v1",
      }).resolveAuthoritativeOutcome(f.requestId),
    ).toBe("unknown");
    expect(
      (
        await database.db.execute<{ n: number }>(
          sql`select count(*)::int n from selarti_response_proposals`,
        )
      ).rows[0]!.n,
    ).toBe(0);
  });
  it("checks the database deadline after waiting for the subject lock", async () => {
    const f = await requestFixture(1500);
    await f.providerQueue.recordAttemptStarted(
      f.message.id,
      "provider-worker",
      f.message.dispatchClaimToken!,
      randomUUID(),
      f.message.reconciliationKey,
      new Date(),
      f.message.attempt,
    );
    const release = await barrier(f.userId);
    let accepting: Promise<unknown>;
    try {
      accepting = f.accept();
      await waitForWaiters(1);
      await database.db.execute(
        sql`select pg_sleep(greatest(0,extract(epoch from (${f.payload.deadline}::timestamptz-clock_timestamp())))+0.02)`,
      );
    } finally {
      await release();
    }
    expect(await accepting!).toBe("late");
    expect(
      (
        await database.db.execute<{ n: number }>(
          sql`select count(*)::int n from selarti_response_proposals`,
        )
      ).rows[0]!.n,
    ).toBe(0);
  });
  it("consumes a durable receipt once after a winning start, including after withdrawal", async () => {
    const f = await fixture(),
      m = (await f.queue.claim(1, "worker", 60_000, 3))[0]!;
    const admission = await f.queue.recordAttemptStarted(
      m.id,
      "worker",
      m.dispatchClaimToken!,
      randomUUID(),
      m.reconciliationKey,
      new Date(),
      m.attempt,
    );
    expect(admission?.kind).toBe("admitted");
    if (admission?.kind !== "admitted") throw new Error("admission missing");
    await f.withdraw();
    const gate = createClientDispatchAdmissionGate(database.db);
    expect(
      await gate.consume(
        { ...m, payload: { ...(m.payload as object), text: "changed" } },
        admission,
      ),
    ).toBe(false);
    expect(await gate.consume(m, admission)).toBe(true);
    expect(await gate.consume(m, admission)).toBe(false);
  });
  it("runs real fenced Telegram registration through production factory and sends no stamp", async () => {
    const f = await fixture();
    const sent: unknown[] = [];
    const runtime = await createProductionWorkerRuntimeFactory({
      clientAsyncCapabilities: {
        telegram: {
          sendMessageUrl: new URL("https://telegram.example/sendMessage"),
          transport: {
            request: async (request) => {
              sent.push(request.body);
              return {
                status: 200,
                body: { ok: true, result: { message_id: 42 } },
              };
            },
          },
        },
      },
    }).create({
      databaseUrl: database.db.$client.options.connectionString,
      clientTelegramBotKey: "fence-bot",
      integrations: { payments: false },
      features: { b2TelegramDispatch: true, telegramEgressConsentGate: true },
    } as never);
    try {
      await runtime.runOnce();
    } finally {
      await runtime.close();
    }
    expect(sent).toEqual([
      {
        chat_id: "91001",
        text: "Я помогу с навигацией по сервису. Опишите ваш запрос одним сообщением.",
      },
    ]);
    expect(
      (
        await database.db.execute<{ n: number }>(
          sql`select count(*)::int n from delivery_attempts where outcome='dispatch_consumed'`,
        )
      ).rows[0]!.n,
    ).toBe(1);
    expect(await f.queue.claim(10, "restart", 60_000, 3)).toHaveLength(0);
  });
});
