import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let upgradeDb: TestDatabase | undefined;

async function migrateThrough0018(database: TestDatabase): Promise<void> {
  for (let index = 0; index <= 18; index += 1) {
    const prefix = index.toString().padStart(4, "0");
    const migration = readdirSync("packages/db/migrations")
      .find((name) => name.startsWith(`${prefix}_`) && name.endsWith(".sql"));
    if (migration === undefined) throw new Error(`missing migration ${prefix}`);
    await database.db.$client.query(
      readFileSync(`packages/db/migrations/${migration}`, "utf8"),
    );
  }
}

async function applyMigration(database: TestDatabase, index: number): Promise<void> {
  const prefix = index.toString().padStart(4, "0");
  const migration = readdirSync("packages/db/migrations")
    .find((name) => name.startsWith(`${prefix}_`) && name.endsWith(".sql"));
  if (migration === undefined) throw new Error(`missing migration ${prefix}`);
  await database.db.$client.query(
    readFileSync(`packages/db/migrations/${migration}`, "utf8"),
  );
}

async function seedGrantShortenedOrder(database: TestDatabase): Promise<{
  expertId: string;
  idempotencyKey: string;
  tariffId: string;
}> {
  const expertUserId = randomUUID();
  const expertId = randomUUID();
  const adminId = randomUUID();
  const approvalId = randomUUID();
  const tariffId = randomUUID();
  const orderId = randomUUID();
  const sessionIdHash = `sha256:${randomUUID()}`;
  const idempotencyKey = "legacy-grant-shortened-order";
  await database.db.execute(sql`insert into users (id) values (${expertUserId}::uuid), (${adminId}::uuid)`);
  await database.db.execute(sql`insert into experts (id, user_id, active, verified)
    values (${expertId}::uuid, ${expertUserId}::uuid, true, true)`);
  await database.db.execute(sql`insert into admin_sessions (session_id_hash, admin_id, mfa_verified_at, expires_at)
    values (${sessionIdHash}, ${adminId}::uuid, transaction_timestamp(), transaction_timestamp() + interval '1 day')`);
  await database.db.execute(sql`insert into admin_approvals (
    id, action, object_type, object_id, requester_id, expires_at, nonce
  ) values (${approvalId}::uuid, 'expert_residency.tariff_create', 'expert', ${tariffId}::uuid,
    ${adminId}::uuid, transaction_timestamp() + interval '1 day', ${randomUUID()})`);
  await database.db.execute(sql`insert into expert_residency_tariff_versions (
    id, tariff_key, version, display_name, description, price_minor, currency,
    duration_seconds, active_from, created_by_admin_id, approval_id, admin_session_id_hash
  ) values (${tariffId}::uuid, 'legacy-shortened', 1, 'Legacy', 'Legacy', 100000, 'RUB', 86400,
    transaction_timestamp() - interval '1 day', ${adminId}::uuid, ${approvalId}::uuid, ${sessionIdHash})`);
  await database.db.execute(sql`insert into expert_residency_orders (
    id, expert_id, tariff_version_id, tariff_name, tariff_description, price_minor,
    currency, duration_seconds, credit_minor, cash_minor, payment_deadline,
    idempotency_key, status, quoted_at
  ) values (${orderId}::uuid, ${expertId}::uuid, ${tariffId}::uuid, 'Legacy', 'Legacy',
    100000, 'RUB', 86400, 50000, 50000, transaction_timestamp() + interval '1 hour',
    ${idempotencyKey}, 'quoted', transaction_timestamp() - interval '1 minute')`);
  return { expertId, idempotencyKey, tariffId };
}

function messages(error: unknown): string {
  const result: string[] = [];
  let current = error as { message?: unknown; cause?: unknown } | undefined;
  while (current !== undefined) {
    if (typeof current.message === "string") result.push(current.message);
    current = current.cause as { message?: unknown; cause?: unknown } | undefined;
  }
  return result.join(" ");
}

afterAll(async () => upgradeDb?.stop(), 120_000);

describe("residency provider deadline corrective upgrade", () => {
  it("removes a fabricated 0019 legacy deadline and fails replay ambiguity closed", async () => {
    upgradeDb = await startTestPostgres();
    await migrateThrough0018(upgradeDb);
    const legacy = await seedGrantShortenedOrder(upgradeDb);
    await applyMigration(upgradeDb, 19);
    const after0019 = (await upgradeDb.db.execute<{
      providerDeadline: Date | string | null;
      paymentDeadline: Date | string;
    }>(sql`
      select provider_deadline as "providerDeadline", payment_deadline as "paymentDeadline"
      from expert_residency_orders
      where idempotency_key = ${legacy.idempotencyKey}
    `)).rows[0];
    if (after0019 === undefined) throw new Error("legacy_order_missing");
    expect(after0019.providerDeadline).not.toBeNull();
    const effectivePaymentDeadline = after0019.paymentDeadline instanceof Date
      ? after0019.paymentDeadline
      : new Date(after0019.paymentDeadline);
    const fabricatedProviderDeadline = after0019.providerDeadline instanceof Date
      ? after0019.providerDeadline
      : new Date(after0019.providerDeadline ?? 0);
    expect(fabricatedProviderDeadline.getTime()).toBe(effectivePaymentDeadline.getTime());

    await applyMigration(upgradeDb, 20);
    const after0020 = (await upgradeDb.db.execute<{
      providerDeadline: Date | string | null;
      paymentDeadline: Date | string;
    }>(sql`
      select provider_deadline as "providerDeadline", payment_deadline as "paymentDeadline"
      from expert_residency_orders
      where idempotency_key = ${legacy.idempotencyKey}
    `)).rows[0];
    if (after0020 === undefined) throw new Error("corrected_legacy_order_missing");
    const repo = new PostgresExpertResidencyRepository(upgradeDb.db);
    const futureProviderDeadline = (await upgradeDb.db.execute<{ providerDeadline: Date | string }>(sql`
      select transaction_timestamp() + interval '2 days' as "providerDeadline"
    `)).rows[0]?.providerDeadline;
    if (futureProviderDeadline === undefined) throw new Error("database_time_missing");
    const providerDeadline = futureProviderDeadline instanceof Date
      ? futureProviderDeadline
      : new Date(futureProviderDeadline);
    const firstReplay = {
      expertId: legacy.expertId,
      tariffKey: "legacy-shortened",
      providerDeadline,
      idempotencyKey: legacy.idempotencyKey,
    };
    const conflictingReplay = {
      ...firstReplay,
      providerDeadline: new Date(firstReplay.providerDeadline.getTime() + 86_400_000),
    };

    // Pre-0019 stored only this earlier effective deadline, not the candidate provider deadline.
    expect(after0020.providerDeadline).toBeNull();
    expect(effectivePaymentDeadline.getTime()).toBeLessThan(providerDeadline.getTime());
    await expect(repo.createCheckoutOrder(firstReplay)).rejects.toMatchObject({
      code: "checkout_idempotency_legacy_ambiguity",
    });
    await expect(repo.createCheckoutOrder(conflictingReplay)).rejects.toMatchObject({
      code: "checkout_idempotency_legacy_ambiguity",
    });

    let insertError: unknown;
    try {
      await upgradeDb.db.execute(sql`insert into expert_residency_orders (
        id, expert_id, tariff_version_id, tariff_name, tariff_description, price_minor,
        currency, duration_seconds, credit_minor, cash_minor, payment_deadline,
        provider_deadline, idempotency_key, status, quoted_at
      ) values (${randomUUID()}::uuid, ${legacy.expertId}::uuid, ${legacy.tariffId}::uuid,
        'New', 'New', 100000, 'RUB', 86400, 0, 100000,
        transaction_timestamp() + interval '1 hour', null, 'new-null-provider-deadline',
        'quoted', transaction_timestamp() - interval '1 minute')`);
    } catch (error) {
      insertError = error;
    }
    expect(messages(insertError)).toContain("new expert residency orders require provider deadline");

    const postCorrectionCommand = {
      expertId: legacy.expertId,
      tariffKey: "legacy-shortened",
      providerDeadline: new Date(providerDeadline.getTime() + 86_400_000),
      idempotencyKey: "post-0020-exact-replay",
    };
    const postCorrectionOrder = await repo.createCheckoutOrder(postCorrectionCommand);
    const postCorrectionDeadline = (await upgradeDb.db.execute<{ providerDeadline: Date | string | null }>(sql`
      select provider_deadline as "providerDeadline" from expert_residency_orders
      where id = ${postCorrectionOrder.orderId}::uuid
    `)).rows[0]?.providerDeadline;
    expect(postCorrectionDeadline).not.toBeNull();
    await expect(repo.createCheckoutOrder(postCorrectionCommand)).resolves.toMatchObject({
      orderId: postCorrectionOrder.orderId,
    });
  }, 120_000);
});
