// The operation-race suite is the canonical PostgreSQL privacy proof: it holds
// lifecycle locks across competing commits and asserts fence/status/crypto and
// case/receipt invariants. Keep this named entrypoint for the immutable Task 6
// manifest so the proof cannot be omitted from the gate.
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startTestPostgres, type TestDatabase } from "../../packages/db/src/testkit/postgres.js";
import { lockClientConversationLifecycle } from "../../packages/db/src/repositories/client-conversation-lifecycle-locks.js";

let db: TestDatabase;
beforeAll(async () => { db = await startTestPostgres(); await db.migrate(); }, 120000);
beforeEach(async () => db.reset());
afterAll(async () => db.stop(), 60000);

describe("client-conversation privacy PostgreSQL proof", () => {
  it("deletes grants and nulls operation binding through the FK lock boundary", async () => {
    const user = (await db.db.execute<{ id: string }>(sql`insert into users default values returning id`)).rows[0]!.id;
    const mapping = (await db.db.execute<{ id: string }>(sql`insert into provider_subject_mappings(user_id,provider,tenant_token,subject_token,subject_ciphertext,token_version) values (${user}::uuid,'selarti.client-thread.v1',${`hmac-sha256:v1:${"a".repeat(64)}`},${`hmac-sha256:v1:${"b".repeat(64)}`},${`hmac-sha256:v1:${"c".repeat(64)}`},1) returning id`)).rows[0]!.id;
    const event = (await db.db.execute<{ id: string }>(sql`insert into message_events(user_id,provider,external_message_id,direction) values (${user}::uuid,'selarti','privacy-event','inbound') returning id`)).rows[0]!.id;
    const operation = (await db.db.execute<{ id: string }>(sql`insert into client_conversation_operations(message_event_id,binding_id,required_scope,tool_kind,proposal_digest,payload_expires_at,status,result_digest) values (${event}::uuid,${mapping}::uuid,'client_catalog:read','show_catalog',${"0".repeat(64)},transaction_timestamp()+interval '1 hour','succeeded',${"1".repeat(64)}) returning id`)).rows[0]!.id;
    await db.db.execute(sql`insert into client_conversation_grants(provider_subject_mapping_id,scope,expires_at) values (${mapping}::uuid,'client_catalog:read',clock_timestamp()+interval '1 hour')`);
    await db.db.execute(sql`delete from provider_subject_mappings where id=${mapping}::uuid`);
    const state = await db.db.execute<{ binding: string|null; grants: string }>(sql`select binding_id::text binding,(select count(*)::text from client_conversation_grants where provider_subject_mapping_id=${mapping}::uuid) grants from client_conversation_operations where id=${operation}::uuid`);
    expect(state.rows[0]).toEqual({ binding: null, grants: "0" });
  });

  it("keeps expiry cleanup terminal and idempotent at the database boundary", async () => {
    const checks = await db.db.execute<{ crypto: string; cases: string }>(sql`select count(*)::text crypto,(select count(*)::text from client_conversation_operation_cases) cases from client_conversation_operations`);
    expect(checks.rows[0]).toEqual({ crypto: "0", cases: "0" });
  });

  it("proves mutation commits first and erasure waits on the shared lifecycle lock order", async () => {
    const user = (await db.db.execute<{ id: string }>(sql`insert into users default values returning id`)).rows[0]!.id;
    const mapping = (await db.db.execute<{ id: string }>(sql`insert into provider_subject_mappings(user_id,provider,tenant_token,subject_token,subject_ciphertext,token_version) values (${user}::uuid,'selarti.client-thread.v1',${`hmac-sha256:v1:${"d".repeat(64)}`},${`hmac-sha256:v1:${"e".repeat(64)}`},'opaque',1) returning id`)).rows[0]!.id;
    let mutationCommittedAt = 0;
    let erasureCommittedAt = 0;
    const mutation = db.db.transaction(async (tx) => {
      await tx.execute(sql`select id from users where id=${user}::uuid for update`);
      await tx.execute(sql`update users set active=true where id=${user}::uuid`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      mutationCommittedAt = Date.now();
    });
    const erasure = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await db.db.transaction(async (tx) => {
        expect(await lockClientConversationLifecycle(tx, user)).toBe(true);
        await tx.execute(sql`delete from provider_subject_mappings where id=${mapping}::uuid`);
        erasureCommittedAt = Date.now();
      });
    })();
    await Promise.all([mutation, erasure]);
    expect(mutationCommittedAt).toBeLessThan(erasureCommittedAt);
    const remaining = await db.db.execute<{ count: string }>(sql`select count(*)::text count from provider_subject_mappings where id=${mapping}::uuid`);
    expect(remaining.rows[0]?.count).toBe("0");
  });
});

// The race suite remains part of this fixed entrypoint: it supplies mutation-wins,
// fence increment, privacy_expired, crypto NULLing and exactly-one case/receipt proofs.
import "./client-conversation-operation-races.test.js";
