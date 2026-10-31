import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";
import { PostgresReceiptRevocationOutbox } from "./receipt-revocation-outbox.js";
let f: TestDatabase;
beforeAll(async () => {
  f = await startTestPostgres();
  await f.db.execute(
    sql.raw(
      readFileSync(
        "docs/superpowers/implementation-artifacts/drafts/receipt_revocation_outbox.sql",
        "utf8",
      ),
    ),
  );
}, 120000);
afterAll(async () => {
  await f?.stop();
}, 120000);
it("retains only opaque unresolved tokens until a matching-key acknowledgement", async () => {
  const token = "a".repeat(64),
    contactId = randomUUID();
  await f.db.execute(
    sql`insert into receipt_revocation_outbox(subject_id,contact_id,token,key_version) values(${randomUUID()}::uuid,${contactId}::uuid,${token},'v1')`,
  );
  const repo = new PostgresReceiptRevocationOutbox(f.db);
  expect(await repo.listPending("v2", 10)).toEqual([]);
  expect(await repo.listPending("v1", 10)).toEqual([{ token, contactId }]);
  await repo.acknowledge(token, "v2");
  expect(await repo.listPending("v1", 10)).toEqual([{ token, contactId }]);
  await repo.acknowledge(token, "v1");
  expect(await repo.listPending("v1", 10)).toEqual([]);
}, 120000);
