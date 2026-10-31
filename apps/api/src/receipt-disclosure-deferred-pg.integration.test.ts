import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { ExperimentalGatewayIpc } from "@ii-tonya/integrations";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../../packages/db/src/testkit/postgres.js";
import { createReceiptContactFence } from "./receipt-disclosure-contact-fence.js";
let fixture: TestDatabase;
beforeAll(async () => {
  fixture = await startTestPostgres();
  await fixture.migrate();
}, 120000);
afterAll(async () => {
  await fixture?.stop();
}, 120000);
it("persists an exact deferred-contact retry ticket across gateway failure and removes it only after ACK", async () => {
  const user = await fixture.createUser(),
    id = randomUUID(),
    account = randomUUID();
  const client = await fixture.db.$client.connect();
  try {
    await client.query("set session_replication_role=replica");
    await client.query(
      `insert into early_bird_deferred_receipt_contacts(id,user_id,account_id,idempotency_key,captured_at,expires_at,key_id,ciphertext) values($1,$2,$3,'synthetic-123',date_trunc('milliseconds',clock_timestamp()),date_trunc('milliseconds',clock_timestamp()+interval '1 hour'),'v1','prc1.'||repeat('a',40))`,
      [id, user, account],
    );
  } finally {
    await client.query("set session_replication_role=origin");
    client.release();
  }
  const gateway = new ExperimentalGatewayIpc({
    address: "\0unused",
    key: Buffer.alloc(32, 1),
    authKey: Buffer.alloc(32, 2),
    timeoutMs: 10,
  });
  const revoke = vi
    .spyOn(gateway, "revokeContactToken")
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce();
  vi.spyOn(gateway, "stopAll").mockResolvedValue();
  const fence = createReceiptContactFence(gateway, "v1");
  const run = () =>
    fixture.db.transaction(async (tx) => {
      await tx.execute(sql`lock table consent_document_versions in share mode`);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${user}::uuid::text,0))`,
      );
      return fence(tx, user);
    });
  expect((await run())?.message).toBe(
    "receipt_disclosure_cancellation_uncertain",
  );
  const pending = await fixture.db.$client.query(
    "select subject_id,contact_id,token,key_version from receipt_revocation_outbox where subject_id=$1",
    [user],
  );
  expect(pending.rows).toEqual([
    {
      subject_id: user,
      contact_id: id,
      token: gateway.contactToken(id),
      key_version: "v1",
    },
  ]);
  expect(await run()).toBeUndefined();
  expect(
    (
      await fixture.db.$client.query(
        "select 1 from receipt_revocation_outbox where subject_id=$1",
        [user],
      )
    ).rowCount,
  ).toBe(0);
  expect(revoke).toHaveBeenCalledTimes(2);
}, 120000);
