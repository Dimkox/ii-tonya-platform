import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
let container: StartedPostgreSqlContainer;
let admin: Pool;
beforeAll(async () => {
  // Roles are cluster-wide. Always use an isolated throwaway cluster, even when
  // II_TONYA_TEST_POSTGRES_ADMIN_URL points to an externally managed server.
  container = await new PostgreSqlContainer("postgres:17.5-bookworm").start();
  admin = new Pool({ connectionString: container.getConnectionUri() });
  await admin.query(`create table users(id uuid primary key);
    create table expert_sales_erased_cohorts(user_id uuid primary key);
    create table experts(id uuid primary key, user_id uuid not null);
    create table expert_residency_orders(expert_id uuid, status text, residency_ends_at timestamptz);
    create table early_bird_composite_intents(id uuid primary key, invoice_id uuid not null, user_id uuid not null, provider_mode text not null, pricing_policy text not null, price_kind text not null, onboarding_minor bigint not null, subscription_minor bigint not null, total_minor bigint not null, base_offer_shown_at timestamptz not null, expires_at timestamptz not null, launch_at timestamptz not null, status text not null, unique(id,user_id));
    create table early_bird_verified_bindings(intent_id uuid primary key, user_id uuid not null, provider_object_id text not null);`);
  await admin.query(
    readFileSync(
      "docs/superpowers/implementation-artifacts/drafts/0082_early_bird_settlement.sql",
      "utf8",
    ),
  );
}, 120_000);
afterAll(async () => {
  await admin?.end();
  await container?.stop();
}, 120_000);
it("permits only provisioned coverage functions to a genuine non-owner login", async () => {
  const role = `coverage_${randomUUID().replaceAll("-", "")}`;
  const password = "synthetic-only-test-password";
  const user = randomUUID();
  await admin.query(
    `create role "${role}" login password '${password}' nosuperuser noinherit nocreatedb nocreaterole nobypassrls`,
  );
  await admin.query("insert into users values($1::uuid)", [user]);
  const url = new URL(container.getConnectionUri());
  url.username = role;
  url.password = password;
  const limited = new Pool({ connectionString: url.toString() });
  try {
    const identity = await limited.query<{ name: string; super: boolean }>(
      "select current_user as name, (select rolsuper from pg_roles where rolname=current_user) as super",
    );
    expect(identity.rows[0]).toEqual({ name: role, super: false });
    await expect(
      limited.query("select early_bird_touch_coverage_epoch($1::uuid)", [user]),
    ).rejects.toMatchObject({ code: "42501" });
    await admin.query(`grant usage on schema public to "${role}"`);
    await admin.query(
      `grant execute on function early_bird_touch_coverage_epoch(uuid), early_bird_active_coverage_end(uuid) to "${role}"`,
    );
    await expect(
      limited.query("select early_bird_touch_coverage_epoch($1::uuid)", [user]),
    ).resolves.toBeDefined();
    expect(
      (
        await limited.query(
          "select early_bird_active_coverage_end($1::uuid) as ends",
          [user],
        )
      ).rows[0].ends,
    ).toBeNull();
    await expect(
      limited.query("select * from early_bird_payment_successes"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      limited.query(
        "insert into early_bird_coverage_epochs values($1::uuid,1)",
        [user],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      limited.query(
        "select early_bird_record_success($1::uuid,$1::uuid,'p',$2,now())",
        [user, `sha256:${"a".repeat(64)}`],
      ),
    ).rejects.toMatchObject({ code: "42501" });
  } finally {
    await limited.end();
    await admin.query(`drop owned by "${role}"`);
    await admin.query(`drop role "${role}"`);
  }
}, 120_000);
