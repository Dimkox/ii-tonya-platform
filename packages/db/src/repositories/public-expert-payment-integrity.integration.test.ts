import { PostgresYooKassaOperationRepository } from "./yookassa-operation-repository.js";
import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { sql } from "drizzle-orm";
import { beforeAll, afterAll, expect, it } from "vitest";
import { createEarlyBirdOwnerJourney } from "../testkit/early-bird-owner-journey.js";
import { seedClientConsent } from "../testkit/client-consent.js";
import { saveExpertOfferProfile } from "./expert-offer-v2.js";
import { PostgresExpertSeparatedSalesRepository } from "./expert-separated-sales-repository.js";
import { PostgresResidentVerificationRepository } from "./resident-verification-repository.js";
import { PostgresExpertVerificationRepository } from "./expert-verification-repository.js";
import { PostgresExpertOnboardingMainPaymentRepository } from "./expert-onboarding-main-payment-repository.js";
import { PostgresPayerReceiptContactRepository } from "./payer-receipt-contact-repository.js";
import { createPayerReceiptVault } from "@ii-tonya/integrations";
import { publicExpertApplyActionSchema } from "../../../integrations/src/yookassa/public-expert-gateway-contracts.js";
import {
  createCorrectionOnboardingFixture,
  correctionEvent,
} from "../../../../tests/support/residency-correction-fixture.js";

let wave: Awaited<ReturnType<typeof createEarlyBirdOwnerJourney>>;
let deferredInvoice: string;
let tariff: string;
let session: string;
let sender: Pool, gateway: Pool, binder: Pool, writer: Pool;
const hash = (v: string) =>
  `sha256:${createHash("sha256").update(v).digest("hex")}`;
const now = "2027-01-11T12:00:01.000000Z";
const vault = createPayerReceiptVault({
  activeKeyId: "fixture",
  keys: new Map([["fixture", new Uint8Array(32).fill(9)]]),
});
const database = () => wave.db.db;
const q = (text: string, values: unknown[] = []) =>
  database().$client.query(text, values);
async function call(
  name: string,
  args: unknown[],
  connection: Pick<PoolClient, "query"> = database().$client,
) {
  return (
    await connection.query(
      `select ${name.includes(".") ? name : `early_bird_private.${name}`}(${args.map((_, i) => `$${i + 1}`).join(",")}) value`,
      args,
    )
  ).rows[0]!.value;
}
async function principal(label: string, functions: string[]) {
  const role = `integrity_${label}_${randomUUID().replaceAll("-", "")}`;
  await q(`create role ${role} login password 'synthetic-integrity-only'`);
  await q(`grant usage on schema public,early_bird_private to ${role}`);
  for (const fn of functions)
    await q(`grant execute on function ${fn} to ${role}`);
  const url = new URL(database().$client.options.connectionString!);
  url.username = role;
  url.password = "synthetic-integrity-only";
  const pool = new Pool({ connectionString: url.toString() });
  expect((await pool.query("select session_user name")).rows[0]!.name).toBe(
    role,
  );
  return pool;
}
beforeAll(async () => {
  wave = await createEarlyBirdOwnerJourney();
  expect((await q("show server_version_num")).rows[0]!.server_version_num).toBe(
    "170005",
  );
  // Genuine deferred authority, bound before any invoice settlement; no fake captured invoice.
  await q(
    "update early_bird_composite_intents set status='abandoned' where id=$1",
    [wave.identity.operationId],
  );
  const choice = (
    await q(
      "insert into early_bird_choices(user_id,base_id,positive_choice_id,revision,choice,request_key,request_digest) select user_id,base_id,positive_choice_id,revision,'later',$2,$3 from early_bird_choices where id=$1 returning id",
      [wave.choice, randomUUID(), hash("later").slice(7)],
    )
  ).rows[0]!.id;
  const account = randomUUID();
  deferredInvoice = randomUUID();
  await call("public.early_bird_deferred_prepare", [
    account,
    wave.user,
    wave.base,
    choice,
    (
      await q(
        "select config_id from early_bird_composite_intents where id=$1",
        [wave.identity.operationId],
      )
    ).rows[0]!.config_id,
  ]);
  await call("public.early_bird_deferred_invoice", [
    account,
    wave.user,
    deferredInvoice,
    randomUUID(),
    "onboarding",
  ]);
  await call("public.early_bird_deferred_bind_verified", [
    deferredInvoice,
    wave.user,
    "integrity_deferred_reserved",
    1000,
    hash("deferred"),
  ]);
  await q(
    `create or replace function early_bird_current_time() returns timestamptz language sql volatile as $$select '${now}'::timestamptz$$`,
  );
  await wave.db.enableExpertReferralCommands();
  tariff = (
    await q(
      "select id from expert_residency_tariff_versions where tariff_key='PRO' and active_from<=clock_timestamp() and active_to>clock_timestamp()",
    )
  ).rows[0]!.id;
  const admin = await wave.db.createUser();
  session = hash(randomUUID());
  await q(
    "insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values($1,$2,clock_timestamp(),clock_timestamp()+interval '1 hour')",
    [session, admin],
  );
  await q(
    "insert into admin_role_assignments(admin_id,role) values($1,'support')",
    [admin],
  );
  sender = await principal("sender", [
    "early_bird_private.public_onboarding_prepare(uuid,uuid,uuid,jsonb)",
    "early_bird_private.public_main_prepare(uuid,uuid,uuid,jsonb)",
    "early_bird_private.public_onboarding_admit(uuid,uuid,text)",
    "early_bird_private.public_main_admit(uuid,uuid,text)",
  ]);
  gateway = await principal("gateway", [
    "public.public_expert_gateway_claim(uuid,uuid,uuid,uuid,text,text)",
  ]);
  binder = await principal("binder", [
    "early_bird_private.public_payment_bind(uuid,text,jsonb)",
  ]);
  writer = await principal("writer", [
    "early_bird_private.public_payment_observe(uuid,text,jsonb)",
    "early_bird_private.public_payment_resolve(uuid,uuid)",
    "early_bird_private.public_payment_complete(uuid,uuid)",
  ]);
}, 120000);
afterAll(async () => {
  await Promise.all(
    [sender, gateway, binder, writer].filter(Boolean).map((p) => p.end()),
  );
  await wave?.db.stop();
}, 120000);
function descriptor(
  kind: "main_create" | "onboarding_create" | "onboarding_capture",
) {
  const parent = kind === "onboarding_capture";
  return {
    requestId: randomUUID(),
    idempotencyKey: randomUUID(),
    legacyDeliveryOperationId: kind === "main_create" ? randomUUID() : null,
    kind,
    requestDigest: hash(randomUUID()),
    bodyVersion: 1,
    ciphertext: parent ? null : "synthetic-integrity-envelope",
    keyReference: parent ? null : "fixture:key",
    bodyExpiresAt: parent ? null : "2027-01-11T13:00:00.123456Z",
  };
}
async function receipt(user: string, quote: string) {
  await new PostgresPayerReceiptContactRepository(
    database(),
    vault,
    30,
  ).capture({
    userId: user,
    quoteId: quote,
    email: "integrity@example.invalid",
    idempotencyKey: randomUUID(),
  });
  const id = (
    await q(
      "select id from payer_receipt_contacts where user_id=$1 and quote_id=$2",
      [user, quote],
    )
  ).rows[0]!.id as string;
  await database().transaction(async (tx) => {
    await tx.execute(
      sql`alter table payer_receipt_contacts disable trigger payer_receipt_contact_guard`,
    );
    await tx.execute(
      sql`update payer_receipt_contacts set captured_at='2027-01-11T11:00:00Z',expires_at='2027-01-11T14:00:00Z' where id=${id}::uuid`,
    );
    await tx.execute(
      sql`alter table payer_receipt_contacts enable trigger payer_receipt_contact_guard`,
    );
  });
  return id;
}
async function onboarding() {
  const user = await wave.db.createUser(),
    chat = String(100000 + Math.floor(Math.random() * 900000));
  const scope = {
    botId: "717171",
    botKey: "integrity",
    telegramUserId: chat,
    chatId: chat,
  };
  const event = () => ({
    ...scope,
    requestKey: randomUUID(),
    requestDigest: hash(randomUUID()).slice(7),
  });
  await q(
    "insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status) values($1,'telegram',$2,$3,$2,'active')",
    [user, chat, scope.botKey],
  );
  await seedClientConsent(database(), user, "client_messaging");
  await saveExpertOfferProfile(database(), {
    userId: user,
    cityCode: "kazan",
    millionCity: false,
    serviceFormat: "offline",
    ticketMinor: "300000",
    participantKind: "expert",
    idempotencyKey: randomUUID(),
  });
  await q(
    "insert into residents_applications(user_id,bot_id,bot_key,channel_identity_id,telegram_user_id,chat_id,form_version,policy_version,education_requirement) select $1,$2,$3,id,$4,$4,1,'resident_education_unknown_v1','unknown_manual_review' from channel_identities where user_id=$1",
    [user, scope.botId, scope.botKey, chat],
  );
  const policy = {
    ...scope,
    messagingConsentPolicyVersion: "client-messaging-v1",
  };
  const sales = new PostgresExpertSeparatedSalesRepository(database(), policy),
    forms = new PostgresResidentVerificationRepository(database(), policy);
  const base = (await sales.transition({
    ...event(),
    tariffVersionId: tariff,
  }))!;
  let selection = await sales.transition({
    ...event(),
    baseId: base.id,
    revision: 0,
    action: "positive",
  });
  selection = await sales.transition({
    ...event(),
    baseId: base.id,
    revision: selection!.revision,
    action: "base",
  });
  await sales.transition({
    ...event(),
    baseId: base.id,
    revision: selection!.revision,
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
      socialLinks: ["https://example.invalid"],
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
    await q(
      "select application_id,quote_id from expert_sales_form_bridges where user_id=$1",
      [user],
    )
  ).rows[0]!;
  const verification = new PostgresExpertVerificationRepository(database(), {
    providerMode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
  });
  const decision = await verification.decide({
    sessionHash: session,
    applicationId: bridge.application_id,
    decision: "approved",
    reasonCode: "identity_verified",
    idempotencyKey: randomUUID(),
  });
  const invoice = (await verification.invoiceForManager(
    session,
    decision.invoiceId!,
  ))!;
  const contact = await receipt(user, bridge.quote_id);
  await database().transaction(async (tx) => {
    await tx.execute(
      sql`alter table expert_sales_fee_attempts disable trigger expert_sales_attempt_immutable`,
    );
    await tx.execute(
      sql`update expert_sales_fee_attempts set created_at='2027-01-11T11:00:00Z',expires_at='2027-01-11T14:00:00Z' where invoice_id=${invoice.id}::uuid`,
    );
    await tx.execute(
      sql`alter table expert_sales_fee_attempts enable trigger expert_sales_attempt_immutable`,
    );
  });
  return prepare(user, invoice.id, contact, descriptor("onboarding_create"));
}
async function mainSubject() {
  const f = await createCorrectionOnboardingFixture(wave.db);
  await f.cards.submitPromoProof({
    ...correctionEvent(f.scope),
    expectedRevision: 0,
    proof: { kind: "link", reference: "https://example.invalid/proof" },
  });
  await f.cards.confirmPromo({
    sessionHash: f.sessionHash,
    applicationId: f.applicationId,
    expectedRevision: 0,
    idempotencyKey: randomUUID(),
  });
  const revision = (await f.approveCard()).revision;
  return {
    ...f,
    revision,
    financial: new PostgresExpertOnboardingMainPaymentRepository(database(), {
      providerMode: "test",
      messagingConsentPolicyVersion: "client-messaging-v1",
    }),
  };
}
async function main(supplied?: Awaited<ReturnType<typeof mainSubject>>) {
  const subject = supplied ?? (await mainSubject());
  const quote = await subject.financial.quoteMain({
    ...correctionEvent(subject.workScope),
    tariffVersionId: subject.tariffId,
    termMonths: 1,
    revision: subject.revision,
  });
  await subject.financial.acceptMain({
    ...correctionEvent(subject.workScope),
    quoteId: quote.id,
    revision: subject.revision,
  });
  const contact = await receipt(subject.userId, quote.id);
  const order = await subject.financial.createMainInvoice({
    ...correctionEvent(subject.workScope),
    revision: subject.revision,
  });
  await q(
    "insert into payer_receipt_order_bindings(order_id,contact_id,quote_id,user_id) values($1,$2,$3,$4)",
    [order.orderId, contact, quote.id, subject.userId],
  );
  await database().transaction(async (tx) => {
    await tx.execute(
      sql`alter table expert_residency_orders disable trigger expert_campaign_order_snapshot_immutable`,
    );
    await tx.execute(
      sql`update expert_residency_orders set payment_deadline='2027-01-11T14:00:00Z',provider_deadline='2027-01-11T14:00:00Z' where id=${order.orderId}::uuid`,
    );
    await tx.execute(
      sql`alter table expert_residency_orders enable trigger expert_campaign_order_snapshot_immutable`,
    );
  });
  return prepare(
    subject.userId,
    order.orderId,
    contact,
    descriptor("main_create"),
  );
}
async function prepare(
  user: string,
  source: string,
  contact: string | null,
  d: ReturnType<typeof descriptor>,
) {
  const product = d.kind.startsWith("onboarding") ? "onboarding" : "main";
  const snapshot = await call(
    `public_${product}_prepare`,
    [user, source, contact, d],
    sender,
  );
  expect(snapshot).toMatchObject({ state: "prepared", requestId: d.requestId });
  return { user, source, contact, d, snapshot, product };
}
type Request = Awaited<ReturnType<typeof prepare>>;
async function dispatch(f: Request) {
  expect(
    await call(
      `public_${f.product}_admit`,
      [f.user, f.d.requestId, f.d.requestDigest],
      sender,
    ),
  ).toMatchObject({ state: "admitted" });
  expect(
    await call(
      "public.public_expert_gateway_claim",
      [
        f.user,
        f.d.requestId,
        f.contact,
        f.d.idempotencyKey,
        f.d.requestDigest,
        f.d.kind,
      ],
      gateway,
    ),
  ).toMatchObject({ state: "uncertain" });
}
function observation(
  f: Request,
  id: string,
  captured: string | null = null,
  held = false,
) {
  return {
    version: 1,
    requestId: f.d.requestId,
    providerObjectId: id,
    parentPaymentId: f.snapshot.parentPaymentId,
    status: captured ? "succeeded" : held ? "waiting_for_capture" : "pending",
    paid: captured !== null || held,
    amountMinor: f.snapshot.amountMinor,
    currency: "RUB",
    mode: f.snapshot.mode,
    providerCreatedAt: "2027-01-11T12:00:00.000001Z",
    providerCapturedAt: captured,
    paymentMethodType: captured || held ? "bank_card" : null,
    identity: {
      purpose: f.product === "main" ? "main_residency" : "onboarding",
      operationId: f.snapshot.legacyOperationId,
      orderId: f.source,
      userId: f.user,
    },
    evidenceDigest: hash(randomUUID()),
    observedAt: now,
  };
}
async function bind(
  f: Request,
  id: string,
  fact = observation(f, id),
  connection: Pick<PoolClient, "query"> = binder,
) {
  return call(
    "public_payment_bind",
    [
      f.d.requestId,
      id,
      { version: 1, complete: true, exactCandidates: 1, observation: fact },
    ],
    connection,
  );
}
it("excludes a genuine deferred verified identity before captured invoice fields exist", async () => {
  const f = await onboarding();
  await dispatch(f);
  expect(
    (
      await q(
        "select provider_id,captured_at from early_bird_deferred_invoices where id=$1",
        [deferredInvoice],
      )
    ).rows[0],
  ).toMatchObject({ provider_id: null, captured_at: null });
  expect(await bind(f, "integrity_deferred_reserved")).toBeNull();
});
it.each(["read committed", "repeatable read"])(
  "serializes different-subject onboarding/main bindings at %s while preserving legitimate parent reuse",
  async (isolation) => {
    const first = await onboarding(),
      second = await main();
    await dispatch(first);
    await dispatch(second);
    const a = await binder.connect(),
      b = await binder.connect(),
      id = `integrity_race_${randomUUID()}`;
    try {
      await a.query("begin");
      await b.query(`begin isolation level ${isolation}`);
      expect(await bind(first, id, observation(first, id), a)).toMatchObject({
        state: "bound",
      });
      const pending = bind(second, id, observation(second, id), b).then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      // Keep winner uncommitted long enough for the competing binder to reach the unique reservation.
      await q("select pg_sleep(0.15)");
      await a.query("commit");
      const result = await pending;
      expect("error" in result || result.value === null).toBe(true);
      await b.query("rollback");
    } finally {
      await a.query("rollback");
      await b.query("rollback");
      a.release();
      b.release();
    }
    const held = observation(first, id, null, true);
    expect(
      await call(
        "public_payment_observe",
        [first.d.requestId, id, held],
        writer,
      ),
    ).toEqual(expect.any(String));
    const capture = await prepare(
      first.user,
      first.source,
      null,
      descriptor("onboarding_capture"),
    );
    await dispatch(capture);
    expect(
      await bind(capture, id, observation(capture, id, null, true)),
    ).toMatchObject({ providerObjectId: id });
  },
);
async function settle(
  f: Request,
  captured: string,
  expectedStart: string,
  expectedEnd: string,
) {
  await dispatch(f);
  const id = `integrity_precision_${randomUUID()}`,
    fact = observation(f, id, captured);
  expect(await bind(f, id, fact)).toMatchObject({ state: "bound" });
  const observed = await call(
    "public_payment_observe",
    [f.d.requestId, id, fact],
    writer,
  );
  const resolution = publicExpertApplyActionSchema.parse(
    await call("public_payment_resolve", [f.d.requestId, observed], writer),
  );
  const c = await database().$client.connect();
  try {
    await c.query("begin");
    const guarded = publicExpertApplyActionSchema.parse(
      await call(
        "public_payment_apply_guard",
        [f.d.requestId, observed, resolution.applyAttemptId],
        c,
      ),
    );
    expect(guarded.evidence?.expectedPeriod).toEqual({
      startsAt: expectedStart,
      endsAt: expectedEnd,
    });
    const period = guarded.evidence!.expectedPeriod!;
    await c.query(
      "update expert_residency_payment_attempts set status='settled',resolved_at=early_bird_current_time() where id=(select payment_attempt_id from expert_residency_provider_operations where id=$1)",
      [f.snapshot.legacyOperationId],
    );
    await c.query(
      "insert into expert_residency_provider_event_inbox(provider,external_event_id,payload_digest,event_kind,identity_version,payment_id,order_id,amount_minor,currency,occurred_at,authenticated,verification_id,verifier_key_version,verified_at,status,processed_at,result_code) values('yookassa',$1,$2,'settled',1,$3,$4,$5,'RUB',$6,true,$7,'integrity-v1',$6,'processed',early_bird_current_time(),'settled')",
      [
        `public:${f.d.requestId}:${observed}`,
        fact.evidenceDigest.slice(7),
        id,
        f.source,
        f.snapshot.amountMinor,
        captured,
        `public:${observed}`,
      ],
    );
    await c.query(
      // The public financial instant is verified capture; processing time may be later.
      "update expert_residency_orders set status='settled',provider_payment_id=$2,settled_at=$5::timestamptz,residency_starts_at=$3,residency_ends_at=$4 where id=$1",
      [f.source, id, period.startsAt, period.endsAt, captured],
    );
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
  expect(
    publicExpertApplyActionSchema.parse(
      await call(
        "public_payment_complete",
        [f.d.requestId, resolution.applyAttemptId],
        writer,
      ),
    ).kind,
  ).toBe("already_applied");
  expect(
    (
      await q(
        "select to_char(provider_captured_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') captured from public_expert_payment_observations where id=$1",
        [observed],
      )
    ).rows[0]!.captured,
  ).toBe(captured);
}
it("round-trips full microseconds from capture and previously queued coverage through real LOGIN sender, binder and writer", async () => {
  const subject = await mainSubject();
  await settle(
    await main(subject),
    "2027-01-11T12:00:00.123456Z",
    "2027-01-11T12:00:00.123456Z",
    "2027-02-10T12:00:00.123456Z",
  );
  await settle(
    await main(subject),
    "2027-01-11T12:00:00.234567Z",
    "2027-02-10T12:00:00.123456Z",
    "2027-03-12T12:00:00.123456Z",
  );
  for (const pool of [sender, gateway, binder, writer])
    await expect(
      pool.query("select * from public_expert_payment_requests"),
    ).rejects.toThrow(/permission denied/u);
});
async function envelopes(f: Request) {
  return (
    await q(
      "select c.ciphertext contact,p.encrypted_body public_body,p.key_reference public_key,l.encrypted_body legacy_body,l.key_reference legacy_key from payer_receipt_contacts c join public_expert_payment_requests p on p.contact_id=c.id join expert_sales_provider_requests l on l.id=p.id where p.id=$1",
      [f.d.requestId],
    )
  ).rows[0]!;
}
it("clears both retained onboarding envelopes only after ACK and TTL, atomically with rollback", async () => {
  const f = await onboarding();
  const before = await envelopes(f);
  expect(before.public_body).toBeTruthy();
  expect(before.legacy_body).toBeTruthy();
  await database().transaction(async (tx) => {
    await tx.execute(
      sql`alter table payer_receipt_contacts disable trigger payer_receipt_contact_guard`,
    );
    await tx.execute(
      sql`update payer_receipt_contacts set captured_at=date_trunc('milliseconds',clock_timestamp())-interval '2 hours',expires_at=date_trunc('milliseconds',clock_timestamp())-interval '1 hour' where id=${f.contact}::uuid`,
    );
    await tx.execute(
      sql`alter table payer_receipt_contacts enable trigger payer_receipt_contact_guard`,
    );
  });
  const repo = new PostgresPayerReceiptContactRepository(database(), vault, 30);
  await expect(
    repo.redactExpiredSelection([{ id: f.contact!, userId: f.user }]),
  ).rejects.toThrow();
  expect(await envelopes(f)).toEqual(before);
  expect(await call("public.early_bird_gateway_revoke", [f.contact])).toBe(
    true,
  );
  const c = await database().$client.connect();
  try {
    await c.query("begin");
    await c.query(
      "update payer_receipt_contacts set ciphertext=null,key_id=null,redacted_at=clock_timestamp() where id=$1",
      [f.contact],
    );
    expect(
      (
        await c.query(
          "select p.encrypted_body public_body,l.encrypted_body legacy_body from public_expert_payment_requests p join expert_sales_provider_requests l on l.id=p.id where p.id=$1",
          [f.d.requestId],
        )
      ).rows[0],
    ).toEqual({ public_body: null, legacy_body: null });
    await c.query("rollback");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
  expect(await envelopes(f)).toEqual(before);
  expect(
    await repo.redactExpiredSelection([{ id: f.contact!, userId: f.user }]),
  ).toBe(1);
  expect(await envelopes(f)).toEqual({
    contact: null,
    public_body: null,
    public_key: null,
    legacy_body: null,
    legacy_key: null,
  });
});

it("erases any legacy main replay envelope linked to the redacted public contact", async () => {
  const f = await main();
  await new PostgresYooKassaOperationRepository(
    database(),
  ).attachReplaySnapshot(f.snapshot.legacyOperationId, {
    ciphertext: "synthetic-legacy-copy",
    keyReference: "fixture:key",
    bodyVersion: 1,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  });
  await database().transaction(async (tx) => {
    await tx.execute(
      sql`alter table payer_receipt_contacts disable trigger payer_receipt_contact_guard`,
    );
    await tx.execute(
      sql`update payer_receipt_contacts set captured_at=date_trunc('milliseconds',clock_timestamp())-interval '2 hours',expires_at=date_trunc('milliseconds',clock_timestamp())-interval '1 hour' where id=${f.contact}::uuid`,
    );
    await tx.execute(
      sql`alter table payer_receipt_contacts enable trigger payer_receipt_contact_guard`,
    );
  });
  await call("public.early_bird_gateway_revoke", [f.contact]);
  await q(
    "update payer_receipt_contacts set ciphertext=null,key_id=null,redacted_at=clock_timestamp() where id=$1",
    [f.contact],
  );
  expect(
    (
      await q(
        "select replay_ciphertext,replay_key_reference,replay_body_version,recovery_expires_at from expert_residency_provider_operations where id=$1",
        [f.snapshot.legacyOperationId],
      )
    ).rows[0],
  ).toEqual({
    replay_ciphertext: null,
    replay_key_reference: null,
    replay_body_version: null,
    recovery_expires_at: null,
  });
});
it("retains claims after ordinary wave erasure and resets the complete registry only through disposable testkit reset", async () => {
  await q("insert into expert_sales_erased_cohorts(user_id) values($1)", [
    wave.user,
  ]);
  expect(
    (
      await q(
        "select count(*)::int n from public_expert_provider_identities where object_kind='payment' and provider_object_id='integrity_deferred_reserved'",
      )
    ).rows[0]!.n,
  ).toBe(1);
  await wave.db.reset();
  expect(
    (await q("select count(*)::int n from public_expert_provider_identities"))
      .rows[0]!.n,
  ).toBe(0);
});
