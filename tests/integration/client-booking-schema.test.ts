import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
}, 120_000);
afterAll(async () => testDb?.stop(), 120_000);

async function relationColumns(relation: string): Promise<readonly string[]> {
  const result = await testDb.db.execute<{ columnName: string }>(sql`
    select a.attname as "columnName"
    from pg_attribute a
    join pg_class c on c.oid=a.attrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname=${relation}
      and a.attnum > 0
      and not a.attisdropped
    order by a.attnum
  `);
  return result.rows.map(({ columnName }) => columnName);
}

async function relationConstraints(
  relation: string,
): Promise<readonly string[]> {
  const result = await testDb.db.execute<{ constraintName: string }>(sql`
    select con.conname as "constraintName"
    from pg_constraint con
    join pg_class c on c.oid=con.conrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=${relation}
    order by con.conname
  `);
  return result.rows.map(({ constraintName }) => constraintName);
}

describe("protected client booking relations", () => {
  it("keeps catalog choices minimal and bound to request and local slot lifecycle", async () => {
    expect(await relationColumns("client_catalog_choices")).toEqual([
      "id",
      "request_id",
      "choice_digest",
      "slot_id",
      "expires_at",
      "created_at",
    ]);
    expect(await relationConstraints("client_catalog_choices")).toEqual(
      expect.arrayContaining([
        "client_catalog_choices_choice_digest_check",
        "client_catalog_choices_choice_digest_unique",
        "client_catalog_choices_expiry_check",
        "client_catalog_choices_request_id_client_catalog_requests_id_fk",
        "client_catalog_choices_slot_id_slots_id_fk",
      ]),
    );
  });

  it("keeps public receipts owner scoped and free of provider or payment authority", async () => {
    const columns = await relationColumns("client_booking_receipts");
    expect(columns).toEqual([
      "id",
      "user_id",
      "choice_digest",
      "booking_handle",
      "reservation_id",
      "created_at",
    ]);
    expect(columns).not.toEqual(
      expect.arrayContaining([
        "provider",
        "contact",
        "amount",
        "payment",
        "payload",
      ]),
    );
    expect(await relationConstraints("client_booking_receipts")).toEqual(
      expect.arrayContaining([
        "client_booking_receipts_booking_handle_check",
        "client_booking_receipts_booking_handle_unique",
        "client_booking_receipts_choice_digest_check",
        "client_booking_receipts_reservation_id_reservations_id_fk",
        "client_booking_receipts_user_choice_unique",
        "client_booking_receipts_user_id_users_id_fk",
      ]),
    );
  });

  it("records finite leased and fenced local erasure phases", async () => {
    expect(await relationColumns("client_booking_erasure_work")).toEqual([
      "deletion_job_id",
      "phase",
      "lease_token",
      "lease_until",
      "attempt_count",
      "updated_at",
    ]);
    expect(await relationConstraints("client_booking_erasure_work")).toEqual(
      expect.arrayContaining([
        "client_booking_erasure_work_attempt_count_check",
        "client_booking_erasure_work_deletion_job_id_privacy_deletion_jo",
        "client_booking_erasure_work_lease_check",
        "client_booking_erasure_work_phase_check",
      ]),
    );
  });
});
