import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { migrateDb } from "../../packages/db/src/client.js";
import { seedClientConsent } from "../../packages/db/src/testkit/client-consent.js";
import { saveExpertOfferProfile } from "../../packages/db/src/repositories/expert-offer-v2.js";
import {
  hasUnresolvedSalesRequest,
  PostgresExpertSeparatedSalesRepository,
} from "../../packages/db/src/repositories/expert-separated-sales-repository.js";
import { PostgresResidentVerificationRepository } from "../../packages/db/src/repositories/resident-verification-repository.js";
import { PostgresExpertVerificationRepository } from "../../packages/db/src/repositories/expert-verification-repository.js";
import { PostgresPayerReceiptContactRepository } from "../../packages/db/src/repositories/payer-receipt-contact-repository.js";
import { PostgresExpertSalesScheduler } from "../../packages/db/src/repositories/expert-sales-scheduler.js";
import { startPublicHeldOnboardingFixture } from "../support/public-held-onboarding-fixture.js";

let fixture: Awaited<ReturnType<typeof startPublicHeldOnboardingFixture>>;
let prefix: string;
let tariff: string;
let prior: Awaited<ReturnType<typeof approvedOwner>>;
let pending: Awaited<ReturnType<typeof approvedOwner>>;
let future: Awaited<ReturnType<typeof approvedOwner>>;
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
beforeAll(async () => {
  prefix = await mkdtemp(join(tmpdir(), "public-terminal-prefix-"));
  await mkdir(join(prefix, "meta"));
  const journal = JSON.parse(
    await readFile("packages/db/migrations/meta/_journal.json", "utf8"),
  );
  const entries = journal.entries.filter(
    (entry: { idx: number }) => entry.idx <= 85,
  );
  expect(entries).toHaveLength(86);
  for (const entry of entries) {
    const name = `${entry.tag}.sql`;
    await copyFile(join("packages/db/migrations", name), join(prefix, name));
    expect(digest(await readFile(join(prefix, name), "utf8"))).toBe(
      digest(await readFile(join("packages/db/migrations", name), "utf8")),
    );
  }
  await writeFile(
    join(prefix, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries }),
  );
  fixture = await startPublicHeldOnboardingFixture({
    replay: (db) => migrateDb(db, prefix),
  });
  expect(
    (await fixture.database.db.execute(sql`show server_version_num`)).rows[0]
      ?.server_version_num,
  ).toBe("170005");
  tariff = await fixture.database.createResidencyTariff({
    tariffKey: "PRO",
    displayName: "PRO",
    priceMinor: 999000,
    durationSeconds: 2592000,
  });
  // All base admissions occur while this genuinely approved tariff is current.
  prior = await approvedOwner();
  pending = await approvedOwner();
  future = await approvedOwner();
}, 180000);
afterAll(async () => {
  try {
    await fixture?.close();
  } finally {
    if (prefix) await rm(prefix, { recursive: true, force: true });
  }
}, 120000);

async function approvedOwner() {
  const database = fixture.database;
  const userId = await database.createUser();
  const chat = String(Math.floor(Math.random() * 900000000) + 100000000);
  const policy = {
    botId: "717171",
    botKey: "terminal-refresh",
    messagingConsentPolicyVersion: "client-messaging-v1",
  };
  const scope = { ...policy, telegramUserId: chat, chatId: chat };
  const event = () => {
    const requestKey = randomUUID();
    return { ...scope, requestKey, requestDigest: digest(requestKey) };
  };
  await database.db.execute(
    sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status) values(${userId}::uuid,'telegram',${chat},${policy.botKey},${chat},'active')`,
  );
  await seedClientConsent(database.db, userId, "client_messaging");
  await saveExpertOfferProfile(database.db, {
    userId,
    cityCode: "kazan",
    millionCity: false,
    serviceFormat: "offline",
    ticketMinor: "300000",
    participantKind: "expert",
    idempotencyKey: randomUUID(),
  });
  // Genuine grandfathered form cohort: production creates its immutable version on submit.
  await database.db.execute(
    sql`insert into residents_applications(user_id,bot_id,bot_key,channel_identity_id,telegram_user_id,chat_id,form_version,policy_version,education_requirement) select ${userId}::uuid,${scope.botId},${scope.botKey},id,${chat},${chat},1,'resident_education_unknown_v1','unknown_manual_review' from channel_identities where user_id=${userId}::uuid`,
  );
  const sales = new PostgresExpertSeparatedSalesRepository(database.db, policy);
  const forms = new PostgresResidentVerificationRepository(database.db, policy);
  const base = (await sales.transition({
    ...event(),
    tariffVersionId: tariff,
  }))!;
  let state = await sales.transition({
    ...event(),
    baseId: base.id,
    revision: 0,
    action: "positive",
  });
  state = await sales.transition({
    ...event(),
    baseId: base.id,
    revision: state!.revision,
    action: "base",
  });
  await sales.transition({
    ...event(),
    baseId: base.id,
    revision: state!.revision,
    action: "month",
  });
  let form = await forms.mutate({ ...event(), action: "start" });
  form = await forms.mutate({
    ...event(),
    action: "patch",
    expectedRevision: form.revision,
    patch: {
      roles: ["EXPERT"],
      primaryRole: "EXPERT",
      category: "BASIC",
      tax: "SELF_EMPLOYED",
      city: "Казань",
      socialLinks: ["https://example.com/expert"],
      motivation: "Практика",
      specialization: "Психология",
      averageCheckMinor: "300000",
    },
  });
  await forms.mutate({
    ...event(),
    action: "submit",
    expectedRevision: form.revision,
  });
  const bridge = (
    await database.db.execute<{ application: string; quote: string }>(
      sql`select application_id as application,quote_id as quote from expert_sales_form_bridges where user_id=${userId}::uuid`,
    )
  ).rows[0]!;
  const manager = await database.createUser();
  const session = `sha256:${digest(randomUUID())}`;
  await database.db.execute(
    sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${session},${manager}::uuid,clock_timestamp(),clock_timestamp()+interval '1 hour')`,
  );
  await database.db.execute(
    sql`insert into admin_role_assignments(admin_id,role) values(${manager}::uuid,'support')`,
  );
  const verification = new PostgresExpertVerificationRepository(database.db, {
    providerMode: "test",
    messagingConsentPolicyVersion: policy.messagingConsentPolicyVersion,
  });
  const decision = await verification.decide({
    sessionHash: session,
    applicationId: bridge.application,
    decision: "approved",
    reasonCode: "identity_verified",
    idempotencyKey: randomUUID(),
  });
  const invoiceId = decision.invoiceId!;
  await new PostgresPayerReceiptContactRepository(
    database.db,
    fixture.vault,
    30,
  ).capture({
    userId,
    quoteId: bridge.quote,
    email: "synthetic@example.com",
    idempotencyKey: randomUUID(),
  });
  const checkout = await fixture.runtime.held.createCheckout({ invoiceId });
  const unresolved = () =>
    database.db.transaction((tx) => hasUnresolvedSalesRequest(tx, userId));
  expect(await unresolved()).toBe(true);
  return { userId, invoiceId, paymentId: checkout.paymentId, unresolved };
}

async function cancelAfterExpiry(
  f: Awaited<ReturnType<typeof approvedOwner>>,
  advance = true,
) {
  if (advance) await fixture.advance(86410);
  await fixture.waiting(f.paymentId);
  await fixture.runtime.held.reconcile(f.invoiceId);
  const operations = (
    await fixture.database.db.execute(
      sql`select r.kind,r.state,exists(select 1 from public_expert_payment_resolutions a where a.request_id=r.id and a.kind='applied') as applied,legacy.status from public_expert_payment_requests r join expert_sales_provider_requests legacy on legacy.id=r.id where r.invoice_id=${f.invoiceId}::uuid order by r.kind`,
    )
  ).rows;
  expect(operations).toEqual([
    {
      kind: "onboarding_cancel",
      state: "resolved",
      applied: true,
      status: expect.any(String),
    },
    {
      kind: "onboarding_create",
      state: "bound",
      applied: false,
      status: "dispatched",
    },
  ]);
  // A terminal sibling does not resolve this CREATE's independent durable request.
  expect(await f.unresolved()).toBe(true);
  await fixture.runtime.held.reconcile(f.invoiceId);
  expect(
    (
      await fixture.database.db.execute(
        sql`select status from expert_onboarding_invoices where id=${f.invoiceId}::uuid`,
      )
    ).rows,
  ).toEqual([{ status: "cancelled" }]);
  expect(
    (
      await fixture.database.db.execute(
        sql`select count(*)::int n from public_expert_payment_requests r join public_expert_payment_resolutions a on a.request_id=r.id and a.kind='applied' where r.invoice_id=${f.invoiceId}::uuid`,
      )
    ).rows,
  ).toEqual([{ n: 2 }]);
}

async function replacement(f: Awaited<ReturnType<typeof approvedOwner>>) {
  expect(await f.unresolved()).toBe(false);
  const scheduler = new PostgresExpertSalesScheduler(fixture.database.db);
  expect((await scheduler.refresh(50)).failed).toBe(0);
  expect(
    (
      await fixture.database.db.execute(
        sql`select sales_attempt_number,status from expert_onboarding_invoices where user_id=${f.userId}::uuid order by sales_attempt_number`,
      )
    ).rows,
  ).toEqual([
    { sales_attempt_number: 1, status: "cancelled" },
    { sales_attempt_number: 2, status: "pending" },
  ]);
  await scheduler.refresh(50);
  expect(
    (
      await fixture.database.db.execute(
        sql`select count(*)::int n from expert_onboarding_invoices where user_id=${f.userId}::uuid`,
      )
    ).rows,
  ).toEqual([{ n: 2 }]);
  expect(
    (
      await fixture.database.db.execute(
        sql`select count(*)::int n from expert_sales_notices n join expert_onboarding_invoices i on i.id=n.invoice_id where i.user_id=${f.userId}::uuid and i.sales_attempt_number=2 and n.kind='refresh'`,
      )
    ).rows,
  ).toEqual([{ n: 1 }]);
  expect(
    (
      await fixture.database.db.execute(
        sql`select count(*)::int n from expert_onboarding_payment_facts where user_id=${f.userId}::uuid`,
      )
    ).rows,
  ).toEqual([{ n: 0 }]);
}

it("repairs already committed public cancellation through an actual0085→0086 upgrade and permits one canonical replacement", async () => {
  const f = prior;
  await cancelAfterExpiry(f);
  expect(await f.unresolved()).toBe(true);
  // The SQL invoice source guard independently rejects another genuine attempt.
  await expect(
    fixture.database.db.transaction((tx) =>
      tx.execute(sql`
    insert into expert_onboarding_invoices(application_id,application_audit_id,user_id,decision_id,provider_mode,sales_attempt_number)
    select application_id,application_audit_id,user_id,decision_id,provider_mode,2 from expert_onboarding_invoices where id=${f.invoiceId}::uuid
  `),
    ),
  ).rejects.toMatchObject({
    cause: { message: "expert_sales_invoice_source" },
  });
  const before = (
    await fixture.database.db.execute(
      sql`select id,request_digest,idempotency_key,dispatched_at,provider_object_id from expert_sales_provider_requests where invoice_id=${f.invoiceId}::uuid order by id`,
    )
  ).rows;
  await migrateDb(fixture.database.db, "packages/db/migrations");
  await replacement(f);
  const after = (
    await fixture.database.db.execute(
      sql`select id,request_digest,idempotency_key,dispatched_at,provider_object_id from expert_sales_provider_requests where invoice_id=${f.invoiceId}::uuid order by id`,
    )
  ).rows;
  expect(after).toEqual(before);
  for (const row of before) {
    expect(
      (
        await fixture.database.db.execute(
          sql`select early_bird_private.public_sync_sales_terminal(${row.id}::uuid) as changed`,
        )
      ).rows,
    ).toEqual([{ changed: 0 }]);
  }
  for (const { db } of Object.values(fixture.connections)) {
    await expect(
      db.execute(
        sql`select early_bird_private.public_sync_sales_terminal(${before[0]!.id}::uuid)`,
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
  }
  await migrateDb(fixture.database.db, "packages/db/migrations");
  expect(await f.unresolved()).toBe(false);
}, 120000);

it("projects each new terminal completion independently while a sibling and unrelated pending checkout remain blocked", async () => {
  await migrateDb(fixture.database.db, "packages/db/migrations");
  const f = future;
  await cancelAfterExpiry(f, false);
  expect(await f.unresolved()).toBe(false);
  // The first scenario's ordinary batch already visited this then-pending owner.
  // Respect the real fifteen-minute scheduler throttle instead of deleting ticks.
  expect(
    (
      await fixture.database.db.execute(
        sql`select t.checked_at>clock_timestamp()-interval '15 minutes' as recent from expert_sales_ticks t join expert_sales_bases b on b.id=t.base_id where b.user_id=${f.userId}::uuid`,
      )
    ).rows,
  ).toEqual([{ recent: true }]);
  await fixture.advance(901);
  await replacement(f);
  expect(await pending.unresolved()).toBe(true);
  expect(
    (
      await fixture.database.db.execute(
        sql`select status from expert_sales_provider_requests where invoice_id=${pending.invoiceId}::uuid`,
      )
    ).rows,
  ).toEqual([{ status: "dispatched" }]);
  const stats = await fixture.stats();
  for (const owner of [pending, f])
    expect(
      stats.posts.filter(
        (post) =>
          post.path === "/v3/payments" &&
          post.metadata?.order_id === owner.invoiceId,
      ),
    ).toHaveLength(1);
}, 120000);
