import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  createYooKassaClient,
  YooKassaPaymentVerifier,
} from "@ii-tonya/integrations";
import { createEarlyBirdCanonicalCoverageFixture } from "../testkit/early-bird-canonical-coverage-fixture.js";
import { PostgresExpertResidencyRepository } from "./expert-residency-repository.js";
import { PostgresExpertResidencyProviderInboxRepository } from "./expert-residency-provider-inbox-repository.js";
import { PostgresYooKassaOperationRepository } from "./yookassa-operation-repository.js";
import { PostgresExpertCardRepository } from "./expert-card-repository.js";
import { PostgresExpertResidencyLifecycleRepository } from "./expert-residency-lifecycle-repository.js";
import { createDb, closeDb } from "../client.js";
import { buildEarlyBirdRoleProvisioningSql } from "../../../../scripts/provision-early-bird-runtime-roles.mjs";

let fixture: Awaited<
  ReturnType<typeof createEarlyBirdCanonicalCoverageFixture>
>;
let lifecycle: PostgresExpertResidencyLifecycleRepository;
let financial: ReturnType<typeof createDb>;
let legacyReader: ReturnType<typeof createDb>;
const work = {
  botId: "2",
  botKey: "wave-lifecycle-work",
  telegramUserId: "123456",
  chatId: "123456",
};
let sequence = 100;
const event = (scope = work) => {
  const requestKey = `${scope.botId}:${++sequence}`;
  return {
    ...scope,
    requestKey,
    requestDigest: createHash("sha256").update(requestKey).digest("hex"),
  };
};
const query = (text: string, values: unknown[] = []) =>
  fixture.db.db.$client.query(text, values);
async function projection() {
  return (
    await query(
      "select p.active published,e.active expert,p.wave_intent_id source,p.paid_order_id,p.review_id,p.public_digest,l.status from experts_published p join experts e on e.id=p.expert_id left join expert_residency_lifecycle l on l.expert_id=e.id where p.user_id=$1",
      [fixture.owner.user],
    )
  ).rows[0]!;
}
async function financialState() {
  return (
    await query(
      "select jsonb_build_object('wave',(select to_jsonb(s) from early_bird_payment_successes s where intent_id=$1),'orders',(select jsonb_agg(to_jsonb(o) order by o.id) from expert_residency_orders o where expert_id=$2)) state",
      [fixture.intentId, fixture.expert.expertId],
    )
  ).rows[0]!.state as unknown;
}

/** The legacy interval is posted through the real operation repository and
 * verifier after an actual local HTTP CREATE/GET, never a branded test event. */
async function settleShortLegacyOrder() {
  const repository = new PostgresExpertResidencyRepository(fixture.db.db);
  const audit = await fixture.db.createAdminAudit({
    action: "expert_residency.tariff_create",
    objectId: randomUUID(),
  });
  const tariff = await repository.createTariffVersion({
    tariffKey: `lifecycle-${randomUUID()}`,
    displayName: "Short legacy",
    priceMinor: 50000n,
    durationSeconds: 86400,
    activeFrom: new Date(Date.now() - 1000),
    activeTo: new Date(Date.now() + 86400000),
    approvalId: audit.approvalId,
    adminSessionIdHash: audit.sessionIdHash,
  });
  const order = await repository.createCheckoutOrder({
    expertId: fixture.expert.expertId,
    tariffVersionId: tariff.id,
    providerDeadline: new Date(Date.now() + 3600000),
    idempotencyKey: randomUUID(),
  });
  let payment: Record<string, unknown> | undefined;
  const server = createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/v3/payments") {
      let raw = "";
      for await (const chunk of request) raw += String(chunk);
      const body = JSON.parse(raw) as Record<string, unknown>;
      payment = {
        id: randomUUID(),
        status: "pending",
        paid: false,
        test: true,
        refundable: false,
        amount: body.amount,
        metadata: body.metadata,
        created_at: new Date().toISOString(),
      };
    } else if (
      request.method !== "GET" ||
      request.url !== `/v3/payments/${payment?.id}`
    ) {
      response.writeHead(404).end();
      return;
    }
    response
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify(payment));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw Error("legacy_provider_address");
    const client = createYooKassaClient(
      { mode: "test", shopId: "test-shop", secretKey: "synthetic-local-only" },
      (url, init) =>
        fetch(`http://127.0.0.1:${address.port}${new URL(url).pathname}`, init),
    );
    const operations = new PostgresYooKassaOperationRepository(fixture.db.db);
    const claim = await operations.claim({
      commandId: randomUUID(),
      orderId: order.id,
      kind: "create_payment",
      mode: "test",
      amountMinor: "50000",
      currency: "RUB",
      requestDigest: `sha256:${"a".repeat(64)}`,
    });
    const created = await client.createPayment({
      amountMinor: 50000n,
      idempotencyKey: claim.idempotencyKey,
      description: "Legacy lifecycle fixture",
      returnUrl: "https://example.invalid/return",
      metadata: { order_id: order.id },
      receipt: {
        customer: { email: "fixture@example.invalid" },
        item: {
          description: "Legacy residency",
          vatCode: 1,
          paymentSubject: "service",
          paymentMode: "full_payment",
        },
      },
    });
    const bound = await operations.bindProviderObject(claim.id, created.id);
    Object.assign(payment!, {
      status: "succeeded",
      paid: true,
      refundable: true,
      captured_at: new Date().toISOString(),
    });
    const verified = await new YooKassaPaymentVerifier(
      client,
      operations,
    ).verifyPayment(bound);
    if (!verified) throw Error("legacy_payment_not_verified");
    await new PostgresExpertResidencyProviderInboxRepository(fixture.db.db, {
      waveCoverage: true,
    }).settle(verified);
    return order.id;
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

beforeAll(async () => {
  fixture = await createEarlyBirdCanonicalCoverageFixture();
  const legacy = await settleShortLegacyOrder();
  await fixture.recordWaveSuccess();
  const cards = new PostgresExpertCardRepository(fixture.db.db, {
    waveWorkspace: true,
    messagingConsentPolicyVersion: "client-messaging-v1",
    workBotId: work.botId,
    workBotKey: work.botKey,
  });
  const handoff = await cards.issueWorkHandoff(
    event({ ...work, botId: "1", botKey: "fixture-bot" }),
  );
  if (handoff.kind !== "issued") throw Error("wave_lifecycle_handoff_missing");
  await cards.redeemWorkHandoff({ ...event(), token: handoff.token });
  let state = (await cards.getWorkflow(work))!;
  await cards.addEntry({
    ...event(),
    expectedRevision: state.revision,
    entry: { kind: "text", text: "Private fixture answers" },
  });
  state = (await cards.getWorkflow(work))!;
  await cards.submitDraft({ ...event(), expectedRevision: state.revision });
  const manager = (
    await query(
      "select session_id_hash session from admin_sessions s join admin_role_assignments a on a.admin_id=s.admin_id and a.role='support' order by s.mfa_verified_at desc limit 1",
    )
  ).rows[0]!.session as string;
  await cards.editPublicCard({
    sessionHash: manager,
    applicationId: state.applicationId,
    expectedRevision: state.revision,
    idempotencyKey: randomUUID(),
    publicCard: {
      displayName: "Мария",
      profession: "Психолог",
      city: "Казань",
      summary: "Индивидуальные консультации",
    },
  });
  state = (await cards.getWorkflow(work))!;
  await cards.reviewCard({
    sessionHash: manager,
    applicationId: state.applicationId,
    expectedRevision: state.revision,
    idempotencyKey: randomUUID(),
    action: "approve",
  });
  await fixture.advanceClock(70 * 86400);
  await fixture.db.db.transaction(
    async (tx) => {
      await tx.execute(
        sql`select early_bird_activate_projection(${fixture.owner.user}::uuid,${fixture.intentId}::uuid)`,
      );
    },
    { isolationLevel: "serializable" },
  );
  expect(
    (
      await query(
        "select status,residency_ends_at<clock_timestamp() expired from expert_residency_orders where id=$1",
        [legacy],
      )
    ).rows[0],
  ).toEqual({ status: "settled", expired: true });
  expect(
    (
      await query(
        "select count(*)::int n from expert_card_main_orders where user_id=$1",
        [fixture.owner.user],
      )
    ).rows[0]!.n,
  ).toBe(0);
  expect(
    (
      await query("select resident_native_admission($1) valid", [
        fixture.expert.expertId,
      ])
    ).rows[0]!.valid,
  ).toBe(true);
  lifecycle = new PostgresExpertResidencyLifecycleRepository(fixture.db.db, {
    messagingConsentPolicyVersion: "client-messaging-v1",
    workBotId: work.botId,
    workBotKey: work.botKey,
  });
  const prefix = "lifecycle_" + randomUUID().replaceAll("-", "");
  const password = randomBytes(24).toString("hex");
  const primary = `${prefix}_primary`,
    publication = `${prefix}_publication`,
    legacyLogin = `${prefix}_legacy`;
  for (const name of [primary, publication, legacyLogin])
    await query(
      `create role ${name} login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '${password}'`,
    );
  await query(
    await buildEarlyBirdRoleProvisioningSql(
      { ii_tonya_wave_publication_worker: publication },
      { financialLogin: primary },
    ),
  );
  // Only the old coverage read baseline, deliberately no private USAGE/EXECUTE.
  await query(`grant select on expert_residency_orders to ${legacyLogin}`);
  const connect = (login: string) => {
    const url = new URL(fixture.db.db.$client.options.connectionString!);
    url.username = login;
    url.password = password;
    return createDb(url.toString(), { max: 1 });
  };
  financial = connect(primary);
  legacyReader = connect(legacyLogin);
  expect(
    (
      await financial.$client.query(
        "select session_user=current_user same,rolsuper,rolinherit from pg_roles where rolname=current_user",
      )
    ).rows[0],
  ).toEqual({ same: true, rolsuper: false, rolinherit: true });
  await expect(
    financial.$client.query("select * from early_bird_payment_successes"),
  ).rejects.toMatchObject({ code: "42501" });
  for (const signature of [
    "public.early_bird_refresh_projection(uuid,uuid)",
    "public.early_bird_current_publication_valid(uuid)",
  ])
    expect(
      (
        await financial.$client.query(
          "select has_function_privilege(current_user,$1,'EXECUTE') allowed",
          [signature],
        )
      ).rows[0]!.allowed,
    ).toBe(false);
  expect(
    (
      await legacyReader.$client.query(
        "select has_schema_privilege(current_user,'early_bird_private','USAGE') allowed",
      )
    ).rows[0]!.allowed,
  ).toBe(false);
  expect(
    (
      await legacyReader.$client.query(
        "select * from expert_residency_current_coverage($1)",
        [fixture.expert.expertId],
      )
    ).rows,
  ).toEqual([]);
}, 180000);
afterAll(async () => {
  try {
    await Promise.all([
      financial && closeDb(financial),
      legacyReader && closeDb(legacyReader),
    ]);
  } finally {
    await fixture?.stop();
  }
}, 120000);

it("keeps a current verified Wave publication when an expired historical legacy order is scanned", async () => {
  const before = await projection();
  const factsBefore = await financialState();
  const result = await lifecycle.processLifecycleBatch(10);
  expect(result).toMatchObject({
    examined: 1,
    suspended: 0,
    billsCreated: 0,
    noticesCreated: 0,
  });
  expect(await projection()).toEqual({
    ...before,
    published: true,
    expert: true,
    status: "active",
  });
  expect((await lifecycle.readLifecycle(work))?.paidUntil).toBe(
    "2027-02-09T21:00:00.000Z",
  );
  expect(await financialState()).toEqual(factsBefore);
});

it("repairs the same hidden Wave projection and honors pause, ownership and verified refund", async () => {
  const before = await projection();
  const factsBefore = await financialState();
  await query(
    "update experts_published set active=false,updated_at=clock_timestamp() where user_id=$1",
    [fixture.owner.user],
  );
  await query(
    "update experts set active=false,updated_at=clock_timestamp() where id=$1",
    [fixture.expert.expertId],
  );
  expect(
    (
      await financial.$client.query(
        "select early_bird_private.public_restore_wave_projection($1,$2) restored",
        [randomUUID(), fixture.expert.expertId],
      )
    ).rows[0]!.restored,
  ).toBe(false);
  expect(await projection()).toMatchObject({ published: false, expert: false });
  expect(
    (
      await financial.$client.query(
        "select early_bird_private.public_restore_wave_projection($1,$2) restored",
        [fixture.owner.user, fixture.expert.expertId],
      )
    ).rows[0]!.restored,
  ).toBe(true);
  await lifecycle.processLifecycleBatch(10);
  expect(await projection()).toEqual({
    ...before,
    published: true,
    expert: true,
    status: "active",
  });
  expect(await financialState()).toEqual(factsBefore);
  // An independently removed verification flag is never minted by restoration.
  await query("update experts set active=false,verified=false where id=$1", [
    fixture.expert.expertId,
  ]);
  await lifecycle.processLifecycleBatch(10);
  expect(await projection()).toMatchObject({ published: false, expert: false });
  expect(
    (
      await query("select verified from experts where id=$1", [
        fixture.expert.expertId,
      ])
    ).rows[0]!.verified,
  ).toBe(false);
  // The fixture owner restores that verification decision separately; lifecycle
  // may then restore only the same already-admitted, still-paid Wave identity.
  await query("update experts set verified=true where id=$1", [
    fixture.expert.expertId,
  ]);
  await lifecycle.processLifecycleBatch(10);
  expect(await projection()).toEqual({
    ...before,
    published: true,
    expert: true,
    status: "active",
  });
  await expect(
    query("update experts_published set wave_intent_id=$2 where user_id=$1", [
      fixture.owner.user,
      randomUUID(),
    ]),
  ).rejects.toMatchObject({ code: "23514" });
  const paused = await lifecycle.requestPause({
    ...event(),
    returnDate: "2027-01-13",
  });
  expect(paused.paidUntil).toBe("2027-02-09T21:00:00.000Z");
  expect(
    (
      await financial.$client.query(
        "select early_bird_private.public_current_wave_end($1) paid_until",
        [fixture.expert.expertId],
      )
    ).rows[0]!.paid_until.toISOString(),
  ).toBe("2027-02-09T21:00:00.000Z");
  expect((await lifecycle.readLifecycle(work))?.paidUntil).toBe(
    "2027-02-09T21:00:00.000Z",
  );
  expect(await lifecycle.processLifecycleBatch(10)).toMatchObject({
    billsCreated: 0,
    noticesCreated: 0,
  });
  expect(await projection()).toMatchObject({
    published: false,
    expert: false,
    status: "paused",
  });
  await lifecycle.resume(event());
  expect(await projection()).toEqual({
    ...before,
    published: true,
    expert: true,
    status: "active",
  });
  await fixture.recordFullRefund();
  await lifecycle.processLifecycleBatch(10);
  expect(await projection()).toMatchObject({
    published: false,
    expert: false,
    status: "payment_required",
  });
  expect(
    (
      await query("select resident_native_admission($1) valid", [
        fixture.expert.expertId,
      ])
    ).rows[0]!.valid,
  ).toBe(false);
});
