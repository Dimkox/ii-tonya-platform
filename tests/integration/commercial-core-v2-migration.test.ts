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
    const ids = {
      admin: "00000000-0000-4000-8000-000000000011",
      expert: "00000000-0000-4000-8000-000000000012",
      tariff: "00000000-0000-4000-8000-000000000013",
      approval: "00000000-0000-4000-8000-000000000014",
      user: "00000000-0000-4000-8000-000000000015",
    };
    await database.db.execute(sql`insert into users (id) values (${ids.admin}::uuid), (${ids.expert}::uuid), (${ids.user}::uuid)`);
    await database.db.execute(sql`insert into admin_sessions (session_id_hash, admin_id, mfa_verified_at, expires_at) values ('commercial-test-session', ${ids.admin}::uuid, now(), now() + interval '1 hour')`);
    await database.db.execute(sql`insert into admin_approvals (id, action, object_type, object_id, requester_id, expires_at, nonce) values (${ids.approval}::uuid, 'expert_residency.tariff_create', 'tariff', ${ids.tariff}::uuid, ${ids.admin}::uuid, now() + interval '1 hour', 'commercial-test-nonce')`);
    await database.db.execute(sql`insert into experts (id, user_id, active, verified) values (${ids.expert}::uuid, ${ids.expert}::uuid, true, true)`);
    await database.db.execute(sql`insert into expert_residency_tariff_versions (id, tariff_key, display_name, price_minor, duration_seconds, active_from, active_to, approval_id, admin_session_id_hash) values (${ids.tariff}::uuid, 'legacy', 'Legacy', 390000, 2592000, now(), now() + interval '1 year', ${ids.approval}::uuid, 'commercial-test-session')`);
    await database.db.execute(sql`insert into expert_residency_orders (expert_id, tariff_version_id, snapshot_display_name, price_minor, currency, duration_seconds, credit_minor, cash_minor, payment_deadline, provider_deadline, idempotency_key) values (${ids.expert}::uuid, ${ids.tariff}::uuid, 'Legacy', 390000, 'RUB', 2592000, 0, 390000, now() + interval '1 hour', now() + interval '2 hours', 'commercial-default-order')`);

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

    const snapshots = await database.db.execute<{
      table_name: string;
      commercial_policy_version: string;
      credit_cap_bps: number;
      group_event_limit: number;
      statistics_level: string;
      support_priority: string;
    }>(sql`select 'tariff' as table_name, commercial_policy_version, credit_cap_bps, group_event_limit, statistics_level, support_priority from expert_residency_tariff_versions where id = '00000000-0000-4000-8000-000000000013' union all select 'order', commercial_policy_version, credit_cap_bps, group_event_limit, statistics_level, support_priority from expert_residency_orders where idempotency_key = 'commercial-default-order'`);
    expect(snapshots.rows).toEqual([
      { table_name: "tariff", commercial_policy_version: "legacy_residency_v1", credit_cap_bps: 5000, group_event_limit: 0, statistics_level: "basic", support_priority: "standard" },
      { table_name: "order", commercial_policy_version: "legacy_residency_v1", credit_cap_bps: 5000, group_event_limit: 0, statistics_level: "basic", support_priority: "standard" },
    ]);
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
          '00000000-0000-4000-8000-000000000012',
          '00000000-0000-4000-8000-000000000013',
          'invalid', 390000, 2592000, 120000, 270000,
          now() + interval '1 hour', now() + interval '2 hours', 'invalid-v2',
          'expert_residency_v2', 3000, 0, 'basic', 'standard'
        )
      `),
    ).rejects.toSatisfy(
      (error: { cause?: { code?: string } }) => error.cause?.code === "23514",
    );

    await expect(database.db.execute(sql`insert into expert_residency_orders (expert_id, tariff_version_id, snapshot_display_name, price_minor, currency, duration_seconds, credit_minor, cash_minor, payment_deadline, provider_deadline, idempotency_key, commercial_policy_version, credit_cap_bps, group_event_limit, statistics_level, support_priority) values ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000013', 'invalid', 10000, 'RUB', 2592000, 0, 10000, now() + interval '1 hour', now() + interval '2 hours', 'invalid-v2-price', 'expert_residency_v2', 3000, 0, 'basic', 'standard')`)).rejects.toSatisfy((error: { cause?: { code?: string } }) => error.cause?.code === "23514");
  });
});
