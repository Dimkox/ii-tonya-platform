import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

describe("commercial core v2 migration", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await startTestPostgres();
    await database.migrate();
  });

  afterAll(async () => {
    await database.stop();
  });

  it("adds policy snapshots and preserves legacy tariff/order defaults", async () => {
    const columns = await database.db.execute<{ column_name: string }>(sql`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name in ('expert_residency_tariff_versions', 'expert_residency_orders')
        and column_name in ('commercial_policy_version', 'credit_cap_bps', 'group_event_limit', 'statistics_level', 'support_priority')
    `);

    expect(columns.rows.map((row) => row.column_name)).toEqual(
      expect.arrayContaining([
        "commercial_policy_version",
        "credit_cap_bps",
        "group_event_limit",
        "statistics_level",
        "support_priority",
      ]),
    );

    const tables = await database.db.execute<{ table_name: string }>(sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in ('client_commercial_policy_controls', 'client_commercial_policy_assignments')
    `);
    expect(tables.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        "client_commercial_policy_controls",
        "client_commercial_policy_assignments",
      ]),
    );
  });

  it("rejects a v2 order whose credit exceeds its captured cap", async () => {
    await expect(
      database.db.execute(sql`
        insert into expert_residency_orders (
          expert_id, tariff_version_id, snapshot_display_name, price_minor,
          duration_seconds, credit_minor, cash_minor, payment_deadline,
          provider_deadline, idempotency_key, commercial_policy_version,
          credit_cap_bps, group_event_limit, statistics_level, support_priority
        ) values (
          '00000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000002',
          'invalid', 10000, 3600, 3001, 6999,
          now() + interval '1 hour', now() + interval '2 hours', 'invalid-v2',
          'expert_residency_v2', 3000, 0, 'basic', 'standard'
        )
      `),
    ).rejects.toSatisfy(
      (error: { cause?: { code?: string } }) => error.cause?.code === "23514",
    );
  });
});
