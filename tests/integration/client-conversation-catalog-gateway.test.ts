import { createHash, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createClientConversationOperationAuthority,
  type ClaimedConversationOperation,
} from "../../packages/application/src/client-conversation-authority.js";
import { frameClientConversationOperation } from "../../packages/application/src/client-conversation-operation-crypto.js";
import {
  ClientCatalogUnauthorizedError,
  createConversationCatalogGateway,
} from "../../packages/application/src/client-catalog-service.js";
import {
  ConversationCatalogRetryableError,
  PostgresClientCatalogRepository,
} from "../../packages/db/src/repositories/client-catalog-repository.js";
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

const token = (label: string) =>
  `hmac-sha256:v1:${createHash("sha256").update(label).digest("hex")}`;

const catalogDigest = (
  userId: string,
  serviceCode = "consultation",
  language = "ru",
) =>
  createHash("sha256")
    .update(`client-catalog-booking-v1\0${userId}\0${serviceCode}\0${language}`)
    .digest("hex");

const receiptDigest = (catalogRequestId: string) => {
  const bytes = Buffer.from(catalogRequestId, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return createHash("sha256")
    .update("ii-tonya/client-conversation-catalog-receipt/v1\0", "utf8")
    .update(length)
    .update(bytes)
    .digest("hex");
};

const authority = createClientConversationOperationAuthority();

type Fixture = Readonly<{
  userId: string;
  bindingId: string;
  operationId: string;
  claimToken: string;
  claim: ClaimedConversationOperation;
  requestDigest: string;
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
      ${bindingId}::uuid,'client_catalog:read',clock_timestamp()+interval '1 hour'
    )
  `);
  const messageEventId = (
    await testDb.db.execute<{ id: string }>(sql`
      insert into message_events (
        user_id,provider,external_message_id,direction
      ) values (
        ${userId}::uuid,'selarti',${`catalog-conversation-${suffix}`},'inbound'
      ) returning id
    `)
  ).rows[0]!.id;
  const operationId = randomUUID();
  const claimToken = randomUUID();
  const keyId = `catalog-${createHash("sha256").update(suffix).digest("hex").slice(0, 16)}`;
  const framed = frameClientConversationOperation({
    operationId,
    messageEventId,
    bindingId,
    keyId,
    payloadExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    proposal: {
      kind: "show_catalog",
      serviceCode: "consultation",
      language: "ru",
    },
  });
  await testDb.db.execute(sql`
    insert into client_conversation_operations (
      id,message_event_id,binding_id,required_scope,tool_kind,proposal_digest,
      payload_envelope_version,payload_key_id,payload_nonce,payload_ciphertext,
      payload_tag,payload_expires_at,status,claim_owner_id,claim_token,
      claim_fence,lease_until,attempt
    ) values (
      ${operationId}::uuid,${messageEventId}::uuid,${bindingId}::uuid,
      'client_catalog:read','show_catalog',${framed.proposalDigest},1,${keyId},
      decode('0102030405060708090a0b0c','hex'),decode('00','hex'),
      decode('00000000000000000000000000000000','hex'),
      transaction_timestamp()+interval '1 hour','processing','catalog-worker',
      ${claimToken}::uuid,1,transaction_timestamp()+interval '5 minutes',1
    )
  `);
  const claim = authority.issuer.issue({
    operationId,
    claimToken,
    claimOwnerId: "catalog-worker",
    claimFence: 1,
    toolKind: "show_catalog",
    requiredScope: "client_catalog:read",
    frozenInput: { serviceCode: "consultation", language: "ru" },
  });
  return {
    userId,
    bindingId,
    operationId,
    claimToken,
    claim,
    requestDigest: catalogDigest(userId),
  };
}

const repository = () => new PostgresClientCatalogRepository(testDb.db);
const gateway = () =>
  createConversationCatalogGateway({ authority, repository: repository() });
const mutationCount = async () =>
  Number(
    (
      await testDb.db.execute<{ count: string }>(
        sql`select count(*)::text count from client_catalog_requests`,
      )
    ).rows[0]!.count,
  );

describe("conversation catalog gateway (real PostgreSQL)", () => {
  it("accepts a genuine claim, preserves local outbox idempotency, and replays the exact receipt", async () => {
    const fixture = await seed("genuine");
    const first = await gateway().request(fixture.claim);
    const second = await gateway().request(fixture.claim);
    const stored = await testDb.db.execute<{
      id: string;
      topic: string;
      requests: string;
      outbox: string;
    }>(sql`
      select r.id,o.topic,
        (select count(*)::text from client_catalog_requests) requests,
        (select count(*)::text from integration_outbox where topic='catalog.show') outbox
      from client_catalog_requests r
      join integration_outbox o on o.idempotency_key='client-catalog:' || r.id::text
    `);
    const expected = receiptDigest(stored.rows[0]!.id);
    expect(first).toEqual({
      kind: "applied",
      downstreamReceiptDigest: expected,
    });
    expect(second).toEqual(first);
    expect(stored.rows[0]).toMatchObject({
      topic: "catalog.show",
      requests: "1",
      outbox: "1",
    });
  });

  it.each([
    [
      "revoked grant",
      async (f: Fixture) =>
        testDb.db.execute(
          sql`update client_conversation_grants set revoked_at=clock_timestamp() where provider_subject_mapping_id=${f.bindingId}::uuid`,
        ),
    ],
    [
      "expired grant",
      async (f: Fixture) =>
        testDb.db.execute(
          sql`update client_conversation_grants set created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour' where provider_subject_mapping_id=${f.bindingId}::uuid`,
        ),
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
            ${f.bindingId}::uuid,'client_booking:write',
            clock_timestamp()+interval '1 hour'
          )
        `);
      },
    ],
    [
      "inactive user",
      async (f: Fixture) =>
        testDb.db.execute(
          sql`update users set active=false where id=${f.userId}::uuid`,
        ),
    ],
    [
      "erased mapping",
      async (f: Fixture) =>
        testDb.db.execute(
          sql`delete from provider_subject_mappings where id=${f.bindingId}::uuid`,
        ),
    ],
    [
      "stale fence",
      async (f: Fixture) =>
        testDb.db.execute(
          sql`update client_conversation_operations set claim_fence=2 where id=${f.operationId}::uuid`,
        ),
    ],
    [
      "expired lease",
      async (f: Fixture) =>
        testDb.db.execute(
          sql`update client_conversation_operations set lease_until=clock_timestamp()-interval '1 second' where id=${f.operationId}::uuid`,
        ),
    ],
  ])("denies %s with no catalog mutation", async (_name, mutate) => {
    const fixture = await seed(randomUUID());
    await mutate(fixture);
    await expect(gateway().request(fixture.claim)).rejects.toBeInstanceOf(
      ClientCatalogUnauthorizedError,
    );
    expect(await mutationCount()).toBe(0);
  });

  it("denies a stored wrong tool/scope pair with no mutation", async () => {
    const fixture = await seed("wrong-tool");
    await testDb.db.execute(sql`
      update client_conversation_operations
      set tool_kind='start_booking',required_scope='client_booking:write'
      where id=${fixture.operationId}::uuid
    `);
    expect(await gateway().request(fixture.claim)).toEqual({
      kind: "rejected",
      code: "conflict",
    });
    expect(await mutationCount()).toBe(0);
  });

  it("denies a wrong provider mapping and a tampered proposal digest", async () => {
    const wrongMapping = await seed("wrong-mapping");
    await testDb.db.execute(sql`
      update provider_subject_mappings
      set provider='other-provider',tenant_token=null,token_version=null
      where id=${wrongMapping.bindingId}::uuid
    `);
    await expect(gateway().request(wrongMapping.claim)).rejects.toBeInstanceOf(
      ClientCatalogUnauthorizedError,
    );

    const tampered = await seed("tampered-proposal");
    await testDb.db.execute(sql`
      update client_conversation_operations set proposal_digest=${"a".repeat(64)}
      where id=${tampered.operationId}::uuid
    `);
    expect(await gateway().request(tampered.claim)).toEqual({
      kind: "rejected",
      code: "conflict",
    });
    expect(await mutationCount()).toBe(0);
  });

  it("rejects a forged claim synchronously before PostgreSQL mutation", async () => {
    const fixture = await seed("forged");
    const forged = { ...fixture.claim } as ClaimedConversationOperation;
    expect(() => gateway().request(forged)).toThrow(
      "client_catalog_unauthorized",
    );
    expect(await mutationCount()).toBe(0);
  });

  it("returns feature_disabled without entering the catalog transaction", async () => {
    const fixture = await seed("disabled");
    const disabled = createConversationCatalogGateway({
      authority,
      repository: new PostgresClientCatalogRepository(testDb.db, {
        conversationCatalogEnabled: false,
      }),
    });
    await expect(disabled.request(fixture.claim)).resolves.toEqual({
      kind: "rejected",
      code: "feature_disabled",
    });
    expect(await mutationCount()).toBe(0);
  });

  it("makes ordinary and conversation requests wait on the identical advisory key", async () => {
    const fixture = await seed("shared-prelock");
    const blocker = await testDb.db.$client.connect();
    try {
      await blocker.query("begin");
      await blocker.query(
        "select pg_advisory_xact_lock(hashtextextended($1 || ':' || $2,0))",
        [fixture.userId, fixture.requestDigest],
      );
      let ordinarySettled = false;
      let conversationSettled = false;
      const ordinary = repository()
        .createOrReplay({
          userId: fixture.userId,
          requestDigest: fixture.requestDigest,
          serviceCode: "consultation",
          language: "ru",
          correlationId: "ordinary-shared-prelock",
          version: 2,
        })
        .finally(() => {
          ordinarySettled = true;
        });
      const conversation = gateway()
        .request(fixture.claim)
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
      expect(conversationResult).toEqual({
        kind: "applied",
        downstreamReceiptDigest: receiptDigest(ordinaryResult.catalogRequestId),
      });
      expect(await mutationCount()).toBe(1);
    } finally {
      blocker.release();
    }
  });

  it("classifies the bounded user-row lock timeout as a pre-call retry", async () => {
    const fixture = await seed("timeout");
    const blocker = await testDb.db.$client.connect();
    try {
      await blocker.query("begin");
      await blocker.query("select id from users where id=$1::uuid for update", [
        fixture.userId,
      ]);
      await expect(gateway().request(fixture.claim)).rejects.toBeInstanceOf(
        ConversationCatalogRetryableError,
      );
      expect(await mutationCount()).toBe(0);
      await blocker.query("rollback");
    } finally {
      blocker.release();
    }
  }, 10_000);

  it.each(["revoke", "deactivate", "erase"] as const)(
    "lets catalog mutation queued first beat %s lifecycle commit without deadlock",
    async (lifecycle) => {
      const fixture = await seed(`lifecycle-${lifecycle}`);
      const blocker = await testDb.db.$client.connect();
      const lifecycleClient = await testDb.db.$client.connect();
      try {
        await blocker.query("begin");
        await blocker.query(
          "select id from users where id=$1::uuid for update",
          [fixture.userId],
        );
        const catalog = gateway().request(fixture.claim);
        await new Promise((resolve) => setTimeout(resolve, 100));
        const lifecycleCommit = (async () => {
          await lifecycleClient.query("begin");
          await lifecycleClient.query(
            "select id from users where id=$1::uuid for update",
            [fixture.userId],
          );
          if (lifecycle === "revoke") {
            await lifecycleClient.query(
              "update client_conversation_grants set revoked_at=clock_timestamp() where provider_subject_mapping_id=$1::uuid",
              [fixture.bindingId],
            );
          } else if (lifecycle === "deactivate") {
            await lifecycleClient.query(
              "update users set active=false where id=$1::uuid",
              [fixture.userId],
            );
          } else {
            await lifecycleClient.query(
              "delete from provider_subject_mappings where id=$1::uuid",
              [fixture.bindingId],
            );
          }
          await lifecycleClient.query("commit");
        })();
        await new Promise((resolve) => setTimeout(resolve, 100));
        await blocker.query("rollback");
        const [result] = await Promise.all([catalog, lifecycleCommit]);
        expect(result).toMatchObject({ kind: "applied" });
        expect(await mutationCount()).toBe(1);
        const state = await testDb.db.execute<{
          active: boolean;
          mappingPresent: boolean;
          revoked: boolean;
        }>(sql`
          select u.active,
            exists(select 1 from provider_subject_mappings where id=${fixture.bindingId}::uuid) as "mappingPresent",
            exists(select 1 from client_conversation_grants where provider_subject_mapping_id=${fixture.bindingId}::uuid and revoked_at is not null) as revoked
          from users u where u.id=${fixture.userId}::uuid
        `);
        expect(
          lifecycle === "revoke"
            ? state.rows[0]!.revoked
            : lifecycle === "deactivate"
              ? state.rows[0]!.active === false
              : state.rows[0]!.mappingPresent === false,
        ).toBe(true);
      } finally {
        await blocker.query("rollback").catch(() => undefined);
        await lifecycleClient.query("rollback").catch(() => undefined);
        blocker.release();
        lifecycleClient.release();
      }
    },
    10_000,
  );
});
