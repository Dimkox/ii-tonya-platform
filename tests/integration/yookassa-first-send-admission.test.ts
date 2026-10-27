import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { DrizzleDb } from "../../packages/db/src/client.js";
import { PostgresYooKassaOperationRepository } from "../../packages/db/src/repositories/yookassa-operation-repository.js";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import type {
  ClaimYooKassaOperationCommand,
  YooKassaOperation,
} from "../../packages/integrations/src/yookassa/operation-port.js";
import { createYooKassaClient } from "../../packages/integrations/src/yookassa/client.js";
import { YooKassaExpertResidencyPaymentAdapter } from "../../packages/integrations/src/yookassa/payment-adapter.js";

let database: ExpertReferralTestDatabase;
let tariffVersionId: string;
let repository: PostgresYooKassaOperationRepository;
type Admission = {
  kind: "initial_send_admitted" | "existing";
  operation: YooKassaOperation;
};
// Keep RED typecheckable before the production capability exists.
async function admit(
  command: ClaimYooKassaOperationCommand,
  repo = repository,
): Promise<Admission> {
  const capability = Reflect.get(repo, "claimInitialPayment") as
    | ((command: ClaimYooKassaOperationCommand) => Promise<Admission>)
    | undefined;
  expect(capability, "atomic admission capability").toBeTypeOf("function");
  return capability!.call(repo, command);
}
beforeAll(async () => {
  if (!process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL)
    throw new Error("isolated_pg17_required");
  database = await startExpertReferralTestDatabase();
  expect(
    (await database.db.execute(sql`show server_version_num`)).rows[0]
      ?.server_version_num,
  ).toBe("170005");
  repository = new PostgresYooKassaOperationRepository(database.db);
  await database.enableExpertReferralCommands();
  tariffVersionId = await database.createResidencyTariff({
    tariffKey: "PRO",
    displayName: "Про",
    priceMinor: 999000,
    durationSeconds: 2592000,
  });
});
afterAll(async () => {
  await database?.stop();
});
async function fixture(withCredit = false) {
  const expert = await database.createExpertIdentity();
  if (withCredit) {
    // Historical grant setup only; admission runs with normal triggers enabled.
    const grantId = randomUUID();
    await database.db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`insert into expert_referral_reward_grants
        (id,expert_id,referral_id,first_settlement_id,qualifying_order_id,qualifying_payment_attempt_id,amount_minor,granted_at,expires_at,idempotency_key)
        values(${grantId}::uuid,${expert.expertId}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,100000,now()-interval '1 day',now()+interval '364 days',${randomUUID()})`);
      const entry = await tx.execute<{
        id: string;
      }>(sql`insert into expert_referral_ledger_entries
        (expert_id,entry_kind,amount_minor,source_type,source_id,idempotency_key)
        values(${expert.expertId}::uuid,'reward_grant',100000,'reward_grant',${grantId}::uuid,${randomUUID()}) returning id`);
      await tx.execute(sql`insert into expert_referral_ledger_allocations
        (ledger_entry_id,reward_grant_id,expert_id,amount_minor)
        values(${entry.rows[0]!.id}::uuid,${grantId}::uuid,${expert.expertId}::uuid,100000)`);
    });
  }
  const order = await new PostgresExpertResidencyRepository(
    database.db,
  ).createCheckoutOrder({
    expertId: expert.expertId,
    tariffVersionId,
    providerDeadline: new Date(Date.now() + 3600000),
    idempotencyKey: randomUUID(),
  });
  return {
    commandId: randomUUID(),
    orderId: order.id,
    kind: "create_payment" as const,
    mode: "test" as const,
    amountMinor: order.cashMinor.toString(),
    currency: "RUB" as const,
    requestDigest: `sha256:${"a".repeat(64)}`,
  };
}
async function state(orderId: string) {
  return (
    await database.db.execute(sql`
    select o.status as order_status, o.credit_minor::text, o.settled_at,
      a.status as attempt_status, a.resolved_at,
      p.status as operation_status, p.provider_object_id, p.replay_ciphertext
    from expert_residency_orders o
    left join expert_residency_payment_attempts a on a.order_id=o.id
    left join expert_residency_provider_operations p on p.payment_attempt_id=a.id
    where o.id=${orderId}::uuid
  `)
  ).rows;
}
async function explicitAttempt(command: ClaimYooKassaOperationCommand) {
  const id = randomUUID();
  await database.db.execute(sql`
    insert into expert_residency_payment_attempts(id,order_id,provider,provider_request_id,expected_amount_minor,currency,status,idempotency_key)
    values(${id}::uuid,${command.orderId}::uuid,'yookassa',${`command:${command.commandId}`},${command.amountMinor}::bigint,'RUB','created',${randomUUID()})
  `);
  return id;
}
it("commits exactly one insertion-owned admission across concurrent callers", async () => {
  const command = await fixture();
  const results = await Promise.all(
    Array.from({ length: 8 }, () => admit(command)),
  );
  expect(
    results.filter((x) => x.kind === "initial_send_admitted"),
  ).toHaveLength(1);
  expect(results.filter((x) => x.kind === "existing")).toHaveLength(7);
  expect(new Set(results.map((x) => x.operation.id)).size).toBe(1);
  expect(await state(command.orderId)).toEqual([
    expect.objectContaining({
      order_status: "payment_pending",
      attempt_status: "unknown_outcome",
      operation_status: "unknown_outcome",
      settled_at: null,
      resolved_at: null,
      provider_object_id: null,
      replay_ciphertext: null,
    }),
  ]);
});
it("preserves committed uncertainty across a new repository instance", async () => {
  const command = await fixture(true);
  const ledger = async () =>
    (
      await database.db.execute(
        sql`select * from expert_referral_ledger_entries where order_id=${command.orderId}::uuid order by id`,
      )
    ).rows;
  const reserved = await ledger();
  expect(reserved).toEqual([
    expect.objectContaining({
      entry_kind: "reservation",
      amount_minor: "-100000",
    }),
  ]);
  const first = await admit(command);
  const before = await state(command.orderId);
  expect(
    await admit(command, new PostgresYooKassaOperationRepository(database.db)),
  ).toEqual({ kind: "existing", operation: first.operation });
  expect(await state(command.orderId)).toEqual(before);
  expect(await ledger()).toEqual(reserved);
});
it.each(["claimed", "pending", "unknown_outcome"])(
  "does not acquire legacy unbound %s permission",
  async (status) => {
    const command = await fixture();
    const old = await repository.claim(command);
    await database.db.execute(
      sql`update expert_residency_provider_operations set status=${status} where id=${old.id}::uuid`,
    );
    expect(await admit(command)).toMatchObject({
      kind: "existing",
      operation: { id: old.id, status },
    });
  },
);
it.each(["amountMinor", "requestDigest", "mode", "paymentAttemptId"] as const)(
  "rejects changed %s on a consumed command",
  async (field) => {
    const command = await fixture();
    await admit(command);
    const changed = {
      ...command,
      [field]:
        field === "amountMinor"
          ? "1"
          : field === "requestDigest"
            ? `sha256:${"b".repeat(64)}`
            : field === "mode"
              ? "live"
              : randomUUID(),
    };
    await expect(admit(changed)).rejects.toMatchObject({
      code: "YOOKASSA_IDEMPOTENCY_CONFLICT",
    });
  },
);
it("accepts a fresh explicit attempt and marks it unknown atomically", async () => {
  const command = await fixture();
  const paymentAttemptId = await explicitAttempt(command);
  expect(await admit({ ...command, paymentAttemptId })).toMatchObject({
    kind: "initial_send_admitted",
    operation: { paymentAttemptId, status: "unknown_outcome" },
  });
  expect((await state(command.orderId))[0]?.attempt_status).toBe(
    "unknown_outcome",
  );
});
it.each([
  "expired",
  "order_status",
  "order_amount",
  "attempt_amount",
  "attempt_status",
  "attempt_order",
  "attempt_provider",
])("rejects explicit attempt bypass: %s", async (fault) => {
  const command = await fixture();
  const paymentAttemptId = await explicitAttempt(command);
  if (fault === "expired")
    await database.db.execute(
      sql`update expert_residency_orders set created_at=now()-interval '2 hours',payment_deadline=now()-interval '1 hour' where id=${command.orderId}::uuid`,
    );
  if (fault === "order_status")
    await database.db.execute(
      sql`update expert_residency_orders set status='expired' where id=${command.orderId}::uuid`,
    );
  if (fault === "order_amount") command.amountMinor = "1";
  if (fault === "attempt_amount")
    await database.db.execute(
      sql`update expert_residency_payment_attempts set expected_amount_minor=1 where id=${paymentAttemptId}::uuid`,
    );
  if (fault === "attempt_status")
    await database.db.execute(
      sql`update expert_residency_payment_attempts set status='failed',resolved_at=now() where id=${paymentAttemptId}::uuid`,
    );
  if (fault === "attempt_order") command.orderId = (await fixture()).orderId;
  if (fault === "attempt_provider")
    await database.db.execute(
      sql`update expert_residency_payment_attempts set provider='other' where id=${paymentAttemptId}::uuid`,
    );
  const before = await state(command.orderId);
  await expect(admit({ ...command, paymentAttemptId })).rejects.toMatchObject({
    code: "YOOKASSA_OPERATION_INVALID",
  });
  expect(await state(command.orderId)).toEqual(before);
});
it("rejects refund and replay snapshot through the payment-only capability", async () => {
  const command = await fixture();
  await expect(
    admit({ ...command, kind: "create_refund", parentPaymentId: "parent" }),
  ).rejects.toMatchObject({ code: "YOOKASSA_OPERATION_INVALID" });
  await expect(
    admit({
      ...command,
      replaySnapshot: {
        ciphertext: "opaque",
        keyReference: "kms:test",
        bodyVersion: 1,
        expiresAt: "2030-01-01T00:00:00Z",
      },
    }),
  ).rejects.toMatchObject({ code: "YOOKASSA_OPERATION_INVALID" });
});
it("cannot reissue permission when a committed transaction response is lost", async () => {
  const command = await fixture();
  const wrapped = new Proxy(database.db, {
    get(target, key, receiver) {
      if (key === "transaction")
        return async (...args: Parameters<DrizzleDb["transaction"]>) => {
          await target.transaction(...args);
          throw new Error("synthetic_commit_response_lost");
        };
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
  await expect(
    admit(command, new PostgresYooKassaOperationRepository(wrapped)),
  ).rejects.toThrow("synthetic_commit_response_lost");
  expect(await admit(command)).toMatchObject({
    kind: "existing",
    operation: { status: "unknown_outcome" },
  });
});
it.each(["implicit_order", "explicit_order", "explicit_attempt"])(
  "rejects expiry during observed lock wait (%s)",
  async (lockKind) => {
    const command = await fixture();
    const paymentAttemptId =
      lockKind !== "implicit_order"
        ? await explicitAttempt(command)
        : undefined;
    await database.db.execute(
      sql`update expert_residency_orders set payment_deadline=clock_timestamp()+interval '800 milliseconds' where id=${command.orderId}::uuid`,
    );
    const lock = await database.db.$client.connect();
    let waiting = false;
    let outcome: PromiseSettledResult<Admission>[] = [];
    try {
      await lock.query("begin");
      await lock.query(
        lockKind === "explicit_attempt"
          ? "select id from expert_residency_payment_attempts where id=$1 for update"
          : "select id from expert_residency_orders where id=$1 for update",
        [lockKind === "explicit_attempt" ? paymentAttemptId : command.orderId],
      );
      const pending = Promise.allSettled([
        admit({
          ...command,
          ...(paymentAttemptId ? { paymentAttemptId } : {}),
        }),
      ]);
      try {
        const until = Date.now() + 2000;
        while (Date.now() < until) {
          const rows = await database.db.execute(
            sql`select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and (query ilike '%expert_residency_orders%' or query ilike '%expert_residency_payment_attempts%')`,
          );
          if (rows.rows.length > 0) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        while (
          (
            await database.db.execute(
              sql`select payment_deadline > clock_timestamp() as fresh from expert_residency_orders where id=${command.orderId}::uuid`,
            )
          ).rows[0]?.fresh
        ) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      } finally {
        await lock.query("rollback");
        outcome = await pending;
      }
    } finally {
      lock.release();
    }
    expect(waiting).toBe(true);
    expect(outcome).toEqual([
      expect.objectContaining({
        status: "rejected",
        reason: expect.objectContaining({ code: "YOOKASSA_OPERATION_INVALID" }),
      }),
    ]);
    expect((await state(command.orderId))[0]?.operation_status).toBeNull();
  },
);
it("real concurrent adapters produce one recorded POST after visible committed unknown state", async () => {
  const command = await fixture();
  let posts = 0;
  const adapter = new YooKassaExpertResidencyPaymentAdapter({
    operations: repository,
    mode: "test",
    returnUrl: "https://example.invalid/return",
    contacts: {
      receiptContactForOrder: async () => ({
        email: "fixture@example.invalid",
        authorityReference: "payer:fixture",
      }),
    },
    receipt: {
      vatCode: 1,
      paymentSubject: "service",
      paymentMode: "full_payment",
    },
    client: createYooKassaClient(
      { shopId: "test-shop", secretKey: "synthetic-secret", mode: "test" },
      async (_url, init) => {
        if (init.method === "POST") {
          posts++;
          expect((await state(command.orderId))[0]).toMatchObject({
            attempt_status: "unknown_outcome",
            operation_status: "unknown_outcome",
          });
        } else expect(init.method).toBe("GET");
        return Response.json({
          id: "payment-first-send",
          status: "pending",
          paid: false,
          amount: { value: "9990.00", currency: "RUB" },
          test: true,
          created_at: new Date().toISOString(),
          metadata: { order_id: command.orderId },
          confirmation: {
            type: "redirect",
            confirmation_url: "https://yoomoney.ru/checkout/test",
          },
          refundable: false,
        });
      },
    ),
  });
  const checkout = {
    orderId: command.orderId,
    amountMinor: command.amountMinor,
    currency: "RUB" as const,
    idempotencyKey: command.commandId,
  };
  const outcomes = await Promise.allSettled([
    adapter.createCheckout(checkout),
    adapter.createCheckout(checkout),
  ]);
  expect(posts).toBe(1);
  expect(
    outcomes.filter((x) => x.status === "fulfilled").length,
  ).toBeGreaterThanOrEqual(1);
});
