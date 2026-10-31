import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createProductionWorkerRuntime } from "../../apps/worker/src/runtime.js";
import { composeReceiptRetention } from "../../apps/worker/src/receipt-disclosure-retention.js";
import { buildEarlyBirdRoleProvisioningSql } from "../../scripts/provision-early-bird-runtime-roles.mjs";
import { startPublicExpertGatewayProvider } from "../support/public-expert-gateway-provider.mjs";
import {
  constraintStateSql,
  indexStateSql,
} from "../../packages/db/src/testkit/migration-state.js";
import { beforeAll, afterAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import * as databaseExports from "../../packages/db/src/index.js";
import * as integrationExports from "../../packages/integrations/src/index.js";
import { PostgresExpertCampaignOrderRepository } from "../../packages/db/src/repositories/expert-campaign-order-repository.js";
import { lockPayerReceiptSelection } from "../../packages/db/src/repositories/payer-receipt-contact-repository.js";
import { PostgresExpertCampaignQuoteRepository } from "../../packages/db/src/repositories/expert-campaign-quote-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { startTestPostgres } from "../../packages/db/src/testkit/postgres.js";
const exports = databaseExports;
const crypto = integrationExports;
let database: ExpertReferralTestDatabase;
let tariffVersionId: string;
let provider: Awaited<ReturnType<typeof startPublicExpertGatewayProvider>>;
let gateway: integrationExports.ExperimentalGatewayIpc;
let gatewayLogin: string | undefined;
beforeAll(async () => {
  if (!process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL)
    throw Error("isolated_pg17_required");
  // Canonical capabilities have exactly one LOGIN member per cluster. Keep this
  // gateway isolated from other files using the shared external admin cluster.
  database = await startExpertReferralTestDatabase(undefined, {
    forceDisposableCluster: true,
  });
  expect(
    (await database.db.execute(sql`show server_version_num`)).rows[0],
  ).toEqual({ server_version_num: "170005" });
  await database.enableExpertReferralCommands();
  tariffVersionId = await database.createResidencyTariff({
    tariffKey: "PRO",
    displayName: "Про",
    priceMinor: 999000,
    durationSeconds: 2592000,
  });
  const login = "receipt_gateway_" + randomUUID().replaceAll("-", "");
  const password = randomBytes(24).toString("hex");
  const provision = await buildEarlyBirdRoleProvisioningSql({
    ii_tonya_wave_gateway: login,
  });
  const admin = await database.db.$client.connect();
  try {
    await admin.query(
      `create role ${login} login inherit password '${password}'`,
    );
    gatewayLogin = login;
    await admin.query(provision);
  } catch (error) {
    await admin.query("rollback");
    throw error;
  } finally {
    admin.release();
  }
  // The existing fixture starts BoundGateway with actual PgAuthority readiness,
  // authenticated IPC and durable contact cancellation, never a synthetic ACK.
  provider = await startPublicExpertGatewayProvider(
    database.db.$client.options.connectionString!,
    login,
    password,
    0,
  );
  gateway = new integrationExports.ExperimentalGatewayIpc({
    address: provider.address,
    key: Buffer.alloc(32, "k"),
    authKey: Buffer.alloc(32, "a"),
    timeoutMs: 10000,
  });
}, 120000);
afterAll(async () => {
  // Stop the gateway before removing its generated LOGIN or its database.
  // Keep shared capability roles and their canonical ACLs intact.
  try {
    await provider?.close();
  } finally {
    try {
      if (gatewayLogin) {
        await database.db.$client.query(`drop owned by ${gatewayLogin}`);
        await database.db.$client.query(`drop role ${gatewayLogin}`);
      }
    } finally {
      await database?.stop();
    }
  }
}, 120000);
function retention(
  repository: databaseExports.PostgresPayerReceiptContactRepository,
) {
  return composeReceiptRetention(
    {
      listExpiredBatch: (limit) => repository.listExpiredBatch(limit),
      redactExpiredSelection: async (plan) => {
        // Assert the real gateway's SQL revoke committed before any envelope is
        // erased. An IPC failure must never be replaced by a locally made ACK.
        for (const { id } of plan)
          expect(
            (
              await database.db.$client.query(
                "select revoked_at is not null as revoked from early_bird_gateway_contact_state where contact_id=$1",
                [id],
              )
            ).rows,
          ).toEqual([{ revoked: true }]);
        return repository.redactExpiredSelection(plan);
      },
    },
    { checkoutEnabled: true, gateway },
  );
}
async function setup() {
  expect(exports.PostgresPayerReceiptContactRepository).toBeTypeOf("function");
  const owner = await database.createExpertIdentity();
  const quote = await new PostgresExpertCampaignQuoteRepository(
    database.db,
  ).createQuote({
    userId: owner.userId,
    tariffVersionId,
    termMonths: 1,
    idempotencyKey: randomUUID(),
  });
  const vault = crypto.createPayerReceiptVault({
    activeKeyId: "r1",
    keys: new Map([["r1", new Uint8Array(32).fill(17)]]),
  });
  const repository = new exports.PostgresPayerReceiptContactRepository(
    database.db,
    vault,
    1,
  );
  const command = {
    userId: owner.userId,
    quoteId: quote.id,
    email: "payer@example.test",
    idempotencyKey: randomUUID(),
  };
  const orders = new PostgresExpertCampaignOrderRepository(
    database.db,
    vault as never,
  );
  return { owner, quote, repository, command, orders, vault };
}
// Isolated fixture time travel must reseal all changed authenticated metadata.
// Production retains immutable timestamps; no clock or mutation seam is added.
async function resealFixtureExpiry(
  s: Awaited<ReturnType<typeof setup>>,
  contactId: string,
  remainingMs: number,
) {
  const clock = (
    await database.db.execute<{ expiresAt: string }>(
      sql`select date_trunc('milliseconds',clock_timestamp()+${remainingMs}*interval '1 millisecond') as "expiresAt"`,
    )
  ).rows[0]!;
  const expiresAt = new Date(clock.expiresAt).toISOString();
  const metadata: integrationExports.PayerReceiptBinding = {
    id: contactId,
    quoteId: s.quote.id,
    userId: s.owner.userId,
    kind: "email",
    basis: "fiscal_payment_dec_plt_004_v1",
    capturedAt: new Date(Date.parse(expiresAt) - 86400000).toISOString(),
    expiresAt,
  };
  const sealed = s.vault.seal(s.command.email, metadata);
  await database.db.transaction(async (tx) => {
    await tx.execute(
      sql`alter table payer_receipt_contacts disable trigger payer_receipt_contact_guard`,
    );
    await tx.execute(
      sql`update payer_receipt_contacts set captured_at=${metadata.capturedAt}::timestamptz,expires_at=${expiresAt}::timestamptz,key_id=${sealed.keyId},ciphertext=${sealed.ciphertext} where id=${contactId}::uuid`,
    );
    await tx.execute(
      sql`alter table payer_receipt_contacts enable trigger payer_receipt_contact_guard`,
    );
  });
  async function assertAuthenticated() {
    const stored = (
      await database.db.execute<{
        capturedAt: string;
        expiresAt: string;
        keyId: string;
        ciphertext: string;
      }>(
        sql`select captured_at as "capturedAt",expires_at as "expiresAt",key_id as "keyId",ciphertext from payer_receipt_contacts where id=${contactId}::uuid`,
      )
    ).rows[0]!;
    expect(
      s.vault.open(
        { keyId: stored.keyId, ciphertext: stored.ciphertext },
        {
          ...metadata,
          capturedAt: new Date(stored.capturedAt).toISOString(),
          expiresAt: new Date(stored.expiresAt).toISOString(),
        },
      ),
    ).toBe(s.command.email);
  }
  await assertAuthenticated();
  return { assertAuthenticated, expiresAt };
}
it("captures privately, replays by plaintext equality and binds the exact selection", async () => {
  const s = await setup();
  const contact = await s.repository.capture(s.command);
  expect(await s.repository.capture(s.command)).toEqual(contact);
  await expect(
    s.repository.capture({ ...s.command, email: "changed@example.test" }),
  ).rejects.toThrow();
  const corrected = await s.repository.capture({
    ...s.command,
    email: "corrected@example.test",
    idempotencyKey: randomUUID(),
  });
  const orderCommand = {
    userId: s.owner.userId,
    expertId: s.owner.expertId,
    quoteId: s.quote.id,
    receiptContactId: contact.receiptContactId,
    idempotencyKey: randomUUID(),
  };
  const order = await s.orders.createCheckoutOrderWithReceipt(orderCommand);
  expect(await s.repository.capture(s.command)).toEqual(contact);
  await expect(
    s.repository.capture({ ...s.command, email: "changed@example.test" }),
  ).rejects.toThrow("PAYER_RECEIPT_CONFLICT");
  expect(await s.repository.receiptContactForOrder(order.id)).toEqual({
    email: "payer@example.test",
    authorityReference: `payer-receipt:${contact.receiptContactId}`,
  });
  expect((await s.orders.createCheckoutOrderWithReceipt(orderCommand)).id).toBe(
    order.id,
  );
  await expect(
    s.orders.createCheckoutOrderWithReceipt({
      ...orderCommand,
      receiptContactId: corrected.receiptContactId,
    }),
  ).rejects.toThrow();
  const stored = (
    await database.db.execute(
      sql`select * from payer_receipt_contacts where id=${contact.receiptContactId}::uuid`,
    )
  ).rows[0];
  expect(JSON.stringify(stored)).not.toContain("payer@example.test");
  await expect(
    database.db.execute(
      sql`update payer_receipt_contacts set ciphertext='replacement' where id=${contact.receiptContactId}::uuid`,
    ),
  ).rejects.toThrow();
});
it("foreign payer and missing contact cannot create an order", async () => {
  const s = await setup();
  const other = await database.createExpertIdentity();
  await expect(
    s.repository.capture({ ...s.command, userId: other.userId }),
  ).rejects.toThrow();
  await expect(
    s.orders.createCheckoutOrderWithReceipt({
      userId: s.owner.userId,
      expertId: s.owner.expertId,
      quoteId: s.quote.id,
      receiptContactId: randomUUID(),
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toThrow();
  expect(
    (
      await database.db.execute(
        sql`select count(*)::int n from expert_residency_orders where campaign_quote_id=${s.quote.id}::uuid`,
      )
    ).rows,
  ).toEqual([{ n: 0 }]);
});
it("cleanup redacts unselected contact after quote consumption while preserving the bound contact", async () => {
  const s = await setup();
  const selected = await s.repository.capture(s.command);
  const unused = await s.repository.capture({
    ...s.command,
    idempotencyKey: randomUUID(),
  });
  const order = await s.orders.createCheckoutOrderWithReceipt({
    userId: s.owner.userId,
    expertId: s.owner.expertId,
    quoteId: s.quote.id,
    receiptContactId: selected.receiptContactId,
    idempotencyKey: randomUUID(),
  });
  const cleanup = new exports.PostgresPayerReceiptContactRepository(
    database.db,
  );
  const empty = async () => ({});
  const runtime = createProductionWorkerRuntime({
    payerReceiptRetention: retention(cleanup),
    jobsRepository: {
      processDueBatch: empty,
      expireDueBatch: empty,
      listLocalReservations: async () => [],
      recordProviderUnavailable: async () => {},
      materializeOperatorCasesBatch: empty,
    },
    expertReferralJobsRepository: {
      expireDueBatch: async () => ({ examined: 0, changed: 0, failed: 0 }),
      listReconciliationBatch: async () => [],
      recordReconciliationMismatches: async () => {},
      replayDueBatch: async () => ({ examined: 0, granted: 0, cancelled: 0 }),
    },
    expertTelegramCheckoutRepository: {
      clearExpiredCheckoutUrls: async () => 0,
    },
    outboxRepository: {
      recoverExpiredDispatchLeases: async () => 0,
      recoverExpiredReconciliationLeases: async () => 0,
    },
    closeDatabase: async () => {},
    closeTelemetry: async () => {},
    now: () => new Date(),
  });
  try {
    expect(await runtime.runOnce()).toHaveProperty(
      "processorPrivacy.payerReceipt",
    );
  } finally {
    await runtime.close();
  }
  expect(
    (
      await database.db.execute(
        sql`select ciphertext from payer_receipt_contacts where id=${unused.receiptContactId}::uuid`,
      )
    ).rows,
  ).toEqual([{ ciphertext: null }]);
  expect(await s.repository.receiptContactForOrder(order.id)).toHaveProperty(
    "email",
    "payer@example.test",
  );
  expect(
    (
      await database.db.$client.query(
        "select contact_id from early_bird_gateway_contact_state where contact_id=$1 and revoked_at is not null",
        [selected.receiptContactId],
      )
    ).rows,
  ).toEqual([]);
});
it("legacy order replay cannot acquire a receipt binding", async () => {
  const s = await setup(),
    contact = await s.repository.capture(s.command);
  const command = {
    userId: s.owner.userId,
    expertId: s.owner.expertId,
    quoteId: s.quote.id,
    idempotencyKey: randomUUID(),
  };
  const legacy = await new PostgresExpertCampaignOrderRepository(
    database.db,
  ).createCheckoutOrder(command);
  await expect(
    s.orders.createCheckoutOrderWithReceipt({
      ...command,
      receiptContactId: contact.receiptContactId,
    }),
  ).rejects.toThrow("EXPERT_CAMPAIGN_IDEMPOTENCY_CONFLICT");
  expect(await s.repository.receiptContactForOrder(legacy.id)).toBeNull();
  expect(
    (
      await database.db.execute(
        sql`select count(*)::int n from payer_receipt_order_bindings where order_id=${legacy.id}::uuid`,
      )
    ).rows,
  ).toEqual([{ n: 0 }]);
});
it("bound selection crosses expiry while locked; cleanup skips the held row and preserves the order", async () => {
  const s = await setup(),
    contact = await s.repository.capture(s.command);
  const command = {
    userId: s.owner.userId,
    expertId: s.owner.expertId,
    quoteId: s.quote.id,
    receiptContactId: contact.receiptContactId,
    idempotencyKey: randomUUID(),
  };
  const order = await s.orders.createCheckoutOrderWithReceipt(command);
  const fixture = await resealFixtureExpiry(s, contact.receiptContactId, 3000);
  const held = await database.db.$client.connect();
  let selection:
    ReturnType<typeof s.repository.receiptContactForOrder> | undefined;
  let checkoutSelection:
    Promise<{ accepted: boolean; error?: string }> | undefined;
  try {
    await held.query("begin");
    await held.query(
      "select id from payer_receipt_contacts where id=$1 for update",
      [contact.receiptContactId],
    );
    expect(
      (
        await held.query(
          "select expires_at>clock_timestamp() as valid from payer_receipt_contacts where id=$1",
          [contact.receiptContactId],
        )
      ).rows[0].valid,
    ).toBe(true);
    selection = s.repository.receiptContactForOrder(order.id);
    // Exercise the exact checkout selector without the order transaction's
    // unrelated 250ms contention timeout, so expiry crosses a proven row wait.
    checkoutSelection = database.db
      .transaction((tx) =>
        lockPayerReceiptSelection(tx, command, s.vault as never),
      )
      .then(
        () => ({ accepted: true }),
        (error) => ({
          accepted: false,
          error: error instanceof Error ? error.message : "unknown",
        }),
      );
    let blocked = false;
    for (let n = 0; n < 200; n++) {
      const result = await database.db.$client.query(
        "select count(distinct pid)>=2 as waiting from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock' and query like '%payer_receipt_contacts%'",
      );
      if (result.rows[0].waiting) {
        blocked = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(blocked).toBe(true);
    // Wait for the database clock, with both selectors already proven blocked.
    await held.query(
      "select pg_sleep(greatest(0,extract(epoch from (expires_at-clock_timestamp())))+0.02) from payer_receipt_contacts where id=$1",
      [contact.receiptContactId],
    );
    expect(
      (
        await held.query(
          "select payer_receipt_redaction_due(c) as due from payer_receipt_contacts c where id=$1",
          [contact.receiptContactId],
        )
      ).rows[0].due,
    ).toBe(true);
    await retention(s.repository)();
    expect(
      (
        await held.query(
          "select ciphertext is not null as retained from payer_receipt_contacts where id=$1",
          [contact.receiptContactId],
        )
      ).rows[0].retained,
    ).toBe(true);
    await held.query("commit");
  } finally {
    await held.query("rollback");
    held.release();
  }
  expect(await selection!).toBeNull();
  expect(await checkoutSelection!).toEqual({
    accepted: false,
    error: "PAYER_RECEIPT_UNAVAILABLE",
  });
  // The intact stored envelope still authenticates after expiry and lock release.
  await fixture.assertAuthenticated();
  await expect(
    s.orders.createCheckoutOrderWithReceipt(command),
  ).resolves.toEqual(order);
  await retention(s.repository)();
  expect(
    (
      await database.db.execute(
        sql`select ciphertext,key_id,redacted_at is not null as redacted from payer_receipt_contacts where id=${contact.receiptContactId}::uuid`,
      )
    ).rows,
  ).toEqual([{ ciphertext: null, key_id: null, redacted: true }]);
  expect(
    (
      await database.db.execute(
        sql`select id from expert_residency_orders where id=${order.id}::uuid`,
      )
    ).rows,
  ).toEqual([{ id: order.id }]);
}, 15000);
it("foreign selection, tampered ciphertext and expired quotes fail without financial writes", async () => {
  const s = await setup(),
    other = await setup();
  const contact = await other.repository.capture(other.command);
  const command = {
    userId: s.owner.userId,
    expertId: s.owner.expertId,
    quoteId: s.quote.id,
    idempotencyKey: randomUUID(),
  };
  await expect(
    s.orders.createCheckoutOrderWithReceipt({
      ...command,
      receiptContactId: contact.receiptContactId,
    }),
  ).rejects.toThrow();
  const own = await s.repository.capture(s.command);
  await database.db.transaction(async (tx) => {
    await tx.execute(
      sql`alter table payer_receipt_contacts disable trigger payer_receipt_contact_guard`,
    );
    await tx.execute(
      sql`update payer_receipt_contacts set ciphertext='prc1.'||repeat('A',80) where id=${own.receiptContactId}::uuid`,
    );
    await tx.execute(
      sql`alter table payer_receipt_contacts enable trigger payer_receipt_contact_guard`,
    );
  });
  await expect(
    s.orders.createCheckoutOrderWithReceipt({
      ...command,
      receiptContactId: own.receiptContactId,
    }),
  ).rejects.toThrow();
  expect(
    (
      await database.db.execute(
        sql`select count(*)::int n from expert_residency_orders where campaign_quote_id=${s.quote.id}::uuid`,
      )
    ).rows,
  ).toEqual([{ n: 0 }]);
  await database.db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role=replica`);
    await tx.execute(
      sql`update expert_campaign_quotes set quoted_at=quoted_at-interval '1 hour',expires_at=expires_at-interval '1 hour',calculation_timestamp=calculation_timestamp-interval '1 hour' where id=${s.quote.id}::uuid`,
    );
  });
  await expect(
    s.repository.capture({ ...s.command, idempotencyKey: randomUUID() }),
  ).rejects.toThrow();
});
it("expired unbound capture cannot win a cleanup/checkout race", async () => {
  const s = await setup(),
    contact = await s.repository.capture(s.command);
  await resealFixtureExpiry(s, contact.receiptContactId, -1000);
  const results = await Promise.allSettled([
    retention(s.repository)(),
    s.orders.createCheckoutOrderWithReceipt({
      userId: s.owner.userId,
      expertId: s.owner.expertId,
      quoteId: s.quote.id,
      receiptContactId: contact.receiptContactId,
      idempotencyKey: randomUUID(),
    }),
  ]);
  expect(results[0]!.status).toBe("fulfilled");
  expect(results[1]!.status).toBe("rejected");
  // SKIP LOCKED can leave the row for the next bounded cycle when checkout won its lock.
  await retention(s.repository)();
  expect(
    (
      await database.db.execute(
        sql`select ciphertext from payer_receipt_contacts where id=${contact.receiptContactId}::uuid`,
      )
    ).rows,
  ).toEqual([{ ciphertext: null }]);
  expect(
    (
      await database.db.execute(
        sql`select count(*)::int n from expert_residency_orders where campaign_quote_id=${s.quote.id}::uuid`,
      )
    ).rows,
  ).toEqual([{ n: 0 }]);
});
it("migration50 catalogue and provenance match a fresh SQL replay", async () => {
  const folder = "packages/db/migrations";
  const state = JSON.parse(
    readFileSync(`${folder}/state/0050_sql_objects.json`, "utf8"),
  ) as { constraints: unknown; indexes: unknown };
  // This is the historical 0050 boundary, independent of later live schema.
  const historical = await startTestPostgres();
  try {
    const journal = JSON.parse(
      readFileSync(`${folder}/meta/_journal.json`, "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    for (const entry of journal.entries.filter((entry) => entry.idx <= 50))
      await historical.db.execute(
        sql.raw(readFileSync(`${folder}/${entry.tag}.sql`, "utf8")),
      );
    expect(
      (await historical.db.$client.query(constraintStateSql)).rows,
    ).toEqual(state.constraints);
    expect((await historical.db.$client.query(indexStateSql)).rows).toEqual(
      state.indexes,
    );
  } finally {
    await historical.stop();
  }
  const manifest = JSON.parse(
    readFileSync(`${folder}/state/0050_manifest.json`, "utf8"),
  ) as {
    snapshotSha256: string;
    sqlObjectsSha256: string;
    migrations: { idx: number; tag: string; sha256: string }[];
  };
  const hash = (path: string) =>
    createHash("sha256").update(readFileSync(path)).digest("hex");
  expect(hash(`${folder}/meta/0050_snapshot.json`)).toBe(
    manifest.snapshotSha256,
  );
  expect(hash(`${folder}/state/0050_sql_objects.json`)).toBe(
    manifest.sqlObjectsSha256,
  );
  for (const entry of manifest.migrations)
    expect(hash(`${folder}/${entry.tag}.sql`)).toBe(entry.sha256);
});
