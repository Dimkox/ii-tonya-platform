import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { PostgresExpertCampaignOrderRepository } from "../../packages/db/src/repositories/expert-campaign-order-repository.js";
import { PostgresExpertCampaignQuoteRepository } from "../../packages/db/src/repositories/expert-campaign-quote-repository.js";
import { PostgresPayerReceiptContactRepository } from "../../packages/db/src/repositories/payer-receipt-contact-repository.js";
import { PostgresYooKassaOperationRepository } from "../../packages/db/src/repositories/yookassa-operation-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import {
  createPayerReceiptVault,
  createPayerReceiptSource,
  createYooKassaClient,
  YooKassaExpertResidencyPaymentAdapter,
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

async function fixture() {
  const owner = await database.createExpertIdentity();
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
  };
}

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
  await noVault.redactExpiredBatch(100);
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
    if (state === "redacted") await f.repository.redactExpiredBatch(100);
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
  await f.repository.redactExpiredBatch(100);
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
  await f.repository.redactExpiredBatch(100);
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
    if (state === "redacted") await f.repository.redactExpiredBatch(100);
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
    });
  },
);
