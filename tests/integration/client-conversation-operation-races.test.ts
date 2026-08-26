import { createHash, webcrypto } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import {
  ClientConversationOperationCryptoError,
  createClientConversationOperationCrypto,
  type ClientConversationOperationKey,
} from "../../packages/application/src/client-conversation-operation-crypto.js";
import { createClientConversationOperationAuthority } from "../../packages/application/src/client-conversation-authority.js";
import { PostgresClientConversationOperationRepository } from "../../packages/db/src/repositories/client-conversation-operation-repository.js";

let db: TestDatabase;
const token = (s: string) =>
  `hmac-sha256:v1:${createHash("sha256").update(s).digest("hex")}`;
const key: ClientConversationOperationKey = {
  keyId: "race-key",
  state: "active",
  key: await webcrypto.subtle.importKey(
    "raw",
    Buffer.alloc(32, 9),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  ),
};
const crypto = createClientConversationOperationCrypto({
  activeKey: async () => key,
  keyById: async (id) => (id === key.keyId ? key : null),
  randomNonce: () => Buffer.from("0102030405060708090a0b0c", "hex"),
});
const authority = createClientConversationOperationAuthority();
const repo = () =>
  new PostgresClientConversationOperationRepository(db.db, crypto, authority);
const expectedResultDigest = (
  operationId: string,
  toolKind: string,
  outcomeCode: string,
  receipt: string,
) => {
  const lp = (value: string) => {
    const bytes = Buffer.from(value, "utf8");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    return Buffer.concat([length, bytes]);
  };
  return createHash("sha256")
    .update(
      Buffer.concat([
        Buffer.from("ii-tonya/client-conversation-result/v1\0", "utf8"),
        lp(operationId),
        lp(toolKind),
        lp(outcomeCode),
        lp(receipt),
      ]),
    )
    .digest("hex");
};
async function seed(
  suffix: string,
  status = "pending",
  expiry = "1 hour",
  attempt = 0,
) {
  const user = (
    await db.db.execute<{ id: string }>(
      sql`insert into users default values returning id`,
    )
  ).rows[0]!.id;
  const binding = (
    await db.db.execute<{ id: string }>(
      sql`insert into provider_subject_mappings(user_id,provider,tenant_token,subject_token,subject_ciphertext,token_version)values(${user}::uuid,'selarti.client-thread.v1',${token("t" + suffix)},${token("s" + suffix)},'x',1)returning id`,
    )
  ).rows[0]!.id;
  const event = (
    await db.db.execute<{ id: string }>(
      sql`insert into message_events(user_id,provider,external_message_id,direction)values(${user}::uuid,'selarti',${"event-" + suffix},'inbound')returning id`,
    )
  ).rows[0]!.id;
  const operation = (
    await db.db.execute<{ id: string }>(
      sql`insert into client_conversation_operations(message_event_id,binding_id,required_scope,tool_kind,proposal_digest,payload_envelope_version,payload_key_id,payload_nonce,payload_ciphertext,payload_tag,payload_expires_at,status,attempt)values(${event}::uuid,${binding}::uuid,'client_catalog:read','show_catalog',${"0".repeat(64)},1,${key.keyId},decode('0102030405060708090a0b0c','hex'),decode('00','hex'),decode('00000000000000000000000000000000','hex'),transaction_timestamp()+interval '1 hour','pending',${attempt})returning id`,
    )
  ).rows[0]!.id;
  if (status === "processing") {
    await db.db.execute(
      sql`update client_conversation_operations set status='processing',claim_owner_id='seed',claim_token=gen_random_uuid(),lease_until=transaction_timestamp()+interval '30 minutes' where id=${operation}::uuid`,
    );
  }
  if (expiry.startsWith("-")) {
    await db.db.execute(
      sql`update client_conversation_operations set created_at=transaction_timestamp()-interval '2 hours',payload_expires_at=transaction_timestamp()-interval '1 second',updated_at=transaction_timestamp() where id=${operation}::uuid`,
    );
  }
  const framed = await crypto.encrypt({
    operationId: operation,
    messageEventId: event,
    bindingId: binding,
    payloadExpiresAt: new Date(
      String(
        (
          await db.db.execute<{ v: string }>(
            sql`select payload_expires_at v from client_conversation_operations where id=${operation}::uuid`,
          )
        ).rows[0]!.v,
      ),
    ).toISOString(),
    proposal: {
      kind: "show_catalog",
      serviceCode: "consultation",
      language: "ru",
    },
  });
  await db.db.execute(
    sql`update client_conversation_operations set proposal_digest=${framed.proposalDigest},payload_nonce=${framed.nonce},payload_ciphertext=${framed.ciphertext},payload_tag=${framed.tag} where id=${operation}::uuid`,
  );
  return operation;
}
beforeAll(async () => {
  db = await startTestPostgres();
  await db.migrate();
}, 120000);
beforeEach(async () => db.reset());
afterAll(async () => db.stop(), 60000);

describe("client conversation operation races (real PostgreSQL)", () => {
  it("claims exactly once under concurrent dispatch", async () => {
    await seed("one");
    const [a, b] = await Promise.all([
      repo().claimDispatch({ ownerId: "a", limit: 1 }),
      repo().claimDispatch({ ownerId: "b", limit: 1 }),
    ]);
    expect(a.length + b.length).toBe(1);
    const r = await db.db.execute<{
      status: string;
      attempt: number;
      claimFence: number;
    }>(
      sql`select status,attempt,claim_fence "claimFence" from client_conversation_operations`,
    );
    expect({
      ...r.rows[0],
      claimFence: Number(r.rows[0]?.claimFence),
    }).toMatchObject({
      status: "processing",
      attempt: 1,
      claimFence: 1,
    });
  });
  it("issues genuine authority claims and rejects stale fences", async () => {
    await seed("two");
    const c = (await repo().claimDispatch({ ownerId: "worker", limit: 1 }))[0]!;
    expect(authority.catalog.read(c.claim)).not.toBeNull();
    expect(
      await repo().recordResult(
        { ...c, claimFence: c.claimFence + 1 },
        { kind: "applied", downstreamReceiptDigest: "a".repeat(64) },
      ),
    ).toBe("stale");
  });
  it("dead-letters tampered crypto and clears it with one operator case", async () => {
    const id = await seed("three");
    await db.db.execute(
      sql`update client_conversation_operations set payload_ciphertext=decode('ff','hex') where id=${id}::uuid`,
    );
    expect(
      await repo().claimDispatch({ ownerId: "worker", limit: 1 }),
    ).toHaveLength(0);
    const r = await db.db.execute<{
      status: string;
      terminalReason: string;
      cases: string;
      ciphertext: Buffer | null;
    }>(
      sql`select status,terminal_reason "terminalReason",payload_ciphertext ciphertext,(select count(*)::text from client_conversation_operation_cases where operation_id=${id}::uuid)cases from client_conversation_operations where id=${id}::uuid`,
    );
    expect(r.rows[0]).toMatchObject({
      status: "dead_letter",
      terminalReason: "crypto_invalid",
      cases: "1",
      ciphertext: null,
    });
  });
  it("cannot terminalize a validation failure after recovery wins its expired lease", async () => {
    const id = await seed("validation-recovery");
    let releaseDecrypt!: () => void;
    let decryptStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      decryptStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseDecrypt = resolve;
    });
    const blocked = new PostgresClientConversationOperationRepository(
      db.db,
      {
        async decrypt() {
          decryptStarted();
          await release;
          throw new ClientConversationOperationCryptoError();
        },
      },
      authority,
    );
    const claiming = blocked.claimDispatch({ ownerId: "blocked", limit: 1 });
    await started;
    const recovery = (async () => {
      await db.db.execute(
        sql`update client_conversation_operations set lease_until=transaction_timestamp()-interval '1 second' where id=${id}::uuid`,
      );
      return repo().recoverExpired({ limit: 1 });
    })();
    const recoveryWon = await Promise.race([
      recovery.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 500)),
    ]);
    releaseDecrypt();
    await claiming;
    await recovery;
    const row = await db.db.execute<{
      status: string;
      cases: string;
      ciphertext: Buffer | null;
    }>(
      sql`select status,payload_ciphertext ciphertext,(select count(*)::text from client_conversation_operation_cases where operation_id=${id}::uuid)cases from client_conversation_operations where id=${id}::uuid`,
    );
    expect(recoveryWon).toBe(true);
    expect(row.rows[0]).toMatchObject({
      status: "unknown_outcome",
      cases: "0",
    });
    expect(row.rows[0]?.ciphertext).not.toBeNull();
  });
  it("recovers expired processing and claims reconciliation", async () => {
    await seed("four", "processing", "1 hour");
    await db.db.execute(
      sql`update client_conversation_operations set lease_until=transaction_timestamp()-interval '1 second',claim_owner_id='old',claim_token=gen_random_uuid() where status='processing'`,
    );
    expect((await repo().recoverExpired({ limit: 1 })).recovered).toBe(1);
    expect(
      (await repo().claimReconciliation({ ownerId: "recon", limit: 1 })).length,
    ).toBe(1);
  });
  it("records applied and every business rejection as succeeded with exact digest and clears crypto", async () => {
    for (const [i, result] of [
      "applied",
      "not_found",
      "conflict",
      "feature_disabled",
    ].entries()) {
      const id = await seed("result" + i);
      const c = (
        await repo().claimDispatch({ ownerId: "worker", limit: 1 })
      )[0]!;
      const value =
        result === "applied"
          ? {
              kind: "applied" as const,
              downstreamReceiptDigest: "b".repeat(64),
            }
          : {
              kind: "rejected" as const,
              code: result as "not_found" | "conflict" | "feature_disabled",
            };
      expect(await repo().recordResult(c, value)).toBe("committed");
      const r = await db.db.execute<{
        status: string;
        ciphertext: Buffer | null;
        resultDigest: string;
      }>(
        sql`select status,payload_ciphertext ciphertext,result_digest "resultDigest" from client_conversation_operations where id=${id}::uuid`,
      );
      expect(r.rows[0]).toMatchObject({
        status: "succeeded",
        ciphertext: null,
        resultDigest: expectedResultDigest(
          id,
          "show_catalog",
          result,
          result === "applied" ? "b".repeat(64) : "",
        ),
      });
    }
  });
  it("rejects a hostile business result without writing", async () => {
    const id = await seed("hostile-result");
    const claim = (
      await repo().claimDispatch({ ownerId: "worker", limit: 1 })
    )[0]!;
    expect(
      await repo().recordResult(claim, {
        kind: "rejected",
        code: "arbitrary",
      } as never),
    ).toBe("stale");
    const row = await db.db.execute<{ status: string; digest: string | null }>(
      sql`select status,result_digest digest from client_conversation_operations where id=${id}::uuid`,
    );
    expect(row.rows[0]).toEqual({ status: "processing", digest: null });
  });
  it("rejects a result write after its lease expires", async () => {
    const id = await seed("expired-result");
    const claim = (
      await repo().claimDispatch({ ownerId: "worker", limit: 1 })
    )[0]!;
    await db.db.execute(
      sql`update client_conversation_operations set lease_until=transaction_timestamp()-interval '1 second' where id=${id}::uuid`,
    );
    expect(
      await repo().recordResult(claim, {
        kind: "applied",
        downstreamReceiptDigest: "c".repeat(64),
      }),
    ).toBe("stale");
    const row = await db.db.execute<{ status: string; digest: string | null }>(
      sql`select status,result_digest digest from client_conversation_operations where id=${id}::uuid`,
    );
    expect(row.rows[0]).toEqual({ status: "processing", digest: null });
  });
  it("cleanup expires with two cases and heartbeat creates two leases", async () => {
    const id = await seed("cleanup", "pending", "-1 second");
    expect((await repo().cleanupExpired({ limit: 1 })).expired).toBe(1);
    const r = await db.db.execute<{ status: string; cases: string }>(
      sql`select status,(select count(*)::text from client_conversation_operation_cases where operation_id=${id}::uuid)cases from client_conversation_operations where id=${id}::uuid`,
    );
    expect(r.rows[0]).toMatchObject({ status: "privacy_expired", cases: "2" });
    await repo().heartbeatRuntime({
      instanceId: "runtime",
      buildSha: "a".repeat(40),
    });
    const leases = await db.db.execute<{
      capability: string;
      contractVersion: number;
      buildSha: string;
      seconds: string;
    }>(
      sql`select capability,contract_version "contractVersion",build_sha "buildSha",extract(epoch from lease_until-heartbeat_at)::text seconds from client_conversation_runtime_leases where instance_id='runtime' order by capability`,
    );
    expect(leases.rows).toEqual([
      {
        capability: "cleanup_v1",
        contractVersion: 1,
        buildSha: "a".repeat(40),
        seconds: "30.000000",
      },
      {
        capability: "dispatch_v1",
        contractVersion: 1,
        buildSha: "a".repeat(40),
        seconds: "30.000000",
      },
    ]);
  });
  it("dead-letters an attempt-five retry with one operator case", async () => {
    const id = await seed("attempt-five", "pending", "1 hour", 4);
    const claim = (
      await repo().claimDispatch({ ownerId: "worker", limit: 1 })
    )[0]!;
    await db.db.execute(
      sql`update client_conversation_operations set attempt=5 where id=${id}::uuid`,
    );
    expect(await repo().recordRetryWait(claim)).toBe("committed");
    const row = await db.db.execute<{
      status: string;
      reason: string;
      cases: string;
    }>(
      sql`select status,terminal_reason reason,(select count(*)::text from client_conversation_operation_cases where operation_id=${id}::uuid) cases from client_conversation_operations where id=${id}::uuid`,
    );
    expect(row.rows[0]).toMatchObject({
      status: "dead_letter",
      reason: "attempts_exhausted",
      cases: "1",
    });
  });
  it("dead-letters a fifth reconciliation failure with one operator case", async () => {
    const id = await seed("reconciliation-five");
    await db.db.execute(
      sql`update client_conversation_operations set status='unknown_outcome',reconciliation_attempt=4 where id=${id}::uuid`,
    );
    const claim = (
      await repo().claimReconciliation({ ownerId: "recon", limit: 1 })
    )[0]!;
    expect(await repo().recordUnknownOutcome(claim)).toBe("committed");
    const row = await db.db.execute<{
      status: string;
      reason: string;
      cases: string;
    }>(
      sql`select status,terminal_reason reason,(select count(*)::text from client_conversation_operation_cases where operation_id=${id}::uuid)cases from client_conversation_operations where id=${id}::uuid`,
    );
    expect(row.rows[0]).toEqual({
      status: "dead_letter",
      reason: "attempts_exhausted",
      cases: "1",
    });
  });
});
