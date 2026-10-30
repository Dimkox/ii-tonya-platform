import { Pool } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";
import { seedClientConsent } from "../testkit/client-consent.js";
import { saveExpertOfferProfile } from "./expert-offer-v2.js";
import { PostgresExpertSeparatedSalesRepository } from "./expert-separated-sales-repository.js";
import { PostgresResidentVerificationRepository } from "./resident-verification-repository.js";
import { PostgresExpertVerificationRepository } from "./expert-verification-repository.js";
import { PostgresPayerReceiptContactRepository } from "./payer-receipt-contact-repository.js";
import { createPayerReceiptVault } from "@ii-tonya/integrations";

let db: ExpertReferralTestDatabase;
let tariff: string;
let session: string;
let sequence = 991000;
const digest = (s: string) =>
  `sha256:${createHash("sha256").update(s).digest("hex")}`;
const policy = {
  botId: "717171",
  botKey: "public-authority",
  messagingConsentPolicyVersion: "client-messaging-v1",
};
const event = <T extends object>(scope: T) => {
  const requestKey = randomUUID();
  return { ...scope, requestKey, requestDigest: digest(requestKey).slice(7) };
};
const descriptor = (kind: string) => ({
  requestId: randomUUID(),
  idempotencyKey: randomUUID() as string,
  kind,
  requestDigest: digest(kind),
  bodyVersion: 1,
  ciphertext:
    kind.endsWith("capture") || kind.endsWith("cancel")
      ? null
      : "synthetic-sealed-envelope",
  keyReference:
    kind.endsWith("capture") || kind.endsWith("cancel") ? null : "fixture:key",
  bodyExpiresAt:
    kind.endsWith("capture") || kind.endsWith("cancel")
      ? null
      : "2027-01-11T13:00:00.000Z",
});
async function call(name: string, args: unknown[]) {
  const params = args.map((_, i) => `$${i + 1}`).join(",");
  return (await db.db.$client.query(`select ${name}(${params}) as value`, args))
    .rows[0]!.value;
}
beforeAll(async () => {
  db = await startExpertReferralTestDatabase(undefined, {
    forceDisposableCluster: true,
  });
  expect(
    (await db.db.$client.query("show server_version_num")).rows[0]!
      .server_version_num,
  ).toBe("170005");
  await db.enableExpertReferralCommands();
  tariff = await db.createResidencyTariff({
    tariffKey: "PRO",
    displayName: "PRO",
    priceMinor: 999000,
    durationSeconds: 2592000,
  });
  const staff = await db.createUser();
  session = digest(randomUUID());
  await db.db.execute(
    sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${session},${staff}::uuid,clock_timestamp(),clock_timestamp()+interval '1 hour')`,
  );
  await db.db.execute(
    sql`insert into admin_role_assignments(admin_id,role) values(${staff}::uuid,'support')`,
  );
  await db.db.execute(
    sql`create or replace function early_bird_current_time() returns timestamptz language sql volatile as $$ select '2027-01-11T12:00:00Z'::timestamptz $$`,
  );
}, 120000);
afterAll(async () => db?.stop(), 120000);
async function onboarding() {
  const userId = await db.createUser(),
    chatId = String(++sequence),
    scope = { ...policy, telegramUserId: chatId, chatId };
  await db.db.execute(
    sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status) values(${userId}::uuid,'telegram',${chatId},${scope.botKey},${chatId},'active')`,
  );
  await seedClientConsent(db.db, userId, "client_messaging");
  await saveExpertOfferProfile(db.db, {
    userId,
    cityCode: "kazan",
    millionCity: false,
    serviceFormat: "offline",
    ticketMinor: "300000",
    participantKind: "expert",
    idempotencyKey: randomUUID(),
  });
  await db.db.execute(
    sql`insert into residents_applications(user_id,bot_id,bot_key,channel_identity_id,telegram_user_id,chat_id,form_version,policy_version,education_requirement) select ${userId}::uuid,${scope.botId},${scope.botKey},id,${chatId},${chatId},1,'resident_education_unknown_v1','unknown_manual_review' from channel_identities where user_id=${userId}::uuid`,
  );
  const sales = new PostgresExpertSeparatedSalesRepository(db.db, policy),
    forms = new PostgresResidentVerificationRepository(db.db, policy);
  const base = (await sales.transition({
    ...event(scope),
    tariffVersionId: tariff,
  }))!;
  let selection = await sales.transition({
    ...event(scope),
    baseId: base.id,
    revision: 0,
    action: "positive",
  });
  selection = await sales.transition({
    ...event(scope),
    baseId: base.id,
    revision: selection!.revision,
    action: "base",
  });
  await sales.transition({
    ...event(scope),
    baseId: base.id,
    revision: selection!.revision,
    action: "month",
  });
  let form = await forms.mutate({ ...event(scope), action: "start" });
  form = await forms.mutate({
    ...event(scope),
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
    ...event(scope),
    action: "submit",
    expectedRevision: form.revision,
  });
  const bridge = (
    await db.db.execute<{ id: string; quoteId: string }>(
      sql`select application_id id,quote_id as "quoteId" from expert_sales_form_bridges where user_id=${userId}::uuid`,
    )
  ).rows[0]!;
  const repository = new PostgresExpertVerificationRepository(db.db, {
    providerMode: "test",
    messagingConsentPolicyVersion: policy.messagingConsentPolicyVersion,
  });
  const decision = await repository.decide({
    sessionHash: session,
    applicationId: bridge.id,
    decision: "approved",
    reasonCode: "identity_verified",
    idempotencyKey: randomUUID(),
  });
  const invoice = (await repository.invoiceForManager(
    session,
    decision.invoiceId!,
  ))!;
  const vault = createPayerReceiptVault({
    activeKeyId: "fixture",
    keys: new Map([["fixture", new Uint8Array(32).fill(13)]]),
  });
  await new PostgresPayerReceiptContactRepository(db.db, vault, 30).capture({
    userId,
    quoteId: bridge.quoteId,
    email: "synthetic@example.com",
    idempotencyKey: randomUUID(),
  });
  const contactId = (
    await db.db.execute<{ id: string }>(
      sql`select id from payer_receipt_contacts where user_id=${userId}::uuid`,
    )
  ).rows[0]!.id;
  // Move only fixture clocks after creating genuine legacy authority. Production has no date override.
  await db.db.transaction(async (tx) => {
    await tx.execute(
      sql`alter table expert_sales_fee_attempts disable trigger expert_sales_attempt_immutable`,
    );
    await tx.execute(
      sql`update expert_sales_fee_attempts set created_at='2027-01-11T11:00:00Z',expires_at='2027-01-11T14:00:00Z' where invoice_id=${invoice.id}::uuid`,
    );
    await tx.execute(
      sql`alter table expert_sales_fee_attempts enable trigger expert_sales_attempt_immutable`,
    );
    await tx.execute(
      sql`alter table payer_receipt_contacts disable trigger payer_receipt_contact_guard`,
    );
    await tx.execute(
      sql`update payer_receipt_contacts set captured_at='2027-01-11T11:00:00Z',expires_at='2027-01-11T14:00:00Z' where id=${contactId}::uuid`,
    );
    await tx.execute(
      sql`alter table payer_receipt_contacts enable trigger payer_receipt_contact_guard`,
    );
  });
  return {
    userId,
    invoiceId: invoice.id,
    operationId: invoice.operationId,
    contactId,
  };
}
async function prepare(
  f: Awaited<ReturnType<typeof onboarding>>,
  d = descriptor("onboarding_create"),
) {
  return call("early_bird_private.public_onboarding_prepare", [
    f.userId,
    f.invoiceId,
    d.kind === "onboarding_create" ? f.contactId : null,
    JSON.stringify(d),
  ]);
}
it.each([
  "onboarding_create",
  "onboarding_capture",
  "onboarding_cancel",
  "main_create",
  "main_refund",
])("denies %s without its own canonical source", async (kind) => {
  const product = kind.startsWith("onboarding")
    ? "onboarding"
    : kind === "main_create"
      ? "main"
      : "refund";
  await expect(
    call(`early_bird_private.public_${product}_prepare`, [
      randomUUID(),
      randomUUID(),
      kind.endsWith("capture") || kind.endsWith("cancel") ? null : randomUUID(),
      JSON.stringify(descriptor(kind)),
    ]),
  ).resolves.toBeNull();
});
it("uses source identity and price, refuses descriptor authority and foreign subjects", async () => {
  const f = await onboarding(),
    d = descriptor("onboarding_create");
  const snap = await prepare(f, d);
  expect(snap).toMatchObject({
    version: 1,
    requestId: d.requestId,
    userId: f.userId,
    legacySourceId: f.invoiceId,
    legacyOperationId: f.operationId,
    amountMinor: "300000",
    mode: "test",
    parentPaymentId: null,
    state: "prepared",
  });
  expect(
    await prepare(
      { ...f, userId: randomUUID() },
      descriptor("onboarding_create"),
    ),
  ).toBeNull();
  for (const extra of [
    { amountMinor: "1000" },
    { mode: "live" },
    { parentPaymentId: "foreign" },
    { url: "https://example.com" },
  ])
    expect(await prepare(f, { ...d, ...extra })).toBeNull();
  expect(await prepare(f, d)).toEqual(snap);
  expect(
    await prepare(f, { ...d, requestDigest: digest("changed") }),
  ).toBeNull();
  await expect(
    db.db.$client.query(
      "update public_expert_payment_requests set amount_minor=1000 where id=$1",
      [d.requestId],
    ),
  ).rejects.toThrow();
});
it("admits and claims once, refuses cross-kind gateway substitution and cannot reset uncertainty", async () => {
  const f = await onboarding(),
    d = descriptor("onboarding_create");
  await prepare(f, d);
  const admissions = await Promise.all(
    [1, 2].map(() =>
      call("early_bird_private.public_onboarding_admit", [
        f.userId,
        d.requestId,
        d.requestDigest,
      ]),
    ),
  );
  expect(admissions.filter(Boolean)).toHaveLength(1);
  expect(
    await call("public.public_expert_gateway_claim", [
      f.userId,
      d.requestId,
      f.contactId,
      d.idempotencyKey,
      d.requestDigest,
      "main_create",
    ]),
  ).toBeNull();
  const claims = await Promise.all(
    [1, 2].map(() =>
      call("public.public_expert_gateway_claim", [
        f.userId,
        d.requestId,
        f.contactId,
        d.idempotencyKey,
        d.requestDigest,
        d.kind,
      ]),
    ),
  );
  expect(claims.filter(Boolean)).toHaveLength(1);
  expect(claims.find(Boolean)).toMatchObject({
    kind: d.kind,
    state: "uncertain",
  });
  await expect(
    db.db.$client.query(
      "update public_expert_payment_requests set state='prepared' where id=$1",
      [d.requestId],
    ),
  ).rejects.toThrow();
});
it("source callers have no observation, binding, posting or direct-table authority", async () => {
  const role = `public_authority_sender_${randomUUID().replaceAll("-", "")}`;
  await db.db.$client.query(
    `create role ${role} login password 'synthetic-public-authority-only'`,
  );
  await db.db.$client.query(
    `grant usage on schema early_bird_private to ${role}`,
  );
  await db.db.$client.query(
    `grant execute on function early_bird_private.public_onboarding_prepare(uuid,uuid,uuid,jsonb) to ${role}`,
  );
  const roleUrl = new URL(db.db.$client.options.connectionString!);
  roleUrl.username = role;
  roleUrl.password = "synthetic-public-authority-only";
  const restricted = new Pool({ connectionString: roleUrl.toString() });
  const c = await restricted.connect();
  try {
    for (const query of [
      "select * from public_expert_payment_requests",
      "select early_bird_private.public_payment_bind(null,null,null)",
      "select early_bird_private.public_payment_observe(null,null,null)",
      "select early_bird_private.public_payment_apply_guard(null,null,null)",
    ]) {
      await expect(c.query(query)).rejects.toThrow(/permission denied/u);
    }
  } finally {
    c.release();
    await restricted.end();
  }
});

function observation(
  f: Awaited<ReturnType<typeof onboarding>>,
  requestId: string,
  providerObjectId: string,
  status:
    "pending" | "waiting_for_capture" | "succeeded" | "canceled" = "pending",
) {
  return {
    version: 1,
    requestId,
    providerObjectId,
    parentPaymentId: null,
    status,
    paid: status === "waiting_for_capture" || status === "succeeded",
    amountMinor: "300000",
    currency: "RUB",
    mode: "test",
    providerCreatedAt: "2027-01-11T12:00:00.000Z",
    providerCapturedAt:
      status === "succeeded" ? "2027-01-11T12:00:00.000Z" : null,
    paymentMethodType: status === "pending" ? null : "bank_card",
    identity: {
      purpose: "onboarding",
      operationId: f.operationId,
      orderId: f.invoiceId,
      userId: f.userId,
    },
    evidenceDigest: digest(randomUUID()),
    observedAt: "2027-01-11T12:00:00.000Z",
  };
}
async function sent() {
  const f = await onboarding(),
    d = descriptor("onboarding_create");
  await prepare(f, d);
  await call("early_bird_private.public_onboarding_admit", [
    f.userId,
    d.requestId,
    d.requestDigest,
  ]);
  await call("public.public_expert_gateway_claim", [
    f.userId,
    d.requestId,
    f.contactId,
    d.idempotencyKey,
    d.requestDigest,
    d.kind,
  ]);
  const paymentId = `public_${randomUUID()}`;
  return { ...f, d, paymentId };
}
const bindingProof = (fact: unknown) =>
  JSON.stringify({
    version: 1,
    complete: true,
    exactCandidates: 1,
    observation: fact,
  });
it("requires complete unique discovery and exact fresh GET identity before binding; pending method may be absent", async () => {
  const f = await sent(),
    fact = observation(f, f.d.requestId, f.paymentId);
  for (const change of [
    { amountMinor: "1000" },
    { mode: "live" },
    { parentPaymentId: "wrong" },
    { identity: { ...fact.identity, userId: randomUUID() } },
    { providerCapturedAt: "2027-01-11T11:59:00.000Z" },
    { extra: "untrusted" },
  ]) {
    expect(
      await call("early_bird_private.public_payment_bind", [
        f.d.requestId,
        f.paymentId,
        bindingProof({ ...fact, ...change }),
      ]),
    ).toBeNull();
  }
  for (const change of [
    { complete: false },
    { exactCandidates: 2 },
    { exactCandidates: 0 },
  ])
    expect(
      await call("early_bird_private.public_payment_bind", [
        f.d.requestId,
        f.paymentId,
        JSON.stringify({
          version: 1,
          complete: true,
          exactCandidates: 1,
          observation: fact,
          ...change,
        }),
      ]),
    ).toBeNull();
  expect(
    await call("early_bird_private.public_payment_bind", [
      f.d.requestId,
      f.paymentId,
      bindingProof(fact),
    ]),
  ).toMatchObject({ state: "bound", providerObjectId: f.paymentId });
  const id = await call("early_bird_private.public_payment_observe", [
    f.d.requestId,
    f.paymentId,
    JSON.stringify(fact),
  ]);
  expect(id).toEqual(expect.any(String));
  expect(
    await call("early_bird_private.public_payment_observe", [
      f.d.requestId,
      f.paymentId,
      JSON.stringify(fact),
    ]),
  ).toBe(id);
  expect(
    await call("early_bird_private.public_payment_expire", [f.d.requestId, id]),
  ).toMatchObject({ kind: "not_ready", action: null });
  expect(await prepare(f, descriptor("onboarding_capture"))).toBeNull();
  await expect(
    db.db.$client.query(
      "delete from public_expert_payment_observations where id=$1",
      [id],
    ),
  ).rejects.toThrow();
});
it("preserves an uncertain capture fence against cancellation even after a fresh waiting GET and contact loss", async () => {
  const f = await sent(),
    fact = observation(f, f.d.requestId, f.paymentId, "waiting_for_capture");
  await call("early_bird_private.public_payment_bind", [
    f.d.requestId,
    f.paymentId,
    bindingProof(fact),
  ]);
  await call("early_bird_private.public_payment_observe", [
    f.d.requestId,
    f.paymentId,
    JSON.stringify(fact),
  ]);
  const capture = descriptor("onboarding_capture");
  expect(await prepare(f, capture)).toMatchObject({
    contactId: null,
    parentPaymentId: f.paymentId,
    amountMinor: "300000",
  });
  // Both operation identities exist, but the parent lock admits only the currently valid one.
  await db.db.execute(
    sql`update expert_onboarding_applications set archived_at=clock_timestamp(),archive_until_date=clock_timestamp()+interval '1 day' where id=(select application_id from expert_onboarding_invoices where id=${f.invoiceId}::uuid)`,
  );
  const competingCancel = descriptor("onboarding_cancel");
  expect(await prepare(f, competingCancel)).toMatchObject({
    kind: "onboarding_cancel",
  });
  await db.db.execute(
    sql`update expert_onboarding_applications set archived_at=null,archive_until_date=null where id=(select application_id from expert_onboarding_invoices where id=${f.invoiceId}::uuid)`,
  );
  const parentAdmissions = await Promise.all(
    [capture, competingCancel].map((d) =>
      call("early_bird_private.public_onboarding_admit", [
        f.userId,
        d.requestId,
        d.requestDigest,
      ]),
    ),
  );
  expect(parentAdmissions[0]).toMatchObject({ state: "admitted" });
  expect(parentAdmissions[1]).toBeNull();
  expect(
    await call("public.public_expert_gateway_claim", [
      f.userId,
      capture.requestId,
      null,
      capture.idempotencyKey,
      capture.requestDigest,
      capture.kind,
    ]),
  ).toMatchObject({ state: "uncertain" });
  await db.db.execute(
    sql`update users set active=false where id=${f.userId}::uuid`,
  );
  await call("early_bird_private.public_payment_observe", [
    f.d.requestId,
    f.paymentId,
    JSON.stringify({ ...fact, evidenceDigest: digest(randomUUID()) }),
  ]);
  expect(
    await call("early_bird_private.public_onboarding_admit", [
      f.userId,
      competingCancel.requestId,
      competingCancel.requestDigest,
    ]),
  ).toBeNull();
  expect(await prepare(f, descriptor("onboarding_cancel"))).toBeNull();
  expect(
    await call("public.public_expert_gateway_claim", [
      f.userId,
      capture.requestId,
      null,
      capture.idempotencyKey,
      capture.requestDigest,
      capture.kind,
    ]),
  ).toBeNull();
  expect(
    (
      await db.db.$client.query(
        "select count(*)::int n from expert_sales_provider_requests where invoice_id=$1 and kind='capture' and status='dispatched'",
        [f.invoiceId],
      )
    ).rows[0]!.n,
  ).toBe(1);
});
it("permits only one contact-free cancellation after owner/contact loss and requires committed canonical state before complete", async () => {
  const f = await sent(),
    held = observation(f, f.d.requestId, f.paymentId, "waiting_for_capture");
  await call("early_bird_private.public_payment_bind", [
    f.d.requestId,
    f.paymentId,
    bindingProof(held),
  ]);
  await call("early_bird_private.public_payment_observe", [
    f.d.requestId,
    f.paymentId,
    JSON.stringify(held),
  ]);
  await db.db.execute(
    sql`update users set active=false where id=${f.userId}::uuid`,
  );
  await db.db.execute(
    sql`update early_bird_gateway_contact_state set revoked_at=clock_timestamp() where contact_id=${f.contactId}::uuid`,
  );
  const cancel = descriptor("onboarding_cancel");
  expect(await prepare(f, cancel)).toMatchObject({
    contactId: null,
    kind: "onboarding_cancel",
  });
  const admitted = await Promise.all(
    [1, 2].map(() =>
      call("early_bird_private.public_onboarding_admit", [
        f.userId,
        cancel.requestId,
        cancel.requestDigest,
      ]),
    ),
  );
  expect(admitted.filter(Boolean)).toHaveLength(1);
  expect(
    await call("public.public_expert_gateway_claim", [
      f.userId,
      cancel.requestId,
      null,
      cancel.idempotencyKey,
      cancel.requestDigest,
      cancel.kind,
    ]),
  ).toMatchObject({ parentPaymentId: f.paymentId });
  const canceled = {
    ...observation(f, cancel.requestId, f.paymentId, "canceled"),
    parentPaymentId: f.paymentId,
  };
  const id = await call("early_bird_private.public_payment_observe", [
    cancel.requestId,
    f.paymentId,
    JSON.stringify(canceled),
  ]);
  const ready = await call("early_bird_private.public_payment_expire", [
    cancel.requestId,
    id,
  ]);
  expect(ready).toMatchObject({
    kind: "ready_to_apply",
    action: "release_terminal_unpaid",
  });
  await expect(
    db.db.$client.query(
      "update expert_onboarding_invoices set status='cancelled' where id=$1",
      [f.invoiceId],
    ),
  ).rejects.toThrow(/public_financial_apply_context_required/u);
  expect(
    await call("early_bird_private.public_payment_complete", [
      cancel.requestId,
      ready.applyAttemptId,
    ]),
  ).toMatchObject({ kind: "not_ready" });
  const c = await db.db.$client.connect();
  try {
    await c.query("begin");
    expect(
      (
        await c.query(
          "select early_bird_private.public_payment_apply_guard($1,$2,$3) value",
          [cancel.requestId, id, ready.applyAttemptId],
        )
      ).rows[0]!.value,
    ).toMatchObject({ kind: "ready_to_apply" });
    await c.query(
      "update expert_onboarding_invoices set status='cancelled' where id=$1",
      [f.invoiceId],
    );
    expect(
      (
        await c.query(
          "select early_bird_private.public_payment_complete($1,$2) value",
          [cancel.requestId, ready.applyAttemptId],
        )
      ).rows[0]!.value,
    ).toMatchObject({ kind: "not_ready" });
    await c.query("rollback");
    expect(
      await call("early_bird_private.public_payment_complete", [
        cancel.requestId,
        ready.applyAttemptId,
      ]),
    ).toMatchObject({ kind: "not_ready" });
    await c.query("begin");
    await c.query(
      "select early_bird_private.public_payment_apply_guard($1,$2,$3)",
      [cancel.requestId, id, ready.applyAttemptId],
    );
    await c.query(
      "update expert_onboarding_invoices set status='cancelled' where id=$1",
      [f.invoiceId],
    );
    await c.query("commit");
  } finally {
    await c.query("rollback");
    c.release();
  }
  expect(
    await call("early_bird_private.public_payment_complete", [
      cancel.requestId,
      ready.applyAttemptId,
    ]),
  ).toMatchObject({
    kind: "already_applied",
    action: "release_terminal_unpaid",
  });
  expect(
    await call("early_bird_private.public_payment_complete", [
      cancel.requestId,
      ready.applyAttemptId,
    ]),
  ).toMatchObject({ kind: "already_applied" });
});

it("strict DTOs reject cross-product bindings, extra keys and invented payment facts on refunds", async () => {
  const {
    publicExpertPaymentSnapshotSchema,
    publicExpertVerifiedObservationSchema,
    publicExpertApplyActionSchema,
  } =
    await import("../../../integrations/src/yookassa/public-expert-gateway-contracts.js");
  const f = await sent();
  const snap = await call("early_bird_private.public_onboarding_snapshot", [
    f.userId,
    f.d.requestId,
  ]);
  expect(publicExpertPaymentSnapshotSchema.safeParse(snap).success).toBe(true);
  for (const change of [
    { kind: "main_create" },
    { amountMinor: "1000" },
    { contactId: null },
    { url: "https://example.com" },
  ])
    expect(
      publicExpertPaymentSnapshotSchema.safeParse({ ...snap, ...change })
        .success,
    ).toBe(false);
  const fact = observation(f, f.d.requestId, f.paymentId);
  expect(publicExpertVerifiedObservationSchema.safeParse(fact).success).toBe(
    true,
  );
  expect(
    publicExpertVerifiedObservationSchema.safeParse({
      ...fact,
      status: "succeeded",
      paid: true,
    }).success,
  ).toBe(false);
  expect(
    publicExpertVerifiedObservationSchema.safeParse({
      ...fact,
      status: "waiting_for_capture",
      paid: true,
    }).success,
  ).toBe(false);
  expect(
    publicExpertVerifiedObservationSchema.safeParse({
      ...fact,
      identity: { ...fact.identity, purpose: "public_main_refund" },
    }).success,
  ).toBe(false);
  expect(
    publicExpertApplyActionSchema.safeParse({
      version: 1,
      kind: "ready_to_apply",
      requestId: f.d.requestId,
      observationId: null,
      legacySourceId: f.invoiceId,
      legacyOperationId: f.operationId,
      providerObjectId: f.paymentId,
      action: "onboarding_settle",
      applyAttemptId: randomUUID(),
      evidence: null,
    }).success,
  ).toBe(false);
});

async function mainOrder() {
  const { createCorrectionOnboardingFixture, correctionEvent } =
    await import("../../../../tests/support/residency-correction-fixture.js");
  const { PostgresExpertOnboardingMainPaymentRepository } =
    await import("./expert-onboarding-main-payment-repository.js");
  const f = await createCorrectionOnboardingFixture(db);
  await f.cards.submitPromoProof({
    ...correctionEvent(f.scope),
    expectedRevision: 0,
    proof: { kind: "link", reference: "https://example.com/promo" },
  });
  await f.cards.confirmPromo({
    sessionHash: f.sessionHash,
    applicationId: f.applicationId,
    expectedRevision: 0,
    idempotencyKey: randomUUID(),
  });
  const revision = (await f.approveCard()).revision;
  const financial = new PostgresExpertOnboardingMainPaymentRepository(db.db, {
    providerMode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
  });
  const quote = await financial.quoteMain({
    ...correctionEvent(f.workScope),
    tariffVersionId: f.tariffId,
    termMonths: 1,
    revision,
  });
  await financial.acceptMain({
    ...correctionEvent(f.workScope),
    quoteId: quote.id,
    revision,
  });
  const vault = createPayerReceiptVault({
    activeKeyId: "fixture",
    keys: new Map([["fixture", new Uint8Array(32).fill(13)]]),
  });
  await new PostgresPayerReceiptContactRepository(db.db, vault, 30).capture({
    userId: f.userId,
    quoteId: quote.id,
    email: "synthetic@example.com",
    idempotencyKey: randomUUID(),
  });
  const contactId = (
    await db.db.$client.query(
      "select id from payer_receipt_contacts where user_id=$1 and quote_id=$2",
      [f.userId, quote.id],
    )
  ).rows[0]!.id as string;
  const order = await financial.createMainInvoice({
    ...correctionEvent(f.workScope),
    revision,
  });
  await db.db.execute(
    sql`insert into payer_receipt_order_bindings(order_id,contact_id,quote_id,user_id) values(${order.orderId}::uuid,${contactId}::uuid,${quote.id}::uuid,${f.userId}::uuid)`,
  );
  await db.db.transaction(async (tx) => {
    await tx.execute(
      sql`alter table expert_residency_orders disable trigger expert_campaign_order_snapshot_immutable`,
    );
    await tx.execute(
      sql`update expert_residency_orders set payment_deadline='2027-01-11T14:00:00Z',provider_deadline='2027-01-11T14:00:00Z' where id=${order.orderId}::uuid`,
    );
    await tx.execute(
      sql`alter table expert_residency_orders enable trigger expert_campaign_order_snapshot_immutable`,
    );
    await tx.execute(
      sql`alter table payer_receipt_contacts disable trigger payer_receipt_contact_guard`,
    );
    await tx.execute(
      sql`update payer_receipt_contacts set captured_at='2027-01-11T11:00:00Z',expires_at='2027-01-11T14:00:00Z' where id=${contactId}::uuid`,
    );
    await tx.execute(
      sql`alter table payer_receipt_contacts enable trigger payer_receipt_contact_guard`,
    );
  });
  return { ...f, order, contactId };
}
it("atomically prepares main delivery from accepted order money and protects unresolved main expiry", async () => {
  const f = await mainOrder(),
    d = descriptor("main_create");
  const snap = await call("early_bird_private.public_main_prepare", [
    f.userId,
    f.order.orderId,
    f.contactId,
    JSON.stringify(d),
  ]);
  expect(snap).toMatchObject({
    kind: "main_create",
    product: "main",
    amountMinor: f.order.cashMinor,
    legacySourceId: f.order.orderId,
    mode: "test",
  });
  expect(
    (
      await db.db.$client.query(
        "select status from expert_residency_provider_operations where id=$1",
        [snap.legacyOperationId],
      )
    ).rows[0]!.status,
  ).toBe("claimed");
  expect(
    await call("early_bird_private.public_main_prepare", [
      f.userId,
      f.order.orderId,
      f.contactId,
      JSON.stringify(descriptor("main_create")),
    ]),
  ).toBeNull();
  expect(
    await call("early_bird_private.public_main_admit", [
      f.userId,
      d.requestId,
      d.requestDigest,
    ]),
  ).toMatchObject({ state: "admitted" });
  expect(
    (
      await db.db.$client.query(
        "select status from expert_residency_provider_operations where id=$1",
        [snap.legacyOperationId],
      )
    ).rows[0]!.status,
  ).toBe("unknown_outcome");
  await expect(
    db.db.$client.query(
      "update expert_residency_orders set status='expired' where id=$1",
      [f.order.orderId],
    ),
  ).rejects.toThrow(/public_financial_apply_context_required/u);
});
it("refund preparation consumes an existing bounded canonical refund command and preserves exact parent/mode/amount", async () => {
  const f = await mainOrder();
  const { PostgresYooKassaOperationRepository } =
    await import("./yookassa-operation-repository.js");
  const { PostgresExpertResidencyProviderInboxRepository } =
    await import("./expert-residency-provider-inbox-repository.js");
  const { createYooKassaClient, YooKassaPaymentVerifier } =
    await import("@ii-tonya/integrations");
  const operations = new PostgresYooKassaOperationRepository(db.db);
  const payment = await operations.claim({
    commandId: randomUUID(),
    orderId: f.order.orderId,
    kind: "create_payment",
    mode: "test",
    amountMinor: f.order.cashMinor,
    currency: "RUB",
    requestDigest: digest(randomUUID()),
  });
  const paymentId = `refund_parent_${randomUUID()}`;
  const bound = await operations.bindProviderObject(payment.id, paymentId);
  const now = new Date().toISOString();
  const client = createYooKassaClient(
    { mode: "test", shopId: "test-shop", secretKey: "synthetic-only" },
    async () =>
      new Response(
        JSON.stringify({
          id: paymentId,
          status: "succeeded",
          paid: true,
          test: true,
          amount: {
            value: (Number(f.order.cashMinor) / 100).toFixed(2),
            currency: "RUB",
          },
          created_at: now,
          captured_at: now,
          metadata: { order_id: f.order.orderId },
          refundable: true,
        }),
        { status: 200 },
      ),
  );
  const verified = await new YooKassaPaymentVerifier(
    client,
    operations,
  ).verifyPayment(bound);
  if (!verified) throw Error("synthetic_parent_not_verified");
  await new PostgresExpertResidencyProviderInboxRepository(db.db).settle(
    verified,
  );
  await operations.resolve(payment.id, "succeeded");
  const d = descriptor("main_refund");
  const refund = await operations.claim({
    commandId: randomUUID(),
    orderId: f.order.orderId,
    kind: "create_refund",
    mode: "test",
    amountMinor: f.order.cashMinor,
    currency: "RUB",
    parentPaymentId: paymentId,
    requestDigest: d.requestDigest,
  });
  d.idempotencyKey = refund.idempotencyKey;
  const snap = await call("early_bird_private.public_refund_prepare", [
    f.userId,
    refund.id,
    f.contactId,
    JSON.stringify(d),
  ]);
  expect(snap).toMatchObject({
    kind: "main_refund",
    product: "refund",
    parentPaymentId: paymentId,
    amountMinor: f.order.cashMinor,
    mode: "test",
    legacyOperationId: refund.id,
  });
  expect(
    await call("early_bird_private.public_main_admit", [
      f.userId,
      d.requestId,
      d.requestDigest,
    ]),
  ).toBeNull();
  expect(
    await call("early_bird_private.public_refund_admit", [
      f.userId,
      d.requestId,
      d.requestDigest,
    ]),
  ).toMatchObject({ state: "admitted" });
  await expect(
    operations.claim({
      commandId: randomUUID(),
      orderId: f.order.orderId,
      kind: "create_refund",
      mode: "test",
      amountMinor: "1",
      currency: "RUB",
      parentPaymentId: paymentId,
      requestDigest: digest(randomUUID()),
    }),
  ).rejects.toThrow();
});

it.each([
  {
    name: "main",
    grant: "early_bird_private.public_main_prepare(uuid,uuid,uuid,jsonb)",
    allowed:
      "select early_bird_private.public_main_prepare(null,null,null,null) value",
    denied: "select early_bird_private.public_payment_observe(null,null,null)",
  },
  {
    name: "refund",
    grant: "early_bird_private.public_refund_prepare(uuid,uuid,uuid,jsonb)",
    allowed:
      "select early_bird_private.public_refund_prepare(null,null,null,null) value",
    denied: "select early_bird_private.public_payment_bind(null,null,null)",
  },
  {
    name: "binder",
    grant: "early_bird_private.public_payment_candidate(uuid)",
    allowed: "select early_bird_private.public_payment_candidate(null) value",
    denied: "select early_bird_private.public_payment_observe(null,null,null)",
  },
  {
    name: "writer",
    grant: "early_bird_private.public_payment_observe(uuid,text,jsonb)",
    allowed:
      "select early_bird_private.public_payment_observe(null,null,null) value",
    denied: "select early_bird_private.public_payment_bind(null,null,null)",
  },
])(
  "isolates $name LOGIN from other capabilities and canonical financial mutation",
  async (f) => {
    const role = `public_authority_${f.name}_${randomUUID().replaceAll("-", "")}`;
    await db.db.$client.query(
      `create role ${role} login password 'synthetic-public-authority-only'`,
    );
    await db.db.$client.query(
      `grant usage on schema early_bird_private to ${role}`,
    );
    await db.db.$client.query(
      `grant execute on function ${f.grant} to ${role}`,
    );
    const url = new URL(db.db.$client.options.connectionString!);
    url.username = role;
    url.password = "synthetic-public-authority-only";
    const pool = new Pool({ connectionString: url.toString() });
    try {
      expect((await pool.query(f.allowed)).rows[0]!.value).toBeNull();
      for (const q of [
        f.denied,
        "select early_bird_private.public_payment_apply_guard(null,null,null)",
        "select * from public_expert_payment_requests",
        "update expert_residency_orders set status='expired'",
      ]) {
        await expect(pool.query(q)).rejects.toThrow(/permission denied/u);
      }
    } finally {
      await pool.end();
    }
  },
);
