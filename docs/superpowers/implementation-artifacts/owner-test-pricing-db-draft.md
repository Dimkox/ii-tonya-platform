# Owner test pricing database draft

Draft only; not applied, not integrated or available for production. PostgreSQL isolated-table test passed, full migration replay failed because collation `C.utf8` was unavailable. The migration must be replayed and its 0074 snapshot reconstructed according to repository policy before it can be added to the journal. More importantly, the checkout must bind the grant to immutable payment facts, verification and receipt before it can be used.

## Draft migration

```sql
CREATE TABLE owner_test_pricing_grants (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  policy_version text NOT NULL DEFAULT 'owner_test_10_20_v1' CHECK (policy_version = 'owner_test_10_20_v1'),
  onboarding_minor bigint NOT NULL DEFAULT 1000 CHECK (onboarding_minor = 1000),
  subscription_minor bigint NOT NULL DEFAULT 2000 CHECK (subscription_minor = 2000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  CHECK (isfinite(created_at) AND (revoked_at IS NULL OR (isfinite(revoked_at) AND revoked_at >= created_at)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX owner_test_pricing_one_active ON owner_test_pricing_grants ((true)) WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE FUNCTION owner_test_pricing_grant_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
     OR NEW.onboarding_minor IS DISTINCT FROM OLD.onboarding_minor OR NEW.subscription_minor IS DISTINCT FROM OLD.subscription_minor
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'owner_test_pricing_grant_immutable';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER owner_test_pricing_grant_update_guard BEFORE UPDATE ON owner_test_pricing_grants
  FOR EACH ROW EXECUTE FUNCTION owner_test_pricing_grant_update_guard();

```

## Draft reader

```typescript
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

/** Read-only: grants are deliberately not exposed to user-facing commands. */
export class PostgresOwnerTestPricingRepository {
  constructor(private readonly db: DrizzleDb) {}

  async find(userId: string): Promise<{
    policyVersion: "owner_test_10_20_v1";
    onboardingMinor: bigint;
    subscriptionMinor: bigint;
  } | null> {
    const result = await this.db.execute<{
      policy_version: string;
      onboarding_minor: string;
      subscription_minor: string;
    }>(sql`
      select g.policy_version, g.onboarding_minor, g.subscription_minor
      from owner_test_pricing_grants g join users u on u.id = g.user_id
      where g.user_id = ${userId}::uuid and u.active and g.revoked_at is null
    `);
    const row = result.rows[0];
    if (!row) return null;
    if (
      row.policy_version !== "owner_test_10_20_v1" ||
      row.onboarding_minor !== "1000" ||
      row.subscription_minor !== "2000"
    )
      throw new Error("owner_test_pricing_invalid");
    return {
      policyVersion: "owner_test_10_20_v1",
      onboardingMinor: 1000n,
      subscriptionMinor: 2000n,
    };
  }
}

```

## Draft focused test

```typescript
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";
import { PostgresOwnerTestPricingRepository } from "./owner-test-pricing-repository.js";

let fixture: TestDatabase;
beforeAll(async () => {
  fixture = await startTestPostgres();
  await fixture.db.execute(
    sql`create table users (id uuid primary key default gen_random_uuid(), active boolean not null default true)`,
  );
  const migration = await readFile(
    "packages/db/migrations/0076_owner_test_pricing.sql",
    "utf8",
  );
  for (const statement of migration.split("--> statement-breakpoint"))
    await fixture.db.execute(sql.raw(statement));
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);

it("exposes the fixed test policy only for the explicitly assigned active user", async () => {
  const user = await fixture.createUser();
  const other = await fixture.createUser();
  const repository = new PostgresOwnerTestPricingRepository(fixture.db);
  expect(await repository.find(user)).toBeNull();
  await fixture.db.execute(
    sql`insert into owner_test_pricing_grants (user_id) values (${user}::uuid)`,
  );
  expect(await repository.find(user)).toEqual({
    policyVersion: "owner_test_10_20_v1",
    onboardingMinor: 1000n,
    subscriptionMinor: 2000n,
  });
  expect(await repository.find(other)).toBeNull();
  await expect(
    fixture.db.execute(
      sql`insert into owner_test_pricing_grants (user_id) values (${other}::uuid)`,
    ),
  ).rejects.toThrow();
  await expect(
    fixture.db.execute(
      sql`update owner_test_pricing_grants set onboarding_minor = 1 where user_id = ${user}::uuid`,
    ),
  ).rejects.toThrow();
  await fixture.db.execute(
    sql`update owner_test_pricing_grants set revoked_at = clock_timestamp() where user_id = ${user}::uuid`,
  );
  expect(await repository.find(user)).toBeNull();
  await expect(
    fixture.db.execute(
      sql`update owner_test_pricing_grants set revoked_at = null where user_id = ${user}::uuid`,
    ),
  ).rejects.toThrow();
});

```
