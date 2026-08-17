import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase | undefined;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
}, 120_000);

afterAll(async () => testDb?.stop(), 60_000);

describe("client conversation durable schema", () => {
  it("enforces the provider-bound token, grant and frozen-operation invariants", async () => {
    const tables = await testDb!.db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name in (
        'client_conversation_grants',
        'client_conversation_operations',
        'client_conversation_runtime_leases',
        'client_conversation_operation_cases'
      )
      order by table_name
    `);
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "client_conversation_grants",
      "client_conversation_operation_cases",
      "client_conversation_operations",
      "client_conversation_runtime_leases",
    ]);

    await testDb!.db.execute(
      sql`insert into users (id) values ('00000000-0000-4000-8000-000000000032')`,
    );
    await expect(
      testDb!.db.execute(sql`
      insert into provider_subject_mappings (
        user_id, provider, subject_token, subject_ciphertext, tenant_token, token_version
      ) values (
        '00000000-0000-4000-8000-000000000032', 'selarti.client-thread.v1', 'hmac-sha256:v1:${"a".repeat(64)}', 'opaque',
        'hmac-sha256:v1:${"b".repeat(64)}', 2
      )
    `),
    ).rejects.toThrow();
  });
});
