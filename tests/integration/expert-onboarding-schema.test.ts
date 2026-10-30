import { createDb } from "../../packages/db/src/client.js";
import { readFileSync } from "node:fs";
import {
  constraintStateSql,
  indexStateSql,
} from "../../packages/db/src/testkit/migration-state.js";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresPrivacyRepository } from "../../packages/db/src/repositories/privacy-repository.js";
import { PostgresExpertCampaignQuoteRepository } from "../../packages/db/src/repositories/expert-campaign-quote-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";

const dbRequire = createRequire(
  new URL("../../packages/db/package.json", import.meta.url),
);
const { PostgreSqlContainer } = dbRequire("@testcontainers/postgresql") as {
  PostgreSqlContainer: new (image: string) => {
    start(): Promise<{ getConnectionUri(): string; stop(): Promise<unknown> }>;
  };
};
let container:
  { getConnectionUri(): string; stop(): Promise<unknown> } | undefined;
const previousAdminUrl = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
let database: ExpertReferralTestDatabase;
function pgFailure(
  error: unknown,
): { code: string; message: string } | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if (
    "code" in error &&
    typeof error.code === "string" &&
    "message" in error &&
    typeof error.message === "string"
  )
    return { code: error.code, message: error.message };
  return "cause" in error ? pgFailure(error.cause) : undefined;
}
async function rejected(query: ReturnType<typeof sql>, code = "23514") {
  await expect(
    database.db.$client.query(queryText(query)),
  ).rejects.toMatchObject({ code });
}
import { PgDialect } from "drizzle-orm/pg-core";
function queryText(query: ReturnType<typeof sql>) {
  const compiled = new PgDialect().sqlToQuery(query);
  return { text: compiled.sql, values: compiled.params };
}
async function apply(userId: string) {
  return database.db.execute(
    sql`insert into expert_onboarding_applications(user_id) values(${userId}::uuid) returning *`,
  );
}
describe("applicant queue foundation (PG17.5)", () => {
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-bookworm").start();
    process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL = container.getConnectionUri();
    database = await startExpertReferralTestDatabase();
    expect(
      (await database.db.execute(sql`show server_version_num`)).rows[0]
        ?.server_version_num,
    ).toBe("170005");
  }, 120_000);
  afterAll(async () => {
    try {
      await database?.stop();
    } finally {
      await container?.stop();
      if (previousAdminUrl === undefined)
        delete process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
      else process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL = previousAdminUrl;
    }
  }, 120_000);
  it("defaults to pending before expert creation and approval never creates an expert or payment", async () => {
    const user = await database.createUser();
    const row = (await apply(user)).rows[0]!;
    expect(row).toMatchObject({
      user_id: user,
      verification_status: "pending",
      onboarding_stage: null,
      campaign_quote_id: null,
      archived_at: null,
      archive_until_date: null,
    });
    expect(Number.isFinite(Date.parse(String(row.created_at)))).toBe(true);
    expect(row.updated_at).toBe(row.created_at);
    await database.db.execute(
      sql`update expert_onboarding_applications set verification_status='approved' where user_id=${user}::uuid`,
    );
    expect(
      (
        await database.db.execute(
          sql`select (select count(*)::int from experts where user_id=${user}::uuid) experts,(select count(*)::int from expert_residency_orders) orders,(select count(*)::int from expert_referral_ledger_entries) ledger`,
        )
      ).rows[0],
    ).toEqual({ experts: 0, orders: 0, ledger: 0 });
  });
  it("guards repeated applications and immutable user identity", async () => {
    const user = await database.createUser();
    await apply(user);
    await rejected(
      sql`insert into expert_onboarding_applications(user_id) values(${user}::uuid)`,
      "P0001",
    );
    const other = await database.createUser();
    await apply(other);
    await rejected(
      sql`update expert_onboarding_applications set user_id=${user}::uuid where user_id=${other}::uuid`,
      "23514",
    );
    await rejected(
      sql`insert into expert_onboarding_applications(user_id) values(${randomUUID()}::uuid)`,
      "23503",
    );
  });
  it("binds an optional quote to its real owner and rejects foreign or absent quotes on insert and update", async () => {
    const owner = await database.createUser();
    const other = await database.createUser();
    const tariff = await database.createResidencyTariff({
      tariffKey: "PRO",
      displayName: "PRO",
      priceMinor: 999000,
      durationSeconds: 2592000,
    });
    const quote = await new PostgresExpertCampaignQuoteRepository(
      database.db,
    ).createQuote({
      userId: owner,
      tariffVersionId: tariff,
      termMonths: 1,
      idempotencyKey: randomUUID(),
    });
    await database.db.execute(
      sql`insert into expert_onboarding_applications(user_id,campaign_quote_id) values(${owner}::uuid,${quote.id}::uuid)`,
    );
    await rejected(
      sql`insert into expert_onboarding_applications(user_id,campaign_quote_id) values(${other}::uuid,${quote.id}::uuid)`,
      "23503",
    );
    const absentQuoteOwner = await database.createUser();
    await rejected(
      sql`insert into expert_onboarding_applications(user_id,campaign_quote_id) values(${absentQuoteOwner}::uuid,${randomUUID()}::uuid)`,
      "23503",
    );
    await apply(other);
    await rejected(
      sql`update expert_onboarding_applications set campaign_quote_id=${quote.id}::uuid where user_id=${other}::uuid`,
      "23514",
    );
    await rejected(
      sql`update expert_onboarding_applications set campaign_quote_id=${randomUUID()}::uuid where user_id=${other}::uuid`,
      "23514",
    );
    expect(
      (
        await database.db.execute(
          sql`select price_minor::text from expert_campaign_quotes where id=${quote.id}::uuid`,
        )
      ).rows[0]?.price_minor,
    ).toBe("599400");
  });
  it("accepts every declared verification/stage value and rejects unknown values", async () => {
    const user = await database.createUser();
    await apply(user);
    for (const verification of ["pending", "approved", "rejected"]) {
      for (const stage of [
        null,
        "interview",
        "card_draft",
        "manager_review",
        "promo_check",
        "payment_ready",
      ]) {
        await database.db.execute(
          sql`update expert_onboarding_applications set verification_status=${verification},onboarding_stage=${stage} where user_id=${user}::uuid`,
        );
      }
    }
    await rejected(
      sql`update expert_onboarding_applications set verification_status='verified' where user_id=${user}::uuid`,
    );
    await rejected(
      sql`update expert_onboarding_applications set onboarding_stage='complete' where user_id=${user}::uuid`,
    );
  });
  it.each([
    [null, "2026-04-30"],
    ["2026-01-31T12:00:00Z", null],
    ["2026-01-31T12:00:00Z", "2026-01-30"],
    ["2026-01-31T12:00:00Z", "2026-04-30T12:00:00.001Z"],
    ["2026-01-31T12:00:00Z", "2026-01-31T11:59:59.999Z"],
    ["infinity", "2026-04-30"],
    ["-infinity", "2026-04-30"],
    ["2026-01-31T12:00:00Z", "infinity"],
    ["2026-01-31T12:00:00Z", "-infinity"],
  ])("rejects invalid archive pair %s / %s", async (start, end) => {
    const user = await database.createUser();
    await apply(user);
    await rejected(
      sql`update expert_onboarding_applications set archived_at=${start}::timestamptz,archive_until_date=${end}::timestamptz where user_id=${user}::uuid`,
    );
  });
  it("uses UTC timestamps and calendar months, including clamped month ends, independent of session timezone", async () => {
    const user = await database.createUser();
    await apply(user);
    const client = await database.db.$client.connect();
    try {
      await client.query("set timezone='Pacific/Honolulu'");
      await client.query(
        "update expert_onboarding_applications set archived_at='2026-01-31T23:30:00Z',archive_until_date='2026-04-30T23:30:00Z' where user_id=$1",
        [user],
      );
      await client.query(
        "update expert_onboarding_applications set archived_at='2026-01-31T00:30:00Z',archive_until_date='2026-01-31T00:30:00Z' where user_id=$1",
        [user],
      );
      await expect(
        client.query(
          "update expert_onboarding_applications set archive_until_date='2026-01-30' where user_id=$1",
          [user],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await client.query(
        "update expert_onboarding_applications set archived_at='2025-11-30T12:00:00Z',archive_until_date='2026-02-28T12:00:00Z' where user_id=$1",
        [user],
      );
      await expect(
        client.query(
          "update expert_onboarding_applications set archive_until_date='2026-03-01' where user_id=$1",
          [user],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await client.query(
        "update expert_onboarding_applications set archived_at=null,archive_until_date=null where user_id=$1",
        [user],
      );
    } finally {
      await client.query("reset timezone");
      client.release();
    }
  });
  it("matches the hand-authored state supplement for new constraints and indexes", async () => {
    const expected = JSON.parse(
      readFileSync(
        "packages/db/migrations/state/0084_sql_objects.json",
        "utf8",
      ),
    ) as {
      constraints: Array<{ table_name: string }>;
      indexes: Array<{ table_name: string }>;
    };
    const constraints = (await database.db.execute(sql.raw(constraintStateSql)))
      .rows;
    const indexes = (await database.db.execute(sql.raw(indexStateSql))).rows;
    expect(constraints).toEqual(expected.constraints);
    expect(indexes).toEqual(expected.indexes);
  });
  it("preserves existing user, expert and integer-money history when applying the additive migration", async () => {
    // Replay only the predecessor prefix in a separate disposable database;
    // later foreign keys and triggers remain intact in the full-chain fixture.
    const historicalName = `onboarding_${randomUUID().replaceAll("-", "")}`;
    await database.db.$client.query(`create database "${historicalName}"`);
    const uri = new URL(container!.getConnectionUri());
    uri.pathname = historicalName;
    const historical = createDb(uri.toString());
    const client = await historical.$client.connect();
    try {
      const journal = JSON.parse(
        readFileSync("packages/db/migrations/meta/_journal.json", "utf8"),
      ) as { entries: Array<{ idx: number; tag: string }> };
      for (const entry of journal.entries.filter((entry) => entry.idx < 51)) {
        await client.query(
          readFileSync(`packages/db/migrations/${entry.tag}.sql`, "utf8"),
        );
      }
      const user = await client.query<{ id: string }>(
        "insert into users default values returning id",
      );
      const id = user.rows[0]!.id;
      await client.query(
        "insert into experts(user_id,active,verified) values($1,false,false)",
        [id],
      );
      const seededPackage = await client.query<{ id: string }>(
        "insert into message_packages(user_id,granted_messages,grant_idempotency_key) values($1,100,$2) returning id",
        [id, `historical-package:${id}`],
      );
      await client.query(
        "insert into message_ledger_entries(package_id,entry_kind,delta,idempotency_key) values($1,'grant',100,$2)",
        [seededPackage.rows[0]!.id, `historical-grant:${id}`],
      );
      const before = await client.query(
        "select (select jsonb_agg(to_jsonb(u)) from users u) users,(select jsonb_agg(to_jsonb(e)) from experts e) experts,(select jsonb_agg(to_jsonb(q)) from expert_campaign_quotes q) quotes,(select jsonb_agg(to_jsonb(t)) from expert_residency_tariff_versions t) tariffs,(select jsonb_agg(to_jsonb(l)) from expert_referral_ledger_entries l) ledger,(select jsonb_agg(to_jsonb(m)) from message_ledger_entries m) messages,(select jsonb_agg(to_jsonb(p)) from message_packages p) packages",
      );
      await client.query(
        readFileSync(
          "packages/db/migrations/0051_expert_onboarding_applications.sql",
          "utf8",
        ),
      );
      // Keep the historical supplement pinned at its own migration boundary.
      const expected51 = JSON.parse(
        readFileSync(
          "packages/db/migrations/state/0051_sql_objects.json",
          "utf8",
        ),
      ) as { constraints: unknown[]; indexes: unknown[] };
      expect((await client.query(constraintStateSql)).rows).toEqual(
        expected51.constraints,
      );
      expect((await client.query(indexStateSql)).rows).toEqual(
        expected51.indexes,
      );
      const after = await client.query(
        "select (select jsonb_agg(to_jsonb(u)) from users u) users,(select jsonb_agg(to_jsonb(e)) from experts e) experts,(select jsonb_agg(to_jsonb(q)) from expert_campaign_quotes q) quotes,(select jsonb_agg(to_jsonb(t)) from expert_residency_tariff_versions t) tariffs,(select jsonb_agg(to_jsonb(l)) from expert_referral_ledger_entries l) ledger,(select jsonb_agg(to_jsonb(m)) from message_ledger_entries m) messages,(select jsonb_agg(to_jsonb(p)) from message_packages p) packages",
      );
      expect(after.rows).toEqual(before.rows);
      expect(
        (
          await client.query(
            "select count(*)::int count from expert_onboarding_applications",
          )
        ).rows[0]?.count,
      ).toBe(0);
    } finally {
      client.release();
      await historical.$client.end();
      await database.db.$client.query(`drop database "${historicalName}"`);
    }
  });
  it("erases only the subject application after captured manifests while preserving both users' ledger facts", async () => {
    const subject = await database.createUserWithPackage(100);
    const other = await database.createUserWithPackage(200);
    await apply(subject);
    await apply(other);
    const before = await database.db.execute(
      sql`select to_jsonb(l) fact from message_ledger_entries l order by l.id`,
    );
    const otherBefore = await database.db.execute(
      sql`select * from expert_onboarding_applications where user_id=${other}::uuid`,
    );
    let captureObservedApplication = false;
    const processors = [
      "object_store",
      "selarti",
      "planerka",
      "make_projection",
    ] as const;
    const repository = new PostgresPrivacyRepository(database.db, {
      privacyMutationCapability: {
        enabled: true,
        captureManifests: async (userId) => {
          expect(userId).toBe(subject);
          captureObservedApplication =
            (
              await database.db.execute(
                sql`select id from expert_onboarding_applications where user_id=${subject}::uuid`,
              )
            ).rows.length === 1;
          return processors.map((processor) => ({
            processor,
            ciphertext: `ciphertext:${processor}`,
            keyReference: `test-key:${processor}`,
            algorithm: "test-envelope-v1",
            version: "1",
            subjectDeletionKeyHash: `sha256:${processor}`,
          }));
        },
        verifyEnvelope: () => true,
      },
    });
    const receipt = await repository.startErasureAtomically({
      targetUserId: subject,
      correlationId: `onboarding-erase:${subject}`,
      idempotencyKey: `onboarding-erase:${subject}`,
      pseudonym: "hmac:test-onboarding-erasure",
    });
    expect(captureObservedApplication).toBe(true);
    expect(receipt.ledgerFactsPreserved).toBe(1);
    expect(
      (
        await database.db.execute(
          sql`select id from expert_onboarding_applications where user_id=${subject}::uuid`,
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await database.db.execute(
          sql`select * from expert_onboarding_applications where user_id=${other}::uuid`,
        )
      ).rows,
    ).toEqual(otherBefore.rows);
    expect(
      (
        await database.db.execute(
          sql`select to_jsonb(l) fact from message_ledger_entries l order by l.id`,
        )
      ).rows,
    ).toEqual(before.rows);
    expect(
      (
        await database.db.execute(
          sql`select processor from privacy_deletion_manifests where deletion_job_id=${receipt.jobId}::uuid order by processor`,
        )
      ).rows.map((r) => r.processor),
    ).toEqual(["make_projection", "object_store", "planerka", "selarti"]);
  });

  it("rolls applicant deletion back with manifests and identity cleanup when a later erasure mutation fails", async () => {
    const subject = await database.createUserWithPackage(100);
    await apply(subject);
    await database.db.execute(
      sql`insert into channel_identities(user_id,provider,external_id) values(${subject}::uuid,'test-onboarding-rollback',${subject})`,
    );
    const before = (
      await database.db.execute(
        sql`select * from expert_onboarding_applications where user_id=${subject}::uuid`,
      )
    ).rows;
    // Real PostgreSQL failure at the later mapping deletion proves the earlier
    // application deletion, manifest inserts, and user deactivation roll back together.
    await database.db.execute(
      sql.raw(`CREATE FUNCTION onboarding_test_reject_identity_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.provider='test-onboarding-rollback' THEN RAISE EXCEPTION 'onboarding_erasure_rollback' USING ERRCODE='23514'; END IF; RETURN OLD; END $$;
      CREATE TRIGGER onboarding_test_erasure_rollback BEFORE DELETE ON channel_identities FOR EACH ROW EXECUTE FUNCTION onboarding_test_reject_identity_delete();`),
    );
    const processors = [
      "object_store",
      "selarti",
      "planerka",
      "make_projection",
    ] as const;
    const repository = new PostgresPrivacyRepository(database.db, {
      privacyMutationCapability: {
        enabled: true,
        captureManifests: async () =>
          processors.map((processor) => ({
            processor,
            ciphertext: `ciphertext:${processor}`,
            keyReference: `test-key:${processor}`,
            algorithm: "test-envelope-v1",
            version: "1",
            subjectDeletionKeyHash: `sha256:${processor}`,
          })),
        verifyEnvelope: () => true,
      },
    });
    try {
      const outcome = await repository
        .startErasureAtomically({
          targetUserId: subject,
          correlationId: `onboarding-rollback:${subject}`,
          idempotencyKey: `onboarding-rollback:${subject}`,
          pseudonym: "hmac:test-onboarding-rollback",
        })
        .then(() => "accepted", pgFailure);
      expect(outcome).toEqual({
        code: "23514",
        message: "onboarding_erasure_rollback",
      });
      expect(
        (
          await database.db.execute(
            sql`select * from expert_onboarding_applications where user_id=${subject}::uuid`,
          )
        ).rows,
      ).toEqual(before);
      expect(
        (
          await database.db.execute(
            sql`select (select active from users where id=${subject}::uuid) active,(select count(*)::int from channel_identities where user_id=${subject}::uuid) identities,(select count(*)::int from privacy_deletion_jobs where user_id=${subject}::uuid) jobs,(select count(*)::int from message_ledger_entries l join message_packages p on p.id=l.package_id where p.user_id=${subject}::uuid) ledger`,
          )
        ).rows[0],
      ).toEqual({ active: true, identities: 1, jobs: 0, ledger: 1 });
    } finally {
      await database.db.execute(
        sql.raw(
          "DROP TRIGGER onboarding_test_erasure_rollback ON channel_identities; DROP FUNCTION onboarding_test_reject_identity_delete();",
        ),
      );
    }
  });
});
