import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { loadEnv } from "../../packages/config/src/env.js";
import { createProductionWorkerRuntimeFactory } from "../../apps/worker/src/main.js";
import type { WorkerRuntime } from "../../apps/worker/src/runtime.js";
import { createProductionWorkerRuntime } from "../../apps/worker/src/runtime.js";
import { PostgresYooKassaOperationRepository } from "../../packages/db/src/repositories/yookassa-operation-repository.js";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import type { YooKassaOperation } from "@ii-tonya/integrations";
import {
  createYooKassaClient,
  YooKassaPaymentVerifier,
  YooKassaWebhookCapability,
  YooKassaExpertResidencyProviderReader,
} from "../../packages/integrations/src/index.js";
import { PostgresExpertResidencyProviderInboxRepository } from "../../packages/db/src/repositories/expert-residency-provider-inbox-repository.js";
import type { ExpertResidencyProviderReader } from "../../packages/worker/src/expert-residency-reconciliation.js";
import type { YooKassaAuditReaderFactory } from "../../apps/worker/src/yookassa-composition.js";
import { createYooKassaWorkerComposition } from "../../apps/worker/src/yookassa-composition.js";
import { PostgresExpertReferralWorkerRepository } from "../../packages/db/src/repositories/expert-referral-worker-repository.js";
import { PostgresWorkerJobsRepository } from "../../packages/db/src/repositories/worker-jobs-repository.js";
import { PostgresOutboxRepository } from "../../packages/db/src/repositories/outbox-repository.js";
import { PostgresExpertTelegramResidencyCallbackRepository } from "../../packages/db/src/repositories/expert-telegram-residency-callback-repository.js";

let database: ExpertReferralTestDatabase;
let tariffVersionId: string;
let databaseUrl: string;
const runtimes: WorkerRuntime[] = [];
const responses = new Map<string, unknown>();
let calls: string[] = [];
let httpStatus = 200;
let operations: PostgresYooKassaOperationRepository;
beforeAll(async () => {
  const admin = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
  if (!admin) throw new Error("isolated_pg17_required");
  database = await startExpertReferralTestDatabase();
  expect(
    (await database.db.execute(sql`show server_version_num`)).rows[0]
      ?.server_version_num,
  ).toBe("170005");
  const url = new URL(admin);
  url.pathname = `/${(await database.db.execute(sql`select current_database() as name`)).rows[0]?.name as string}`;
  databaseUrl = url.toString();
  operations = new PostgresYooKassaOperationRepository(database.db);
  await database.enableExpertReferralCommands();
  tariffVersionId = await database.createResidencyTariff({
    tariffKey: "PRO",
    displayName: "Про",
    priceMinor: 999000,
    durationSeconds: 2592000,
  });
});
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  responses.clear();
  calls = [];
  httpStatus = 200;
});
afterAll(async () => {
  await database?.stop();
});
beforeEach(async () => {
  await database.db.execute(
    sql`update expert_residency_provider_operations set reconciliation_claimed_at=now() where status in ('pending','unknown_outcome')`,
  );
});

function config(enabled = true) {
  const loaded = loadEnv({
    DATABASE_URL: "postgresql://fixture:fixture@localhost/fixture",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    ...(enabled
      ? {
          PAYMENTS_ENABLED: "true",
          PAYMENT_PROVIDER: "yookassa",
          YOOKASSA_ENABLED: "true",
          YOOKASSA_MODE: "test",
          YOOKASSA_SHOP_ID: "12345",
          YOOKASSA_SECRET_KEY: "synthetic-runtime-secret",
          YOOKASSA_SECRET_REF: "env://YOOKASSA_SECRET_KEY",
          YOOKASSA_RETURN_URL: "https://ii-tonya.ru/return",
          YOOKASSA_RECEIPT_VAT_CODE: "1",
          YOOKASSA_RECEIPT_PAYMENT_SUBJECT: "service",
          YOOKASSA_RECEIPT_PAYMENT_MODE: "full_payment",
        }
      : {}),
  });
  // The testkit's isolated Docker address is injected, not deployment config.
  return { ...loaded, databaseUrl };
}
async function runtime(
  enabled = true,
  readerFactory?: YooKassaAuditReaderFactory,
) {
  vi.stubEnv("YOOKASSA_SECRET_KEY", "synthetic-runtime-secret");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(url.startsWith("https://api.yookassa.ru/v3/")).toBe(true);
    const path = new URL(url).pathname;
    calls.push(path);
    if (httpStatus !== 200)
      return new Response("synthetic-private-error", { status: httpStatus });
    if (!responses.has(path)) throw new Error("unexpected_provider_read");
    return Response.json(responses.get(path));
  });
  const created = await createProductionWorkerRuntimeFactory(
    readerFactory ? { yookassaReaderFactory: readerFactory } : {},
  ).create(config(enabled));
  runtimes.push(created);
  return created;
}
async function fixture(mode: "test" | "live" = "test") {
  const expert = await database.createExpertIdentity();
  const order = await new PostgresExpertResidencyRepository(
    database.db,
  ).createCheckoutOrder({
    expertId: expert.expertId,
    tariffVersionId,
    providerDeadline: new Date(Date.now() + 3600000),
    idempotencyKey: randomUUID(),
  });
  const claim = await operations.claim({
    commandId: randomUUID(),
    orderId: order.id,
    kind: "create_payment",
    mode,
    amountMinor: order.cashMinor.toString(),
    currency: "RUB",
    requestDigest: `sha256:${"a".repeat(64)}`,
  });
  const bound = await operations.bindProviderObject(claim.id, randomUUID());
  const body = {
    id: bound.providerObjectId!,
    status: "succeeded",
    paid: true,
    amount: { value: "9990.00", currency: "RUB" },
    test: mode === "test",
    created_at: new Date().toISOString(),
    captured_at: new Date().toISOString(),
    metadata: { order_id: order.id },
    refundable: true,
  };
  responses.set(`/v3/payments/${bound.providerObjectId}`, body);
  return { operation: bound, body, orderId: order.id };
}
async function status(id: string) {
  return (
    await database.db.execute(
      sql`select status,resolved_at::text,updated_at::text from expert_residency_provider_operations where id=${id}::uuid`,
    )
  ).rows[0];
}
async function orderStatus(id: string) {
  return (
    await database.db.execute(
      sql`select status from expert_residency_orders where id=${id}::uuid`,
    )
  ).rows[0]?.status;
}

async function attemptState(orderId: string) {
  return (
    await database.db.execute(sql`
    select id,order_id,provider,provider_request_id,expected_amount_minor::text,
      currency,status,resolved_at::text,updated_at::text
    from expert_residency_payment_attempts where order_id=${orderId}::uuid
    order by id
  `)
  ).rows;
}

async function verifiedPayment(operation: YooKassaOperation) {
  const verifier = new YooKassaPaymentVerifier(
    createYooKassaClient({
      mode: "test",
      shopId: "12345",
      secretKey: "synthetic-secret",
    }),
    operations,
  );
  const event = await verifier.verifyPayment(operation);
  if (!event) throw new Error("fixture_success_required");
  return event;
}

it("normal factory recovers an unknown bound payment through the real inbox before expiry", async () => {
  const f = await fixture();
  await operations.markUnknown(f.operation.id);
  const worker = await runtime();
  expect((await worker.runOnce()).unknownOutcomeReconciliation).toMatchObject({
    succeeded: 1,
  });
  expect(await orderStatus(f.orderId)).toBe("settled");
  expect(await status(f.operation.id)).toMatchObject({ status: "succeeded" });
  expect(calls).toEqual([`/v3/payments/${f.operation.providerObjectId}`]);
  const inbox = await database.db.execute(
    sql`select status from expert_residency_provider_event_inbox where order_id=${f.orderId}::uuid`,
  );
  expect(inbox.rows).toHaveLength(1);
});
it("disabled factory performs zero provider reads", async () => {
  const f = await fixture();
  const worker = await runtime(false);
  await worker.runOnce();
  expect(calls).toEqual([]);
  expect(await status(f.operation.id)).toMatchObject({ status: "pending" });
});
it.each(["pending", "canceled", "mismatch"])(
  "keeps %s distinct from a financial success",
  async (outcome) => {
    const f = await fixture();
    if (outcome === "mismatch") f.body.amount.value = "1.00";
    else {
      f.body.status = outcome;
      f.body.paid = false;
    }
    const worker = await runtime();
    await worker.runOnce();
    expect(await status(f.operation.id)).toMatchObject({
      status: outcome === "canceled" ? "canceled" : "pending",
    });
    expect(await orderStatus(f.orderId)).toBe("payment_pending");
  },
);
it("same terminal resolution preserves both timestamps, conflicting terminal resolution fails", async () => {
  const f = await fixture();
  await operations.resolve(f.operation.id, "succeeded");
  const first = await status(f.operation.id);
  await Promise.all([
    operations.resolve(f.operation.id, "succeeded"),
    operations.resolve(f.operation.id, "succeeded"),
  ]);
  expect(await status(f.operation.id)).toEqual(first);
  await expect(
    operations.resolve(f.operation.id, "canceled"),
  ).rejects.toThrow();
  expect(await status(f.operation.id)).toEqual(first);
});
it("filters mode before LIMIT and keeps leased rows out of concurrent claims", async () => {
  const old = await fixture("live");
  const current = await fixture();
  const claim = operations.claimReconciliationBatch.bind(operations) as (
    limit: number,
    mode?: "test" | "live",
  ) => Promise<readonly YooKassaOperation[]>;
  // Fence other fixtures; each test uses fresh records, never a shared reset.
  await database.db.execute(
    sql`update expert_residency_provider_operations set reconciliation_claimed_at=now() where id not in (${old.operation.id}::uuid,${current.operation.id}::uuid)`,
  );
  const batches = await Promise.all([claim(1, "test"), claim(1, "test")]);
  expect(batches.flat().map((row) => row.id)).toEqual([current.operation.id]);
  expect((await claim(1, "live")).map((row) => row.id)).toEqual([
    old.operation.id,
  ]);
});
it.each([401, 403])(
  "latches credential HTTP %i failure across cycles",
  async (code) => {
    await fixture();
    await fixture();
    httpStatus = code;
    const audit = vi.fn(async () => {
      throw new Error("audit_must_not_call_provider");
    });
    const worker = await runtime(true, () => ({ readPayments: audit }));
    const cycle = await worker.runOnce();
    expect(cycle.unknownOutcomeReconciliation).toMatchObject({
      reason: "credentials_unavailable",
    });
    expect(cycle.expertResidencyReconciliation).toMatchObject({
      provider: "unavailable",
      reason: "credentials_unavailable",
    });
    expect((await worker.runOnce()).unknownOutcomeReconciliation).toMatchObject(
      { reason: "credentials_unavailable" },
    );
    expect(calls).toHaveLength(1);
    expect(audit).not.toHaveBeenCalled();
  },
);

it("contradictory flags, missing secret and unsupported reference fail before I/O", async () => {
  const fetch = vi.fn(async () => {
    throw new Error("no_provider_io");
  });
  vi.stubGlobal("fetch", fetch);
  const enabled = config();
  const unsafe: ExpertResidencyProviderReader = {
    readPayments: async () => ({ kind: "disabled" }),
  };
  await expect(
    createProductionWorkerRuntimeFactory({ yookassaReader: unsafe }).create(
      enabled,
    ),
  ).rejects.toThrow("yookassa_unguarded_reader_rejected");
  await expect(
    createProductionWorkerRuntimeFactory().create({
      ...enabled,
      integrations: { ...enabled.integrations, payments: false },
    }),
  ).rejects.toThrow("configuration_invalid");
  await expect(
    createProductionWorkerRuntimeFactory().create({
      ...enabled,
      features: { ...enabled.features, yookassa: false },
    }),
  ).rejects.toThrow("configuration_invalid");
  await expect(
    createProductionWorkerRuntimeFactory({ yookassaEnv: {} }).create(enabled),
  ).rejects.toThrow("credentials_unavailable");
  const badReference = {
    ...enabled,
    yookassa: {
      ...enabled.yookassa!,
      secretReference: "file://not-approved" as "env://YOOKASSA_SECRET_KEY",
    },
  };
  await expect(
    createProductionWorkerRuntimeFactory().create(badReference),
  ).rejects.toThrow("configuration_invalid");
  expect(fetch).not.toHaveBeenCalled();
});

it("a malformed item does not starve valid rows, and never leaks payloads", async () => {
  const bad = await fixture();
  const good = await fixture();
  responses.set(`/v3/payments/${bad.operation.providerObjectId}`, {
    private: "sensitive-fixture",
  });
  const worker = await runtime();
  const result = (await worker.runOnce()).unknownOutcomeReconciliation;
  expect(result).toMatchObject({ failed: 1, succeeded: 1 });
  expect(JSON.stringify(result)).not.toContain("sensitive");
  expect(await status(bad.operation.id)).toMatchObject({ status: "pending" });
  expect(await orderStatus(good.orderId)).toBe("settled");
});

it("financial operator rejection remains retryable even after durable rejection evidence", async () => {
  const f = await fixture();
  await database.db.execute(
    sql`update expert_residency_orders set created_at=now()-interval '2 hours',payment_deadline=now()-interval '1 hour' where id=${f.orderId}::uuid`,
  );
  const worker = await runtime();
  expect((await worker.runOnce()).unknownOutcomeReconciliation).toMatchObject({
    failed: 1,
    succeeded: 0,
  });
  expect(await status(f.operation.id)).toMatchObject({ status: "pending" });
  const inbox = await database.db.execute(
    sql`select status,result_code from expert_residency_provider_event_inbox where order_id=${f.orderId}::uuid`,
  );
  expect(inbox.rows).toEqual([
    { status: "rejected", result_code: "EXPERT_RESIDENCY_PAYMENT_EXPIRED" },
  ]);
  await database.db.execute(
    sql`update expert_residency_provider_operations set reconciliation_claimed_at=now()-interval '6 minutes' where id=${f.operation.id}::uuid`,
  );
  expect((await worker.runOnce()).unknownOutcomeReconciliation).toMatchObject({
    failed: 1,
    succeeded: 0,
  });
  expect(await status(f.operation.id)).toMatchObject({ status: "pending" });
});

it("caps the actual cycle at 25 bound reads and never claims live rows", async () => {
  const live = await fixture("live");
  for (let i = 0; i < 27; i++) {
    const f = await fixture();
    f.body.status = "pending";
    f.body.paid = false;
  }
  const worker = await runtime();
  expect((await worker.runOnce()).unknownOutcomeReconciliation).toMatchObject({
    claimed: 25,
    pending: 25,
  });
  expect(calls).toHaveLength(25);
  expect(calls).not.toContain(
    `/v3/payments/${live.operation.providerObjectId}`,
  );
  const lease = await database.db.execute(
    sql`select reconciliation_claimed_at from expert_residency_provider_operations where id=${live.operation.id}::uuid`,
  );
  expect(lease.rows[0]?.reconciliation_claimed_at).toBeNull();
});

it("recovers a crash after canonical inbox commit without duplicating residency", async () => {
  const f = await fixture();
  await database.db.execute(
    sql.raw(
      `create function fixture_reject_resolution() returns trigger language plpgsql as $$ begin raise exception 'synthetic_crash_after_inbox'; end $$`,
    ),
  );
  await database.db.execute(
    sql.raw(
      `create trigger fixture_reject_resolution before update on expert_residency_provider_operations for each row when (new.id='${f.operation.id}'::uuid and new.status='succeeded') execute function fixture_reject_resolution()`,
    ),
  );
  const worker = await runtime();
  try {
    expect((await worker.runOnce()).unknownOutcomeReconciliation).toMatchObject(
      { failed: 1, succeeded: 0 },
    );
  } finally {
    await database.db.execute(
      sql`drop trigger fixture_reject_resolution on expert_residency_provider_operations`,
    );
    await database.db.execute(sql`drop function fixture_reject_resolution()`);
  }
  expect(await orderStatus(f.orderId)).toBe("settled");
  expect(await status(f.operation.id)).toMatchObject({ status: "pending" });
  const before = await database.db.execute(
    sql`select residency_starts_at::text,residency_ends_at::text,settled_at::text from expert_residency_orders where id=${f.orderId}::uuid`,
  );
  await database.db.execute(
    sql`update expert_residency_provider_operations set reconciliation_claimed_at=now()-interval '6 minutes' where id=${f.operation.id}::uuid`,
  );
  expect((await worker.runOnce()).unknownOutcomeReconciliation).toMatchObject({
    succeeded: 1,
  });
  expect(await status(f.operation.id)).toMatchObject({ status: "succeeded" });
  expect(
    (
      await database.db.execute(
        sql`select residency_starts_at::text,residency_ends_at::text,settled_at::text from expert_residency_orders where id=${f.orderId}::uuid`,
      )
    ).rows,
  ).toEqual(before.rows);
  expect(
    (
      await database.db.execute(
        sql`select id from expert_residency_provider_event_inbox where order_id=${f.orderId}::uuid`,
      )
    ).rows,
  ).toHaveLength(1);
});

it("concurrent webhook and worker acceptance produces one canonical settlement", async () => {
  const f = await fixture();
  const worker = await runtime();
  const verifier = new YooKassaPaymentVerifier(
    createYooKassaClient({
      mode: "test",
      shopId: "12345",
      secretKey: "synthetic-secret",
    }),
    operations,
  );
  const webhook = new YooKassaWebhookCapability(operations, verifier);
  const notice = {
    type: "notification" as const,
    event: "payment.succeeded" as const,
    object: { id: f.operation.providerObjectId! },
  };
  const delivery = async () => {
    const event = await webhook.verify(notice);
    expect(event).not.toBeNull();
    await new PostgresExpertResidencyProviderInboxRepository(
      database.db,
    ).settle(event!);
    await webhook.resolveSucceeded(notice);
  };
  // Hold the common order row until both independent settlement transactions
  // are observed waiting on PostgreSQL locks, not merely scheduled together.
  const lock = await database.db.$client.connect();
  let waiters = 0;
  let outcomes: PromiseSettledResult<unknown>[] = [];
  try {
    await lock.query("begin");
    await lock.query(
      "select id from expert_residency_orders where id=$1 for update",
      [f.orderId],
    );
    const overlapping = Promise.allSettled([worker.runOnce(), delivery()]);
    try {
      const deadline = Date.now() + 1_000;
      do {
        const observed = await database.db.execute(sql`
          select count(*)::int as count from pg_stat_activity
          where datname=current_database() and wait_event_type='Lock'
            and (query ilike '%expert_residency_provider_event_inbox%'
              or query ilike '%expert_residency_orders%')
        `);
        waiters = Number(observed.rows[0]?.count ?? 0);
        if (waiters >= 2) break;
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      } while (Date.now() < deadline);
    } finally {
      await lock.query("rollback");
      outcomes = await overlapping;
    }
  } finally {
    lock.release();
  }
  expect(waiters).toBeGreaterThanOrEqual(2);
  expect(outcomes.map((outcome) => outcome.status)).toEqual([
    "fulfilled",
    "fulfilled",
  ]);
  await delivery();
  expect(await orderStatus(f.orderId)).toBe("settled");
  expect(await status(f.operation.id)).toMatchObject({ status: "succeeded" });
  expect(
    (
      await database.db.execute(
        sql`select id from expert_residency_provider_event_inbox where order_id=${f.orderId}::uuid`,
      )
    ).rows,
  ).toHaveLength(1);
  expect(
    (
      await database.db.execute(
        sql`select expert_id from expert_first_residency_settlements where qualifying_order_id=${f.orderId}::uuid`,
      )
    ).rows,
  ).toHaveLength(1);
});

it.each(["succeeded", "pending", "canceled", "wrong_parent"])(
  "bound refund %s reads exact refund and parent with canonical reversal",
  async (outcome) => {
    const f = await fixture();
    expect(await attemptState(f.orderId)).toEqual([
      expect.objectContaining({
        id: f.operation.paymentAttemptId,
        status: "pending",
        resolved_at: null,
      }),
    ]);
    const worker = await runtime();
    await worker.runOnce();
    expect(await orderStatus(f.orderId)).toBe("settled");
    const settledAttempt = await attemptState(f.orderId);
    expect(settledAttempt).toEqual([
      expect.objectContaining({
        id: f.operation.paymentAttemptId,
        status: "settled",
        resolved_at: expect.any(String),
      }),
    ]);
    await new PostgresExpertResidencyProviderInboxRepository(
      database.db,
    ).settle(await verifiedPayment(f.operation));
    expect(await attemptState(f.orderId)).toEqual(settledAttempt);
    const refund = await operations.claim({
      commandId: randomUUID(),
      orderId: f.orderId,
      kind: "create_refund",
      mode: "test",
      amountMinor: "999000",
      currency: "RUB",
      parentPaymentId: f.operation.providerObjectId!,
      requestDigest: `sha256:${"b".repeat(64)}`,
    });
    const bound = await operations.bindProviderObject(refund.id, randomUUID());
    responses.set(`/v3/refunds/${bound.providerObjectId}`, {
      id: bound.providerObjectId,
      payment_id:
        outcome === "wrong_parent"
          ? randomUUID()
          : f.operation.providerObjectId,
      status: outcome === "wrong_parent" ? "succeeded" : outcome,
      amount: { value: "9990.00", currency: "RUB" },
      created_at: new Date().toISOString(),
    });
    calls = [];
    await worker.runOnce();
    expect(calls).toEqual([
      `/v3/refunds/${bound.providerObjectId}`,
      `/v3/payments/${f.operation.providerObjectId}`,
    ]);
    expect(await status(refund.id)).toMatchObject({
      status: outcome === "wrong_parent" ? "pending" : outcome,
    });
    expect(await orderStatus(f.orderId)).toBe(
      outcome === "succeeded" ? "refunded" : "settled",
    );
  },
);

it.each(["created", "pending", "unknown_outcome"])(
  "settles the exact pre-bound %s attempt in the canonical transaction and preserves replay evidence",
  async (initialStatus) => {
    const f = await fixture();
    await database.db.execute(
      sql`update expert_residency_payment_attempts set status=${initialStatus}::expert_residency_payment_attempt_status where id=${f.operation.paymentAttemptId}::uuid`,
    );
    const worker = await runtime();
    expect((await worker.runOnce()).unknownOutcomeReconciliation).toMatchObject(
      { succeeded: 1 },
    );
    const first = await attemptState(f.orderId);
    expect(first).toEqual([
      expect.objectContaining({
        id: f.operation.paymentAttemptId,
        order_id: f.orderId,
        provider: "yookassa",
        provider_request_id: f.operation.providerObjectId,
        expected_amount_minor: "999000",
        currency: "RUB",
        status: "settled",
        resolved_at: expect.any(String),
      }),
    ]);
    const order = (
      await database.db.execute(
        sql`select settled_at::text from expert_residency_orders where id=${f.orderId}::uuid`,
      )
    ).rows[0];
    expect(first[0]?.resolved_at).toBe(order?.settled_at);
    expect(first[0]?.updated_at).toBe(first[0]?.resolved_at);
    const inbox = new PostgresExpertResidencyProviderInboxRepository(
      database.db,
    );
    const event = await verifiedPayment(f.operation);
    await Promise.all([inbox.settle(event), inbox.settle(event)]);
    expect(await attemptState(f.orderId)).toEqual(first);
  },
);

it("preserves an already-settled exact-bound attempt's original timestamps", async () => {
  const f = await fixture();
  await database.db.execute(
    sql`update expert_residency_payment_attempts set status='settled',resolved_at=now()-interval '1 minute',updated_at=now()-interval '1 minute' where id=${f.operation.paymentAttemptId}::uuid`,
  );
  const before = await attemptState(f.orderId);
  const worker = await runtime();
  expect((await worker.runOnce()).unknownOutcomeReconciliation).toMatchObject({
    succeeded: 1,
  });
  expect(await orderStatus(f.orderId)).toBe("settled");
  expect(await attemptState(f.orderId)).toEqual(before);
});

it("rolls the attempt transition back when the same settlement transaction fails afterward", async () => {
  const f = await fixture();
  const before = await attemptState(f.orderId);
  await database.db.execute(
    sql.raw(
      `create function fixture_reject_order_settlement() returns trigger language plpgsql as $$ begin raise exception 'synthetic_late_settlement_failure'; end $$`,
    ),
  );
  await database.db.execute(
    sql.raw(
      `create trigger fixture_reject_order_settlement before update on expert_residency_orders for each row when (new.id='${f.orderId}'::uuid and new.status='settled') execute function fixture_reject_order_settlement()`,
    ),
  );
  const worker = await runtime();
  try {
    expect((await worker.runOnce()).unknownOutcomeReconciliation).toMatchObject(
      { succeeded: 0, failed: 1 },
    );
  } finally {
    await database.db.execute(
      sql`drop trigger fixture_reject_order_settlement on expert_residency_orders`,
    );
    await database.db.execute(
      sql`drop function fixture_reject_order_settlement()`,
    );
  }
  expect(await attemptState(f.orderId)).toEqual(before);
  expect(await orderStatus(f.orderId)).toBe("payment_pending");
  expect(await status(f.operation.id)).toMatchObject({ status: "pending" });
  expect(
    (
      await database.db.execute(
        sql`select id from expert_residency_provider_event_inbox where order_id=${f.orderId}::uuid`,
      )
    ).rows,
  ).toHaveLength(0);
});

it.each(["failed", "refunded", "charged_back"])(
  "rejects a pre-existing %s attempt without overwriting terminal evidence",
  async (terminalStatus) => {
    const f = await fixture();
    await database.db.execute(
      sql`update expert_residency_payment_attempts set status=${terminalStatus}::expert_residency_payment_attempt_status,resolved_at=now()-interval '1 minute' where id=${f.operation.paymentAttemptId}::uuid`,
    );
    const before = await attemptState(f.orderId);
    const worker = await runtime();
    const event = await verifiedPayment(f.operation);
    await expect(
      new PostgresExpertResidencyProviderInboxRepository(database.db).settle(
        event,
      ),
    ).rejects.toMatchObject({
      code: "EXPERT_RESIDENCY_PAYMENT_ATTEMPT_CONFLICT",
    });
    expect((await worker.runOnce()).unknownOutcomeReconciliation).toMatchObject(
      { succeeded: 0, failed: 1 },
    );
    expect(await attemptState(f.orderId)).toEqual(before);
    expect(await orderStatus(f.orderId)).toBe("payment_pending");
    expect(await status(f.operation.id)).toMatchObject({ status: "pending" });
    expect(
      (
        await database.db.execute(
          sql`select id from expert_residency_provider_event_inbox where order_id=${f.orderId}::uuid`,
        )
      ).rows,
    ).toHaveLength(0);
  },
);

it("rejects a mismatched bound attempt amount without settling any state", async () => {
  const f = await fixture();
  await database.db.execute(
    sql`update expert_residency_payment_attempts set expected_amount_minor=1 where id=${f.operation.paymentAttemptId}::uuid`,
  );
  const before = await attemptState(f.orderId);
  const worker = await runtime();
  const event = await verifiedPayment(f.operation);
  await expect(
    new PostgresExpertResidencyProviderInboxRepository(database.db).settle(
      event,
    ),
  ).rejects.toMatchObject({
    code: "EXPERT_RESIDENCY_PAYMENT_ATTEMPT_CONFLICT",
  });
  expect((await worker.runOnce()).unknownOutcomeReconciliation).toMatchObject({
    succeeded: 0,
    failed: 1,
  });
  expect(await attemptState(f.orderId)).toEqual(before);
  expect(await orderStatus(f.orderId)).toBe("payment_pending");
  expect(await status(f.operation.id)).toMatchObject({ status: "pending" });
});

it("rejects an event pointing to another order while retaining the original attempt", async () => {
  const f = await fixture();
  const other = await fixture();
  await runtime();
  // A genuinely verified provider read cannot reassign an already-bound attempt.
  f.body.metadata.order_id = other.orderId;
  const event = await verifiedPayment({
    ...f.operation,
    orderId: other.orderId,
  });
  const before = await attemptState(f.orderId);
  const otherBefore = await attemptState(other.orderId);
  await expect(
    new PostgresExpertResidencyProviderInboxRepository(database.db).settle(
      event,
    ),
  ).rejects.toMatchObject({
    code: "EXPERT_RESIDENCY_PAYMENT_ATTEMPT_CONFLICT",
  });
  expect(await attemptState(f.orderId)).toEqual(before);
  expect(await attemptState(other.orderId)).toEqual(otherBefore);
  expect(await orderStatus(f.orderId)).toBe("payment_pending");
  expect(await orderStatus(other.orderId)).toBe("payment_pending");
});

it("preserves completed audit counts and committed mismatches when its deadline expires after persistence", async () => {
  const refunded = await fixture();
  const matched = await fixture();
  const settlementWorker = await runtime();
  await settlementWorker.runOnce();
  const refund = await operations.claim({
    commandId: randomUUID(),
    orderId: refunded.orderId,
    kind: "create_refund",
    mode: "test",
    amountMinor: "999000",
    currency: "RUB",
    parentPaymentId: refunded.operation.providerObjectId!,
    requestDigest: `sha256:${"d".repeat(64)}`,
  });
  const bound = await operations.bindProviderObject(refund.id, randomUUID());
  responses.set(`/v3/refunds/${bound.providerObjectId}`, {
    id: bound.providerObjectId,
    payment_id: refunded.operation.providerObjectId,
    status: "succeeded",
    amount: { value: "9990.00", currency: "RUB" },
    created_at: new Date().toISOString(),
  });
  await settlementWorker.runOnce();
  expect(await orderStatus(refunded.orderId)).toBe("refunded");
  expect(await orderStatus(matched.orderId)).toBe("settled");

  let now = 0;
  const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
  const repository = new PostgresExpertReferralWorkerRepository(database.db);
  const composition = createYooKassaWorkerComposition(config(), database.db, {
    env: { YOOKASSA_SECRET_KEY: "synthetic-secret" },
    readerFactory: (client, mode) =>
      new YooKassaExpertResidencyProviderReader(client, mode),
  })!;
  const countMismatches = async () =>
    Number(
      (
        await database.db.execute(sql`
    select count(*)::int as count from integration_errors
    where provider='expert_residency' and reason_code='expert_residency_reconciliation_status'
  `)
      ).rows[0]?.count,
    );
  const before = await countMismatches();
  const worker = createProductionWorkerRuntime({
    jobsRepository: new PostgresWorkerJobsRepository(database.db),
    outboxRepository: new PostgresOutboxRepository(database.db),
    expertTelegramCheckoutRepository:
      new PostgresExpertTelegramResidencyCallbackRepository(database.db),
    expertReferralJobsRepository: {
      expireDueBatch: (command) => repository.expireDueBatch(command),
      replayDueBatch: (command) => repository.replayDueBatch(command),
      listReconciliationBatch: async (command) =>
        (await repository.listReconciliationBatch(command)).filter((payment) =>
          [refunded.orderId, matched.orderId].includes(payment.orderId),
        ),
      recordReconciliationMismatches: async (mismatches) => {
        await repository.recordReconciliationMismatches(mismatches);
        // Advance only after the real transaction committed its mismatch evidence.
        now = 20_000;
      },
    },
    yookassaBoundRecovery: composition,
    expertResidencyProviderReader: composition.reader,
    closeDatabase: async () => undefined,
    closeTelemetry: async () => undefined,
    now: () => new Date(),
  });
  runtimes.push(worker);
  try {
    const report = await worker.runOnce();
    expect(await countMismatches()).toBe(before + 1);
    expect(report.expertResidencyReconciliation).toEqual({
      examined: 2,
      matched: 1,
      mismatches: 1,
      provider: "available",
      reason: "budget_exhausted",
    });
  } finally {
    clock.mockRestore();
  }
});
