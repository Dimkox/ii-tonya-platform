import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "../../packages/db/src/client.js";
import { PostgresExpertTelegramResidencyCallbackRepository } from "../../packages/db/src/repositories/expert-telegram-residency-callback-repository.js";

const schema = "expert_telegram_xr1_test";
const connectionString =
  process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("test_database_unavailable");
const isolatedUrl = new URL(connectionString);
isolatedUrl.searchParams.set("options", `-c search_path=${schema},public`);
const db = createDb(isolatedUrl.toString());
const repository = new PostgresExpertTelegramResidencyCallbackRepository(db);
const expertId = "00000000-0000-4000-8000-000000000101";
const userId = "00000000-0000-4000-8000-000000000100";
const tariffVersionId = "00000000-0000-4000-8000-000000000301";

describe("expert Telegram xr1 repository on shared Claw PostgreSQL", () => {
  beforeAll(async () => {
    await db.execute(
      sql.raw(`drop schema if exists ${schema} cascade; create schema ${schema};
      create table users(id uuid primary key, active boolean not null);
      create table experts(id uuid primary key, user_id uuid not null references users(id), active boolean not null, verified boolean not null);
      create table channel_identities(user_id uuid not null references users(id), provider text not null, external_id text not null);
      create table expert_residency_tariff_versions(id uuid primary key);
      insert into users values ('${userId}',true);
      insert into experts values ('${expertId}','${userId}',true,true);
      insert into channel_identities values ('${userId}','telegram','123456789');
      insert into expert_residency_tariff_versions values ('${tariffVersionId}');`),
    );
    const migration = await readFile(
      "packages/db/migrations/0025_expert_telegram_residency_callbacks.sql",
      "utf8",
    );
    for (const statement of migration
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter(Boolean))
      await db.execute(sql.raw(statement));
  });
  afterAll(async () => {
    await db.execute(sql.raw(`drop schema if exists ${schema} cascade`));
    await closeDb(db);
  });

  it("binds and consumes an xr1 callback exactly once", async () => {
    const tokenHash = "a".repeat(64);
    const claims = {
      expertId,
      telegramUserId: "123456789",
      tariffVersionId,
      action: "start_residency_checkout" as const,
      expiresAt: new Date(Date.now() + 60_000),
    };
    await repository.put(tokenHash, claims, "telegram:quote:1");
    const binding = {
      expertId,
      telegramUserId: "123456789",
      tariffVersionId,
      action: "start_residency_checkout" as const,
    };
    await expect(
      repository.consume(tokenHash, binding, new Date()),
    ).resolves.toMatchObject(binding);
    await expect(
      repository.consume(tokenHash, binding, new Date()),
    ).resolves.toBeNull();
  });
});
