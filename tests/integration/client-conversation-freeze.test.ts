import { createHash, webcrypto } from "node:crypto";

import { sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createClientConversationOperationCrypto,
  type ClientConversationOperationKey,
} from "../../packages/application/src/client-conversation-operation-crypto.js";
import type { ConversationMessageRepository } from "../../packages/application/src/ports.js";
import {
  ConversationOperationNonceCollisionError,
  PostgresMessageRepository,
  type MessageRepositoryOptions,
} from "../../packages/db/src/index.js";
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
const ignoreNonceCollision = (): void => undefined;

const insertBinding = async (
  userId: string,
  suffix: string,
): Promise<string> => {
  const mapping = await testDb.db.execute<{ bindingId: string }>(sql`
    insert into provider_subject_mappings (
      user_id,provider,tenant_token,subject_token,subject_ciphertext,token_version
    ) values (
      ${userId}::uuid,'selarti.client-thread.v1',${token(`tenant-${suffix}`)},
      ${token(`subject-${suffix}`)},'ciphertext',1
    ) returning id as "bindingId"
  `);
  return mapping.rows[0]!.bindingId;
};

const prepare = async (
  repository: PostgresMessageRepository,
  userId: string,
  suffix: string,
) => {
  const inbound = {
    provider: "selarti",
    externalEventId: `freeze-event-${suffix}`,
    externalMessageId: `freeze-message-${suffix}`,
    userId,
    messageClass: "ordinary_inbound" as const,
    occurredAt: new Date(),
    correlationId: `freeze-correlation-${suffix}`,
  };
  return { inbound, prepared: await repository.prepareInbound(inbound) };
};

describe("client conversation operation freeze", () => {
  it("atomically writes one ledger fact, audit fact and encrypted operation without an outbox tool call", async () => {
    const userId = await testDb.createUserWithPackage(1);
    const mapping = await testDb.db.execute<{ bindingId: string }>(sql`
      insert into provider_subject_mappings (
        user_id,provider,tenant_token,subject_token,subject_ciphertext,token_version
      ) values (
        ${userId}::uuid,'selarti.client-thread.v1',${token("tenant")},${token("subject")},'ciphertext',1
      ) returning id as "bindingId"
    `);
    const bindingId = mapping.rows[0]!.bindingId;
    await testDb.db.execute(sql`
      insert into client_conversation_grants (
        provider_subject_mapping_id,scope,expires_at
      ) values (
        ${bindingId}::uuid,'client_catalog:read',clock_timestamp()+interval '1 day'
      )
    `);
    const key: ClientConversationOperationKey = {
      keyId: "freeze-key-1",
      state: "active",
      key: await webcrypto.subtle.importKey(
        "raw",
        Buffer.alloc(32, 7),
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"],
      ),
    };
    const operationCrypto = createClientConversationOperationCrypto({
      activeKey: async () => key,
      keyById: async (keyId) => (keyId === key.keyId ? key : null),
      randomNonce: () => Buffer.from("000102030405060708090a0b", "hex"),
    });
    const options: MessageRepositoryOptions & {
      conversationOperationCrypto: typeof operationCrypto;
    } = {
      conversationOperationCrypto: operationCrypto,
      onConversationOperationNonceCollision: ignoreNonceCollision,
    };
    const repository = new PostgresMessageRepository(testDb.db, options);
    const compatible: ConversationMessageRepository = repository;
    const inbound = {
      provider: "selarti",
      externalEventId: "freeze-event-1",
      externalMessageId: "freeze-message-1",
      userId,
      messageClass: "ordinary_inbound" as const,
      occurredAt: new Date(),
      correlationId: "freeze-correlation-1",
    };
    const prepared = await repository.prepareInbound(inbound);

    const completed = await compatible.completeInbound({
      messageEventId: prepared.messageEventId,
      bindingId,
      userId,
      correlationId: inbound.correlationId,
      outcome: {
        kind: "show_catalog",
        payload: { serviceCode: "consultation", language: "ru" },
      },
    });

    expect(completed).toMatchObject({
      kind: "completed",
      result: { kind: "catalog_requested", chargedMessages: 1 },
    });
    const rows = await testDb.db.execute<{
      operationId: string;
      messageEventId: string;
      bindingId: string;
      toolKind: "show_catalog";
      requiredScope: "client_catalog:read";
      proposalDigest: string;
      envelopeVersion: number;
      keyId: string;
      nonce: Buffer;
      ciphertext: Buffer;
      tag: Buffer;
      payloadExpiresAt: Date | string;
      createdAt: Date | string;
      ledger: string;
      audit: string;
      outbox: string;
    }>(sql`
      select
        o.id as "operationId",o.message_event_id as "messageEventId",
        o.binding_id as "bindingId",o.tool_kind as "toolKind",
        o.required_scope as "requiredScope",o.proposal_digest as "proposalDigest",
        o.payload_envelope_version as "envelopeVersion",o.payload_key_id as "keyId",
        o.payload_nonce as nonce,o.payload_ciphertext as ciphertext,o.payload_tag as tag,
        o.payload_expires_at as "payloadExpiresAt",o.created_at as "createdAt",
        (select count(*)::text from message_ledger_entries l where l.message_event_id=o.message_event_id) as ledger,
        (select count(*)::text from audit_events a where a.object_id=o.message_event_id) as audit,
        (select count(*)::text from integration_outbox x where x.reconciliation_key=${`conversation:${prepared.messageEventId}`}) as outbox
      from client_conversation_operations o
      where o.message_event_id=${prepared.messageEventId}::uuid
    `);
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0]!;
    expect(row).toMatchObject({
      messageEventId: prepared.messageEventId,
      bindingId,
      toolKind: "show_catalog",
      requiredScope: "client_catalog:read",
      envelopeVersion: 1,
      keyId: "freeze-key-1",
      ledger: "1",
      audit: "1",
      outbox: "0",
    });
    const expiryMs = new Date(row.payloadExpiresAt).getTime();
    const createdMs = new Date(row.createdAt).getTime();
    expect(expiryMs).toBeGreaterThan(createdMs);
    expect(expiryMs - createdMs).toBeLessThanOrEqual(24 * 60 * 60_000);
    await expect(
      operationCrypto.decrypt({
        ...row,
        payloadExpiresAt: new Date(row.payloadExpiresAt).toISOString(),
      }),
    ).resolves.toEqual({
      kind: "show_catalog",
      serviceCode: "consultation",
      language: "ru",
    });
  });

  it("rolls back accounting and audit when operation encryption fails", async () => {
    const userId = await testDb.createUserWithPackage(1);
    const bindingId = await insertBinding(userId, "encrypt-failure");
    const repository = new PostgresMessageRepository(testDb.db, {
      conversationOperationCrypto: {
        async encrypt() {
          throw new Error("secret-provider-unavailable");
        },
      },
      onConversationOperationNonceCollision: ignoreNonceCollision,
    });
    const { inbound, prepared } = await prepare(
      repository,
      userId,
      "encrypt-failure",
    );

    await expect(
      repository.completeInbound({
        messageEventId: prepared.messageEventId,
        bindingId,
        userId,
        correlationId: inbound.correlationId,
        outcome: { kind: "show_catalog", payload: {} },
      }),
    ).rejects.toThrow("secret-provider-unavailable");

    expect(await testDb.packageBalance(userId)).toBe(1);
    expect(await testDb.ledgerEntryCount(inbound.externalMessageId)).toBe(0);
    expect(await testDb.auditCountForCorrelation(inbound.correlationId)).toBe(
      0,
    );
    expect(await testDb.outboxCountForCorrelation(inbound.correlationId)).toBe(
      0,
    );
    const operations = await testDb.db.execute<{ count: string }>(sql`
      select count(*)::text as count from client_conversation_operations
      where message_event_id=${prepared.messageEventId}::uuid
    `);
    expect(operations.rows[0]?.count).toBe("0");
  });

  it("rolls back a fully prepared operation when the process fails before completion commit", async () => {
    const userId = await testDb.createUserWithPackage(1);
    const bindingId = await insertBinding(userId, "before-commit");
    const key: ClientConversationOperationKey = {
      keyId: "freeze-key-before-commit",
      state: "active",
      key: await webcrypto.subtle.importKey(
        "raw",
        Buffer.alloc(32, 8),
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"],
      ),
    };
    const operationCrypto = createClientConversationOperationCrypto({
      activeKey: async () => key,
      keyById: async () => key,
      randomNonce: () => Buffer.from("08090a0b0c0d0e0f10111213", "hex"),
    });
    const repository = new PostgresMessageRepository(testDb.db, {
      conversationOperationCrypto: operationCrypto,
      onConversationOperationNonceCollision: ignoreNonceCollision,
      beforeCompleteCommit: async () => {
        throw new Error("process stopped before commit");
      },
    });
    const { inbound, prepared } = await prepare(
      repository,
      userId,
      "before-commit",
    );

    await expect(
      repository.completeInbound({
        messageEventId: prepared.messageEventId,
        bindingId,
        userId,
        correlationId: inbound.correlationId,
        outcome: { kind: "show_catalog", payload: {} },
      }),
    ).rejects.toThrow("process stopped before commit");

    expect(await testDb.packageBalance(userId)).toBe(1);
    expect(await testDb.ledgerEntryCount(inbound.externalMessageId)).toBe(0);
    expect(await testDb.auditCountForCorrelation(inbound.correlationId)).toBe(
      0,
    );
    const operations = await testDb.db.execute<{ count: string }>(sql`
      select count(*)::text as count from client_conversation_operations
      where message_event_id=${prepared.messageEventId}::uuid
    `);
    expect(operations.rows[0]?.count).toBe("0");
  });

  it("keeps one frozen proposal after commit acknowledgement loss and ignores a different retry", async () => {
    const userId = await testDb.createUserWithPackage(1);
    const bindingId = await insertBinding(userId, "ack-loss");
    const key: ClientConversationOperationKey = {
      keyId: "freeze-key-ack",
      state: "active",
      key: await webcrypto.subtle.importKey(
        "raw",
        Buffer.alloc(32, 9),
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"],
      ),
    };
    const operationCrypto = createClientConversationOperationCrypto({
      activeKey: async () => key,
      keyById: async () => key,
      randomNonce: () => Buffer.from("101112131415161718191a1b", "hex"),
    });
    let loseAcknowledgement = true;
    const repository = new PostgresMessageRepository(testDb.db, {
      conversationOperationCrypto: operationCrypto,
      onConversationOperationNonceCollision: ignoreNonceCollision,
      afterCompleteCommit: async () => {
        if (!loseAcknowledgement) return;
        loseAcknowledgement = false;
        throw new Error("commit acknowledgement lost");
      },
    });
    const { inbound, prepared } = await prepare(repository, userId, "ack-loss");

    await expect(
      repository.completeInbound({
        messageEventId: prepared.messageEventId,
        bindingId,
        userId,
        correlationId: inbound.correlationId,
        outcome: {
          kind: "show_catalog",
          payload: { serviceCode: "first" },
        },
      }),
    ).rejects.toThrow("commit acknowledgement lost");
    await expect(
      repository.completeInbound({
        messageEventId: prepared.messageEventId,
        bindingId,
        userId,
        correlationId: inbound.correlationId,
        outcome: {
          kind: "show_catalog",
          payload: { serviceCode: "different" },
        },
      }),
    ).resolves.toEqual({
      kind: "duplicate",
      messageEventId: prepared.messageEventId,
    });

    const facts = await testDb.db.execute<{
      operations: string;
      ledger: string;
      audit: string;
    }>(sql`
      select
        (select count(*)::text from client_conversation_operations where message_event_id=${prepared.messageEventId}::uuid) as operations,
        (select count(*)::text from message_ledger_entries where message_event_id=${prepared.messageEventId}::uuid) as ledger,
        (select count(*)::text from audit_events where object_id=${prepared.messageEventId}::uuid) as audit
    `);
    expect(facts.rows[0]).toEqual({ operations: "1", ledger: "1", audit: "1" });
  });

  it("serializes ten different proposals for one event to one frozen operation", async () => {
    const userId = await testDb.createUserWithPackage(1);
    const bindingId = await insertBinding(userId, "ten-racers");
    const key: ClientConversationOperationKey = {
      keyId: "freeze-key-race",
      state: "active",
      key: await webcrypto.subtle.importKey(
        "raw",
        Buffer.alloc(32, 11),
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"],
      ),
    };
    const operationCrypto = createClientConversationOperationCrypto({
      activeKey: async () => key,
      keyById: async () => key,
      randomNonce: () => Buffer.from("202122232425262728292a2b", "hex"),
    });
    const repository = new PostgresMessageRepository(testDb.db, {
      conversationOperationCrypto: operationCrypto,
      onConversationOperationNonceCollision: ignoreNonceCollision,
    });
    const { inbound, prepared } = await prepare(
      repository,
      userId,
      "ten-racers",
    );

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        repository.completeInbound({
          messageEventId: prepared.messageEventId,
          bindingId,
          userId,
          correlationId: inbound.correlationId,
          outcome: {
            kind: "show_catalog",
            payload: { serviceCode: `service-${index}` },
          },
        }),
      ),
    );

    expect(
      results.filter((result) => result.kind === "completed"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.kind === "duplicate"),
    ).toHaveLength(9);
    const winningIndex = results.findIndex(
      (result) => result.kind === "completed",
    );
    expect(winningIndex).toBeGreaterThanOrEqual(0);
    const facts = await testDb.db.execute<{
      operations: string;
      ledger: string;
      audit: string;
      outbox: string;
    }>(sql`
      select
        (select count(*)::text from client_conversation_operations where message_event_id=${prepared.messageEventId}::uuid) as operations,
        (select count(*)::text from message_ledger_entries where message_event_id=${prepared.messageEventId}::uuid) as ledger,
        (select count(*)::text from audit_events where object_id=${prepared.messageEventId}::uuid) as audit,
        (select count(*)::text from integration_outbox where reconciliation_key=${`conversation:${prepared.messageEventId}`}) as outbox
    `);
    expect(facts.rows[0]).toEqual({
      operations: "1",
      ledger: "1",
      audit: "1",
      outbox: "0",
    });
    const winner = await testDb.db.execute<{
      operationId: string;
      messageEventId: string;
      bindingId: string;
      toolKind: "show_catalog";
      requiredScope: "client_catalog:read";
      proposalDigest: string;
      envelopeVersion: number;
      keyId: string;
      nonce: Buffer;
      ciphertext: Buffer;
      tag: Buffer;
      payloadExpiresAt: Date | string;
    }>(sql`
      select id as "operationId",message_event_id as "messageEventId",
        binding_id as "bindingId",tool_kind as "toolKind",required_scope as "requiredScope",
        proposal_digest as "proposalDigest",payload_envelope_version as "envelopeVersion",
        payload_key_id as "keyId",payload_nonce as nonce,payload_ciphertext as ciphertext,
        payload_tag as tag,payload_expires_at as "payloadExpiresAt"
      from client_conversation_operations where message_event_id=${prepared.messageEventId}::uuid
    `);
    const proposal = await operationCrypto.decrypt({
      ...winner.rows[0]!,
      payloadExpiresAt: new Date(
        winner.rows[0]!.payloadExpiresAt,
      ).toISOString(),
    });
    expect(proposal).toEqual({
      kind: "show_catalog",
      serviceCode: `service-${winningIndex}`,
    });
  });

  it("aborts and alarms instead of retrying a nonce collision for the same key", async () => {
    const userId = await testDb.createUserWithPackage(2);
    const bindingId = await insertBinding(userId, "nonce-collision");
    const key: ClientConversationOperationKey = {
      keyId: "freeze-key-collision",
      state: "active",
      key: await webcrypto.subtle.importKey(
        "raw",
        Buffer.alloc(32, 13),
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"],
      ),
    };
    const operationCrypto = createClientConversationOperationCrypto({
      activeKey: async () => key,
      keyById: async () => key,
      randomNonce: () => Buffer.from("303132333435363738393a3b", "hex"),
    });
    const nonceCollisionAlarm = vi.fn();
    const options: MessageRepositoryOptions & {
      onConversationOperationNonceCollision: () => void;
    } = {
      conversationOperationCrypto: operationCrypto,
      onConversationOperationNonceCollision: nonceCollisionAlarm,
    };
    const repository = new PostgresMessageRepository(testDb.db, options);
    const first = await prepare(repository, userId, "nonce-collision-a");
    const second = await prepare(repository, userId, "nonce-collision-b");
    const outcome = { kind: "show_catalog" as const, payload: {} };

    await repository.completeInbound({
      messageEventId: first.prepared.messageEventId,
      bindingId,
      userId,
      correlationId: first.inbound.correlationId,
      outcome,
    });
    const error = await repository
      .completeInbound({
        messageEventId: second.prepared.messageEventId,
        bindingId,
        userId,
        correlationId: second.inbound.correlationId,
        outcome,
      })
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(ConversationOperationNonceCollisionError);
    expect(error).toMatchObject({
      code: "conversation_operation_nonce_collision",
      message: "Client conversation operation nonce collision",
    });
    expect(JSON.stringify(error)).not.toContain(
      "client_conversation_operations_nonce_unique",
    );
    expect(nonceCollisionAlarm).toHaveBeenCalledTimes(1);
    expect(await testDb.packageBalance(userId)).toBe(1);
    expect(
      await testDb.ledgerEntryCount(second.inbound.externalMessageId),
    ).toBe(0);
    expect(
      await testDb.auditCountForCorrelation(second.inbound.correlationId),
    ).toBe(0);
  });
});
