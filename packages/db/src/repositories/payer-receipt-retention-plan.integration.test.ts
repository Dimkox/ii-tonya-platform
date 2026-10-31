import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";
import { PostgresPayerReceiptContactRepository } from "./payer-receipt-contact-repository.js";
let f: TestDatabase;
beforeAll(async () => {
  f = await startTestPostgres();
  await f.db.execute(sql`create table consent_document_versions(id uuid)`);
  await f.db.execute(
    sql`create table payer_receipt_contacts(id uuid primary key,user_id uuid not null,expires_at timestamptz not null,redacted_at timestamptz,ciphertext text,key_id text)`,
  );
  await f.db.execute(
    sql`create function payer_receipt_redaction_due(c payer_receipt_contacts) returns boolean language sql stable as $$select c.expires_at<=clock_timestamp()$$`,
  );
}, 120000);
afterAll(async () => {
  await f?.stop();
}, 120000);
it("redacts only the selected due IDs with the same subjects, never new arrivals", async () => {
  const user = randomUUID(),
    other = randomUUID(),
    first = randomUUID(),
    second = randomUUID();
  await f.db.execute(
    sql`insert into payer_receipt_contacts values(${first}::uuid,${user}::uuid,clock_timestamp()-interval '1 hour',null,'secret','key')`,
  );
  const repo = new PostgresPayerReceiptContactRepository(f.db);
  const plan = await repo.listExpiredBatch(10);
  expect(plan).toEqual([{ id: first, userId: user }]);
  await f.db.execute(
    sql`insert into payer_receipt_contacts values(${second}::uuid,${other}::uuid,clock_timestamp()-interval '1 hour',null,'secret','key')`,
  );
  expect(await repo.redactExpiredSelection(plan)).toBe(1);
  const rows = await f.db.execute<{ id: string; redacted: boolean }>(
    sql`select id,redacted_at is not null as redacted from payer_receipt_contacts order by id`,
  );
  expect(rows.rows.find((r) => r.id === first)?.redacted).toBe(true);
  expect(rows.rows.find((r) => r.id === second)?.redacted).toBe(false);
  expect(
    await repo.redactExpiredSelection([{ id: second, userId: user }]),
  ).toBe(0);
}, 120000);
