import { createHash, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createClientConversationOperationAuthority,
  type ClaimedConversationOperation,
} from "../../packages/application/src/client-conversation-authority.js";
import { frameClientConversationOperation } from "../../packages/application/src/client-conversation-operation-crypto.js";
import { createConversationBookingGateway } from "../../packages/application/src/client-booking-service.js";
import {
  ConversationBookingRetryableError,
  PostgresBookingRepository,
} from "../../packages/db/src/repositories/booking-repository.js";
import { PostgresClientCatalogRepository } from "../../packages/db/src/repositories/client-catalog-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
}, 120_000);
beforeEach(async () => testDb.reset());
afterAll(async () => testDb?.stop(), 60_000);

const lp = (value: string): Buffer => {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
};

const token = (label: string) =>
  `hmac-sha256:v1:${createHash("sha256").update(label).digest("hex")}`;
const choiceDigestFor = (choiceHandle: string) =>
  `sha256:${createHash("sha256").update(choiceHandle).digest("hex")}` as const;
const expectedBookingHandle = (operationId: string, choiceDigest: string) =>
  `bk1.${createHash("sha256")
    .update("ii-tonya/client-conversation-booking-handle/v1\0", "utf8")
    .update(lp(operationId))
    .update(lp(choiceDigest))
    .digest("base64url")}` as const;
const expectedReceipt = (bookingHandle: string) =>
  createHash("sha256")
    .update("ii-tonya/client-conversation-booking-receipt/v1\0", "utf8")
    .update(lp(bookingHandle))
    .digest("hex");

const authority = createClientConversationOperationAuthority();

type Fixture = Readonly<{
  userId: string;
  bindingId: string;
  operationId: string;
  claim: ClaimedConversationOperation;
  choiceHandle: `ch1.${string}`;
  choiceDigest: `sha256:${string}`;
}>;

async function seed(suffix: string): Promise<Fixture> {
  const userId = (
    await testDb.db.execute<{ id: string }>(
      sql`insert into users default values returning id`,
    )
  ).rows[0]!.id;
  const bindingId = (
    await testDb.db.execute<{ id: string }>(sql`
      insert into provider_subject_mappings (
        user_id,provider,tenant_token,subject_token,subject_ciphertext,token_version
      ) values (
        ${userId}::uuid,'selarti.client-thread.v1',${token(`tenant-${suffix}`)},
        ${token(`subject-${suffix}`)},'ciphertext',1
      ) returning id
    `)
  ).rows[0]!.id;
  await testDb.db.execute(sql`
    insert into client_conversation_grants (
      provider_subject_mapping_id,scope,expires_at
    ) values (
      ${bindingId}::uuid,'client_booking:write',clock_timestamp()+interval '1 hour'
    )
  `);

  const expertUserId = (
    await testDb.db.execute<{ id: string }>(
      sql`insert into users default values returning id`,
    )
  ).rows[0]!.id;
  const expertId = randomUUID();
  const serviceId = randomUUID();
  const slotId = randomUUID();
  await testDb.db.execute(sql`
    insert into experts (id,user_id,public_display_name,active,verified)
    values (${expertId}::uuid,${expertUserId}::uuid,'Expert',true,true)
  `);
  await testDb.db.execute(sql`
    insert into expert_services (
      id,expert_id,name,code,language,active,duration_minutes
    ) values (
      ${serviceId}::uuid,${expertId}::uuid,'Career','career','ru',true,60
    )
  `);
  await testDb.db.execute(sql`
    insert into slots (
      id,expert_service_id,provider,external_slot_id,starts_at,ends_at,
      observed_at,capacity
    ) values (
      ${slotId}::uuid,${serviceId}::uuid,'local',${`conversation-${suffix}`},
      clock_timestamp()+interval '48 hours',
      clock_timestamp()+interval '49 hours',clock_timestamp(),1
    )
  `);
  const requestId = (
    await testDb.db.execute<{ id: string }>(sql`
      insert into client_catalog_requests (user_id,request_digest,state)
      values (${userId}::uuid,${createHash("sha256").update(suffix).digest("hex")},'ready')
      returning id
    `)
  ).rows[0]!.id;
  const choiceHandle = `ch1.${createHash("sha256")
    .update(`choice-${suffix}`)
    .digest("base64url")}` as const;
  const choiceDigest = choiceDigestFor(choiceHandle);
  await testDb.db.execute(sql`
    insert into client_catalog_choices (
      request_id,choice_digest,slot_id,expires_at
    ) values (
      ${requestId}::uuid,${choiceDigest},${slotId}::uuid,
      clock_timestamp()+interval '10 minutes'
    )
  `);

  const messageEventId = (
    await testDb.db.execute<{ id: string }>(sql`
      insert into message_events (
        user_id,provider,external_message_id,direction
      ) values (
        ${userId}::uuid,'selarti',${`booking-conversation-${suffix}`},'inbound'
      ) returning id
    `)
  ).rows[0]!.id;
  const operationId = randomUUID();
  const claimToken = randomUUID();
  const keyId = `booking-${createHash("sha256").update(suffix).digest("hex").slice(0, 16)}`;
  const framed = frameClientConversationOperation({
    operationId,
    messageEventId,
    bindingId,
    keyId,
    payloadExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    proposal: { kind: "start_booking", choiceHandle },
  });
  await testDb.db.execute(sql`
    insert into client_conversation_operations (
      id,message_event_id,binding_id,required_scope,tool_kind,proposal_digest,
      payload_envelope_version,payload_key_id,payload_nonce,payload_ciphertext,
      payload_tag,payload_expires_at,status,claim_owner_id,claim_token,
      claim_fence,lease_until,attempt
    ) values (
      ${operationId}::uuid,${messageEventId}::uuid,${bindingId}::uuid,
      'client_booking:write','start_booking',${framed.proposalDigest},1,${keyId},
      decode(${createHash("sha256").update(`nonce-${suffix}`).digest("hex").slice(0, 24)},'hex'),
      decode('00','hex'),decode('00000000000000000000000000000000','hex'),
      transaction_timestamp()+interval '1 hour','processing','booking-worker',
      ${claimToken}::uuid,1,transaction_timestamp()+interval '5 minutes',1
    )
  `);
  return {
    userId,
    bindingId,
    operationId,
    choiceHandle,
    choiceDigest,
    claim: authority.issuer.issue({
      operationId,
      claimToken,
      claimOwnerId: "booking-worker",
      claimFence: 1,
      toolKind: "start_booking",
      requiredScope: "client_booking:write",
      frozenInput: { choiceHandle },
    }),
  };
}

const repository = (enabled = true) =>
  new PostgresBookingRepository(testDb.db, {
    retryDelayMs: () => 0,
    conversationBookingEnabled: enabled,
  });
const gateway = (enabled = true) =>
  createConversationBookingGateway({
    authority,
    repository: repository(enabled),
  });

const counts = async () =>
  (
    await testDb.db.execute<{
      reservations: string;
      receipts: string;
      audits: string;
      outbox: string;
      deliveries: string;
    }>(sql`
      select
        (select count(*)::text from reservations) reservations,
        (select count(*)::text from client_booking_receipts) receipts,
        (select count(*)::text from audit_events where action='reservation.reserve') audits,
        (select count(*)::text from integration_outbox where topic in ('planerka.reserve','telegram.reservation_request')) outbox,
        (select count(*)::text from delivery_attempts) deliveries
    `)
  ).rows[0]!;

async function runLifecycle(
  fixture: Fixture,
  kind: "revoke" | "deactivate" | "erase",
): Promise<void> {
  const { lockClientConversationLifecycle } =
    await import("../../packages/db/src/repositories/client-conversation-lifecycle-locks.js");
  await testDb.db.transaction(async (tx) => {
    await lockClientConversationLifecycle(tx, fixture.userId);
    if (kind === "revoke") {
      await tx.execute(sql`
        update client_conversation_grants set revoked_at=clock_timestamp()
        where provider_subject_mapping_id=${fixture.bindingId}::uuid
          and scope='client_booking:write'
      `);
    } else if (kind === "deactivate") {
      await tx.execute(sql`
        update users set active=false where id=${fixture.userId}::uuid
      `);
    } else {
      await tx.execute(sql`
        delete from provider_subject_mappings where id=${fixture.bindingId}::uuid
      `);
    }
  });
}

describe("conversation booking gateway (real PostgreSQL)", () => {
  it("reserves once, replays one protected receipt, and never executes a provider", async () => {
    const fixture = await seed("genuine");
    const first = await gateway().reserve(fixture.claim);
    const second = await gateway().reserve(fixture.claim);
    const receipt = (
      await testDb.db.execute<{ bookingHandle: string }>(sql`
        select booking_handle as "bookingHandle" from client_booking_receipts
      `)
    ).rows[0]!;
    const bookingHandle = expectedBookingHandle(
      fixture.operationId,
      fixture.choiceDigest,
    );
    expect(receipt.bookingHandle).toBe(bookingHandle);
    expect(first).toEqual({
      kind: "applied",
      downstreamReceiptDigest: expectedReceipt(bookingHandle),
    });
    expect(second).toEqual(first);
    expect(await counts()).toEqual({
      reservations: "1",
      receipts: "1",
      audits: "1",
      outbox: "2",
      deliveries: "0",
    });
  });

  it.each(["revoke", "deactivate", "erase"] as const)(
    "denies when %s lifecycle commits first",
    async (kind) => {
      const fixture = await seed(`first-${kind}`);
      await runLifecycle(fixture, kind);
      await expect(gateway().reserve(fixture.claim)).resolves.toEqual({
        kind: "rejected",
        code: "not_found",
      });
      expect(await counts()).toMatchObject({
        reservations: "0",
        receipts: "0",
      });
    },
  );

  it.each([
    [
      "expired grant",
      async (f: Fixture) =>
        testDb.db.execute(sql`
          update client_conversation_grants
          set created_at=clock_timestamp()-interval '2 hours',
            expires_at=clock_timestamp()-interval '1 hour'
          where provider_subject_mapping_id=${f.bindingId}::uuid
        `),
      "not_found",
    ],
    [
      "wrong grant",
      async (f: Fixture) => {
        await testDb.db.execute(sql`
          delete from client_conversation_grants
          where provider_subject_mapping_id=${f.bindingId}::uuid
        `);
        return testDb.db.execute(sql`
          insert into client_conversation_grants (
            provider_subject_mapping_id,scope,expires_at
          ) values (
            ${f.bindingId}::uuid,'client_catalog:read',
            clock_timestamp()+interval '1 hour'
          )
        `);
      },
      "not_found",
    ],
    [
      "wrong mapping",
      async (f: Fixture) =>
        testDb.db.execute(sql`
          update provider_subject_mappings
          set provider='other-provider',tenant_token=null,token_version=null
          where id=${f.bindingId}::uuid
        `),
      "not_found",
    ],
    [
      "stale fence",
      async (f: Fixture) =>
        testDb.db.execute(sql`
          update client_conversation_operations set claim_fence=2
          where id=${f.operationId}::uuid
        `),
      "conflict",
    ],
    [
      "expired lease",
      async (f: Fixture) =>
        testDb.db.execute(sql`
          update client_conversation_operations
          set lease_until=clock_timestamp()-interval '1 second'
          where id=${f.operationId}::uuid
        `),
      "conflict",
    ],
  ])("denies %s before booking mutation", async (_name, mutate, code) => {
    const fixture = await seed(randomUUID());
    await mutate(fixture);
    await expect(gateway().reserve(fixture.claim)).resolves.toEqual({
      kind: "rejected",
      code,
    });
    expect(await counts()).toMatchObject({ reservations: "0", receipts: "0" });
  });

  it("denies wrong tool/scope and proposal digest before booking", async () => {
    const wrongTool = await seed("wrong-tool");
    await testDb.db.execute(sql`
      update client_conversation_operations
      set tool_kind='show_catalog',required_scope='client_catalog:read'
      where id=${wrongTool.operationId}::uuid
    `);
    await expect(gateway().reserve(wrongTool.claim)).resolves.toEqual({
      kind: "rejected",
      code: "conflict",
    });

    const tampered = await seed("tampered-proposal");
    await testDb.db.execute(sql`
      update client_conversation_operations set proposal_digest=${"a".repeat(64)}
      where id=${tampered.operationId}::uuid
    `);
    await expect(gateway().reserve(tampered.claim)).resolves.toEqual({
      kind: "rejected",
      code: "conflict",
    });
    expect(await counts()).toMatchObject({ reservations: "0", receipts: "0" });
  });

  it("rejects forgery synchronously and feature disablement before mutation", async () => {
    const fixture = await seed("forged-disabled");
    expect(() =>
      gateway().reserve({ ...fixture.claim } as ClaimedConversationOperation),
    ).toThrow("client_booking_unauthorized");
    await expect(gateway(false).reserve(fixture.claim)).resolves.toEqual({
      kind: "rejected",
      code: "feature_disabled",
    });
    expect(await counts()).toMatchObject({ reservations: "0", receipts: "0" });
  });

  it("makes ordinary and conversation reserve wait on the identical choice key", async () => {
    const fixture = await seed("shared-prelock");
    const blocker = await testDb.db.$client.connect();
    try {
      await blocker.query("begin");
      await blocker.query(
        "select pg_advisory_xact_lock(hashtextextended('choice:' || $1,0))",
        [fixture.choiceDigest],
      );
      let ordinarySettled = false;
      let conversationSettled = false;
      const ordinary = repository()
        .reserveProtectedChoice({
          userId: fixture.userId,
          choiceDigest: fixture.choiceDigest,
          idempotencyKey: createHash("sha256")
            .update(
              `client-booking-reserve-v1\0${fixture.userId}\0${fixture.choiceDigest}`,
            )
            .digest("hex"),
          bookingHandle: `bk1.${"O".repeat(43)}`,
          correlationId: "ordinary-shared-choice",
          minimumLeadMs: 86_400_000,
          slotFreshnessMs: 900_000,
          confirmationBufferMs: 3_600_000,
        })
        .finally(() => {
          ordinarySettled = true;
        });
      const conversation = gateway()
        .reserve(fixture.claim)
        .finally(() => {
          conversationSettled = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect({ ordinarySettled, conversationSettled }).toEqual({
        ordinarySettled: false,
        conversationSettled: false,
      });
      await blocker.query("rollback");
      const [ordinaryResult, conversationResult] = await Promise.all([
        ordinary,
        conversation,
      ]);
      expect(["reserved", "replayed"]).toContain(ordinaryResult.kind);
      const stored = (
        await testDb.db.execute<{ bookingHandle: string }>(sql`
          select booking_handle as "bookingHandle" from client_booking_receipts
        `)
      ).rows[0]!;
      expect(conversationResult).toEqual({
        kind: "applied",
        downstreamReceiptDigest: expectedReceipt(stored.bookingHandle),
      });
      expect(await counts()).toMatchObject({
        reservations: "1",
        receipts: "1",
      });
    } finally {
      blocker.release();
    }
  });

  it("bounds and normalizes contention on the conversation choice prelock", async () => {
    const fixture = await seed("bounded-choice-prelock");
    const blocker = await testDb.db.$client.connect();
    try {
      await blocker.query("begin");
      await blocker.query(
        "select pg_advisory_xact_lock(hashtextextended('choice:' || $1,0))",
        [fixture.choiceDigest],
      );

      const startedAt = Date.now();
      const request = gateway()
        .reserve(fixture.claim)
        .then(
          (result) => ({ kind: "resolved" as const, result }),
          (error: unknown) => ({ kind: "rejected" as const, error }),
        );
      const bounded = await Promise.race([
        request,
        new Promise<{ kind: "timed_out" }>((resolve) =>
          setTimeout(() => resolve({ kind: "timed_out" }), 3_500),
        ),
      ]);
      const elapsedMs = Date.now() - startedAt;

      await blocker.query("rollback");
      await request;

      expect(bounded.kind).toBe("rejected");
      if (bounded.kind !== "rejected") return;
      expect(bounded.error).toBeInstanceOf(ConversationBookingRetryableError);
      expect(elapsedMs).toBeLessThan(3_500);
      expect(await counts()).toMatchObject({
        reservations: "0",
        receipts: "0",
      });
    } finally {
      await blocker.query("rollback").catch(() => undefined);
      blocker.release();
    }
  }, 10_000);

  it("does not let catalog choice cleanup cross an in-flight booking prelock", async () => {
    const fixture = await seed("cleanup-prelock");
    let releasePrelock!: () => void;
    let prelockStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      prelockStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releasePrelock = resolve;
    });
    const bookingRepository = new PostgresBookingRepository(testDb.db, {
      retryDelayMs: () => 0,
      afterProtectedChoicePrelock: async () => {
        prelockStarted();
        await release;
      },
    });
    const booking = bookingRepository.reserveProtectedChoice({
      userId: fixture.userId,
      choiceDigest: fixture.choiceDigest,
      idempotencyKey: "d".repeat(64),
      bookingHandle: `bk1.${"D".repeat(43)}`,
      correlationId: "cleanup-booking",
      minimumLeadMs: 86_400_000,
      slotFreshnessMs: 900_000,
      confirmationBufferMs: 3_600_000,
    });
    await started;
    await testDb.db.execute(sql`
      update client_catalog_requests set
        created_at=clock_timestamp()-interval '2 days',
        expires_at=clock_timestamp()-interval '1 second',
        updated_at=clock_timestamp()
      where user_id=${fixture.userId}::uuid
    `);
    let cleanupSettled = false;
    const cleanup = new PostgresClientCatalogRepository(testDb.db)
      .expireDue({ now: new Date(), limit: 10 })
      .finally(() => {
        cleanupSettled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(cleanupSettled).toBe(false);
    releasePrelock();
    await expect(booking).resolves.toEqual({ kind: "not_found" });
    await expect(cleanup).resolves.toMatchObject({ expired: 1 });
  });

  it("classifies a bounded user lock timeout as retryable before booking", async () => {
    const fixture = await seed("timeout");
    const blocker = await testDb.db.$client.connect();
    try {
      await blocker.query("begin");
      await blocker.query("select id from users where id=$1::uuid for update", [
        fixture.userId,
      ]);
      await expect(gateway().reserve(fixture.claim)).rejects.toBeInstanceOf(
        ConversationBookingRetryableError,
      );
      expect(await counts()).toMatchObject({
        reservations: "0",
        receipts: "0",
      });
      await blocker.query("rollback");
    } finally {
      blocker.release();
    }
  }, 10_000);

  it.each(["revoke", "deactivate", "erase"] as const)(
    "lets booking queued first beat %s lifecycle commit without deadlock",
    async (kind) => {
      const fixture = await seed(`during-${kind}`);
      const blocker = await testDb.db.$client.connect();
      try {
        await blocker.query("begin");
        await blocker.query(
          "select id from users where id=$1::uuid for update",
          [fixture.userId],
        );
        const booking = gateway().reserve(fixture.claim);
        await new Promise((resolve) => setTimeout(resolve, 100));
        const lifecycle = runLifecycle(fixture, kind);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await blocker.query("rollback");
        const [result] = await Promise.all([booking, lifecycle]);
        expect(result).toMatchObject({ kind: "applied" });
        expect(await counts()).toMatchObject({
          reservations: "1",
          receipts: "1",
        });
      } finally {
        await blocker.query("rollback").catch(() => undefined);
        blocker.release();
      }
    },
    10_000,
  );
});
