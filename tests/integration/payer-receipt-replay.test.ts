import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { PostgresExpertCampaignOrderRepository } from "../../packages/db/src/repositories/expert-campaign-order-repository.js";
import { PostgresExpertCampaignQuoteRepository } from "../../packages/db/src/repositories/expert-campaign-quote-repository.js";
import { PostgresPayerReceiptContactRepository } from "../../packages/db/src/repositories/payer-receipt-contact-repository.js";
import { PostgresYooKassaOperationRepository } from "../../packages/db/src/repositories/yookassa-operation-repository.js";
import { PostgresExpertReferralRepository } from "../../packages/db/src/repositories/expert-referral-repository.js";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import { PostgresExpertResidencyProviderInboxRepository } from "../../packages/db/src/repositories/expert-residency-provider-inbox-repository.js";
import { ExpertCodeCrypto } from "../../packages/application/src/expert-code-crypto.js";
import { verifiedEventFixture } from "../../packages/integrations/src/expert-residency/verified-event.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
  type ExpertIdentityFixture,
} from "../../packages/db/src/testkit/expert-referral.js";
import {
  createPayerReceiptVault,
  createPayerReceiptSource,
  createYooKassaClient,
  YooKassaExpertResidencyPaymentAdapter,
  YooKassaUnknownOutcomeError,
  type PayerReceiptBinding,
  type PayerReceiptVault,
} from "../../packages/integrations/src/index.js";

let database: ExpertReferralTestDatabase;
let tariffVersionId: string;
beforeAll(async () => {
  if (!process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL)
    throw new Error("isolated_pg17_required");
  database = await startExpertReferralTestDatabase();
  expect(
    (await database.db.execute(sql`show server_version_num`)).rows,
  ).toEqual([{ server_version_num: "170005" }]);
  await database.enableExpertReferralCommands();
  tariffVersionId = await database.createResidencyTariff({
    tariffKey: "PRO",
    displayName: "Pro",
    priceMinor: 999000,
    durationSeconds: 2592000,
  });
}, 120000);
afterAll(async () => {
  await database?.stop();
});

// Obtain real referral credit through issuance, redemption and verified fixture
// settlement. No financial rows are fabricated and no real provider is called.
async function grantCredit(owner: ExpertIdentityFixture) {
  const invitee = await database.createExpertIdentity();
  const audit = await database.createAdminAudit({
    action: "expert_referral.batch_generate",
    objectId: owner.expertId,
  });
  const referrals = new PostgresExpertReferralRepository(
    database.db,
    new ExpertCodeCrypto({
      currentVersion: "v1",
      activeVersions: ["v1"],
      key: () => new Uint8Array(32).fill(29),
    }),
  );
  const batch = await referrals.issueBatch({
    inviterExpertId: owner.expertId,
    count: 1,
    issuedByAdminId: audit.adminId,
    approvalId: audit.approvalId,
    adminSessionIdHash: audit.sessionIdHash,
  });
  await referrals.redeemCode({
    plaintext: batch.codes[0]!.plaintext,
    userId: invitee.userId,
    provider: invitee.provider,
    externalId: invitee.externalId,
  });
  const tariffId = await database.createResidencyTariff({
    tariffKey: `receipt-credit-${randomUUID()}`,
    displayName: "Receipt replay fixture",
    priceMinor: 999000,
    durationSeconds: 2592000,
    commercialPolicyVersion: "legacy_residency_v1",
  });
  await database.db.execute(
    sql`update expert_referral_feature_controls set version=version+1,reward_grants_enabled=true where control_key='expert_referrals'`,
  );
  const qualifying = await new PostgresExpertResidencyRepository(
    database.db,
  ).createCheckoutOrder({
    expertId: invitee.expertId,
    tariffVersionId: tariffId,
    providerDeadline: new Date(Date.now() + 3600000),
    idempotencyKey: randomUUID(),
  });
  const now = new Date().toISOString();
  const event = verifiedEventFixture(
    {
      kind: "settled",
      provider: "receipt-replay-fixture",
      eventId: `settled_${qualifying.id}`,
      paymentId: `pay_${qualifying.id}`,
      orderId: qualifying.id,
      amountMinor: qualifying.cashMinor,
      currency: "RUB",
      occurredAt: now,
      payloadDigest: `sha256:${createHash("sha256").update(qualifying.id).digest("hex")}`,
    },
    {
      verificationId: `verify_${qualifying.id}`,
      verifierKeyVersion: "fixture-v1",
      verifiedAt: now,
    },
  );
  expect(
    (
      await new PostgresExpertResidencyProviderInboxRepository(
        database.db,
      ).settle(event)
    ).rewardGranted,
  ).toBe(true);
  const grants = (
    await database.db.execute<{ id: string; amount: string }>(
      sql`select id,amount_minor::text as amount from expert_referral_reward_grants where expert_id=${owner.expertId}::uuid`,
    )
  ).rows;
  expect(grants).toEqual([{ id: expect.any(String), amount: "100000" }]);
  return grants[0]!.id;
}

async function fixture(withCredit = false) {
  const owner = await database.createExpertIdentity();
  const grantId = withCredit ? await grantCredit(owner) : undefined;
  const quote = await new PostgresExpertCampaignQuoteRepository(
    database.db,
  ).createQuote({
    userId: owner.userId,
    tariffVersionId,
    termMonths: 1,
    idempotencyKey: randomUUID(),
  });
  const vault = createPayerReceiptVault({
    activeKeyId: "r1",
    keys: new Map([["r1", new Uint8Array(32).fill(17)]]),
  });
  const repository = new PostgresPayerReceiptContactRepository(
    database.db,
    vault,
    1,
  );
  const capture = {
    userId: owner.userId,
    quoteId: quote.id,
    email: "payer@example.test",
    idempotencyKey: randomUUID(),
  };
  const contact = await repository.capture(capture);
  const alternate = await repository.capture({
    ...capture,
    email: "alternate@example.test",
    idempotencyKey: randomUUID(),
  });
  const command = {
    userId: owner.userId,
    expertId: owner.expertId,
    quoteId: quote.id,
    receiptContactId: contact.receiptContactId,
    idempotencyKey: randomUUID(),
  };
  const orders = new PostgresExpertCampaignOrderRepository(database.db, vault);
  return {
    owner,
    quote,
    vault,
    repository,
    contact,
    alternate,
    command,
    orders,
    grantId,
  };
}

// Only this isolated fixture changes authenticated timestamps. Real cleanup
// performs the redaction, and every envelope remains correctly authenticated.
async function expireContact(f: Awaited<ReturnType<typeof fixture>>) {
  const expiresAt = new Date(Date.now() - 1000).toISOString();
  const metadata: PayerReceiptBinding = {
    id: f.contact.receiptContactId,
    quoteId: f.quote.id,
    userId: f.owner.userId,
    kind: "email",
    basis: "fiscal_payment_dec_plt_004_v1",
    capturedAt: new Date(Date.parse(expiresAt) - 86400000).toISOString(),
    expiresAt,
  };
  const sealed = f.vault.seal("payer@example.test", metadata);
  await database.db.transaction(async (tx) => {
    await tx.execute(
      sql`alter table payer_receipt_contacts disable trigger payer_receipt_contact_guard`,
    );
    await tx.execute(
      sql`update payer_receipt_contacts set captured_at=${metadata.capturedAt}::timestamptz,expires_at=${expiresAt}::timestamptz,key_id=${sealed.keyId},ciphertext=${sealed.ciphertext} where id=${metadata.id}::uuid`,
    );
    await tx.execute(
      sql`alter table payer_receipt_contacts enable trigger payer_receipt_contact_guard`,
    );
  });
  expect(f.vault.open(sealed, metadata)).toBe("payer@example.test");
}

// Optional lookup permits an assertion-level RED against the pre-change class.
function metadataFor(
  repository: PostgresPayerReceiptContactRepository,
  orderId: string,
) {
  const capable = repository as PostgresPayerReceiptContactRepository & {
    receiptAuthorityForOrder?(id: string): Promise<{
      contactKind: "email" | "phone";
      authorityReference: string;
    } | null>;
  };
  return capable.receiptAuthorityForOrder?.(orderId) ?? Promise.resolve(null);
}

async function financialState(expertId: string) {
  return {
    orders: (
      await database.db.execute(
        sql`select * from expert_residency_orders where expert_id=${expertId}::uuid order by id`,
      )
    ).rows,
    ledger: (
      await database.db.execute(
        sql`select * from expert_referral_ledger_entries where expert_id=${expertId}::uuid order by id`,
      )
    ).rows,
    allocations: (
      await database.db.execute(
        sql`select * from expert_referral_ledger_allocations where expert_id=${expertId}::uuid order by ledger_entry_id,reward_grant_id`,
      )
    ).rows,
    bindings: (
      await database.db.execute(
        sql`select b.* from payer_receipt_order_bindings b join expert_residency_orders o on o.id=b.order_id where o.expert_id=${expertId}::uuid order by b.order_id`,
      )
    ).rows,
    grants: (
      await database.db.execute(
        sql`select * from expert_referral_reward_grants where expert_id=${expertId}::uuid order by id`,
      )
    ).rows,
    attempts: (
      await database.db.execute(
        sql`select p.* from expert_residency_payment_attempts p join expert_residency_orders o on o.id=p.order_id where o.expert_id=${expertId}::uuid order by p.id`,
      )
    ).rows,
    operations: (
      await database.db.execute(
        sql`select p.* from expert_residency_provider_operations p join expert_residency_orders o on o.id=p.order_id where o.expert_id=${expertId}::uuid order by p.id`,
      )
    ).rows,
  };
}

function paymentFixture(
  f: Awaited<ReturnType<typeof fixture>>,
  order: { id: string; cashMinor: string },
) {
  const paymentId = `payment-${order.id}`;
  const amount = `${BigInt(order.cashMinor) / 100n}.${(BigInt(order.cashMinor) % 100n).toString().padStart(2, "0")}`;
  const transport = vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe(
      init.method === "POST"
        ? "https://api.yookassa.ru/v3/payments"
        : `https://api.yookassa.ru/v3/payments/${paymentId}`,
    );
    return Response.json({
      id: paymentId,
      status: "pending",
      paid: false,
      amount: { value: amount, currency: "RUB" },
      test: true,
      created_at: "2026-10-14T00:00:00.000Z",
      metadata: { order_id: order.id },
      confirmation: {
        type: "redirect",
        confirmation_url: "https://yoomoney.ru/checkout/pg-replay",
      },
      refundable: false,
    });
  });
  const deps = {
    client: createYooKassaClient(
      { shopId: "test-shop", secretKey: "synthetic-secret", mode: "test" },
      transport,
    ),
    operations: new PostgresYooKassaOperationRepository(database.db),
    contacts: createPayerReceiptSource(f.repository),
    mode: "test" as const,
    returnUrl: "https://example.invalid/return",
    receipt: {
      vatCode: 1 as const,
      paymentSubject: "service",
      paymentMode: "full_payment",
    },
  };
  return {
    deps,
    transport,
    paymentId,
    command: {
      orderId: order.id,
      amountMinor: order.cashMinor,
      currency: "RUB" as const,
      idempotencyKey: f.command.idempotencyKey,
    },
  };
}

it("replays a receipt-bound nonzero-credit reservation without rewriting any financial or provider rows", async () => {
  const f = await fixture(true);
  const order = await f.orders.createCheckoutOrderWithReceipt(f.command);
  expect(order.creditMinor).toBe("100000");
  expect(order.allocations).toEqual([
    { grantId: f.grantId, amountMinor: "100000" },
  ]);
  await expireContact(f);
  await f.repository.redactExpiredSelection(
    await f.repository.listExpiredBatch(100),
  );
  const payment = paymentFixture(f, order);
  const noVault = new PostgresPayerReceiptContactRepository(database.db);
  await expect(
    new YooKassaExpertResidencyPaymentAdapter({
      ...payment.deps,
      contacts: createPayerReceiptSource(noVault),
    }).createCheckout(payment.command),
  ).rejects.toThrow("yookassa_unknown_outcome");
  const before = await financialState(f.owner.expertId);
  expect(
    before.ledger.filter((row) => row.entry_kind === "reservation"),
  ).toEqual([
    expect.objectContaining({ amount_minor: "-100000", order_id: order.id }),
  ]);
  expect(before.attempts).toHaveLength(1);
  expect(before.operations).toHaveLength(1);
  const open = vi.fn((): never => {
    throw new Error("replay_disclosure_forbidden");
  });
  for (let n = 0; n < 2; n++) {
    await expect(
      new PostgresExpertCampaignOrderRepository(database.db, {
        seal: f.vault.seal,
        open,
      }).createCheckoutOrderWithReceipt(f.command),
    ).resolves.toEqual(order);
    expect(await financialState(f.owner.expertId)).toEqual(before);
  }
  expect(open).not.toHaveBeenCalled();
  expect(payment.transport).not.toHaveBeenCalled();
}, 15000);

it("expires an overdue receipt-bound order and releases its original credit exactly once without plaintext", async () => {
  const f = await fixture(true);
  const order = await f.orders.createCheckoutOrderWithReceipt(f.command);
  expect(order.creditMinor).toBe("100000");
  const payment = paymentFixture(f, order);
  await expect(
    new YooKassaExpertResidencyPaymentAdapter({
      ...payment.deps,
      contacts: createPayerReceiptSource(
        new PostgresPayerReceiptContactRepository(database.db),
      ),
    }).createCheckout(payment.command),
  ).rejects.toThrow("yookassa_unknown_outcome");
  await expireContact(f);
  await f.repository.redactExpiredSelection(
    await f.repository.listExpiredBatch(100),
  );
  // Bounded historical clock fixture in this child database only. Preserve
  // created_at < payment_deadline <= provider_deadline; product clocks stay real.
  const shifted = await database.db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role=replica`);
    return (
      await tx.execute<{ createdAt: string; paymentDeadline: string }>(
        sql`with clock as materialized(select date_trunc('milliseconds',clock_timestamp()) as now) update expert_residency_orders set created_at=clock.now-interval '2 minutes',payment_deadline=clock.now-interval '1 minute' from clock where id=${order.id}::uuid returning created_at as "createdAt",payment_deadline as "paymentDeadline"`,
      )
    ).rows[0]!;
  });
  const before = await financialState(f.owner.expertId);
  const reservation = before.ledger.find(
    (row) => row.entry_kind === "reservation",
  )!;
  expect(reservation).toMatchObject({
    amount_minor: "-100000",
    order_id: order.id,
  });
  const open = vi.fn((): never => {
    throw new Error("expiry_disclosure_forbidden");
  });
  const replay = () =>
    new PostgresExpertCampaignOrderRepository(database.db, {
      seal: f.vault.seal,
      open,
    }).createCheckoutOrderWithReceipt(f.command);
  const expired = await replay();
  expect(expired).toEqual({
    ...order,
    status: "expired",
    createdAt: new Date(shifted.createdAt).toISOString(),
    paymentDeadline: new Date(shifted.paymentDeadline).toISOString(),
  });
  const after = await financialState(f.owner.expertId);
  const releases = after.ledger.filter((row) => row.entry_kind === "release");
  expect(releases).toHaveLength(1);
  expect(releases[0]).toMatchObject({
    expert_id: f.owner.expertId,
    order_id: order.id,
    amount_minor: "100000",
    original_entry_id: reservation.id,
    source_type: "residency_order",
    source_id: order.id,
    idempotency_key: `release:${String(reservation.id)}`,
  });
  expect(after.ledger.filter((row) => row.entry_kind !== "release")).toEqual(
    before.ledger,
  );
  expect(
    after.allocations.filter((row) => row.ledger_entry_id === releases[0]!.id),
  ).toEqual([
    expect.objectContaining({
      reward_grant_id: f.grantId,
      expert_id: f.owner.expertId,
      amount_minor: "100000",
    }),
  ]);
  expect(
    after.allocations.filter((row) => row.ledger_entry_id !== releases[0]!.id),
  ).toEqual(before.allocations);
  expect(after.orders).toEqual(
    before.orders.map((row) => ({
      ...row,
      status: "expired",
      updated_at: expect.anything(),
    })),
  );
  expect(after.bindings).toEqual(before.bindings);
  expect(after.grants).toEqual(before.grants);
  expect(after.attempts).toEqual(before.attempts);
  expect(after.operations).toEqual(before.operations);
  expect(
    (
      await database.db.execute(
        sql`select sum(a.amount_minor)::text as net from expert_referral_ledger_allocations a join expert_referral_ledger_entries e on e.id=a.ledger_entry_id where e.order_id=${order.id}::uuid`,
      )
    ).rows,
  ).toEqual([{ net: "0" }]);
  await expect(replay()).resolves.toEqual(expired);
  await expect(replay()).resolves.toEqual(expired);
  expect(await financialState(f.owner.expertId)).toEqual(after);
  expect(open).not.toHaveBeenCalled();
  expect(payment.transport).not.toHaveBeenCalled();
}, 15000);

it.each([
  "failed disclosure",
  "lost admission acknowledgement",
  "failed bookkeeping",
])(
  "retains real unknown admission after %s across fresh repository/adapter retry",
  async (failure) => {
    const f = await fixture();
    const order = await f.orders.createCheckoutOrderWithReceipt(f.command);
    const payment = paymentFixture(f, order);
    const reader = new PostgresPayerReceiptContactRepository(
      database.db,
      failure === "lost admission acknowledgement" ? f.vault : undefined,
    );
    const disclosure = vi.spyOn(reader, "receiptContactForOrder");
    let committed: Awaited<ReturnType<typeof financialState>> | undefined;
    if (failure === "lost admission acknowledgement") {
      const commit = payment.deps.operations.claimInitialPayment.bind(
        payment.deps.operations,
      );
      vi.spyOn(
        payment.deps.operations,
        "claimInitialPayment",
      ).mockImplementation(async (command) => {
        await commit(command);
        committed = await financialState(f.owner.expertId);
        throw new YooKassaUnknownOutcomeError();
      });
    }
    if (failure === "failed bookkeeping")
      vi.spyOn(payment.deps.operations, "markUnknown").mockRejectedValue(
        new Error("private storage details"),
      );
    await expect(
      new YooKassaExpertResidencyPaymentAdapter({
        ...payment.deps,
        contacts: createPayerReceiptSource(reader),
      }).createCheckout(payment.command),
    ).rejects.toThrow("yookassa_unknown_outcome");
    const before = await financialState(f.owner.expertId);
    expect(before.attempts).toEqual([
      expect.objectContaining({
        order_id: order.id,
        status: "unknown_outcome",
        expected_amount_minor: order.cashMinor,
        resolved_at: null,
      }),
    ]);
    expect(before.operations).toEqual([
      expect.objectContaining({
        order_id: order.id,
        payment_attempt_id: before.attempts[0]!.id,
        status: "unknown_outcome",
        provider_object_id: null,
        amount_minor: order.cashMinor,
      }),
    ]);
    if (failure === "lost admission acknowledgement")
      expect(before).toEqual(committed);
    expect(disclosure).toHaveBeenCalledTimes(
      failure === "lost admission acknowledgement" ? 0 : 1,
    );
    const freshReader = new PostgresPayerReceiptContactRepository(
      database.db,
      f.vault,
    );
    const freshDisclosure = vi.spyOn(freshReader, "receiptContactForOrder");
    const retry = new YooKassaExpertResidencyPaymentAdapter({
      ...payment.deps,
      operations: new PostgresYooKassaOperationRepository(database.db),
      contacts: createPayerReceiptSource(freshReader),
    });
    await expect(retry.createCheckout(payment.command)).rejects.toThrow(
      "yookassa_unknown_outcome",
    );
    expect(await financialState(f.owner.expertId)).toEqual(before);
    expect(freshDisclosure).not.toHaveBeenCalled();
    expect(payment.transport).not.toHaveBeenCalled();
  },
);

it("keeps a real concurrent losing admission from reading contact or POSTing while the winner waits", async () => {
  const f = await fixture();
  const order = await f.orders.createCheckoutOrderWithReceipt(f.command);
  const payment = paymentFixture(f, order);
  const reading = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const winnerReader = new PostgresPayerReceiptContactRepository(
    database.db,
    f.vault,
  );
  const read = winnerReader.receiptContactForOrder.bind(winnerReader);
  const winnerDisclosure = vi
    .spyOn(winnerReader, "receiptContactForOrder")
    .mockImplementation(async (orderId) => {
      reading.resolve();
      await release.promise;
      return read(orderId);
    });
  const winner = new YooKassaExpertResidencyPaymentAdapter({
    ...payment.deps,
    contacts: createPayerReceiptSource(winnerReader),
  }).createCheckout(payment.command);
  try {
    // Reject promptly if the winner fails before the controlled disclosure gate.
    await Promise.race([
      reading.promise,
      winner.then(() => {
        throw new Error("winner_skipped_gate");
      }),
    ]);
    const before = await financialState(f.owner.expertId);
    expect(before.operations).toEqual([
      expect.objectContaining({
        status: "unknown_outcome",
        provider_object_id: null,
      }),
    ]);
    const loserReader = new PostgresPayerReceiptContactRepository(
      database.db,
      f.vault,
    );
    const loserDisclosure = vi.spyOn(loserReader, "receiptContactForOrder");
    const loserTransport = vi.fn(async (): Promise<Response> => {
      throw new Error("loser_transport_forbidden");
    });
    const loser = new YooKassaExpertResidencyPaymentAdapter({
      ...payment.deps,
      operations: new PostgresYooKassaOperationRepository(database.db),
      contacts: createPayerReceiptSource(loserReader),
      client: createYooKassaClient(
        { shopId: "test-shop", secretKey: "synthetic-secret", mode: "test" },
        loserTransport,
      ),
    });
    await expect(loser.createCheckout(payment.command)).rejects.toThrow(
      "yookassa_unknown_outcome",
    );
    expect(loserDisclosure).not.toHaveBeenCalled();
    expect(loserTransport).not.toHaveBeenCalled();
    expect(payment.transport).not.toHaveBeenCalled();
    expect(await financialState(f.owner.expertId)).toEqual(before);
  } finally {
    release.resolve();
    await winner;
  }
  expect(winnerDisclosure).toHaveBeenCalledOnce();
  expect(payment.transport.mock.calls.map(([, init]) => init.method)).toEqual([
    "POST",
  ]);
  expect(
    await new PostgresYooKassaOperationRepository(
      database.db,
    ).findByProviderObject(payment.paymentId, "create_payment"),
  ).toMatchObject({ orderId: order.id, status: "pending" });
}, 15000);

it("retains exact opaque metadata after expiry and redaction with no vault access", async () => {
  const f = await fixture();
  const order = await f.orders.createCheckoutOrderWithReceipt(f.command);
  const expected = {
    contactKind: "email",
    authorityReference: `payer-receipt:${f.contact.receiptContactId}`,
  };
  const forbidden = vi.fn((): never => {
    throw new Error("private vault details");
  });
  const noVault = new PostgresPayerReceiptContactRepository(database.db);
  const brokenVault = new PostgresPayerReceiptContactRepository(database.db, {
    open: forbidden,
    seal: forbidden,
  });
  expect(await metadataFor(noVault, order.id)).toEqual(expected);
  expect(await metadataFor(brokenVault, order.id)).toEqual(expected);
  await expireContact(f);
  expect(await f.repository.receiptContactForOrder(order.id)).toBeNull();
  expect(await metadataFor(noVault, order.id)).toEqual(expected);
  await noVault.redactExpiredSelection(await noVault.listExpiredBatch(100));
  expect(
    (
      await database.db.execute(
        sql`select key_id,ciphertext,redacted_at is not null as redacted from payer_receipt_contacts where id=${f.contact.receiptContactId}::uuid`,
      )
    ).rows,
  ).toEqual([{ key_id: null, ciphertext: null, redacted: true }]);
  expect(await metadataFor(brokenVault, order.id)).toEqual(expected);
  expect(forbidden).not.toHaveBeenCalled();
});

it.each(["missing key", "expired", "redacted"])(
  "replays the exact order with %s and preserves all financial facts",
  async (state) => {
    const f = await fixture();
    const order = await f.orders.createCheckoutOrderWithReceipt(f.command);
    expect(order).toMatchObject({
      creditMinor: "0",
      cashMinor: order.priceMinor,
      status: "payment_pending",
    });
    expect(BigInt(order.cashMinor)).toBeGreaterThan(0n);
    if (state !== "missing key") await expireContact(f);
    if (state === "redacted")
      await f.repository.redactExpiredSelection(
        await f.repository.listExpiredBatch(100),
      );
    const before = await financialState(f.owner.expertId);
    const open = vi.fn((): never => {
      throw new Error("must not decrypt on replay");
    });
    const replay = new PostgresExpertCampaignOrderRepository(database.db, {
      seal: f.vault.seal,
      open,
    });
    await expect(
      replay.createCheckoutOrderWithReceipt(f.command),
    ).resolves.toEqual(order);
    expect(await financialState(f.owner.expertId)).toEqual(before);
    expect(open).not.toHaveBeenCalled();
  },
);

it("retains the real admitted operation across redaction and GET-verifies without decrypting", async () => {
  const f = await fixture();
  const order = await f.orders.createCheckoutOrderWithReceipt(f.command);
  const operations = new PostgresYooKassaOperationRepository(database.db);
  const amount = `${BigInt(order.cashMinor) / 100n}.${(BigInt(order.cashMinor) % 100n).toString().padStart(2, "0")}`;
  const transport = vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe(
      init.method === "POST"
        ? "https://api.yookassa.ru/v3/payments"
        : "https://api.yookassa.ru/v3/payments/payment-pg-replay",
    );
    return Response.json({
      id: "payment-pg-replay",
      status: "pending",
      paid: false,
      amount: { value: amount, currency: "RUB" },
      test: true,
      created_at: "2026-10-14T00:00:00.000Z",
      metadata: { order_id: order.id },
      confirmation: {
        type: "redirect",
        confirmation_url: "https://yoomoney.ru/checkout/pg-replay",
      },
      refundable: false,
    });
  });
  const deps = {
    client: createYooKassaClient(
      { shopId: "test-shop", secretKey: "synthetic-secret", mode: "test" },
      transport,
    ),
    operations,
    contacts: createPayerReceiptSource(f.repository),
    mode: "test" as const,
    returnUrl: "https://example.invalid/return",
    receipt: {
      vatCode: 1 as const,
      paymentSubject: "service",
      paymentMode: "full_payment",
    },
  };
  const command = {
    orderId: order.id,
    amountMinor: order.cashMinor,
    currency: "RUB" as const,
    idempotencyKey: f.command.idempotencyKey,
  };
  const created = await new YooKassaExpertResidencyPaymentAdapter(
    deps,
  ).createCheckout(command);
  const operation = await operations.findByProviderObject(
    "payment-pg-replay",
    "create_payment",
  );
  expect(operation?.status).toBe("pending");
  await expireContact(f);
  await f.repository.redactExpiredSelection(
    await f.repository.listExpiredBatch(100),
  );
  const before = await financialState(f.owner.expertId);
  const noVault = new PostgresPayerReceiptContactRepository(database.db);
  const plaintext = vi.spyOn(noVault, "receiptContactForOrder");
  await expect(
    new PostgresExpertCampaignOrderRepository(
      database.db,
    ).createCheckoutOrderWithReceipt(f.command),
  ).resolves.toEqual(order);
  await expect(
    new YooKassaExpertResidencyPaymentAdapter({
      ...deps,
      contacts: createPayerReceiptSource(noVault),
    }).createCheckout(command),
  ).resolves.toEqual(created);
  expect(transport.mock.calls.map(([, init]) => init.method)).toEqual([
    "POST",
    "GET",
  ]);
  expect(plaintext).not.toHaveBeenCalled();
  expect(
    await operations.findByProviderObject(
      "payment-pg-replay",
      "create_payment",
    ),
  ).toEqual(operation);
  expect(await financialState(f.owner.expertId)).toEqual(before);
});

it("rejects alternate selection, quote and user even after the bound contact is redacted", async () => {
  const f = await fixture();
  await f.orders.createCheckoutOrderWithReceipt(f.command);
  await expireContact(f);
  await f.repository.redactExpiredSelection(
    await f.repository.listExpiredBatch(100),
  );
  const before = await financialState(f.owner.expertId);
  const replay = new PostgresExpertCampaignOrderRepository(database.db);
  await expect(
    replay.createCheckoutOrderWithReceipt({
      ...f.command,
      receiptContactId: f.alternate.receiptContactId,
    }),
  ).rejects.toThrow("EXPERT_CAMPAIGN_IDEMPOTENCY_CONFLICT");
  await expect(
    replay.createCheckoutOrderWithReceipt({
      ...f.command,
      quoteId: randomUUID(),
    }),
  ).rejects.toThrow("EXPERT_CAMPAIGN_IDEMPOTENCY_CONFLICT");
  await expect(
    replay.createCheckoutOrderWithReceipt({
      ...f.command,
      userId: await database.createUser(),
    }),
  ).rejects.toThrow("EXPERT_CAMPAIGN_OWNER_INELIGIBLE");
  expect(await financialState(f.owner.expertId)).toEqual(before);
});

it("does not let a reassigned expert inherit the original payer's purchase", async () => {
  const f = await fixture();
  await f.orders.createCheckoutOrderWithReceipt(f.command);
  const nextUser = await database.createUser();
  await database.db.execute(
    sql`update experts set user_id=${nextUser}::uuid where id=${f.owner.expertId}::uuid`,
  );
  const replay = new PostgresExpertCampaignOrderRepository(database.db);
  await expect(
    replay.createCheckoutOrderWithReceipt(f.command),
  ).rejects.toThrow("EXPERT_CAMPAIGN_OWNER_INELIGIBLE");
  await expect(
    replay.createCheckoutOrderWithReceipt({ ...f.command, userId: nextUser }),
  ).rejects.toThrow("EXPERT_CAMPAIGN_QUOTE_UNAVAILABLE");
});

it.each(["user inactive", "expert inactive", "expert unverified"])(
  "preserves eligibility checks for %s replay",
  async (state) => {
    const f = await fixture();
    await f.orders.createCheckoutOrderWithReceipt(f.command);
    if (state === "user inactive")
      await database.db.execute(
        sql`update users set active=false where id=${f.owner.userId}::uuid`,
      );
    if (state === "expert inactive")
      await database.db.execute(
        sql`update experts set active=false where id=${f.owner.expertId}::uuid`,
      );
    if (state === "expert unverified")
      await database.db.execute(
        sql`update experts set verified=false where id=${f.owner.expertId}::uuid`,
      );
    await expect(
      new PostgresExpertCampaignOrderRepository(
        database.db,
      ).createCheckoutOrderWithReceipt(f.command),
    ).rejects.toThrow("EXPERT_CAMPAIGN_OWNER_INELIGIBLE");
  },
);

it("returns no metadata for missing, malformed and legacy unbound orders or storage errors", async () => {
  const f = await fixture();
  const order = await f.orders.createCheckoutOrder({
    userId: f.command.userId,
    expertId: f.command.expertId,
    quoteId: f.command.quoteId,
    idempotencyKey: f.command.idempotencyKey,
  });
  for (const id of [randomUUID(), "malformed", "-".repeat(36), order.id])
    expect(await metadataFor(f.repository, id)).toBeNull();
  await expect(
    f.orders.createCheckoutOrderWithReceipt(f.command),
  ).rejects.toThrow("EXPERT_CAMPAIGN_IDEMPOTENCY_CONFLICT");
  const execute = vi
    .spyOn(database.db, "execute")
    .mockRejectedValue(new Error("private SQL details"));
  try {
    expect(await metadataFor(f.repository, order.id)).toBeNull();
  } finally {
    execute.mockRestore();
  }
});

it.each(["missing key", "expired", "redacted", "wrong key"])(
  "still rejects a fresh order with %s contact",
  async (state) => {
    const f = await fixture();
    if (state === "expired" || state === "redacted") await expireContact(f);
    if (state === "redacted")
      await f.repository.redactExpiredSelection(
        await f.repository.listExpiredBatch(100),
      );
    const vault: PayerReceiptVault | undefined =
      state === "missing key"
        ? undefined
        : state === "wrong key"
          ? createPayerReceiptVault({
              activeKeyId: "r1",
              keys: new Map([["r1", new Uint8Array(32).fill(99)]]),
            })
          : f.vault;
    await expect(
      new PostgresExpertCampaignOrderRepository(
        database.db,
        vault,
      ).createCheckoutOrderWithReceipt(f.command),
    ).rejects.toThrow("EXPERT_CAMPAIGN_QUOTE_UNAVAILABLE");
    const stateAfter = await financialState(f.owner.expertId);
    expect(stateAfter).toEqual({
      orders: [],
      ledger: [],
      allocations: [],
      bindings: [],
      grants: [],
      attempts: [],
      operations: [],
    });
  },
);
