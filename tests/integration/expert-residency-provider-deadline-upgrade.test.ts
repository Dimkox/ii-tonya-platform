import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

const migrationsFolder = "packages/db/migrations";
let upgradeDb: TestDatabase | undefined;
let migrationFixtureRoot: string | undefined;

type MigrationJournal = {
  version: string;
  dialect: string;
  entries: Array<{
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }>;
};

function migrationsThrough(lastIndex: number): string {
  migrationFixtureRoot ??= mkdtempSync(
    join(tmpdir(), "ii-tonya-provider-deadline-migrations-"),
  );
  const destination = join(migrationFixtureRoot, `through-${lastIndex}`);
  mkdirSync(join(destination, "meta"), { recursive: true });
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8"),
  ) as MigrationJournal;
  const entries = journal.entries.filter((entry) => entry.idx <= lastIndex);
  for (const entry of entries) {
    copyFileSync(
      join(migrationsFolder, `${entry.tag}.sql`),
      join(destination, `${entry.tag}.sql`),
    );
  }
  writeFileSync(
    join(destination, "meta/_journal.json"),
    `${JSON.stringify({ ...journal, entries }, null, 2)}\n`,
    "utf8",
  );
  return destination;
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
  await database.db.execute(
    sql`insert into users (id) values (${expertUserId}::uuid), (${adminId}::uuid)`,
  );
  await database.db
    .execute(sql`insert into experts (id, user_id, active, verified)
    values (${expertId}::uuid, ${expertUserId}::uuid, true, true)`);
  await database.db
    .execute(sql`insert into admin_sessions (session_id_hash, admin_id, mfa_verified_at, expires_at)
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
    current = current.cause as
      { message?: unknown; cause?: unknown } | undefined;
  }
  return result.join(" ");
}

afterAll(async () => {
  try {
    await upgradeDb?.stop();
  } finally {
    if (migrationFixtureRoot !== undefined) {
      rmSync(migrationFixtureRoot, { recursive: true, force: true });
    }
  }
}, 120_000);

describe("residency provider deadline corrective upgrade", () => {
  it("uses recorded 0019 metadata to apply 0020 and later migrations and fail legacy replay closed", async () => {
    upgradeDb = await startTestPostgres();
    await migrate(upgradeDb.db, { migrationsFolder: migrationsThrough(18) });
    const legacy = await seedGrantShortenedOrder(upgradeDb);
    await migrate(upgradeDb.db, { migrationsFolder: migrationsThrough(19) });
    const legacyInboxId = randomUUID();
    const legacyEventId = `legacy-${"x".repeat(256)}`;
    const legacyTerminalEventId = randomUUID();
    await upgradeDb.db
      .execute(sql`insert into expert_residency_provider_event_inbox (
      id, provider, external_event_id, payload_digest, authenticated,
      event_kind, processing_status
    ) values (${legacyInboxId}::uuid, 'legacy-provider', ${legacyEventId}, 'sha256:legacy', true,
      'settlement', 'pending')`);
    await upgradeDb.db
      .execute(sql`insert into expert_residency_provider_event_inbox (
      provider, external_event_id, payload_digest, authenticated,
      event_kind, processing_status, processing_result_digest, processed_at
    ) values ('legacy-provider', ${legacyTerminalEventId}, 'sha256:legacy-terminal',
      true, 'settlement', 'failed', ${`sha256:${"d".repeat(64)}`},
      transaction_timestamp())`);
    const after0019 = (
      await upgradeDb.db.execute<{
        providerDeadline: Date | string | null;
        paymentDeadline: Date | string;
      }>(sql`
      select provider_deadline as "providerDeadline", payment_deadline as "paymentDeadline"
      from expert_residency_orders
      where idempotency_key = ${legacy.idempotencyKey}
    `)
    ).rows[0];
    if (after0019 === undefined) throw new Error("legacy_order_missing");
    expect(after0019.providerDeadline).not.toBeNull();
    const effectivePaymentDeadline =
      after0019.paymentDeadline instanceof Date
        ? after0019.paymentDeadline
        : new Date(after0019.paymentDeadline);
    const fabricatedProviderDeadline =
      after0019.providerDeadline instanceof Date
        ? after0019.providerDeadline
        : new Date(after0019.providerDeadline ?? 0);
    expect(fabricatedProviderDeadline.getTime()).toBe(
      effectivePaymentDeadline.getTime(),
    );

    const migrations = readMigrationFiles({ migrationsFolder });
    const original0019 = migrations[19];
    const corrective0020 = migrations[20];
    const verification0021 = migrations[21];
    const durableOutcome0022 = migrations[22];
    const terminalImmutability0023 = migrations[23];
    if (
      original0019 === undefined ||
      corrective0020 === undefined ||
      verification0021 === undefined ||
      durableOutcome0022 === undefined ||
      terminalImmutability0023 === undefined
    ) {
      throw new Error("provider_deadline_migration_metadata_missing");
    }
    const metadataBefore = (
      await upgradeDb.db.execute<{
        id: number;
        hash: string;
        createdAt: string;
      }>(sql`
      select id, hash, created_at::text as "createdAt"
      from drizzle.__drizzle_migrations
      order by id
    `)
    ).rows;
    expect(metadataBefore).toHaveLength(20);
    expect(
      metadataBefore.filter(
        (row) => row.createdAt === String(original0019.folderMillis),
      ),
    ).toEqual([
      {
        id: 20,
        hash: original0019.hash,
        createdAt: String(original0019.folderMillis),
      },
    ]);
    expect(
      metadataBefore.some(
        (row) => row.createdAt === String(corrective0020.folderMillis),
      ),
    ).toBe(false);

    await upgradeDb.migrate();
    const metadataAfter = (
      await upgradeDb.db.execute<{
        id: number;
        hash: string;
        createdAt: string;
      }>(sql`
      select id, hash, created_at::text as "createdAt"
      from drizzle.__drizzle_migrations
      order by id
    `)
    ).rows;
    expect(metadataAfter).toHaveLength(24);
    expect(
      metadataAfter.filter(
        (row) => row.createdAt === String(original0019.folderMillis),
      ),
    ).toEqual(metadataBefore.slice(19));
    expect(
      metadataAfter.filter(
        (row) => row.createdAt === String(corrective0020.folderMillis),
      ),
    ).toEqual([
      {
        id: 21,
        hash: corrective0020.hash,
        createdAt: String(corrective0020.folderMillis),
      },
    ]);
    expect(
      metadataAfter.filter(
        (row) => row.createdAt === String(durableOutcome0022.folderMillis),
      ),
    ).toEqual([
      {
        id: 23,
        hash: durableOutcome0022.hash,
        createdAt: String(durableOutcome0022.folderMillis),
      },
    ]);
    expect(
      metadataAfter.filter(
        (row) => row.createdAt === String(verification0021.folderMillis),
      ),
    ).toEqual([
      {
        id: 22,
        hash: verification0021.hash,
        createdAt: String(verification0021.folderMillis),
      },
    ]);
    expect(
      metadataAfter.filter(
        (row) =>
          row.createdAt === String(terminalImmutability0023.folderMillis),
      ),
    ).toEqual([
      {
        id: 24,
        hash: terminalImmutability0023.hash,
        createdAt: String(terminalImmutability0023.folderMillis),
      },
    ]);
    const legacyEvent = (
      await upgradeDb.db.execute<{
        verificationId: string;
        verifierKeyVersion: string;
        authenticated: boolean;
        verifiedAt: Date | string;
        receivedAt: Date | string;
      }>(sql`select verification_id as "verificationId",
        verifier_key_version as "verifierKeyVersion", authenticated,
        verified_at as "verifiedAt", received_at as "receivedAt"
        from expert_residency_provider_event_inbox
        where external_event_id = ${legacyEventId}`)
    ).rows[0];
    expect(legacyEvent).toMatchObject({
      verificationId: `legacy-unverified:${legacyInboxId}`,
      verifierKeyVersion: "legacy-unverified",
      authenticated: false,
    });
    expect(legacyEvent!.verificationId.length).toBeLessThanOrEqual(128);
    expect(new Date(legacyEvent!.verifiedAt).toISOString()).toBe(
      new Date(legacyEvent!.receivedAt).toISOString(),
    );
    const legacyTerminal = (
      await upgradeDb.db.execute<{
        code: string;
        result: unknown;
        authenticated: boolean;
      }>(sql`select processing_result_code as code,
        processing_result as result, authenticated
        from expert_residency_provider_event_inbox
        where external_event_id = ${legacyTerminalEventId}`)
    ).rows[0];
    expect(legacyTerminal).toEqual({
      code: "legacy_unreconstructable",
      result: null,
      authenticated: false,
    });
    let terminalMutationError: unknown;
    try {
      await upgradeDb.db
        .execute(sql`update expert_residency_provider_event_inbox
        set processing_result_code = 'changed_after_upgrade'
        where external_event_id = ${legacyTerminalEventId}`);
    } catch (error) {
      terminalMutationError = error;
    }
    expect(messages(terminalMutationError)).toContain(
      "terminal expert provider event outcome is immutable",
    );

    const after0020 = (
      await upgradeDb.db.execute<{
        providerDeadline: Date | string | null;
        paymentDeadline: Date | string;
      }>(sql`
      select provider_deadline as "providerDeadline", payment_deadline as "paymentDeadline"
      from expert_residency_orders
      where idempotency_key = ${legacy.idempotencyKey}
    `)
    ).rows[0];
    if (after0020 === undefined)
      throw new Error("corrected_legacy_order_missing");
    const repo = new PostgresExpertResidencyRepository(upgradeDb.db);
    const futureProviderDeadline = (
      await upgradeDb.db.execute<{ providerDeadline: Date | string }>(sql`
      select transaction_timestamp() + interval '2 days' as "providerDeadline"
    `)
    ).rows[0]?.providerDeadline;
    if (futureProviderDeadline === undefined)
      throw new Error("database_time_missing");
    const providerDeadline =
      futureProviderDeadline instanceof Date
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
      providerDeadline: new Date(
        firstReplay.providerDeadline.getTime() + 86_400_000,
      ),
    };

    // Pre-0019 stored only this earlier effective deadline, not the candidate provider deadline.
    expect(after0020.providerDeadline).toBeNull();
    expect(effectivePaymentDeadline.getTime()).toBeLessThan(
      providerDeadline.getTime(),
    );
    await expect(repo.createCheckoutOrder(firstReplay)).rejects.toMatchObject({
      code: "checkout_idempotency_legacy_ambiguity",
    });
    await expect(
      repo.createCheckoutOrder(conflictingReplay),
    ).rejects.toMatchObject({
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
    expect(messages(insertError)).toContain(
      "new expert residency orders require provider deadline",
    );

    const postCorrectionCommand = {
      expertId: legacy.expertId,
      tariffKey: "legacy-shortened",
      providerDeadline: new Date(providerDeadline.getTime() + 86_400_000),
      idempotencyKey: "post-0020-exact-replay",
    };
    const postCorrectionOrder = await repo.createCheckoutOrder(
      postCorrectionCommand,
    );
    const postCorrectionDeadline = (
      await upgradeDb.db.execute<{
        providerDeadline: Date | string | null;
      }>(sql`
      select provider_deadline as "providerDeadline" from expert_residency_orders
      where id = ${postCorrectionOrder.orderId}::uuid
    `)
    ).rows[0]?.providerDeadline;
    expect(postCorrectionDeadline).not.toBeNull();
    await expect(
      repo.createCheckoutOrder(postCorrectionCommand),
    ).resolves.toMatchObject({
      orderId: postCorrectionOrder.orderId,
    });
  }, 120_000);
});
