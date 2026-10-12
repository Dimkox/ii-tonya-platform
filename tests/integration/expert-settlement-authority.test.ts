import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { ExpertCodeCrypto } from "../../packages/application/src/expert-code-crypto.js";
import { PostgresExpertReferralRepository } from "../../packages/db/src/repositories/expert-referral-repository.js";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import { PostgresExpertResidencyProviderInboxRepository } from "../../packages/db/src/repositories/expert-residency-provider-inbox-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
  type ExpertIdentityFixture,
} from "../../packages/db/src/testkit/expert-referral.js";
import { verifiedEventFixture } from "../../packages/integrations/src/expert-residency/verified-event.js";

let database: ExpertReferralTestDatabase;
type Policy = "legacy_residency_v1" | "expert_residency_v2";
type Tx = Parameters<
  Parameters<ExpertReferralTestDatabase["db"]["transaction"]>[0]
>[0];
const residency = () => new PostgresExpertResidencyRepository(database.db);
const provider = () =>
  new PostgresExpertResidencyProviderInboxRepository(database.db);
const codeCrypto = new ExpertCodeCrypto({
  currentVersion: "v1",
  activeVersions: ["v1"],
  key: () => new Uint8Array(32).fill(23),
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

// Schedule only at an executor boundary; forward every SQL statement/result.
// The gate is one-shot so a genuine serialization retry is free to progress.
function gate(
  matches: (text: string) => boolean,
  phase: "before" | "after" = "after",
  fail = false,
) {
  const reached = deferred(),
    resume = deferred(),
    submitted = deferred();
  const dialect = new PgDialect();
  let used = false;
  let transactions = 0;
  const db = new Proxy(database.db, {
    get(target, property) {
      if (property === "transaction")
        return <T>(
          work: (tx: Tx) => Promise<T>,
          config?: Parameters<
            ExpertReferralTestDatabase["db"]["transaction"]
          >[1],
        ) => {
          transactions++;
          return target.transaction(
            (tx) =>
              work(
                new Proxy(tx, {
                  get(transaction, member) {
                    if (member === "execute")
                      return async (query: Parameters<Tx["execute"]>[0]) => {
                        const text = (
                          typeof query === "string"
                            ? query
                            : dialect.sqlToQuery(query.getSQL()).sql
                        )
                          .replace(/\s+/gu, " ")
                          .trim();
                        const intercept = !used && matches(text);
                        if (intercept) used = true;
                        if (intercept && phase === "before") {
                          reached.resolve();
                          await resume.promise;
                        }
                        const running = Promise.resolve(
                          transaction.execute(query),
                        );
                        if (intercept) submitted.resolve();
                        const result = await running;
                        if (intercept && phase === "after") {
                          reached.resolve();
                          await resume.promise;
                        }
                        if (intercept && fail)
                          throw new Error("synthetic_settlement_rollback");
                        return result;
                      };
                    const value = Reflect.get(transaction, member);
                    return typeof value === "function"
                      ? value.bind(transaction)
                      : value;
                  },
                }),
              ),
            config,
          );
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    db,
    release: resume.resolve,
    submitted: submitted.promise,
    transactions: () => transactions,
    wait: async (work: Promise<unknown>) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          reached.promise,
          work.then(() => {
            throw new Error("settlement_boundary_not_reached");
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("settlement_boundary_timeout")),
              3000,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}

function event(order: { id: string; cashMinor: string }) {
  return verifiedEventFixture(
    {
      kind: "settled",
      provider: "authority-fixture",
      eventId: `evt_${order.id}`,
      paymentId: `pay_${order.id}`,
      orderId: order.id,
      amountMinor: order.cashMinor,
      currency: "RUB",
      occurredAt: "2026-08-03T00:00:00.000Z",
      payloadDigest: `sha256:${createHash("sha256").update(order.id).digest("hex")}`,
    },
    {
      verificationId: `verify_${order.id}`,
      verifierKeyVersion: "fixture-v1",
      verifiedAt: "2026-08-03T00:00:01.000Z",
    },
  );
}

async function tariff(policy: Policy) {
  return database.createResidencyTariff({
    tariffKey:
      policy === "expert_residency_v2" ? "START" : `authority-${randomUUID()}`,
    displayName: "Authority",
    priceMinor: 50000,
    durationSeconds: policy === "expert_residency_v2" ? 2592000 : 86400,
    commercialPolicyVersion: policy,
  });
}
async function order(expertId: string, tariffVersionId: string) {
  return residency().createCheckoutOrder({
    expertId,
    tariffVersionId,
    providerDeadline: new Date(Date.now() + 3600000),
    idempotencyKey: randomUUID(),
  });
}
async function referral(existingInviter?: ExpertIdentityFixture) {
  const inviter = existingInviter ?? (await database.createExpertIdentity());
  const invitee = await database.createExpertIdentity();
  const audit = await database.createAdminAudit({
    action: "expert_referral.batch_generate",
    objectId: inviter.expertId,
  });
  const referrals = new PostgresExpertReferralRepository(
    database.db,
    codeCrypto,
  );
  const issued = await referrals.issueBatch({
    inviterExpertId: inviter.expertId,
    count: 1,
    issuedByAdminId: audit.adminId,
    approvalId: audit.approvalId,
    adminSessionIdHash: audit.sessionIdHash,
  });
  await referrals.redeemCode({
    plaintext: issued.codes[0]!.plaintext,
    userId: invitee.userId,
    provider: invitee.provider,
    externalId: invitee.externalId,
  });
  return { inviter, invitee };
}
async function effects(orderId: string) {
  return (
    await database.db.execute(sql`select
    (select count(*)::int from expert_residency_provider_event_inbox where order_id=${orderId}::uuid) inbox,
    (select count(*)::int from expert_residency_payment_attempts where order_id=${orderId}::uuid) attempts,
    (select count(*)::int from expert_referral_ledger_entries where order_id=${orderId}::uuid and entry_kind='spend') spends,
    (select count(*)::int from expert_referral_ledger_entries where order_id=${orderId}::uuid and entry_kind='release') releases,
    (select count(*)::int from expert_first_residency_settlements where qualifying_order_id=${orderId}::uuid) markers,
    (select count(*)::int from expert_referral_reward_grants where qualifying_order_id=${orderId}::uuid) rewards`)
  ).rows[0];
}

beforeAll(async () => {
  database = await startExpertReferralTestDatabase();
  expect(
    (await database.db.execute(sql`show server_version_num`)).rows,
  ).toEqual([{ server_version_num: "170005" }]);
}, 120000);
beforeEach(async () => {
  await database.reset();
  await database.enableExpertReferralCommands();
});
afterAll(async () => {
  await database?.stop();
});

it.each(["legacy_residency_v1", "expert_residency_v2"] as const)(
  "appends both distinct concurrent %s orders without losing paid time and replays once",
  async (policy) => {
    const expert = await database.createExpertIdentity();
    const tariffId = await tariff(policy);
    const first = await order(expert.expertId, tariffId);
    const existing = await provider().settle(event(first));
    const history = (
      await database.db.execute(
        sql`select * from expert_residency_orders where id=${first.id}::uuid`,
      )
    ).rows;
    const a = await order(expert.expertId, tariffId),
      b = await order(expert.expertId, tariffId);
    const boundary = gate((text) =>
      text.startsWith("select max(residency_ends_at)"),
    );
    const pending = new PostgresExpertResidencyProviderInboxRepository(
      boundary.db,
    ).settle(event(a));
    try {
      await boundary.wait(pending);
      // A has read the old end; B commits while A is paused. Without real
      // serialization A subsequently commits the same interval as B.
      const settledB = await provider().settle(event(b));
      boundary.release();
      const settledA = await pending;
      expect(settledB.residencyStartsAt).toBe(existing.residencyEndsAt);
      expect(settledA.residencyStartsAt).toBe(settledB.residencyEndsAt);
      const durationMs =
        policy === "expert_residency_v2" ? 2592000000 : 86400000;
      expect(
        Date.parse(settledB.residencyEndsAt) -
          Date.parse(settledB.residencyStartsAt),
      ).toBe(durationMs);
      expect(
        Date.parse(settledA.residencyEndsAt) -
          Date.parse(existing.residencyEndsAt),
      ).toBe(2 * durationMs);
      expect(
        (
          await database.db.execute(
            sql`select * from expert_residency_orders where id=${first.id}::uuid`,
          )
        ).rows,
      ).toEqual(history);
      const before = await effects(a.id);
      await expect(provider().settle(event(a))).resolves.toEqual(settledA);
      expect(await effects(a.id)).toEqual(before);
      expect(before).toEqual({
        inbox: 1,
        attempts: 1,
        spends: 0,
        releases: 0,
        markers: 0,
        rewards: 0,
      });
    } finally {
      boundary.release();
      await pending.catch(() => undefined);
    }
  },
  20000,
);

it("does not introduce a global authority lock for different experts", async () => {
  const a = await database.createExpertIdentity(),
    b = await database.createExpertIdentity();
  const tariffId = await tariff("legacy_residency_v1");
  const oa = await order(a.expertId, tariffId),
    ob = await order(b.expertId, tariffId);
  const boundary = gate((text) =>
    text.startsWith("select max(residency_ends_at)"),
  );
  const pending = new PostgresExpertResidencyProviderInboxRepository(
    boundary.db,
  ).settle(event(oa));
  let second: ReturnType<ReturnType<typeof provider>["settle"]> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await boundary.wait(pending);
    second = provider().settle(event(ob));
    await Promise.race([
      second,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("unrelated_expert_blocked")),
          2000,
        );
      }),
    ]);
    boundary.release();
    expect((await pending).kind).toBe("settled");
  } finally {
    if (timer) clearTimeout(timer);
    boundary.release();
    await Promise.allSettled([pending, ...(second ? [second] : [])]);
  }
}, 20000);

it.each(["legacy_residency_v1", "expert_residency_v2"] as const)(
  "preserves %s referral treatment under settlement replay",
  async (policy) => {
    const { invitee } = await referral();
    await database.db.execute(
      sql`update expert_referral_feature_controls set version=version+1,reward_grants_enabled=true where control_key='expert_referrals'`,
    );
    const o = await order(invitee.expertId, await tariff(policy));
    const settled = await provider().settle(event(o));
    expect(settled).toMatchObject({
      firstSettlement: true,
      eligibility: "eligible",
      rewardGranted: policy === "legacy_residency_v1",
    });
    expect((await effects(o.id))!.rewards).toBe(
      policy === "legacy_residency_v1" ? 1 : 0,
    );
    expect(
      (
        await database.db.execute(
          sql`select status from expert_referral_reward_maturities where qualifying_order_id=${o.id}::uuid`,
        )
      ).rows,
    ).toEqual(policy === "expert_residency_v2" ? [{ status: "pending" }] : []);
    if (policy === "expert_residency_v2") {
      expect(
        (
          await database.db.execute(
            sql`select m.settled_at=o.settled_at as same_settlement_clock,m.matures_at=o.settled_at+interval '30 days' as thirty_days from expert_referral_reward_maturities m join expert_residency_orders o on o.id=m.qualifying_order_id where o.id=${o.id}::uuid`,
          )
        ).rows,
      ).toEqual([{ same_settlement_clock: true, thirty_days: true }]);
    }
    const before = await effects(o.id);
    await expect(provider().settle(event(o))).resolves.toEqual(settled);
    expect(await effects(o.id)).toEqual(before);
  },
);

async function creditOrder(multigrant = false) {
  const { inviter, invitee } = await referral();
  const tariffId = await tariff("legacy_residency_v1");
  await database.db.execute(
    sql`update expert_referral_feature_controls set version=version+1,reward_grants_enabled=true where control_key='expert_referrals'`,
  );
  const qualifying = await order(invitee.expertId, tariffId);
  expect((await provider().settle(event(qualifying))).rewardGranted).toBe(true);
  let spendingTariff = tariffId;
  if (multigrant) {
    const second = await referral(inviter);
    const secondPaid = await order(second.invitee.expertId, tariffId);
    expect((await provider().settle(event(secondPaid))).rewardGranted).toBe(
      true,
    );
    spendingTariff = await database.createResidencyTariff({
      tariffKey: `multigrant-${randomUUID()}`,
      displayName: "Multigrant expiry",
      priceMinor: 300000,
      durationSeconds: 86400,
      commercialPolicyVersion: "legacy_residency_v1",
    });
  }
  const o = await order(inviter.expertId, spendingTariff);
  expect(o).toMatchObject(
    multigrant
      ? { creditMinor: "150000", cashMinor: "150000" }
      : { creditMinor: "25000", cashMinor: "25000" },
  );
  if (multigrant)
    expect(o.allocations.map((a) => a.amountMinor).sort()).toEqual([
      "100000",
      "50000",
    ]);
  return { inviter, o };
}

it("commits expiry and release after an order-lock wait before rejecting settlement; replay and worker add nothing", async () => {
  const { inviter, o } = await creditOrder();
  await database.db.execute(
    sql`update expert_residency_orders set payment_deadline=clock_timestamp()+interval '2 seconds' where id=${o.id}::uuid`,
  );
  const blocker = await database.db.$client.connect();
  await blocker.query("begin");
  await blocker.query(
    // Permit the inbox INSERT's FK KEY SHARE, but block settlement FOR UPDATE.
    "select id from expert_residency_orders where id=$1 for no key update",
    [o.id],
  );
  const boundary = gate(
    (text) =>
      text.includes("from expert_residency_orders where id=") &&
      text.endsWith("for update"),
    "before",
  );
  const pending = new PostgresExpertResidencyProviderInboxRepository(
    boundary.db,
  ).settle(event(o));
  const outcome = pending.then(
    (value) => ({ value, error: undefined }),
    (error) => ({ value: undefined, error }),
  );
  try {
    await boundary.wait(pending);
    expect(
      (
        await blocker.query(
          "select clock_timestamp()<payment_deadline as future from expert_residency_orders where id=$1",
          [o.id],
        )
      ).rows,
    ).toEqual([{ future: true }]);
    boundary.release();
    await boundary.submitted;
    // Bounded DB-clock wait, not pg_stat_activity snapshot polling. The real
    // unchanged order SELECT is submitted while this connection owns its lock.
    await blocker.query(
      "select pg_sleep(greatest(0,extract(epoch from payment_deadline-clock_timestamp()))+0.1) from expert_residency_orders where id=$1",
      [o.id],
    );
    expect(
      (
        await blocker.query(
          "select clock_timestamp()>=payment_deadline as expired from expert_residency_orders where id=$1",
          [o.id],
        )
      ).rows,
    ).toEqual([{ expired: true }]);
    await blocker.query("commit");
    expect((await outcome).error).toMatchObject({
      code: "EXPERT_RESIDENCY_PAYMENT_EXPIRED",
    });
    expect(await effects(o.id)).toEqual({
      inbox: 1,
      attempts: 0,
      spends: 0,
      releases: 1,
      markers: 0,
      rewards: 0,
    });
    expect(
      (
        await database.db.execute(
          sql`select status,settled_at,residency_starts_at,residency_ends_at from expert_residency_orders where id=${o.id}::uuid`,
        )
      ).rows,
    ).toEqual([
      {
        status: "expired",
        settled_at: null,
        residency_starts_at: null,
        residency_ends_at: null,
      },
    ]);
    const rejected = (
      await database.db.execute(
        sql`select * from expert_residency_provider_event_inbox where order_id=${o.id}::uuid`,
      )
    ).rows;
    const verified = event(o);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      status: "rejected",
      result_code: "EXPERT_RESIDENCY_PAYMENT_EXPIRED",
      authenticated: true,
      identity_version: 1,
      event_kind: "settled",
      order_id: o.id,
      payment_id: verified.paymentId,
      payload_digest: verified.payloadDigest.slice(7),
      verification_id: verified.verificationId,
      verifier_key_version: verified.verifierKeyVersion,
    });
    // Drizzle raw execute preserves PG timestamptz strings. Compare instants
    // inside PostgreSQL, retaining microseconds rather than assuming JS Dates.
    expect(
      (
        await database.db.execute(sql`select
          i.occurred_at=${verified.occurredAt}::timestamptz occurred_exact,
          i.verified_at=${verified.verifiedAt}::timestamptz verified_exact,
          isfinite(i.processed_at) and i.processed_at>=o.payment_deadline
            and i.processed_at<=clock_timestamp() processed_after_deadline
          from expert_residency_provider_event_inbox i
          join expert_residency_orders o on o.id=i.order_id
          where i.order_id=${o.id}::uuid`)
      ).rows,
    ).toEqual([
      {
        occurred_exact: true,
        verified_exact: true,
        processed_after_deadline: true,
      },
    ]);
    expect(
      (
        await database.db.execute(
          sql`select id from integration_outbox where idempotency_key=${`expert-residency-settled:${o.id}`}`,
        )
      ).rows,
    ).toEqual([]);
    await expect(provider().settle(verified)).rejects.toMatchObject({
      code: "EXPERT_RESIDENCY_PAYMENT_EXPIRED",
    });
    await expect(
      provider().settle(event({ ...o, cashMinor: "1" })),
    ).rejects.toMatchObject({
      code: "EXPERT_RESIDENCY_PROVIDER_EVENT_CONFLICT",
    });
    expect(
      (
        await database.db.execute(
          sql`select * from expert_residency_provider_event_inbox where order_id=${o.id}::uuid`,
        )
      ).rows,
    ).toEqual(rejected);
    await expect(residency().releaseExpiredOrders()).resolves.toEqual({
      examined: 0,
      released: 0,
    });
    await expect(residency().releaseExpiredOrders()).resolves.toEqual({
      examined: 0,
      released: 0,
    });
    expect(await effects(o.id)).toEqual({
      inbox: 1,
      attempts: 0,
      spends: 0,
      releases: 1,
      markers: 0,
      rewards: 0,
    });
    expect(
      (
        await database.db.execute(
          sql`select e.amount_minor::text amount,a.amount_minor::text allocation from expert_referral_ledger_entries e join expert_referral_ledger_allocations a on a.ledger_entry_id=e.id where e.order_id=${o.id}::uuid and e.entry_kind='release'`,
        )
      ).rows,
    ).toEqual([{ amount: "25000", allocation: "25000" }]);
    await expect(residency().balance(inviter.expertId)).resolves.toMatchObject({
      availableCreditMinor: "100000",
      reservedCreditMinor: "0",
    });
  } finally {
    boundary.release();
    try {
      await blocker.query("rollback");
    } finally {
      blocker.release();
      await outcome;
    }
  }
}, 20000);

it.each(["settlement", "worker"] as const)(
  "rolls back a failed expiry allocation, then %s releases once",
  async (retryBy) => {
    const { inviter, o } = await creditOrder(true);
    const reservations = (
      await database.db.execute<{
        reservation_id: string;
        reward_grant_id: string;
        amount: string;
        allocation: string;
      }>(
        sql`select e.id reservation_id,a.reward_grant_id,e.amount_minor::text amount,a.amount_minor::text allocation from expert_referral_ledger_entries e join expert_referral_ledger_allocations a on a.ledger_entry_id=e.id where e.order_id=${o.id}::uuid and e.entry_kind='reservation' order by e.id,a.reward_grant_id`,
      )
    ).rows;
    expect(reservations).toHaveLength(2);
    expect(new Set(reservations.map((row) => row.reward_grant_id)).size).toBe(
      2,
    );
    expect(reservations.map((row) => row.allocation).sort()).toEqual([
      "-100000",
      "-50000",
    ]);
    expect(reservations.every((row) => row.amount === "-150000")).toBe(true);
    await database.db.execute(
      sql`update expert_residency_orders set payment_deadline=clock_timestamp() where id=${o.id}::uuid`,
    );
    const boundary = gate(
      (text) =>
        text.startsWith("insert into expert_referral_ledger_allocations"),
      "after",
      true,
    );
    const pending = new PostgresExpertResidencyProviderInboxRepository(
      boundary.db,
    ).settle(event(o));
    const outcome = pending.catch((error) => error);
    try {
      await boundary.wait(pending);
      boundary.release();
      expect(await outcome).toMatchObject({
        message: "synthetic_settlement_rollback",
      });
      expect(await effects(o.id)).toEqual({
        inbox: 0,
        attempts: 0,
        spends: 0,
        releases: 0,
        markers: 0,
        rewards: 0,
      });
      expect(
        (
          await database.db.execute(
            sql`select status from expert_residency_orders where id=${o.id}::uuid`,
          )
        ).rows,
      ).toEqual([{ status: "payment_pending" }]);
      await expect(
        residency().balance(inviter.expertId),
      ).resolves.toMatchObject({
        availableCreditMinor: "50000",
        reservedCreditMinor: "150000",
      });
      if (retryBy === "settlement") {
        await expect(provider().settle(event(o))).rejects.toMatchObject({
          code: "EXPERT_RESIDENCY_PAYMENT_EXPIRED",
        });
      } else {
        await expect(residency().releaseExpiredOrders()).resolves.toEqual({
          examined: 1,
          released: 1,
        });
        // Worker already committed expiry. The real, exact-amount verified
        // payment must still survive as a terminal inbox fact, not roll back.
        await expect(provider().settle(event(o))).rejects.toMatchObject({
          code: "EXPERT_RESIDENCY_PAYMENT_EXPIRED",
        });
      }
      expect(await effects(o.id)).toEqual({
        inbox: 1,
        attempts: 0,
        spends: 0,
        releases: 1,
        markers: 0,
        rewards: 0,
      });
      expect(
        (
          await database.db.execute(
            sql`select e.original_entry_id reservation_id,a.reward_grant_id,e.idempotency_key,e.source_type,e.source_id,e.amount_minor::text amount,a.amount_minor::text allocation from expert_referral_ledger_entries e join expert_referral_ledger_allocations a on a.ledger_entry_id=e.id where e.order_id=${o.id}::uuid and e.entry_kind='release' order by e.original_entry_id,a.reward_grant_id`,
          )
        ).rows,
      ).toEqual(
        reservations.map((row) => ({
          reservation_id: row.reservation_id,
          reward_grant_id: row.reward_grant_id,
          idempotency_key: `release:${row.reservation_id}`,
          source_type: "residency_order",
          source_id: o.id,
          amount: (-BigInt(row.amount)).toString(),
          allocation: (-BigInt(row.allocation)).toString(),
        })),
      );
      const terminal = (
        await database.db.execute(
          sql`select * from expert_residency_provider_event_inbox where order_id=${o.id}::uuid`,
        )
      ).rows;
      expect(terminal).toHaveLength(1);
      expect(terminal[0]).toMatchObject({
        status: "rejected",
        result_code: "EXPERT_RESIDENCY_PAYMENT_EXPIRED",
        authenticated: true,
      });
      await expect(provider().settle(event(o))).rejects.toMatchObject({
        code: "EXPERT_RESIDENCY_PAYMENT_EXPIRED",
      });
      await expect(
        provider().settle(event({ ...o, cashMinor: "1" })),
      ).rejects.toMatchObject({
        code: "EXPERT_RESIDENCY_PROVIDER_EVENT_CONFLICT",
      });
      expect(
        (
          await database.db.execute(
            sql`select * from expert_residency_provider_event_inbox where order_id=${o.id}::uuid`,
          )
        ).rows,
      ).toEqual(terminal);
      await expect(residency().releaseExpiredOrders()).resolves.toEqual({
        examined: 0,
        released: 0,
      });
      await expect(
        residency().balance(inviter.expertId),
      ).resolves.toMatchObject({
        availableCreditMinor: "200000",
        reservedCreditMinor: "0",
      });
    } finally {
      boundary.release();
      await outcome;
    }
  },
);

it("rolls back forwarded settlement writes and permits a clean retry", async () => {
  const expert = await database.createExpertIdentity();
  const o = await order(expert.expertId, await tariff("legacy_residency_v1"));
  const boundary = gate(
    (text) =>
      text.startsWith("update expert_residency_orders set status='settled'"),
    "after",
    true,
  );
  const pending = new PostgresExpertResidencyProviderInboxRepository(
    boundary.db,
  ).settle(event(o));
  const outcome = pending.catch((error) => error);
  try {
    await boundary.wait(pending);
    boundary.release();
    expect(await outcome).toMatchObject({
      message: "synthetic_settlement_rollback",
    });
    expect(await effects(o.id)).toEqual({
      inbox: 0,
      attempts: 0,
      spends: 0,
      releases: 0,
      markers: 0,
      rewards: 0,
    });
    expect(
      (
        await database.db.execute(
          sql`select status,residency_ends_at from expert_residency_orders where id=${o.id}::uuid`,
        )
      ).rows,
    ).toEqual([{ status: "payment_pending", residency_ends_at: null }]);
    await expect(provider().settle(event(o))).resolves.toMatchObject({
      kind: "settled",
      firstSettlement: true,
    });
    expect(await effects(o.id)).toEqual({
      inbox: 1,
      attempts: 1,
      spends: 0,
      releases: 0,
      markers: 1,
      rewards: 0,
    });
  } finally {
    boundary.release();
    await outcome;
  }
});
