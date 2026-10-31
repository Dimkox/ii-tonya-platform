import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { expertResidencyPaymentEventSchema } from "@ii-tonya/contracts";
import { verifiedEventFixture } from "../../../integrations/src/expert-residency/verified-event.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";
import { PostgresExpertResidencyRepository } from "./expert-residency-repository.js";
import { PostgresExpertResidencyProviderInboxRepository } from "./expert-residency-provider-inbox-repository.js";
const SYNTHETIC_FIXTURE_VALUE_1 = "synthetic-only";

let fixture: ExpertReferralTestDatabase;
let limited: Pool;
let prefixDirectory: string | undefined;
const role = "early_bird_legacy_witness";
beforeAll(async () => {
  const journal = JSON.parse(
    readFileSync("packages/db/migrations/meta/_journal.json", "utf8"),
  ) as { entries: Array<{ idx: number; tag: string }> };
  const prefix = journal.entries.filter((entry) => entry.idx <= 80);
  expect(prefix).toHaveLength(81);
  expect(prefix.at(-1)?.tag).toBe("0080_early_bird_form_bridge");
  // The first payment genuinely predates the Wave migration. Keep every real
  // historical SQL file and journal hash; never remove installed capabilities.
  prefixDirectory = await mkdtemp(join(tmpdir(), "legacy-role-prefix-"));
  await mkdir(join(prefixDirectory, "meta"));
  await writeFile(
    join(prefixDirectory, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries: prefix }),
  );
  for (const entry of prefix)
    await copyFile(
      `packages/db/migrations/${entry.tag}.sql`,
      join(prefixDirectory, `${entry.tag}.sql`),
    );
  const migrationsFolder = prefixDirectory;
  fixture = await startExpertReferralTestDatabase(
    (db) => migrate(db, { migrationsFolder }),
    { forceDisposableCluster: true },
  );
  await fixture.enableExpertReferralCommands();
  await fixture.db.execute(
    sql.raw(`create role ${role} login password 'synthetic-only' noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
    grant usage on schema public to ${role};
    grant select on users, experts, channel_identities, expert_referrals, expert_referral_abuse_holds, expert_referral_feature_controls, expert_card_main_orders, expert_residency_tariff_versions, expert_referral_reward_grants, expert_referral_ledger_allocations, expert_referral_ledger_entries to ${role};
    grant select, update on experts, expert_referrals, expert_referral_abuse_holds, expert_referral_feature_controls, expert_card_main_orders, expert_referral_reward_grants, expert_referral_ledger_allocations, expert_referral_ledger_entries to ${role};
    grant select, insert, update on expert_residency_orders, expert_residency_provider_event_inbox, expert_residency_payment_attempts, expert_first_residency_settlements to ${role};
    grant insert on audit_events, integration_outbox to ${role};
    grant select(idempotency_key) on integration_outbox to ${role};
    grant update on consent_document_versions to ${role};
    grant usage on sequence expert_first_residency_settlements_settlement_sequence_seq to ${role};`),
  );
  const address = new URL(fixture.db.$client.options.connectionString!);
  address.username = role;
  address.password = SYNTHETIC_FIXTURE_VALUE_1;
  limited = new Pool({ connectionString: address.toString(), max: 1 });
}, 120_000);
afterAll(async () => {
  try {
    await limited?.end();
  } finally {
    try {
      await fixture?.stop();
    } finally {
      if (prefixDirectory)
        await rm(prefixDirectory, { recursive: true, force: true });
    }
  }
}, 120_000);

function hasCode(error: unknown, code: string): boolean {
  const seen = new Set<unknown>();
  while (error && typeof error === "object" && !seen.has(error)) {
    seen.add(error);
    if ((error as { code?: string }).code === code) return true;
    error = (error as { cause?: unknown }).cause;
  }
  return false;
}

it("preserves legacy settlement across the canonical Wave migrations with only coverage helper grants", async () => {
  const expert = await fixture.createExpertIdentity();
  const repository = new PostgresExpertResidencyRepository(fixture.db);
  const audit = await fixture.createAdminAudit({
    action: "expert_residency.tariff_create",
    objectId: randomUUID(),
  });
  const tariff = await repository.createTariffVersion({
    tariffKey: `witness-${randomUUID()}`,
    displayName: "Witness",
    priceMinor: 50000n,
    durationSeconds: 86400,
    activeFrom: new Date(Date.now() - 1000),
    activeTo: new Date(Date.now() + 86400000),
    approvalId: audit.approvalId,
    adminSessionIdHash: audit.sessionIdHash,
  });
  const makeEvent = async () => {
    const order = await repository.createCheckoutOrder({
      expertId: expert.expertId,
      tariffVersionId: tariff.id,
      providerDeadline: new Date(Date.now() + 3600000),
      idempotencyKey: randomUUID(),
    });
    return verifiedEventFixture(
      expertResidencyPaymentEventSchema.parse({
        kind: "settled",
        provider: "sandbox",
        eventId: `evt_${randomUUID()}`,
        paymentId: `pay_${randomUUID()}`,
        orderId: order.id,
        amountMinor: "50000",
        currency: "RUB",
        occurredAt: new Date().toISOString(),
        payloadDigest: `sha256:${"a".repeat(64)}`,
      }),
      {
        verificationId: `verify_${randomUUID()}`,
        verifierKeyVersion: "test-v1",
        verifiedAt: new Date().toISOString(),
      },
    );
  };
  const inbox = new PostgresExpertResidencyProviderInboxRepository(
    drizzle(limited) as never,
  );
  const before = await makeEvent();
  expect(
    (
      await fixture.db.execute(
        sql`select to_regclass('public.early_bird_payment_successes') is null as absent,(select count(*)::int from drizzle.__drizzle_migrations) as migrations`,
      )
    ).rows[0],
  ).toEqual({ absent: true, migrations: 81 });
  await expect(inbox.settle(before)).resolves.toMatchObject({
    kind: "settled",
    paymentId: before.paymentId,
  });
  await migrate(fixture.db, { migrationsFolder: "packages/db/migrations" });
  expect(
    (
      await fixture.db.execute(
        sql`select count(*)::int n from drizzle.__drizzle_migrations`,
      )
    ).rows[0]?.n,
  ).toBe(
    (
      JSON.parse(
        readFileSync("packages/db/migrations/meta/_journal.json", "utf8"),
      ) as { entries: unknown[] }
    ).entries.length,
  );
  const after = await makeEvent();
  await expect(inbox.settle(after)).rejects.toSatisfy((error: unknown) =>
    hasCode(error, "42501"),
  );
  expect(
    (
      await fixture.db.execute(
        sql`select status from expert_residency_orders where id=${after.orderId}::uuid`,
      )
    ).rows[0]?.status,
  ).toBe("payment_pending");
  await fixture.db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('ii_tonya.legacy_settlement_role',${role},true)`,
    );
    await tx.execute(
      sql.raw(
        readFileSync(
          "scripts/sql/provision-early-bird-legacy-coverage.sql",
          "utf8",
        ),
      ),
    );
  });
  await expect(inbox.settle(after)).resolves.toMatchObject({
    kind: "settled",
    paymentId: after.paymentId,
  });
  await expect(inbox.settle(after)).resolves.toMatchObject({
    kind: "settled",
    paymentId: after.paymentId,
  });
  expect(
    (
      await fixture.db.execute(
        sql`select count(*)::integer as n from early_bird_payment_successes`,
      )
    ).rows[0]?.n,
  ).toBe(0);
  for (const query of [
    "select * from early_bird_payment_successes",
    "select early_bird_record_success(null,null,null,null,null)",
    "select early_bird_private.bind_verified(null,null,null,null,null)",
  ]) {
    await expect(limited.query(query)).rejects.toMatchObject({ code: "42501" });
  }
  const result = await fixture.db.execute(
    sql`select count(*)::integer as n from expert_residency_payment_attempts where order_id=${after.orderId}::uuid and status='settled'`,
  );
  expect(result.rows[0]?.n).toBe(1);
}, 120_000);
