import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";
import { PostgresDeferredReceiptRetention } from "./early-bird-deferred-receipt-retention.js";

let fixture: TestDatabase;
beforeAll(async () => {
  fixture = await startTestPostgres();
  await fixture.db.execute(
    sql.raw(
      `create table consent_document_versions(id uuid); create table early_bird_deferred_receipt_contacts(id uuid primary key,user_id uuid not null,expires_at timestamptz not null,ciphertext text not null);`,
    ),
  );
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);

it("lists only opaque expired contacts and deletes only the selected still-expired owner", async () => {
  const expired = randomUUID(),
    active = randomUUID(),
    user = randomUUID(),
    other = randomUUID();
  await fixture.db.execute(
    sql`insert into early_bird_deferred_receipt_contacts values(${expired}::uuid,${user}::uuid,clock_timestamp()-interval '1 minute','encrypted'),(${active}::uuid,${user}::uuid,clock_timestamp()+interval '1 hour','encrypted')`,
  );
  const retention = new PostgresDeferredReceiptRetention(fixture.db);
  expect(await retention.listExpired()).toEqual([
    { id: expired, userId: user },
  ]);
  expect(await retention.expireSelected({ id: expired, userId: other })).toBe(
    false,
  );
  expect(await retention.expireSelected({ id: active, userId: user })).toBe(
    false,
  );
  expect(await retention.expireSelected({ id: expired, userId: user })).toBe(
    true,
  );
  expect(await retention.expireSelected({ id: expired, userId: user })).toBe(
    false,
  );
  await expect(
    retention.expireSelected({ id: "invalid", userId: user }),
  ).rejects.toThrow("early_bird_deferred_retention_invalid");
}, 120_000);
