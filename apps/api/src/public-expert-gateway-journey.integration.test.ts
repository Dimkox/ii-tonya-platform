import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { ExperimentalGatewayIpc } from "@ii-tonya/integrations";
import { createDb, closeDb } from "../../../packages/db/src/client.js";
import {
  createPublicExpertPaymentRuntime,
  publicExpertConnectionNames,
  type PublicExpertRuntimeConfiguration,
} from "../../../packages/db/src/public-expert-payment-runtime.js";
import { startExpertReferralTestDatabase } from "../../../packages/db/src/testkit/expert-referral.js";
import {
  createPublicOnboardingFixture,
  publicTestVault,
} from "../../../packages/db/src/testkit/public-expert-payment.js";
import { PostgresExpertCardRepository } from "../../../packages/db/src/repositories/expert-card-repository.js";
import { PostgresExpertOnboardingMainPaymentRepository } from "../../../packages/db/src/repositories/expert-onboarding-main-payment-repository.js";
import { PostgresPayerReceiptContactRepository } from "../../../packages/db/src/repositories/payer-receipt-contact-repository.js";
import { PostgresPrivacyRepository } from "../../../packages/db/src/repositories/privacy-repository.js";
import { PostgresExpertResidencyRepository } from "../../../packages/db/src/repositories/expert-residency-repository.js";
import { PostgresYooKassaOperationRepository } from "../../../packages/db/src/repositories/yookassa-operation-repository.js";
import { verifyExpertOfferProfile } from "../../../packages/db/src/repositories/expert-offer-v2.js";
import { composeReceiptRetention } from "../../worker/src/receipt-disclosure-retention.js";
import { createReceiptContactFence } from "./receipt-disclosure-contact-fence.js";
import {
  buildEarlyBirdRoleProvisioningSql,
  loadEarlyBirdRoleCapabilities,
} from "../../../scripts/provision-early-bird-runtime-roles.mjs";
import {
  startPublicExpertFuturePostgres,
  startPublicExpertGatewayProvider,
} from "../../../tests/support/public-expert-gateway-provider.mjs";

// Every provider observation is produced by actual gateway IPC/LIST/GET/TLS.
// The future clock belongs only to this disposable PG cluster, Node and provider.
let future: Awaited<ReturnType<typeof startPublicExpertFuturePostgres>>;
let context: Parameters<typeof createPublicOnboardingFixture>[0];
let provider: Awaited<ReturnType<typeof startPublicExpertGatewayProvider>>;
let gateway: ExperimentalGatewayIpc;
let runtime: ReturnType<typeof createPublicExpertPaymentRuntime>;
const connections = {} as PublicExpertRuntimeConfiguration["connections"];
const key = randomBytes(32);
const password = "synthetic-task7-only";
let eventSequence = 720000;
const event = <T extends { botId: string }>(scope: T) => {
  const requestKey = `${scope.botId}:${++eventSequence}`;
  return {
    ...scope,
    requestKey,
    requestDigest: createHash("sha256").update(requestKey).digest("hex"),
  };
};
const q = (text: string, values: unknown[] = []) =>
  context.db.db.$client.query(text, values);
function freshRuntime() {
  return createPublicExpertPaymentRuntime(context.db.db, {
    connections,
    gateway,
    mode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
    vault: publicTestVault,
    requestKey: key,
    requestKeyReference: "journey:v1",
    retainedRequestKeys: new Map([["journey:v1", key]]),
    returnUrl: "https://example.invalid/return",
    vatCode: 1,
  });
}
async function requests(userId: string) {
  return (
    await q(
      "select id,kind,state,contact_id,parent_payment_id,provider_object_id,encrypted_body from public_expert_payment_requests where user_id=$1 order by created_at,id",
      [userId],
    )
  ).rows;
}
async function providerStats() {
  return provider.command({ op: "stats" }) as Promise<{
    gatewayPid: number;
    posts: {
      path: string;
      key: string;
      metadata: Record<string, string> | null;
      hasReceipt: boolean;
    }[];
    reads: string[];
    payments: {
      id: string;
      status: string;
      metadata: Record<string, string>;
      captured_at?: string;
    }[];
    refunds: { id: string }[];
  }>;
}
async function held() {
  const f = await createPublicOnboardingFixture(context);
  const result = await runtime.held.createCheckout({ invoiceId: f.invoiceId });
  expect(result).toMatchObject({ paymentId: expect.any(String) });
  const payment = (await providerStats()).payments.find(
    (p) => p.metadata.order_id === f.invoiceId,
  )!;
  expect(payment.status).toBe("pending");
  expect(
    (
      await q("select status from expert_onboarding_invoices where id=$1", [
        f.invoiceId,
      ])
    ).rows[0]!.status,
  ).toBe("pending");
  return { ...f, paymentId: payment.id };
}
async function paidOwner() {
  const f = await held();
  await provider.command({
    op: "payment",
    id: f.paymentId,
    status: "waiting_for_capture",
  });
  await runtime.held.reconcile(f.invoiceId);
  const feeStatus = (
    await q("select status from expert_onboarding_invoices where id=$1", [
      f.invoiceId,
    ])
  ).rows[0]!.status;
  if (feeStatus !== "settled") {
    throw Error(
      "journey_fee_diagnostic:" +
        JSON.stringify({
          requests: (await requests(f.userId)).map(
            ({ kind, state, parent_payment_id }) => ({
              kind,
              state,
              parent_payment_id,
            }),
          ),
          resolutions: (
            await q(
              "select kind,reason from public_expert_payment_resolutions where request_id in(select id from public_expert_payment_requests where user_id=$1)",
              [f.userId],
            )
          ).rows,
          observations: (
            await q(
              "select status,provider_captured_at,observed_at from public_expert_payment_observations where request_id in(select id from public_expert_payment_requests where user_id=$1)",
              [f.userId],
            )
          ).rows,
        }),
    );
  }
  expect(
    (
      await q("select status from expert_onboarding_invoices where id=$1", [
        f.invoiceId,
      ])
    ).rows[0]!.status,
  ).toBe("settled");
  expect(
    (
      await q(
        "select count(*)::int n from expert_onboarding_payment_facts where invoice_id=$1",
        [f.invoiceId],
      )
    ).rows[0]!.n,
  ).toBe(1);
  const identity = (
    await q(
      "select external_id,external_chat_id,bot_key from channel_identities where user_id=$1",
      [f.userId],
    )
  ).rows[0]!;
  const scope = {
    botId: "717171",
    botKey: identity.bot_key as string,
    telegramUserId: identity.external_id as string,
    chatId: identity.external_chat_id as string,
  };
  const workScope = { ...scope, botId: "818181", botKey: "journey-work" };
  const cards = new PostgresExpertCardRepository(context.db.db, {
    workBotId: workScope.botId,
    workBotKey: workScope.botKey,
    messagingConsentPolicyVersion: "client-messaging-v1",
  });
  const profile = (
    await q("select revision from expert_offer_profiles where user_id=$1", [
      f.userId,
    ])
  ).rows[0]!;
  await verifyExpertOfferProfile(context.db.db, {
    sessionHash: context.session,
    userId: f.userId,
    revision: profile.revision,
  });
  await cards.submitPromoProof({
    ...event(scope),
    expectedRevision: 0,
    proof: { kind: "link", reference: "https://example.invalid/local-promo" },
  });
  await cards.confirmPromo({
    sessionHash: context.session,
    applicationId: f.applicationId,
    expectedRevision: 0,
    idempotencyKey: randomUUID(),
  });
  const handoff = await cards.issueWorkHandoff(event(scope));
  if (handoff.kind !== "issued") throw Error("journey_handoff_missing");
  await cards.redeemWorkHandoff({ ...event(workScope), token: handoff.token });
  await cards.addEntry({
    ...event(workScope),
    expectedRevision: 0,
    entry: { kind: "text", text: "Частные ответы локального интервью" },
  });
  let state = (await cards.getWorkflow(workScope))!;
  await cards.submitDraft({
    ...event(workScope),
    expectedRevision: state.revision,
  });
  await cards.editPublicCard({
    sessionHash: context.session,
    applicationId: f.applicationId,
    expectedRevision: state.revision,
    idempotencyKey: randomUUID(),
    publicCard: {
      displayName: "Мария",
      profession: "Психолог",
      city: "Казань",
      summary: "Индивидуальные консультации",
    },
  });
  state = (await cards.getWorkflow(workScope))!;
  await cards.reviewCard({
    sessionHash: context.session,
    applicationId: f.applicationId,
    expectedRevision: state.revision,
    idempotencyKey: randomUUID(),
    action: "approve",
  });
  state = (await cards.getWorkflow(workScope))!;
  return { ...f, workScope, revision: state.revision };
}
async function mainPending() {
  const f = await paidOwner();
  const financial = new PostgresExpertOnboardingMainPaymentRepository(
    context.db.db,
    {
      providerMode: "test",
      messagingConsentPolicyVersion: "client-messaging-v1",
    },
  );
  const quote = await financial.quoteMain({
    ...event(f.workScope),
    tariffVersionId: context.tariff,
    termMonths: 1,
    revision: f.revision,
  });
  await financial.acceptMain({
    ...event(f.workScope),
    quoteId: quote.id,
    revision: f.revision,
  });
  await new PostgresPayerReceiptContactRepository(
    context.db.db,
    publicTestVault,
    30,
  ).capture({
    userId: f.userId,
    quoteId: quote.id,
    email: "journey-private@example.invalid",
    idempotencyKey: randomUUID(),
  });
  const contact = (
    await q(
      "select id from payer_receipt_contacts where user_id=$1 and quote_id=$2",
      [f.userId, quote.id],
    )
  ).rows[0]!.id as string;
  const order = await financial.createMainInvoice({
    ...event(f.workScope),
    revision: f.revision,
  });
  await q(
    "insert into payer_receipt_order_bindings(order_id,contact_id,quote_id,user_id) values($1,$2,$3,$4)",
    [order.orderId, contact, quote.id, f.userId],
  );
  const binding = await financial.checkoutBindingForOwner(
    { ...event(f.workScope), revision: f.revision },
    order.orderId,
  );
  expect(await runtime.main.createOrRecover(binding)).toMatchObject({
    kind: "ready",
    orderId: order.orderId,
  });
  const payment = (await providerStats()).payments.find(
    (p) => p.metadata.order_id === order.orderId,
  )!;
  const request = (await requests(f.userId)).find(
    (r) => r.kind === "main_create",
  )!;
  return {
    ...f,
    order,
    binding,
    mainContactId: contact,
    mainPaymentId: payment.id,
    requestId: request.id as string,
  };
}
beforeAll(async () => {
  future = await startPublicExpertFuturePostgres();
  const NativeDate = Date;
  vi.stubGlobal(
    "Date",
    new Proxy(NativeDate, {
      construct(target, args) {
        return Reflect.construct(
          target,
          args.length ? args : [NativeDate.now() + future.offsetSeconds * 1000],
        );
      },
      get(target, property) {
        return property === "now"
          ? () => NativeDate.now() + future.offsetSeconds * 1000
          : Reflect.get(target, property);
      },
    }),
  );
  const previous = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
  process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL = future.connectionString;
  try {
    const db = await startExpertReferralTestDatabase();
    await db.enableExpertReferralCommands();
    const tariff = await db.createResidencyTariff({
      tariffKey: "PRO",
      displayName: "PRO",
      priceMinor: 999000,
      durationSeconds: 2592000,
    });
    const staff = await db.createUser(),
      session = `sha256:${createHash("sha256").update(randomUUID()).digest("hex")}`;
    await db.db.execute(
      sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${session},${staff}::uuid,clock_timestamp(),clock_timestamp()+interval '1 hour')`,
    );
    await db.db.execute(
      sql`insert into admin_role_assignments(admin_id,role) values(${staff}::uuid,'support')`,
    );
    context = { db, tariff, session };
  } finally {
    if (previous === undefined)
      delete process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
    else process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL = previous;
  }
  expect((await q("show server_version_num")).rows[0]!.server_version_num).toBe(
    "170005",
  );
  expect(
    Math.abs(
      Number(
        (await q("select extract(epoch from clock_timestamp())*1000 n"))
          .rows[0]!.n,
      ) - Date.now(),
    ),
  ).toBeLessThan(1500);
  console.info("isolated PG17.5 clock image", future.imageId);
  const mapping: Record<string, string> = {};
  const capabilities = await loadEarlyBirdRoleCapabilities();
  for (const [index, name] of publicExpertConnectionNames.entries()) {
    const cap = capabilities.find((entry: { runtimeKeys: string[] }) =>
      entry.runtimeKeys.includes(name),
    )!;
    const login = `journey_${index}`;
    mapping[cap.role] = login;
    await q(`create role ${login} login inherit password '${password}'`);
    const url = new URL(context.db.db.$client.options.connectionString!);
    url.username = login;
    url.password = password;
    connections[name] = { login, db: createDb(url.toString(), { max: 2 }) };
  }
  await q(`create role journey_gateway login inherit password '${password}'`);
  mapping.ii_tonya_wave_gateway = "journey_gateway";
  await q(await buildEarlyBirdRoleProvisioningSql(mapping));
  provider = await startPublicExpertGatewayProvider(
    context.db.db.$client.options.connectionString!,
    "journey_gateway",
    password,
    future.offsetSeconds,
  );
  gateway = new ExperimentalGatewayIpc({
    address: provider.address,
    key: Buffer.alloc(32, "k"),
    authKey: Buffer.alloc(32, "a"),
    timeoutMs: 10000,
  });
  runtime = freshRuntime();
  await runtime.assertReady();
  for (const connection of Object.values(connections)) {
    await expect(
      connection.db.$client.query("select * from payer_receipt_contacts"),
    ).rejects.toMatchObject({ code: "42501" });
    expect(
      (await connection.db.$client.query("select session_user name")).rows[0]!
        .name,
    ).toBe(connection.login);
  }
}, 180000);
afterAll(async () => {
  const failures: unknown[] = [];
  const cleanup = async (work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (error) {
      failures.push(error);
    }
  };
  await cleanup(async () => runtime?.stop());
  await cleanup(async () => provider?.close());
  await cleanup(async () =>
    Promise.all(Object.values(connections).map((entry) => closeDb(entry.db))),
  );
  await cleanup(async () => context?.db.stop());
  await cleanup(async () => future?.stop());
  vi.unstubAllGlobals();
  if (failures.length)
    throw new AggregateError(failures, "journey fixture cleanup failed");
}, 120000);

it("completes approved public held fee → real card approval → main → publication → authorized local refund and restart recovery", async () => {
  const f = await mainPending();
  expect(
    (
      await q(
        "select count(*)::int n from experts_published where user_id=$1 and active",
        [f.userId],
      )
    ).rows[0]!.n,
  ).toBe(0);
  await provider.command({
    op: "payment",
    id: f.mainPaymentId,
    status: "succeeded",
  });
  await runtime.recovery.recover(f.requestId);
  const order = (
    await q(
      "select status,early_bird_private.public_time(residency_starts_at) starts,early_bird_private.public_time(settled_at) settled from expert_residency_orders where id=$1",
      [f.order.orderId],
    )
  ).rows[0]!;
  const payment = (await providerStats()).payments.find(
    (p) => p.id === f.mainPaymentId,
  )!;
  expect(order).toEqual({
    status: "settled",
    starts: payment.captured_at,
    settled: payment.captured_at,
  });
  expect(
    (
      await q(
        "select paid_order_id,active,wave_intent_id from experts_published where user_id=$1",
        [f.userId],
      )
    ).rows[0],
  ).toEqual({
    paid_order_id: f.order.orderId,
    active: true,
    wave_intent_id: null,
  });
  const operations = new PostgresYooKassaOperationRepository(context.db.db);
  const create = (
    await q(
      "select legacy_operation_id from public_expert_payment_requests where id=$1",
      [f.requestId],
    )
  ).rows[0]!.legacy_operation_id;
  await operations.resolve(create, "succeeded");
  // Explicit synthetic trusted command, NOT an authenticated live refund API.
  const refund = await operations.claim({
    commandId: randomUUID(),
    orderId: f.order.orderId,
    kind: "create_refund",
    mode: "test",
    amountMinor: f.binding.amountMinor,
    currency: "RUB",
    parentPaymentId: f.mainPaymentId,
    requestDigest: `sha256:${createHash("sha256")
      .update("local-explicit-refund-command:" + f.order.orderId)
      .digest("hex")}`,
  });
  const before = (await providerStats()).posts.length;
  expect(
    await runtime.main.createOrRecoverRefund({
      userId: randomUUID(),
      operationId: refund.id,
    }),
  ).toEqual({ kind: "unavailable" });
  expect((await providerStats()).posts.length).toBe(before);
  await provider.command({ op: "drop", unavailable: true });
  expect(
    (
      await runtime.main.createOrRecoverRefund({
        userId: f.userId,
        operationId: refund.id,
      })
    ).kind,
  ).toBe("pending");
  expect((await providerStats()).posts.length).toBe(before + 1);
  await runtime.stop();
  await provider.command({ op: "reads", enabled: true });
  const priorPid = (await providerStats()).gatewayPid;
  const restarted = await provider.command({ op: "restart" });
  expect(restarted.ready).toBe(true);
  expect(restarted.gatewayPid).not.toBe(priorPid);
  runtime = freshRuntime();
  const result = await runtime.main.createOrRecoverRefund({
    userId: f.userId,
    operationId: refund.id,
  });
  expect(result.kind).toBe("observed");
  expect((await providerStats()).posts.length).toBe(before + 1);
  expect(
    (
      await q("select status from expert_residency_orders where id=$1", [
        f.order.orderId,
      ])
    ).rows[0]!.status,
  ).toBe("refunded");
  expect(
    (
      await q("select active from experts_published where user_id=$1", [
        f.userId,
      ])
    ).rows[0]!.active,
  ).toBe(false);
  expect(
    (
      await q(
        "select count(*)::int n from expert_residency_provider_event_inbox where order_id=$1 and status='processed'",
        [f.order.orderId],
      )
    ).rows[0]!.n,
  ).toBe(2);
  expect(JSON.stringify(await requests(f.userId))).not.toContain(
    "journey-private@example.invalid",
  );
}, 120000);

it("recovers a lost unbound CREATE response with complete TLS LIST plus fresh GET after runtime reconstruction and a gateway process restart, with no POST replay", async () => {
  const f = await createPublicOnboardingFixture(context);
  const before = (await providerStats()).posts.length;
  await provider.command({ op: "drop", unavailable: true });
  await expect(
    runtime.held.createCheckout({ invoiceId: f.invoiceId }),
  ).rejects.toThrow("held_checkout_unavailable");
  expect(await requests(f.userId)).toMatchObject([
    { state: "uncertain", provider_object_id: null },
  ]);
  expect((await providerStats()).posts.length).toBe(before + 1);
  await runtime.stop();
  await provider.command({ op: "reads", enabled: true });
  const priorPid = (await providerStats()).gatewayPid;
  const restarted = await provider.command({ op: "restart" });
  expect(restarted.gatewayPid).not.toBe(priorPid);
  runtime = freshRuntime();
  const reads = (await providerStats()).reads.length;
  expect(
    (
      await runtime.held.recoverCheckout({
        invoiceId: f.invoiceId,
        operationId: f.operationId,
      })
    ).kind,
  ).toBe("ready");
  const stats = await providerStats();
  expect(stats.posts.length).toBe(before + 1);
  expect(
    stats.reads.slice(reads).some((p) => p.startsWith("/v3/payments?")),
  ).toBe(true);
  expect(
    stats.reads
      .slice(reads)
      .some((p) => /^\/v3\/payments\/[0-9a-f-]+$/u.test(p)),
  ).toBe(true);
  expect(await requests(f.userId)).toMatchObject([
    { state: "bound", provider_object_id: expect.any(String) },
  ]);
}, 60000);

it("ACK deletion fences an in-flight contact send and blocks every later contact dispatch while retaining canonical recovery", async () => {
  const f = await createPublicOnboardingFixture(context);
  const before = (await providerStats()).posts.length;
  await provider.command({ op: "pause" });
  const sending = runtime.held.createCheckout({ invoiceId: f.invoiceId });
  expect(await provider.command({ op: "entered" })).toEqual({ entered: true });
  const privacy = new PostgresPrivacyRepository(context.db.db, {
    privacyMutationCapability: { enabled: true },
    beforePrivacyReceiptDisclosure: createReceiptContactFence(
      gateway,
      "journey-v1",
    ),
  });
  let deleted = false;
  const deleting = privacy
    .withdrawConsentAtomically({
      targetUserId: f.userId,
      purpose: "client_messaging",
      policyVersion: "client-messaging-v1",
      correlationId: randomUUID(),
    })
    .then(async () => {
      const retention = composeReceiptRetention(
        new PostgresPayerReceiptContactRepository(
          context.db.db,
          publicTestVault,
          30,
        ),
        { checkoutEnabled: true, gateway },
      );
      expect(await retention()).toBeGreaterThan(0);
      deleted = true;
    });
  // The approved boundary allows an already admitted send to finish. ACK
  // fences later sends even while this provider response is still pending.
  await deleting;
  expect(
    (
      await q(
        "select revoked_at is not null revoked from early_bird_gateway_contact_state where contact_id=$1",
        [f.contactId],
      )
    ).rows[0]!.revoked,
  ).toBe(true);
  await provider.command({ op: "release" });
  await Promise.allSettled([sending]);
  expect(deleted).toBe(true);
  expect(
    (
      await q(
        "select ciphertext,redacted_at is not null redacted from payer_receipt_contacts where id=$1",
        [f.contactId],
      )
    ).rows[0],
  ).toEqual({ ciphertext: null, redacted: true });
  expect(
    (
      await q(
        "select count(*)::int n from receipt_revocation_outbox where subject_id=$1",
        [f.userId],
      )
    ).rows[0]!.n,
  ).toBe(0);
  expect(
    (
      await q(
        "select encrypted_body from public_expert_payment_requests where user_id=$1",
        [f.userId],
      )
    ).rows.every((r) => r.encrypted_body === null),
  ).toBe(true);
  await runtime.held.recoverCheckout({
    invoiceId: f.invoiceId,
    operationId: f.operationId,
  });
  expect((await providerStats()).posts.length).toBe(before + 1);
}, 60000);

it("capture-versus-cancel contenders share the held parent fence and cannot dispatch both mutations", async () => {
  const f = await held();
  await provider.command({
    op: "payment",
    id: f.paymentId,
    status: "waiting_for_capture",
  });
  await provider.command({ op: "pause" });
  const capturing = runtime.held.reconcile(f.invoiceId);
  expect(await provider.command({ op: "entered" })).toEqual({ entered: true });
  await q(
    "update expert_onboarding_applications set archived_at=clock_timestamp(),archive_until_date=clock_timestamp()+interval '1 month' where id=$1",
    [f.applicationId],
  );
  const canceling = runtime.held.reconcile(f.invoiceId);
  await provider.command({ op: "release" });
  await Promise.all([capturing, canceling]);
  await runtime.held.reconcile(f.invoiceId);
  const mutations = (await providerStats()).posts.filter((p) =>
    p.path.includes(f.paymentId),
  );
  expect(mutations.map((p) => p.path)).toEqual([
    `/v3/payments/${f.paymentId}/capture`,
  ]);
  expect(mutations[0]!.hasReceipt).toBe(false);
  const current = await requests(f.userId);
  expect(
    current.filter((r) =>
      ["onboarding_capture", "onboarding_cancel"].includes(r.kind),
    ),
  ).toHaveLength(1);
  expect(current.find((r) => r.kind === "onboarding_capture")).toMatchObject({
    contact_id: null,
    parent_payment_id: f.paymentId,
  });
}, 60000);

it("does not expire an uncertain main order before its delayed successful capture is freshly recovered", async () => {
  const f = await mainPending();
  const before = (await providerStats()).posts.length;
  // Delayed processing is represented by the isolated clock below; the captured
  // instant is preserved from the real TLS provider object, never caller facts.
  await provider.command({
    op: "payment",
    id: f.mainPaymentId,
    status: "succeeded",
  });
  const capture = (await providerStats()).payments.find(
    (p) => p.id === f.mainPaymentId,
  )!.captured_at!;
  const deadline = Date.parse(f.binding.paymentDeadline);
  const advance = Math.max(1, Math.ceil((deadline - Date.now()) / 1000) + 1);
  await future.advance(advance);
  await provider.command({ op: "offset", seconds: future.offsetSeconds });
  const residency = new PostgresExpertResidencyRepository(context.db.db);
  await residency.releaseExpiredOrders(25);
  expect(
    (
      await q("select status from expert_residency_orders where id=$1", [
        f.order.orderId,
      ])
    ).rows[0]!.status,
  ).toBe("payment_pending");
  await runtime.stop();
  runtime = freshRuntime();
  await runtime.recovery.recover(f.requestId);
  expect(
    (
      await q(
        "select status,early_bird_private.public_time(residency_starts_at) starts from expert_residency_orders where id=$1",
        [f.order.orderId],
      )
    ).rows[0],
  ).toEqual({ status: "settled", starts: capture });
  expect((await providerStats()).posts.length).toBe(before);
}, 120000);
