import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import type { DrizzleDb } from "../../packages/db/src/client.js";
import { ExpertCodeCrypto } from "../../packages/application/src/expert-code-crypto.js";
import { PostgresExpertReferralRepository } from "../../packages/db/src/repositories/expert-referral-repository.js";
import {
  PostgresExpertCampaignOrderRepository,
  type CreateExpertCampaignOrder,
} from "../../packages/db/src/repositories/expert-campaign-order-repository.js";
import { PostgresExpertCampaignQuoteRepository } from "../../packages/db/src/repositories/expert-campaign-quote-repository.js";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import { PostgresExpertReferralWorkerRepository } from "../../packages/db/src/repositories/expert-referral-worker-repository.js";
import { PostgresExpertResidencyProviderInboxRepository } from "../../packages/db/src/repositories/expert-residency-provider-inbox-repository.js";
import { PostgresAdminRepository } from "../../packages/db/src/repositories/admin-repository.js";
import { PostgresAdminApprovalRepository } from "../../packages/db/src/repositories/admin-approval-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
  type ExpertIdentityFixture,
} from "../../packages/db/src/testkit/expert-referral.js";
import { verifiedEventFixture } from "../../packages/integrations/src/expert-residency/verified-event.js";

let database: ExpertReferralTestDatabase;
let owner: ExpertIdentityFixture;
let tariffId: string;
const orders = (db = database.db) =>
  new PostgresExpertCampaignOrderRepository(db);
const provider = () =>
  new PostgresExpertResidencyProviderInboxRepository(database.db);
const legacy = () => new PostgresExpertResidencyRepository(database.db);
const crypto = new ExpertCodeCrypto({
  currentVersion: "v1",
  activeVersions: ["v1"],
  key: () => new Uint8Array(32).fill(29),
});
const command = (quoteId: string): CreateExpertCampaignOrder => ({
  userId: owner.userId,
  expertId: owner.expertId,
  quoteId,
  idempotencyKey: randomUUID(),
});
async function quote(termMonths: 1 | 3 = 1, tariffVersionId = tariffId) {
  return new PostgresExpertCampaignQuoteRepository(database.db).createQuote({
    userId: owner.userId,
    tariffVersionId,
    termMonths,
    idempotencyKey: randomUUID(),
  });
}
async function tariff(
  key = "PRO",
  policy: "legacy_residency_v1" | "expert_residency_v2" = "expert_residency_v2",
) {
  return database.createResidencyTariff({
    tariffKey: key,
    displayName: key,
    priceMinor: 999000,
    durationSeconds: 2592000,
    commercialPolicyVersion: policy,
  });
}
function event(
  order: { id: string; cashMinor: string },
  kind: "settled" | "refunded" = "settled",
) {
  return verifiedEventFixture(
    {
      kind,
      provider: "campaign-fixture",
      eventId: `${kind}_${order.id}`,
      paymentId: `pay_${order.id}`,
      orderId: order.id,
      amountMinor: order.cashMinor,
      currency: "RUB",
      occurredAt: "2026-08-03T00:00:00.000Z",
      payloadDigest: `sha256:${createHash("sha256")
        .update(kind + order.id)
        .digest("hex")}`,
    },
    {
      verificationId: `verify_${kind}_${order.id}`,
      verifierKeyVersion: "fixture-v1",
      verifiedAt: "2026-08-03T00:00:01.000Z",
    },
  );
}
async function referral(inviter = owner) {
  const invitee = await database.createExpertIdentity();
  const audit = await database.createAdminAudit({
    action: "expert_referral.batch_generate",
    objectId: inviter.expertId,
  });
  const repo = new PostgresExpertReferralRepository(database.db, crypto);
  const batch = await repo.issueBatch({
    inviterExpertId: inviter.expertId,
    count: 1,
    issuedByAdminId: audit.adminId,
    approvalId: audit.approvalId,
    adminSessionIdHash: audit.sessionIdHash,
  });
  await repo.redeemCode({
    plaintext: batch.codes[0]!.plaintext,
    userId: invitee.userId,
    provider: invitee.provider,
    externalId: invitee.externalId,
  });
  return invitee;
}
// Obtain genuine legacy rewards, not fabricated ledger acceptance.
async function credit(count = 5) {
  const legacyTariff = await tariff(
    `credit-${randomUUID()}`,
    "legacy_residency_v1",
  );
  await database.db.execute(
    sql`update expert_referral_feature_controls set version=version+1,reward_grants_enabled=true where control_key='expert_referrals'`,
  );
  for (let i = 0; i < count; i++) {
    const invitee = await referral();
    const order = await legacy().createCheckoutOrder({
      expertId: invitee.expertId,
      tariffVersionId: legacyTariff,
      providerDeadline: new Date(Date.now() + 3600000),
      idempotencyKey: randomUUID(),
    });
    expect((await provider().settle(event(order))).rewardGranted).toBe(true);
  }
}
async function state() {
  return (
    await database.db.execute(sql`select
    (select count(*)::int from expert_residency_orders where expert_id=${owner.expertId}::uuid) orders,
    (select count(*)::int from expert_referral_ledger_entries where expert_id=${owner.expertId}::uuid and entry_kind='reservation') reservations,
    (select count(*)::int from expert_referral_ledger_entries where expert_id=${owner.expertId}::uuid and entry_kind='release') releases`)
  ).rows[0];
}
async function stored(id: string) {
  return (
    await database.db.execute(
      sql`select * from expert_residency_orders where id=${id}::uuid`,
    )
  ).rows[0]!;
}
function code(error: unknown): string | undefined {
  if (typeof error !== "object" || !error) return undefined;
  return "code" in error && typeof error.code === "string"
    ? error.code
    : "cause" in error
      ? code(error.cause)
      : undefined;
}
async function sqlDenied(action: Promise<unknown>) {
  expect(["23514", "23505", "23503"]).toContain(
    await action.then(() => "accepted", code),
  );
}
async function insertRaw(fact: Record<string, unknown>) {
  await database.db.execute(
    sql`insert into expert_residency_orders select (jsonb_populate_record(null::expert_residency_orders,${JSON.stringify(fact)}::jsonb)).*`,
  );
}

// One-shot gate forwards the original SQL; only observeBlocked proves a lock wait.
function gate(matches: (text: string) => boolean, failAfter = false) {
  let release!: () => void, reached!: () => void;
  const resume = new Promise<void>((r) => {
      release = r;
    }),
    paused = new Promise<void>((r) => {
      reached = r;
    });
  let used = false,
    pid = 0,
    attempts = 0;
  const dialect = new PgDialect();
  const db = new Proxy(database.db, {
    get(target, key) {
      if (key === "transaction")
        return (
          work: Parameters<DrizzleDb["transaction"]>[0],
          config?: Parameters<DrizzleDb["transaction"]>[1],
        ) => {
          attempts++;
          return target.transaction(
            (tx) =>
              work(
                new Proxy(tx, {
                  get(t, k) {
                    if (k === "execute")
                      return async (
                        query: Parameters<typeof tx.execute>[0],
                      ) => {
                        const text = (
                          typeof query === "string"
                            ? query
                            : dialect.sqlToQuery(query.getSQL()).sql
                        )
                          .replace(/\s+/gu, " ")
                          .trim();
                        const hit = !used && matches(text);
                        if (hit) {
                          used = true;
                          pid = (
                            await t.execute<{ pid: number }>(
                              sql`select pg_backend_pid() pid`,
                            )
                          ).rows[0]!.pid;
                          reached();
                          await resume;
                        }
                        const result = await t.execute(query);
                        if (hit && failAfter)
                          throw Error("synthetic_checkout_rollback");
                        return result;
                      };
                    const v = Reflect.get(t, k);
                    return typeof v === "function" ? v.bind(t) : v;
                  },
                }),
              ),
            config,
          );
        };
      const v = Reflect.get(target, key);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return {
    db,
    release,
    pid: () => pid,
    attempts: () => attempts,
    wait: async (work: Promise<unknown>) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          paused,
          work.then(() => {
            throw Error("boundary_not_reached");
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(Error("boundary_timeout")), 3000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
async function observeBlocked(waiter: number, blocker: number) {
  for (let i = 0; i < 100; i++) {
    // Each pool query is autocommit: no cached activity snapshot, no query-text filter.
    const result = await database.db.$client.query<{ blocked: boolean }>(
      "select $2::int=any(pg_blocking_pids($1::int)) and exists(select 1 from pg_locks where pid=$1::int and not granted) blocked",
      [waiter, blocker],
    );
    if (result.rows[0]?.blocked) return;
    await delay(2);
  }
  throw Error("actual_postgres_wait_not_observed");
}
async function serverMs() {
  return Number(
    (
      await database.db.execute<{ ms: string }>(
        sql`select floor(extract(epoch from clock_timestamp())*1000)::text ms`,
      )
    ).rows[0]!.ms,
  );
}
async function until(ms: number) {
  while ((await serverMs()) < ms) await delay(3);
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
  owner = await database.createExpertIdentity();
  tariffId = await tariff();
});
afterAll(async () => {
  await database?.stop();
});

it.each([
  ["PRO", 1, 0, "599400", "179820", "419580", 2592000, 3],
  ["PRO", 3, 0, "1528470", "458541", "1069929", 7776000, 3],
  ["START", 3, 0, "1500000", "450000", "1050000", 7776000, 0],
  ["PRO", 3, 73, "1888110", "566433", "1321677", 7776000, 3],
  ["BASE", 3, 0, "1500000", "450000", "1050000", 7776000, 1],
] as const)(
  "pins %s/%i stage %i arithmetic and FIFO",
  async (key, term, hours, price, used, cash, duration, groups) => {
    await credit(hours ? 6 : 5);
    if (hours)
      await database.db.execute(
        sql`insert into expert_campaign_anchors(user_id,rule_version,calculation_timestamp) values(${owner.userId}::uuid,'expert_energy_start_v1',date_trunc('milliseconds',clock_timestamp())-make_interval(hours=>${hours}))`,
      );
    const q = await quote(term, key === "PRO" ? tariffId : await tariff(key));
    const result = await orders().createCheckoutOrder(command(q.id));
    expect(result).toMatchObject({
      quoteId: q.id,
      priceMinor: price,
      creditMinor: used,
      cashMinor: cash,
      durationSeconds: duration,
      termMonths: term,
      groupEventLimit: groups,
      creditCapBps: 3000,
      commercialPolicyVersion: "expert_campaign_v1",
      providerDeadline: q.expiresAt,
      paymentDeadline: q.expiresAt,
      status: "payment_pending",
    });
    const grants = (
      await database.db.execute<{ id: string }>(
        sql`select id from expert_referral_reward_grants where expert_id=${owner.expertId}::uuid order by expires_at,granted_at,id`,
      )
    ).rows;
    expect(result.allocations.map((a) => a.grantId)).toEqual(
      grants.slice(0, result.allocations.length).map((g) => g.id),
    );
    expect(
      result.allocations.reduce((s, a) => s + BigInt(a.amountMinor), 0n),
    ).toBe(BigInt(used));
    expect(
      result.allocations.slice(0, -1).every((a) => a.amountMinor === "100000"),
    ).toBe(true);
  },
);
it("uses only available credit and does not floor cash", async () => {
  await credit(1);
  const result = await orders().createCheckoutOrder(
    command((await quote()).id),
  );
  expect(result).toMatchObject({
    priceMinor: "599400",
    creditMinor: "100000",
    cashMinor: "499400",
  });
});
it("replays canonical UUIDs without rereading retired source", async () => {
  await credit(1);
  const q = await quote();
  const c = command(q.id);
  const first = await orders().createCheckoutOrder(c);
  await database.db.execute(
    sql`update expert_residency_tariff_versions set active_to=clock_timestamp() where id=${tariffId}::uuid`,
  );
  const before = await state();
  expect(
    await orders().createCheckoutOrder({
      ...c,
      userId: c.userId.toUpperCase(),
      expertId: c.expertId.toUpperCase(),
      quoteId: c.quoteId.toUpperCase(),
    }),
  ).toEqual(first);
  expect(await state()).toEqual(before);
});
it("conflicts on changed quote, legacy key, and distinct-key quote reuse", async () => {
  const q = await quote(),
    other = await quote();
  const c = command(q.id);
  await orders().createCheckoutOrder(c);
  await expect(
    orders().createCheckoutOrder({ ...c, quoteId: other.id }),
  ).rejects.toMatchObject({ code: "EXPERT_CAMPAIGN_IDEMPOTENCY_CONFLICT" });
  await expect(
    orders().createCheckoutOrder(command(q.id)),
  ).rejects.toMatchObject({ code: "QUOTE_ALREADY_USED" });
  const key = randomUUID();
  await legacy().createCheckoutOrder({
    expertId: owner.expertId,
    tariffVersionId: tariffId,
    providerDeadline: new Date(Date.now() + 60000),
    idempotencyKey: key,
  });
  await expect(
    orders().createCheckoutOrder({ ...command(other.id), idempotencyKey: key }),
  ).rejects.toMatchObject({ code: "EXPERT_CAMPAIGN_IDEMPOTENCY_CONFLICT" });
});
it.each(["user", "expert", "verification", "owner"] as const)(
  "denies new and replay after %s authority changes",
  async (kind) => {
    const c = command((await quote()).id);
    await orders().createCheckoutOrder(c);
    const fresh = command((await quote()).id);
    if (kind === "user")
      await database.db.execute(
        sql`update users set active=false where id=${owner.userId}::uuid`,
      );
    if (kind === "expert")
      await database.db.execute(
        sql`update experts set active=false where id=${owner.expertId}::uuid`,
      );
    if (kind === "verification")
      await database.db.execute(
        sql`update experts set verified=false where id=${owner.expertId}::uuid`,
      );
    if (kind === "owner") {
      const other = await database.createUser();
      c.userId = other;
      fresh.userId = other;
    }
    const before = await state();
    for (const input of [c, fresh])
      await expect(orders().createCheckoutOrder(input)).rejects.toMatchObject({
        code: "EXPERT_CAMPAIGN_OWNER_INELIGIBLE",
      });
    expect(await state()).toEqual(before);
  },
);
it("denies someone else's quote without writes", async () => {
  const q = await quote();
  const someone = await database.createExpertIdentity();
  await expect(
    orders().createCheckoutOrder({
      ...command(q.id),
      userId: someone.userId,
      expertId: someone.expertId,
    }),
  ).rejects.toMatchObject({ code: "EXPERT_CAMPAIGN_QUOTE_UNAVAILABLE" });
  expect((await state())!.orders).toBe(0);
});
it.each(["short", "bad key1", "newline1\n", "x".repeat(129)])(
  "rejects transport key %j",
  async (idempotencyKey) => {
    await expect(
      orders().createCheckoutOrder({
        ...command(randomUUID()),
        idempotencyKey,
      }),
    ).rejects.toMatchObject({ code: "EXPERT_CAMPAIGN_INVALID_INPUT" });
  },
);
it.each(["priceMinor", "termMonths", "clock", "creditMinor"])(
  "rejects caller %s authority",
  async (field) => {
    await expect(
      orders().createCheckoutOrder({ ...command(randomUUID()), [field]: 1 }),
    ).rejects.toMatchObject({ code: "EXPERT_CAMPAIGN_INVALID_INPUT" });
  },
);
it("denies new consumption of retired tariff", async () => {
  const q = await quote();
  await database.db.execute(
    sql`update expert_residency_tariff_versions set active_to=clock_timestamp() where id=${tariffId}::uuid`,
  );
  await expect(
    orders().createCheckoutOrder(command(q.id)),
  ).rejects.toMatchObject({ code: "EXPERT_CAMPAIGN_TARIFF_INACTIVE" });
  expect((await state())!.orders).toBe(0);
});

it("serializes concurrent same-key and distinct-key quote consumption", async () => {
  await credit(2);
  const c = command((await quote()).id);
  const pair = await Promise.all([
    orders().createCheckoutOrder(c),
    orders().createCheckoutOrder(c),
  ]);
  expect(pair[0]).toEqual(pair[1]);
  const q = await quote();
  const results = await Promise.allSettled([
    orders().createCheckoutOrder(command(q.id)),
    orders().createCheckoutOrder(command(q.id)),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")).toMatchObject({
    reason: { code: "QUOTE_ALREADY_USED" },
  });
  expect(await state()).toMatchObject({ orders: 2, reservations: 2 });
});
it("rolls back order and reservation when allocation fails", async () => {
  await credit(1);
  const c = command((await quote()).id);
  const boundary = gate(
    (text) => text.startsWith("insert into expert_referral_ledger_allocations"),
    true,
  );
  const work = orders(boundary.db).createCheckoutOrder(c);
  void work.catch(() => {});
  try {
    await boundary.wait(work);
    boundary.release();
    await expect(work).rejects.toMatchObject({
      code: "EXPERT_CAMPAIGN_STORAGE",
    });
    expect(await state()).toMatchObject({ orders: 0, reservations: 0 });
  } finally {
    boundary.release();
    await work.catch(() => {});
  }
  expect((await orders().createCheckoutOrder(c)).creditMinor).toBe("100000");
});

const immutable = [
  "id",
  "expert_id",
  "tariff_version_id",
  "campaign_quote_id",
  "campaign_term_months",
  "snapshot_display_name",
  "price_minor",
  "credit_minor",
  "cash_minor",
  "currency",
  "duration_seconds",
  "commercial_policy_version",
  "credit_cap_bps",
  "individual_services_enabled",
  "group_event_limit",
  "statistics_level",
  "support_priority",
  "payment_deadline",
  "provider_deadline",
  "idempotency_key",
  "created_at",
];
it.each(immutable)("rejects SQL rewrite of immutable %s", async (field) => {
  const o = await orders().createCheckoutOrder(command((await quote()).id));
  const row = await stored(o.id);
  const value =
    field.endsWith("_id") || field === "id"
      ? randomUUID()
      : field === "campaign_term_months"
        ? 3
        : field === "individual_services_enabled"
          ? false
          : field.endsWith("deadline") || field === "created_at"
            ? new Date(Date.now() + 1000).toISOString()
            : typeof row[field] === "number"
              ? Number(row[field]) + 1
              : field.endsWith("minor")
                ? String(BigInt(String(row[field])) + 1n)
                : "forged";
  await sqlDenied(
    database.db.execute(
      sql`update expert_residency_orders set ${sql.identifier(field)}=${value} where id=${o.id}::uuid`,
    ),
  );
  expect(await stored(o.id)).toEqual(row);
});
it("rejects deletion, cloned consumption and source substitution; allows lifecycle updates", async () => {
  const o = await orders().createCheckoutOrder(command((await quote()).id));
  const row = await stored(o.id);
  await sqlDenied(
    database.db.execute(
      sql`delete from expert_residency_orders where id=${o.id}::uuid`,
    ),
  );
  await sqlDenied(
    insertRaw({ ...row, id: randomUUID(), idempotency_key: randomUUID() }),
  );
  const q = await quote();
  await sqlDenied(
    insertRaw({
      ...row,
      id: randomUUID(),
      idempotency_key: randomUUID(),
      campaign_quote_id: q.id,
      price_minor: "599401",
      cash_minor: "599401",
      provider_deadline: q.expiresAt,
      payment_deadline: q.expiresAt,
    }),
  );
  await database.db.execute(
    sql`update expert_residency_orders set status='failed',updated_at=clock_timestamp() where id=${o.id}::uuid`,
  );
  expect(
    (
      await orders().createCheckoutOrder({
        ...command(o.quoteId),
        idempotencyKey: String(row.idempotency_key),
      })
    ).status,
  ).toBe("failed");
});

it("commits overdue replay expiry and original grant release once", async () => {
  await credit(2);
  // Privileged historical fixture: shift grant dates together, retaining 365-day invariant.
  await database.db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role=replica`);
    await tx.execute(
      sql`with clock as materialized (select date_trunc('milliseconds',clock_timestamp())+interval '500 milliseconds' deadline) update expert_referral_reward_grants set granted_at=clock.deadline-interval '365 days',expires_at=clock.deadline from clock where expert_id=${owner.expertId}::uuid`,
    );
  });
  const c = command((await quote()).id);
  const o = await orders().createCheckoutOrder(c);
  expect(o.allocations).toHaveLength(2);
  expect(Date.parse(o.paymentDeadline)).toBeLessThan(
    Date.parse(o.providerDeadline),
  );
  await until(Date.parse(o.paymentDeadline) + 1);
  const [replayed] = await Promise.all([
    orders().createCheckoutOrder(c),
    legacy().releaseExpiredOrders(),
  ]);
  expect(replayed.status).toBe("expired");
  expect((await orders().createCheckoutOrder(c)).status).toBe("expired");
  const rows = (
    await database.db.execute(
      sql`select a.reward_grant_id as grant_id,sum(a.amount_minor)::text net from expert_referral_ledger_entries e join expert_referral_ledger_allocations a on a.ledger_entry_id=e.id where e.order_id=${o.id}::uuid group by a.reward_grant_id`,
    )
  ).rows;
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.net === "0")).toBe(true);
  expect((await state())!.releases).toBe(1);
  await expect(
    orders().createCheckoutOrder(command(o.quoteId)),
  ).rejects.toMatchObject({ code: "QUOTE_ALREADY_USED" });
});

it.each(["subject", "document"] as const)(
  "observes actual %s wait across quote expiry and leaves no consumption",
  async (kind) => {
    await database.db.execute(
      sql`update expert_residency_tariff_versions set active_to=date_trunc('milliseconds',clock_timestamp())+interval '2 seconds' where id=${tariffId}::uuid`,
    );
    const q = await quote();
    const blocker = await database.db.$client.connect();
    await blocker.query("begin");
    const blockerPid = Number(
      (await blocker.query("select pg_backend_pid() pid")).rows[0].pid,
    );
    if (kind === "subject")
      await blocker.query(
        "select pg_advisory_xact_lock(hashtextextended($1::uuid::text,0))",
        [owner.userId],
      );
    else
      await blocker.query(
        "lock table consent_document_versions in access exclusive mode",
      );
    const boundary = gate((text) =>
      kind === "subject"
        ? text.includes("pg_advisory_xact_lock")
        : text.startsWith("lock table consent_document_versions"),
    );
    const work = orders(boundary.db).createCheckoutOrder(command(q.id));
    void work.catch(() => {});
    try {
      await boundary.wait(work);
      await until(Date.parse(q.expiresAt) - 80);
      boundary.release();
      await observeBlocked(boundary.pid(), blockerPid);
      await until(Date.parse(q.expiresAt));
      await blocker.query("commit");
      await expect(work).rejects.toMatchObject({
        code: "EXPERT_CAMPAIGN_QUOTE_EXPIRED",
      });
      expect(await state()).toMatchObject({ orders: 0, reservations: 0 });
    } finally {
      boundary.release();
      await blocker.query("rollback");
      await work.catch(() => {});
      blocker.release();
    }
  },
);

it("bounds real advisory contention at three whole-transaction attempts", async () => {
  const q = await quote(),
    blocker = await database.db.$client.connect();
  await blocker.query("begin");
  await blocker.query(
    "select pg_advisory_xact_lock(hashtextextended($1::uuid::text,0))",
    [owner.userId],
  );
  const pid = Number(
    (await blocker.query("select pg_backend_pid() pid")).rows[0].pid,
  );
  const boundary = gate((text) => text.includes("pg_advisory_xact_lock"));
  const work = orders(boundary.db).createCheckoutOrder(command(q.id));
  void work.catch(() => {});
  try {
    await boundary.wait(work);
    boundary.release();
    await observeBlocked(boundary.pid(), pid);
    await expect(work).rejects.toMatchObject({
      code: "EXPERT_CAMPAIGN_CONTENTION",
    });
    expect(boundary.attempts()).toBe(3);
    expect(await state()).toMatchObject({ orders: 0, reservations: 0 });
  } finally {
    boundary.release();
    await blocker.query("rollback");
    await work.catch(() => {});
    blocker.release();
  }
});

it("settles saved three-month cash/duration consecutively, replays and reverses with V2 maturity", async () => {
  const inviter = await database.createExpertIdentity();
  owner = await referral(inviter);
  const c = command((await quote(3)).id);
  const first = await orders().createCheckoutOrder(c);
  const settled = await provider().settle(event(first));
  expect(settled.rewardGranted).toBe(false);
  await provider().settle(event(first));
  expect((await orders().createCheckoutOrder(c)).status).toBe("settled");
  const second = await orders().createCheckoutOrder(
    command((await quote()).id),
  );
  await provider().settle(event(second));
  const a = await stored(first.id),
    b = await stored(second.id);
  expect(new Date(String(b.residency_starts_at)).getTime()).toBe(
    new Date(String(a.residency_ends_at)).getTime(),
  );
  expect(
    new Date(String(a.residency_ends_at)).getTime() -
      new Date(String(a.residency_starts_at)).getTime(),
  ).toBe(7776000000);
  const facts = (
    await database.db.execute(
      sql`select (select count(*)::int from expert_first_residency_settlements where expert_id=${owner.expertId}::uuid) markers,(select count(*)::int from expert_referral_reward_grants where expert_id=${inviter.expertId}::uuid) rewards,(select count(*)::int from expert_referral_reward_maturities where invitee_expert_id=${owner.expertId}::uuid and matures_at=settled_at+interval '30 days') maturities`,
    )
  ).rows[0];
  expect(facts).toEqual({ markers: 1, rewards: 0, maturities: 1 });
  await provider().reverse(event(first, "refunded"));
  await provider().reverse(event(first, "refunded"));
  expect((await orders().createCheckoutOrder(c)).status).toBe("refunded");
  expect(
    (
      await database.db.execute(
        sql`select status from expert_referral_reward_maturities where qualifying_order_id=${first.id}::uuid`,
      )
    ).rows,
  ).toEqual([{ status: "cancelled" }]);
});

it.each(["user", "tariff"] as const)(
  "rereads changed %s after an observed authority-lock wait",
  async (kind) => {
    const q = await quote(),
      c = command(q.id);
    const blocker = await database.db.$client.connect();
    await blocker.query("begin");
    const pid = Number(
      (await blocker.query("select pg_backend_pid() pid")).rows[0].pid,
    );
    if (kind === "user")
      await blocker.query("update users set active=false where id=$1", [
        owner.userId,
      ]);
    else
      await blocker.query(
        "update expert_residency_tariff_versions set active_to=clock_timestamp() where id=$1",
        [tariffId],
      );
    const boundary = gate((text) =>
      kind === "user"
        ? text.startsWith("select pg_advisory_xact_lock(")
        : text.includes("from expert_residency_tariff_versions where"),
    );
    const work = orders(boundary.db).createCheckoutOrder(c);
    void work.catch(() => {});
    try {
      await boundary.wait(work);
      boundary.release();
      await observeBlocked(boundary.pid(), pid);
      await blocker.query("commit");
      await expect(work).rejects.toMatchObject({
        code:
          kind === "user"
            ? "EXPERT_CAMPAIGN_OWNER_INELIGIBLE"
            : "EXPERT_CAMPAIGN_TARIFF_INACTIVE",
      });
      expect(await state()).toMatchObject({ orders: 0, reservations: 0 });
    } finally {
      boundary.release();
      await blocker.query("rollback");
      await work.catch(() => {});
      blocker.release();
    }
  },
);

it("excludes credit expiring during a real grant row-lock wait", async () => {
  await credit(1);
  // Only the fixture clock is privileged; the command still has no caller time.
  await database.db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role=replica`);
    await tx.execute(
      sql`with clock as materialized(select date_trunc('milliseconds',clock_timestamp())+interval '2 seconds' deadline) update expert_referral_reward_grants set granted_at=clock.deadline-interval '365 days',expires_at=clock.deadline from clock where expert_id=${owner.expertId}::uuid`,
    );
  });
  const grant = (
    await database.db.execute<{ id: string; expires_at: string }>(
      sql`select id,expires_at from expert_referral_reward_grants where expert_id=${owner.expertId}::uuid`,
    )
  ).rows[0]!;
  const q = await quote();
  const blocker = await database.db.$client.connect();
  await blocker.query("begin");
  await blocker.query(
    "select id from expert_referral_reward_grants where id=$1 for update",
    [grant.id],
  );
  const pid = Number(
    (await blocker.query("select pg_backend_pid() pid")).rows[0].pid,
  );
  const boundary = gate(
    (text) =>
      text.includes("from expert_referral_reward_grants g") &&
      text.endsWith("for update of g"),
  );
  const work = orders(boundary.db).createCheckoutOrder(command(q.id));
  void work.catch(() => {});
  try {
    await boundary.wait(work);
    await until(new Date(grant.expires_at).getTime() - 80);
    boundary.release();
    await observeBlocked(boundary.pid(), pid);
    await until(new Date(grant.expires_at).getTime());
    await blocker.query("commit");
    expect(await work).toMatchObject({
      creditMinor: "0",
      cashMinor: "599400",
      allocations: [],
      paymentDeadline: q.expiresAt,
    });
    expect(await state()).toMatchObject({ orders: 1, reservations: 0 });
  } finally {
    boundary.release();
    await blocker.query("rollback");
    await work.catch(() => {});
    blocker.release();
  }
});

it.each([
  "expert_id",
  "tariff_version_id",
  "campaign_term_months",
  "snapshot_display_name",
  "duration_seconds",
  "credit_cap_bps",
  "individual_services_enabled",
  "group_event_limit",
  "statistics_level",
  "support_priority",
  "provider_deadline",
])("rejects forged source field %s on INSERT", async (field) => {
  const first = await orders().createCheckoutOrder(command((await quote()).id));
  const raw = await stored(first.id),
    q = await quote();
  const changed: Record<string, unknown> = {
    expert_id: (await database.createExpertIdentity()).expertId,
    tariff_version_id: await tariff("START"),
    campaign_term_months: 3,
    snapshot_display_name: "forged",
    duration_seconds: 7776000,
    credit_cap_bps: 0,
    individual_services_enabled: false,
    group_event_limit: 1,
    statistics_level: "basic",
    support_priority: "standard",
    provider_deadline: new Date(Date.parse(q.expiresAt) + 1).toISOString(),
  };
  await sqlDenied(
    insertRaw({
      ...raw,
      id: randomUUID(),
      campaign_quote_id: q.id,
      idempotency_key: randomUUID(),
      created_at: new Date(await serverMs()).toISOString(),
      provider_deadline: q.expiresAt,
      payment_deadline: q.expiresAt,
      [field]: changed[field],
    }),
  );
});

it.each(["legacy_residency_v1", "expert_residency_v2"] as const)(
  "preserves %s predicates and prohibits campaign relabeling",
  async (policy) => {
    const tariffVersionId =
      policy === "expert_residency_v2"
        ? tariffId
        : await tariff(randomUUID(), policy);
    const old = await legacy().createCheckoutOrder({
      expertId: owner.expertId,
      tariffVersionId,
      providerDeadline: new Date(Date.now() + 60000),
      idempotencyKey: randomUUID(),
    });
    const raw = await stored(old.id),
      q = await quote();
    expect(raw.campaign_quote_id).toBeNull();
    expect(raw.campaign_term_months).toBeNull();
    await sqlDenied(
      insertRaw({
        ...raw,
        id: randomUUID(),
        idempotency_key: randomUUID(),
        campaign_term_months: 1,
      }),
    );
    await sqlDenied(
      database.db.execute(
        sql`update expert_residency_orders set commercial_policy_version='expert_campaign_v1',campaign_quote_id=${q.id}::uuid,campaign_term_months=1 where id=${old.id}::uuid`,
      ),
    );
    await database.db.execute(
      sql`update expert_residency_orders set status='failed' where id=${old.id}::uuid`,
    );
  },
);

it("matures a campaign once; concurrent reversal, checkout, settlement and expiry conserve credit", async () => {
  const inviter = owner;
  owner = await referral(inviter);
  const referred = await orders().createCheckoutOrder(
    command((await quote(3)).id),
  );
  await provider().settle(event(referred));
  // Privileged historical eligibility fixture, not a claim that runtime has a clock input.
  await database.db.execute(
    sql`with clock as materialized(select clock_timestamp()-interval '1 second' due) update expert_referral_reward_maturities set settled_at=clock.due-interval '30 days',matures_at=clock.due from clock where qualifying_order_id=${referred.id}::uuid`,
  );
  await database.db.execute(
    sql`update expert_referral_feature_controls set version=version+1,reward_grants_enabled=true where control_key='expert_referrals'`,
  );
  const worker = new PostgresExpertReferralWorkerRepository(database.db);
  const batch = { now: new Date(), batchSize: 10 };
  expect((await worker.grantDueMaturityBatch(batch)).granted).toBe(1);
  expect((await worker.grantDueMaturityBatch(batch)).granted).toBe(0);
  owner = await referral(inviter);
  const secondReferral = await orders().createCheckoutOrder(
    command((await quote()).id),
  );
  await provider().settle(event(secondReferral));
  await database.db.execute(
    sql`with clock as materialized(select clock_timestamp()-interval '1 second' due) update expert_referral_reward_maturities set settled_at=clock.due-interval '30 days',matures_at=clock.due from clock where qualifying_order_id=${secondReferral.id}::uuid`,
  );
  owner = inviter;
  const c = command((await quote()).id);
  const spending = await orders().createCheckoutOrder(c);
  expect(spending.creditMinor).toBe("100000");
  const spendingGrantId = spending.allocations[0]!.grantId;
  // A separate, genuinely allocated grant expires. Reversal targets the first
  // grant, so the due order cannot be vacuously released by that other path.
  await credit(1);
  const dueGrantId = (
    await database.db.execute<{ id: string }>(
      sql`select id from expert_referral_reward_grants where expert_id=${owner.expertId}::uuid and id<>${spendingGrantId}::uuid`,
    )
  ).rows[0]!.id;
  await database.db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role=replica`);
    await tx.execute(
      sql`with clock as materialized(select date_trunc('milliseconds',clock_timestamp())+interval '2 seconds' deadline) update expert_referral_reward_grants set granted_at=clock.deadline-interval '365 days',expires_at=clock.deadline from clock where id=${dueGrantId}::uuid`,
    );
  });
  const dueCommand = command((await quote()).id);
  const dueOrder = await orders().createCheckoutOrder(dueCommand);
  expect(dueOrder).toMatchObject({
    creditMinor: "100000",
    cashMinor: "499400",
    allocations: [{ grantId: dueGrantId, amountMinor: "100000" }],
  });

  type LedgerFact = {
    id: string;
    kind: string;
    amount: string;
    orderId: string | null;
    originalId: string | null;
    sourceType: string;
    sourceId: string;
    key: string;
    allocations: { grantId: string; amountMinor: string }[];
  };
  const readLedger = async () =>
    (
      await database.db.execute<LedgerFact>(
        sql`select e.id,e.entry_kind kind,e.amount_minor::text amount,e.order_id as "orderId",e.original_entry_id as "originalId",e.source_type as "sourceType",e.source_id as "sourceId",e.idempotency_key key,coalesce(jsonb_agg(jsonb_build_object('grantId',a.reward_grant_id,'amountMinor',a.amount_minor::text) order by a.reward_grant_id) filter(where a.reward_grant_id is not null),'[]'::jsonb) allocations from expert_referral_ledger_entries e left join expert_referral_ledger_allocations a on a.ledger_entry_id=e.id where e.expert_id=${owner.expertId}::uuid group by e.id order by e.idempotency_key`,
      )
    ).rows;
  const before = await readLedger();
  expect(before).toHaveLength(4);
  const reservation = (orderId: string) =>
    before.find((e) => e.kind === "reservation" && e.orderId === orderId)!;
  const spendingReservation = reservation(spending.id),
    dueReservation = reservation(dueOrder.id);
  const originalReward = before.find(
    (e) => e.kind === "reward_grant" && e.sourceId === spendingGrantId,
  )!;
  const originalGrant = (
    await database.db.execute<{
      first_settlement_id: string;
      maturity_id: string;
    }>(
      sql`select first_settlement_id,maturity_id from expert_referral_reward_grants where id=${spendingGrantId}::uuid`,
    )
  ).rows[0]!;
  const secondMaturityId = (
    await database.db.execute<{ id: string }>(
      sql`select id from expert_referral_reward_maturities where qualifying_order_id=${secondReferral.id}::uuid`,
    )
  ).rows[0]!.id;
  for (const [order, request, grantId] of [
    [spending, c, spendingGrantId],
    [dueOrder, dueCommand, dueGrantId],
  ] as const) {
    expect(reservation(order.id)).toMatchObject({
      kind: "reservation",
      amount: "-100000",
      orderId: order.id,
      originalId: null,
      sourceType: "residency_order",
      sourceId: order.id,
      key: `checkout:${owner.expertId}:${request.idempotencyKey}`,
      allocations: [{ grantId, amountMinor: "-100000" }],
    });
    expect(
      before.find((e) => e.kind === "reward_grant" && e.sourceId === grantId),
    ).toMatchObject({
      amount: "100000",
      orderId: null,
      originalId: null,
      sourceType: "reward_grant",
      allocations: [{ grantId, amountMinor: "100000" }],
    });
  }
  expect(originalReward.key).toBe(`reward-ledger:${originalGrant.maturity_id}`);
  const next = command((await quote()).id);
  await until(Date.parse(dueOrder.paymentDeadline) + 1);
  expect(
    (
      await database.db.execute(
        sql`select status='payment_pending' and clock_timestamp()>=payment_deadline due from expert_residency_orders where id=${dueOrder.id}::uuid`,
      )
    ).rows,
  ).toEqual([{ due: true }]);
  const expiryGate = gate((text) =>
    text.startsWith("update expert_residency_orders set status='expired'"),
  );
  const replayGate = gate(
    (text) =>
      text.includes("from expert_residency_orders where expert_id=") &&
      text.endsWith("for update"),
  );
  const expiryWork = new PostgresExpertResidencyRepository(
    expiryGate.db,
  ).releaseExpiredOrders();
  void expiryWork.catch(() => {});
  let replayWork:
    | ReturnType<PostgresExpertCampaignOrderRepository["createCheckoutOrder"]>
    | undefined;
  const concurrent = await (async () => {
    try {
      // Worker already holds the due order FOR UPDATE before its real expiry
      // statement. The replay must submit real SQL and be observed blocked.
      await expiryGate.wait(expiryWork);
      replayWork = orders(replayGate.db).createCheckoutOrder(dueCommand);
      void replayWork.catch(() => {});
      await replayGate.wait(replayWork);
      replayGate.release();
      await observeBlocked(replayGate.pid(), expiryGate.pid());
      const running = Promise.allSettled([
        orders().createCheckoutOrder(next),
        provider().settle(event(spending)),
        provider().reverse(event(referred, "refunded")),
        expiryWork,
        worker.grantDueMaturityBatch(batch),
        replayWork,
      ] as const);
      expiryGate.release();
      return await running;
    } finally {
      expiryGate.release();
      replayGate.release();
      await Promise.allSettled([expiryWork, replayWork]);
    }
  })();
  const [checkout, settlement, reversal, expiry, maturity, replay] = concurrent;
  if (checkout.status === "rejected")
    expect(checkout.reason).toMatchObject({
      code: "EXPERT_CAMPAIGN_CONTENTION",
    });
  // Existing settlement/reversal workers may serialize differently. Non-checkout
  // failures must be bounded transactional contention, never arbitrary errors.
  for (const result of [settlement, reversal, maturity])
    if (result.status === "rejected")
      expect(
        result === settlement
          ? ["40001", "40P01", "55P03", "EXPERT_RESIDENCY_CREDIT_INVALIDATED"]
          : ["40001", "40P01", "55P03"],
      ).toContain(code(result.reason));
  expect(expiry).toEqual({
    status: "fulfilled",
    value: { examined: 1, released: 1 },
  });
  expect((await stored(dueOrder.id)).status).toBe("expired");
  if (replay.status === "fulfilled")
    expect(replay.value).toEqual({ ...dueOrder, status: "expired" });
  else
    expect(replay.reason).toMatchObject({ code: "EXPERT_CAMPAIGN_CONTENTION" });

  // Build the entire expected ledger from the seeded 100000 grants and the
  // committed command outcomes, NOT from actual entry/allocation sums.
  const after = await readLedger();
  const withoutId = ({ id, ...fact }: LedgerFact) => {
    expect(id).toEqual(expect.any(String));
    return fact;
  };
  const expected: Omit<LedgerFact, "id">[] = before.map(withoutId);
  const add = (
    kind: string,
    amount: bigint,
    orderId: string | null,
    originalId: string | null,
    sourceType: string,
    sourceId: string,
    key: string,
    grantId: string,
  ) =>
    expected.push({
      kind,
      amount: amount.toString(),
      orderId,
      originalId,
      sourceType,
      sourceId,
      key,
      allocations: [{ grantId, amountMinor: amount.toString() }],
    });
  add(
    "release",
    100000n,
    dueOrder.id,
    dueReservation.id,
    "residency_order",
    dueOrder.id,
    `release:${dueReservation.id}`,
    dueGrantId,
  );
  const settled = settlement.status === "fulfilled",
    reversed = reversal.status === "fulfilled";
  const invalidatedPayment =
    settlement.status === "rejected" &&
    code(settlement.reason) === "EXPERT_RESIDENCY_CREDIT_INVALIDATED";
  if (invalidatedPayment) expect(reversed).toBe(true);
  if (settled) {
    expect(settlement.value).toMatchObject({
      kind: "settled",
      orderId: spending.id,
      rewardGranted: false,
    });
    add(
      "release",
      100000n,
      spending.id,
      spendingReservation.id,
      "residency_settlement",
      spending.id,
      `settlement-release:${spendingReservation.id}`,
      spendingGrantId,
    );
    add(
      "spend",
      -100000n,
      spending.id,
      spendingReservation.id,
      "residency_settlement",
      spending.id,
      `settlement-spend:${spendingReservation.id}`,
      spendingGrantId,
    );
  }
  if (reversed) {
    expect(reversal.value).toMatchObject({
      kind: "refunded",
      orderId: referred.id,
      cashRefundedMinor: BigInt(referred.cashMinor),
      restoredCreditMinor: 0n,
      rewardReversed: true,
      terminated: true,
    });
    // This is the reversal transaction's historical debt, not the final
    // balance: the concurrent due-order release may commit before or after it.
    expect(settled ? [0n, 100000n] : [0n]).toContain(reversal.value.debtMinor);
    add(
      "reversal",
      -100000n,
      null,
      originalReward.id,
      "provider_reversal",
      referred.id,
      `reward-reversal:${originalGrant.first_settlement_id}`,
      spendingGrantId,
    );
    if (!settled)
      add(
        "release",
        100000n,
        spending.id,
        spendingReservation.id,
        "provider_reversal",
        referred.id,
        `refund-release:${originalGrant.first_settlement_id}:${spendingReservation.id}`,
        spendingGrantId,
      );
  }
  const newGrants = (
    await database.db.execute<{ id: string; amount: string; key: string }>(
      sql`select id,amount_minor::text amount,idempotency_key key from expert_referral_reward_grants where maturity_id=${secondMaturityId}::uuid`,
    )
  ).rows;
  if (maturity.status === "fulfilled") {
    expect(maturity.value).toEqual({
      examined: 1,
      granted: 1,
      cancelled: 0,
      pending: 0,
    });
    // There are exactly two legitimate serialized outcomes: a new 100000
    // grant, or repayment of the first grant's 100000 reversal. Never both.
    if (newGrants.length === 1) {
      const g = newGrants[0]!;
      expect(g).toMatchObject({
        amount: "100000",
        key: `reward:${secondMaturityId}`,
      });
      add(
        "reward_grant",
        100000n,
        null,
        null,
        "reward_grant",
        g.id,
        `reward-ledger:${secondMaturityId}`,
        g.id,
      );
    } else {
      expect(newGrants).toEqual([]);
      expect(reversed).toBe(true);
      const reverseId = after.find(
        (e) => e.key === `reward-reversal:${originalGrant.first_settlement_id}`,
      )!.id;
      add(
        "debt_repayment",
        100000n,
        null,
        reverseId,
        "matured_referral",
        secondMaturityId,
        `reward-debt:${secondMaturityId}:${spendingGrantId}`,
        spendingGrantId,
      );
    }
  } else expect(newGrants).toEqual([]);
  const grantIds = [spendingGrantId, dueGrantId, ...newGrants.map((g) => g.id)];
  expect(
    (
      await database.db.execute<{ id: string; amount: string }>(
        sql`select id,amount_minor::text amount from expert_referral_reward_grants where expert_id=${owner.expertId}::uuid order by id`,
      )
    ).rows,
  ).toEqual(grantIds.sort().map((id) => ({ id, amount: "100000" })));
  expect(
    (
      await database.db.execute(
        sql`select status from expert_referral_reward_maturities where id=${secondMaturityId}::uuid`,
      )
    ).rows,
  ).toEqual([
    { status: maturity.status === "fulfilled" ? "granted" : "pending" },
  ]);
  if (checkout.status === "fulfilled") {
    const o = checkout.value;
    expect(["0", "100000"]).toContain(o.creditMinor);
    expect(o).toMatchObject({
      quoteId: next.quoteId,
      expertId: owner.expertId,
      priceMinor: "599400",
      cashMinor: (599400n - BigInt(o.creditMinor)).toString(),
      status: "payment_pending",
    });
    expect(await stored(o.id)).toMatchObject({
      idempotency_key: next.idempotencyKey,
      credit_minor: o.creditMinor,
      cash_minor: o.cashMinor,
      status: "payment_pending",
    });
    if (o.creditMinor === "0") expect(o.allocations).toEqual([]);
    else {
      expect(o.allocations).toHaveLength(1);
      const a = o.allocations[0]!;
      expect(a.amountMinor).toBe("100000");
      if (a.grantId === spendingGrantId) {
        // The initial reservation consumed all of A. Only reversal release
        // followed by maturity repayment can make A reservable again, and a
        // successful settlement must not also consume that same credit.
        expect({
          reversed,
          settled,
          matured: maturity.status,
          newGrants: newGrants.length,
        }).toEqual({
          reversed: true,
          settled: false,
          matured: "fulfilled",
          newGrants: 0,
        });
      } else {
        expect(maturity.status).toBe("fulfilled");
        expect(newGrants).toHaveLength(1);
        expect(a.grantId).toBe(newGrants[0]!.id);
      }
      add(
        "reservation",
        -100000n,
        o.id,
        null,
        "residency_order",
        o.id,
        `checkout:${owner.expertId}:${next.idempotencyKey}`,
        a.grantId,
      );
    }
  } else
    expect(
      (
        await database.db.execute(
          sql`select id from expert_residency_orders where expert_id=${owner.expertId}::uuid and idempotency_key=${next.idempotencyKey}`,
        )
      ).rows,
    ).toEqual([]);
  // Exact key/amount/source/original/grant mapping catches an extra reservation
  // even if the erroneous entry and allocation totals agree with one another.
  const byKey = (a: { key: string }, b: { key: string }) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  expect(after.map(withoutId).sort(byKey)).toEqual(expected.sort(byKey));
  expect(new Set(after.map((e) => e.key)).size).toBe(after.length);
  expect(
    after.filter(
      (e) => e.kind === "release" && e.originalId === dueReservation.id,
    ),
  ).toHaveLength(1);
  expect(
    after.filter(
      (e) => e.kind === "release" && e.originalId === spendingReservation.id,
    ),
  ).toHaveLength(settled || reversed ? 1 : 0);

  const kinds = [
    "reward_grant",
    "reservation",
    "release",
    "spend",
    "reversal",
    "debt_repayment",
    "expiry",
  ] as const;
  const expectedByGrant = grantIds.map((grantId) => {
    const totals = Object.fromEntries(
      kinds.map((kind) => [
        kind,
        expected
          .filter((e) => e.kind === kind)
          .flatMap((e) => e.allocations)
          .filter((a) => a.grantId === grantId)
          .reduce((sum, a) => sum + BigInt(a.amountMinor), 0n)
          .toString(),
      ]),
    );
    return {
      grantId,
      ...totals,
      net: Object.values(totals)
        .reduce((sum, v) => sum + BigInt(v), 0n)
        .toString(),
    };
  });
  const actualByGrant = (
    await database.db.execute(sql`select g.id as "grantId",
    coalesce(sum(a.amount_minor) filter(where e.entry_kind='reward_grant'),0)::text reward_grant,
    coalesce(sum(a.amount_minor) filter(where e.entry_kind='reservation'),0)::text reservation,
    coalesce(sum(a.amount_minor) filter(where e.entry_kind='release'),0)::text release,
    coalesce(sum(a.amount_minor) filter(where e.entry_kind='spend'),0)::text spend,
    coalesce(sum(a.amount_minor) filter(where e.entry_kind='reversal'),0)::text reversal,
    coalesce(sum(a.amount_minor) filter(where e.entry_kind='debt_repayment'),0)::text debt_repayment,
    coalesce(sum(a.amount_minor) filter(where e.entry_kind='expiry'),0)::text expiry,
    coalesce(sum(a.amount_minor),0)::text net
    from expert_referral_reward_grants g left join expert_referral_ledger_allocations a on a.reward_grant_id=g.id left join expert_referral_ledger_entries e on e.id=a.ledger_entry_id where g.expert_id=${owner.expertId}::uuid group by g.id order by g.id`)
  ).rows;
  expect(actualByGrant).toEqual(expectedByGrant);
  const net = expected.reduce((sum, e) => sum + BigInt(e.amount), 0n),
    debt = net < 0n ? -net : 0n;
  const live = expectedByGrant
    .filter((g) => g.grantId !== dueGrantId)
    .reduce((sum, g) => sum + BigInt(g.net), 0n);
  const reserved = -expected
    .filter((e) => e.kind === "reservation" || e.kind === "release")
    .reduce((sum, e) => sum + BigInt(e.amount), 0n);
  expect(await legacy().balance(owner.expertId)).toMatchObject({
    availableCreditMinor: (live > debt ? live - debt : 0n).toString(),
    reservedCreditMinor: reserved.toString(),
    debtMinor: debt.toString(),
  });
  expect(
    expected
      .filter((e) => e.kind === "spend")
      .reduce((sum, e) => sum - BigInt(e.amount), 0n),
  ).toBe(settled ? 100000n : 0n);
  const snapshot = await stored(spending.id);
  expect(snapshot).toMatchObject({
    credit_minor: "100000",
    cash_minor: "499400",
    status: settled ? "settled" : reversed ? "failed" : "payment_pending",
  });
  expect((await stored(referred.id)).status).toBe(
    reversed ? "refunded" : "settled",
  );
  expect(
    (
      await database.db.execute(
        sql`select expected_amount_minor::text amount,status from expert_residency_payment_attempts where order_id=${spending.id}::uuid`,
      )
    ).rows,
  ).toEqual(settled ? [{ amount: "499400", status: "settled" }] : []);
  for (const [orderId, kind, fulfilled] of [
    [spending.id, "settled", settled],
    [referred.id, "refunded", reversed],
  ] as const)
    expect(
      (
        await database.db.execute(
          sql`select status from expert_residency_provider_event_inbox where order_id=${orderId}::uuid and event_kind=${kind}`,
        )
      ).rows,
    ).toEqual(
      fulfilled
        ? [{ status: "processed" }]
        : orderId === spending.id && invalidatedPayment
          ? [{ status: "rejected" }]
          : [],
    );
  expect(
    (
      await database.db.execute(
        sql`select reason_code,status from integration_errors where reason_code='expert_residency_paid_after_credit_invalidation'`,
      )
    ).rows,
  ).toEqual(
    invalidatedPayment
      ? [
          {
            reason_code: "expert_residency_paid_after_credit_invalidation",
            status: "open",
          },
        ]
      : [],
  );
  // Replaying committed commands must preserve every entry ID and allocation.
  if (checkout.status === "fulfilled")
    expect(await orders().createCheckoutOrder(next)).toEqual(checkout.value);
  if (settled) await provider().settle(event(spending));
  if (reversed) await provider().reverse(event(referred, "refunded"));
  if (maturity.status === "fulfilled")
    expect((await worker.grantDueMaturityBatch(batch)).examined).toBe(0);
  expect((await orders().createCheckoutOrder(dueCommand)).status).toBe(
    "expired",
  );
  expect(await legacy().releaseExpiredOrders()).toEqual({
    examined: 0,
    released: 0,
  });
  expect(await readLedger()).toEqual(after);
}, 15000);

it("replays after quote expiry as expired, without releasing twice or reopening consumption", async () => {
  await database.db.execute(
    sql`update expert_residency_tariff_versions set active_to=date_trunc('milliseconds',clock_timestamp())+interval '500 milliseconds' where id=${tariffId}::uuid`,
  );
  const q = await quote(),
    c = command(q.id);
  const o = await orders().createCheckoutOrder(c);
  await until(Date.parse(q.expiresAt));
  expect(await orders().createCheckoutOrder(c)).toEqual({
    ...o,
    status: "expired",
  });
  expect(await orders().createCheckoutOrder(c)).toEqual({
    ...o,
    status: "expired",
  });
  await expect(
    orders().createCheckoutOrder(command(q.id)),
  ).rejects.toMatchObject({ code: "QUOTE_ALREADY_USED" });
  expect(await state()).toEqual({ orders: 1, reservations: 0, releases: 0 });
});

it("keeps new checkout fail-closed under feature disable", async () => {
  const c = command((await quote()).id);
  await database.db.execute(
    sql`update expert_referral_feature_controls set version=version+1,new_commands_enabled=false where control_key='expert_referrals'`,
  );
  await expect(orders().createCheckoutOrder(c)).rejects.toMatchObject({
    code: "EXPERT_CAMPAIGN_DISABLED",
  });
  expect(await state()).toMatchObject({ orders: 0, reservations: 0 });
});

it("rejects replay by a newly assigned expert owner who does not own the immutable quote", async () => {
  const c = command((await quote()).id);
  await orders().createCheckoutOrder(c);
  const newUserId = await database.createUser();
  await database.db.execute(
    sql`update experts set user_id=${newUserId}::uuid where id=${owner.expertId}::uuid`,
  );
  const before = await state();
  await expect(
    orders().createCheckoutOrder({ ...c, userId: newUserId }),
  ).rejects.toMatchObject({ code: "EXPERT_CAMPAIGN_QUOTE_UNAVAILABLE" });
  expect(await state()).toEqual(before);
});

it("persists the exact microsecond grant-expiry minimum", async () => {
  await credit(1);
  await database.db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role=replica`);
    await tx.execute(
      sql`with clock as materialized(select date_trunc('milliseconds',clock_timestamp())+interval '1 minute 123 microseconds' deadline) update expert_referral_reward_grants set granted_at=clock.deadline-interval '365 days',expires_at=clock.deadline from clock where expert_id=${owner.expertId}::uuid`,
    );
  });
  const o = await orders().createCheckoutOrder(command((await quote()).id));
  expect(
    (
      await database.db.execute(
        sql`select o.payment_deadline=g.expires_at exact from expert_residency_orders o join expert_referral_reward_grants g on g.expert_id=o.expert_id where o.id=${o.id}::uuid`,
      )
    ).rows,
  ).toEqual([{ exact: true }]);
});

// Credit-invalidation regressions: written before the correction, UNRUN under
// the exhausted 3/3 budget. Real legacy grants fund a real campaign reservation.
async function splitCreditOrder() {
  await credit(2);
  const c = command((await quote()).id);
  const order = await orders().createCheckoutOrder(c);
  expect(order.creditMinor).toBe("179820");
  expect(order.cashMinor).toBe("419580");
  expect(order.allocations.map((a) => a.amountMinor)).toEqual([
    "100000",
    "79820",
  ]);
  const grants = await Promise.all(
    order.allocations.map(async (allocation) => {
      const row = (
        await database.db.execute<{
          id: string;
          cashMinor: string;
          marker: string;
        }>(
          sql`select o.id,o.cash_minor::text as "cashMinor",g.first_settlement_id marker from expert_referral_reward_grants g join expert_first_residency_settlements s on s.id=g.first_settlement_id join expert_residency_orders o on o.id=s.qualifying_order_id where g.id=${allocation.grantId}::uuid`,
        )
      ).rows[0]!;
      return { ...allocation, source: row };
    }),
  );
  const reservationId = (
    await database.db.execute<{ id: string }>(
      sql`select id from expert_referral_ledger_entries where order_id=${order.id}::uuid and entry_kind='reservation'`,
    )
  ).rows[0]!.id;
  return { c, order, grants, reservationId };
}
async function reservationFacts(orderId: string) {
  return (
    await database.db.execute(
      sql`select e.id,e.entry_kind kind,e.amount_minor::text amount,e.original_entry_id original,e.source_type,e.source_id,e.idempotency_key,a.reward_grant_id grant_id,a.amount_minor::text allocation from expert_referral_ledger_entries e join expert_referral_ledger_allocations a on a.ledger_entry_id=e.id where e.order_id=${orderId}::uuid order by e.id,a.reward_grant_id`,
    )
  ).rows;
}
async function supportSession(role = "support") {
  const id = await database.createUser(),
    sessionIdHash = `session:${randomUUID()}`;
  await database.db.execute(
    sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${sessionIdHash},${id}::uuid,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour')`,
  );
  await database.db.execute(
    sql`insert into admin_role_assignments(admin_id,role) values(${id}::uuid,${role})`,
  );
  return sessionIdHash;
}
async function partialRelease(
  f: Awaited<ReturnType<typeof splitCreditOrder>>,
  amount: number,
) {
  // Explicit historical partial-release fixture, not a normal accepted checkout.
  await database.db.transaction(async (tx) => {
    const id = randomUUID();
    await tx.execute(
      sql`insert into expert_referral_ledger_entries(id,expert_id,entry_kind,amount_minor,order_id,original_entry_id,source_type,source_id,idempotency_key) values(${id}::uuid,${owner.expertId}::uuid,'release',${amount},${f.order.id}::uuid,${f.reservationId}::uuid,'provider_reversal',${f.grants[0]!.source.id}::uuid,${`refund-release:${f.grants[0]!.source.marker}:${f.reservationId}`})`,
    );
    await tx.execute(
      sql`insert into expert_referral_ledger_allocations(ledger_entry_id,reward_grant_id,expert_id,amount_minor) values(${id}::uuid,${f.grants[0]!.grantId}::uuid,${owner.expertId}::uuid,${amount})`,
    );
  });
}

it("reversal first invalidates a split-grant order, restores both grants once, and survives second-grant reversal/replay", async () => {
  const f = await splitCreditOrder();
  const result = await provider().reverse(
    event(f.grants[0]!.source, "refunded"),
  );
  expect(result).toMatchObject({ rewardReversed: true, debtMinor: 0n });
  expect(await stored(f.order.id)).toMatchObject({
    status: "failed",
    credit_minor: "179820",
    cash_minor: "419580",
    settled_at: null,
    residency_starts_at: null,
  });
  const facts = await reservationFacts(f.order.id);
  expect(facts.filter((r) => r.kind === "release")).toHaveLength(2);
  for (const a of f.grants)
    expect(
      facts.filter((r) => r.kind === "release" && r.grant_id === a.grantId),
    ).toEqual([
      expect.objectContaining({
        amount: "179820",
        allocation: a.amountMinor,
        original: f.reservationId,
        source_type: "provider_reversal",
        source_id: f.grants[0]!.source.id,
        idempotency_key: `refund-release:${f.grants[0]!.source.marker}:${f.reservationId}`,
      }),
    ]);
  expect(
    new Set(facts.filter((r) => r.kind === "release").map((r) => r.id)).size,
  ).toBe(1);
  expect(await legacy().balance(owner.expertId)).toMatchObject({
    availableCreditMinor: "100000",
    reservedCreditMinor: "0",
    debtMinor: "0",
  });
  await provider().reverse(event(f.grants[1]!.source, "refunded"));
  expect(await legacy().balance(owner.expertId)).toMatchObject({
    availableCreditMinor: "0",
    reservedCreditMinor: "0",
    debtMinor: "0",
  });
  expect(await orders().createCheckoutOrder(f.c)).toEqual({
    ...f.order,
    status: "failed",
  });
  expect(await legacy().releaseExpiredOrders()).toEqual({
    examined: 0,
    released: 0,
  });
  await provider().reverse(event(f.grants[0]!.source, "refunded"));
  expect(await reservationFacts(f.order.id)).toEqual(facts);
});

it("settlement first keeps split-grant residency and attributes exact debt without a refund release", async () => {
  const f = await splitCreditOrder();
  await provider().settle(event(f.order));
  const paid = await stored(f.order.id);
  const facts = await reservationFacts(f.order.id);
  expect(facts.filter((r) => r.kind === "release")).toHaveLength(2);
  expect(
    facts
      .filter((r) => r.kind === "spend")
      .map((r) => r.allocation)
      .sort(),
  ).toEqual(["-100000", "-79820"]);
  await provider().reverse(event(f.grants[0]!.source, "refunded"));
  expect(await legacy().balance(owner.expertId)).toMatchObject({
    availableCreditMinor: "0",
    reservedCreditMinor: "0",
    debtMinor: "79820",
  });
  await provider().reverse(event(f.grants[1]!.source, "refunded"));
  expect(await legacy().balance(owner.expertId)).toMatchObject({
    availableCreditMinor: "0",
    reservedCreditMinor: "0",
    debtMinor: "179820",
  });
  expect(await stored(f.order.id)).toEqual(paid);
  expect(await reservationFacts(f.order.id)).toEqual(facts);
  await provider().settle(event(f.order));
  expect(await reservationFacts(f.order.id)).toEqual(facts);
});

it("completes a historical partial release per grant without hiding the remaining reservation", async () => {
  const f = await splitCreditOrder();
  await partialRelease(f, 40000);
  await provider().reverse(event(f.grants[0]!.source, "refunded"));
  expect((await stored(f.order.id)).status).toBe("failed");
  const facts = await reservationFacts(f.order.id);
  expect(
    facts
      .filter((r) => r.kind === "release")
      .map((r) => [r.amount, r.allocation])
      .sort(),
  ).toEqual([
    ["139820", "60000"],
    ["139820", "79820"],
    ["40000", "40000"],
  ]);
  expect(await legacy().balance(owner.expertId)).toMatchObject({
    availableCreditMinor: "100000",
    reservedCreditMinor: "0",
    debtMinor: "0",
  });
  await provider().reverse(event(f.grants[1]!.source, "refunded"));
  expect(await reservationFacts(f.order.id)).toEqual(facts);
});

it("fails closed on an over-released original allocation without committing reversal or cancellation", async () => {
  const f = await splitCreditOrder();
  await partialRelease(f, 100001);
  const before = await reservationFacts(f.order.id);
  await expect(
    provider().reverse(event(f.grants[0]!.source, "refunded")),
  ).rejects.toMatchObject({
    code: "EXPERT_RESIDENCY_CREDIT_ALLOCATION_INVALID",
  });
  expect((await stored(f.order.id)).status).toBe("payment_pending");
  expect((await stored(f.grants[0]!.source.id)).status).toBe("settled");
  expect(await reservationFacts(f.order.id)).toEqual(before);
});

it("retains payment after credit invalidation with exact protected binding and replay after support resolution", async () => {
  const f = await splitCreditOrder();
  await provider().reverse(event(f.grants[0]!.source, "refunded"));
  const facts = await reservationFacts(f.order.id),
    input = event(f.order);
  await expect(provider().settle(input)).rejects.toMatchObject({
    code: "EXPERT_RESIDENCY_CREDIT_INVALIDATED",
  });
  const inbox = (
    await database.db.execute(
      sql`select * from expert_residency_provider_event_inbox where order_id=${f.order.id}::uuid`,
    )
  ).rows;
  expect(inbox).toHaveLength(1);
  expect(inbox[0]).toMatchObject({
    authenticated: true,
    status: "rejected",
    result_code: "EXPERT_RESIDENCY_CREDIT_INVALIDATED",
    provider: input.provider,
    external_event_id: input.eventId,
    payment_id: input.paymentId,
    amount_minor: "419580",
    currency: "RUB",
    verification_id: input.verificationId,
  });
  const errors = (
    await database.db.execute(sql`select * from integration_errors`)
  ).rows;
  expect(errors).toHaveLength(1);
  const errorId = String(errors[0]!.id);
  expect(errors[0]).toMatchObject({
    reason_code: "expert_residency_paid_after_credit_invalidation",
    status: "open",
  });
  const admin = new PostgresAdminRepository(database.db),
    auth = await supportSession();
  expect(
    await admin.listLatePayments({ sessionIdHash: auth, limit: 10 }),
  ).toMatchObject({
    allowed: true,
    items: [
      {
        id: errorId,
        reasonCode: "expert_residency_paid_after_credit_invalidation",
      },
    ],
  });
  expect(
    await admin.getLatePayment({ sessionIdHash: auth, errorId }),
  ).toMatchObject({
    allowed: true,
    item: {
      inboxId: inbox[0]!.id,
      orderId: f.order.id,
      amountMinor: 419580,
      currency: "RUB",
      provider: input.provider,
      paymentId: input.paymentId,
    },
  });
  for (const sessionIdHash of [
    "missing",
    await supportSession("catalog_admin"),
  ]) {
    expect(
      await admin.listLatePayments({ sessionIdHash, limit: 10 }),
    ).toMatchObject({ allowed: false });
    expect(
      await admin.getLatePayment({ sessionIdHash, errorId }),
    ).toMatchObject({ allowed: false });
  }
  const stale = await supportSession();
  await database.db.execute(
    sql`update admin_sessions set mfa_verified_at=clock_timestamp()-interval '1 hour' where session_id_hash=${stale}`,
  );
  expect(
    await admin.getLatePayment({ sessionIdHash: stale, errorId }),
  ).toMatchObject({ allowed: false });
  expect(
    await admin.listLatePayments({ sessionIdHash: stale, limit: 10 }),
  ).toMatchObject({ allowed: false });
  // A known but wrong exception reason cannot cross-bind this verified fact.
  const crossId = randomUUID();
  await database.db.execute(
    sql`insert into integration_errors(id,provider,reason_code,metadata_hash) values(${crossId}::uuid,'expert_residency','expert_residency_paid_after_deadline',${errors[0]!.metadata_hash})`,
  );
  expect(
    await admin.getLatePayment({ sessionIdHash: auth, errorId: crossId }),
  ).toMatchObject({ allowed: true, item: null });
  const approvals = new PostgresAdminApprovalRepository(database.db),
    nonce = `nonce:${randomUUID()}`;
  const request = await approvals.requestApproval({
    sessionIdHash: auth,
    action: "integration_error.resolve",
    objectType: "integration_error",
    objectId: errorId,
    payload: { errorId },
    nonce,
  });
  expect(
    await approvals.approveApproval({
      sessionIdHash: await supportSession(),
      approvalId: request!.approvalId,
    }),
  ).toBe(true);
  expect(
    await admin.resolveIntegrationError({
      sessionIdHash: auth,
      approvalId: request!.approvalId,
      nonce,
      correlationId: randomUUID(),
      errorId,
    }),
  ).toMatchObject({ allowed: true });
  await expect(provider().settle(input)).rejects.toMatchObject({
    code: "EXPERT_RESIDENCY_CREDIT_INVALIDATED",
  });
  expect(
    (
      await database.db.execute(
        sql`select id,status from integration_errors where reason_code='expert_residency_paid_after_credit_invalidation'`,
      )
    ).rows,
  ).toEqual([{ id: errorId, status: "resolved" }]);
  expect((await stored(f.order.id)).status).toBe("failed");
  expect(await reservationFacts(f.order.id)).toEqual(facts);
  expect(
    (
      await database.db.execute(
        sql`select id from expert_residency_payment_attempts where order_id=${f.order.id}::uuid`,
      )
    ).rows,
  ).toEqual([]);
});

it("payment really blocked by reversal retains its fact after the consuming order becomes failed", async () => {
  const f = await splitCreditOrder();
  const reversing = gate((text) =>
    text.startsWith("update expert_residency_orders set status='failed'"),
  );
  const paying = gate((text) =>
    text.startsWith("insert into expert_residency_provider_event_inbox"),
  );
  const reversal = new PostgresExpertResidencyProviderInboxRepository(
    reversing.db,
  ).reverse(event(f.grants[0]!.source, "refunded"));
  void reversal.catch(() => {});
  let payment: Promise<unknown> | undefined;
  try {
    await reversing.wait(reversal);
    payment = new PostgresExpertResidencyProviderInboxRepository(
      paying.db,
    ).settle(event(f.order));
    void payment.catch(() => {});
    await paying.wait(payment);
    paying.release();
    await observeBlocked(paying.pid(), reversing.pid());
    reversing.release();
    await reversal;
    await expect(payment).rejects.toMatchObject({
      code: "EXPERT_RESIDENCY_CREDIT_INVALIDATED",
    });
  } finally {
    reversing.release();
    paying.release();
    await Promise.allSettled([reversal, payment]);
  }
  expect((await stored(f.order.id)).status).toBe("failed");
  const facts = await reservationFacts(f.order.id);
  expect(facts.filter((r) => r.kind === "spend")).toEqual([]);
  expect(
    facts
      .filter((r) => r.kind === "release")
      .map((r) => r.allocation)
      .sort(),
  ).toEqual(["100000", "79820"]);
  expect(
    (
      await database.db.execute(
        sql`select status,result_code,amount_minor::text amount from expert_residency_provider_event_inbox where order_id=${f.order.id}::uuid`,
      )
    ).rows,
  ).toEqual([
    {
      status: "rejected",
      result_code: "EXPERT_RESIDENCY_CREDIT_INVALIDATED",
      amount: "419580",
    },
  ]);
  expect(
    (await database.db.execute(sql`select reason_code from integration_errors`))
      .rows,
  ).toEqual([
    { reason_code: "expert_residency_paid_after_credit_invalidation" },
  ]);
});

it("expiry completes a historical partial allocation exactly once without reversing the unaffected grant", async () => {
  const f = await splitCreditOrder();
  await partialRelease(f, 40000);
  // Explicit historical deadline fixture; runtime has no caller clock.
  await database.db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role=replica`);
    await tx.execute(
      sql`update expert_residency_orders set created_at=clock_timestamp()-interval '2 seconds',payment_deadline=clock_timestamp()-interval '1 second' where id=${f.order.id}::uuid`,
    );
  });
  expect(await legacy().releaseExpiredOrders()).toEqual({
    examined: 1,
    released: 1,
  });
  const facts = await reservationFacts(f.order.id);
  expect(
    facts
      .filter((r) => r.kind === "release")
      .map((r) => [r.amount, r.allocation])
      .sort(),
  ).toEqual([
    ["139820", "60000"],
    ["139820", "79820"],
    ["40000", "40000"],
  ]);
  expect(await legacy().balance(owner.expertId)).toMatchObject({
    availableCreditMinor: "200000",
    reservedCreditMinor: "0",
    debtMinor: "0",
  });
  await provider().reverse(event(f.grants[0]!.source, "refunded"));
  expect((await stored(f.order.id)).status).toBe("expired");
  expect(await reservationFacts(f.order.id)).toEqual(facts);
  expect(await legacy().releaseExpiredOrders()).toEqual({
    examined: 0,
    released: 0,
  });
});

it("rejects a release allocated to a grant outside the original reservation", async () => {
  const f = await splitCreditOrder();
  await credit(1);
  const foreign = (
    await database.db.execute<{ id: string }>(
      sql`select id from expert_referral_reward_grants where expert_id=${owner.expertId}::uuid and id not in (${f.grants[0]!.grantId}::uuid,${f.grants[1]!.grantId}::uuid)`,
    )
  ).rows[0]!.id;
  await database.db.transaction(async (tx) => {
    const id = randomUUID();
    await tx.execute(
      sql`insert into expert_referral_ledger_entries(id,expert_id,entry_kind,amount_minor,order_id,original_entry_id,source_type,source_id,idempotency_key) values(${id}::uuid,${owner.expertId}::uuid,'release',1,${f.order.id}::uuid,${f.reservationId}::uuid,'provider_reversal',${f.grants[0]!.source.id}::uuid,${randomUUID()})`,
    );
    await tx.execute(
      sql`insert into expert_referral_ledger_allocations(ledger_entry_id,reward_grant_id,expert_id,amount_minor) values(${id}::uuid,${foreign}::uuid,${owner.expertId}::uuid,1)`,
    );
  });
  const facts = await reservationFacts(f.order.id);
  await expect(
    provider().reverse(event(f.grants[0]!.source, "refunded")),
  ).rejects.toMatchObject({
    code: "EXPERT_RESIDENCY_CREDIT_ALLOCATION_INVALID",
  });
  expect(await reservationFacts(f.order.id)).toEqual(facts);
  expect((await stored(f.order.id)).status).toBe("payment_pending");
});

it("reversal retries its stale pending-order snapshot when settlement commits first", async () => {
  const f = await splitCreditOrder();
  const paying = gate((text) =>
    text.startsWith("update expert_residency_orders set status='settled'"),
  );
  const reversing = gate((text) =>
    text.startsWith('select o.id,o.expert_id as "expertId",o.status'),
  );
  const payment = new PostgresExpertResidencyProviderInboxRepository(
    paying.db,
  ).settle(event(f.order));
  void payment.catch(() => {});
  let reversal: Promise<unknown> | undefined;
  try {
    await paying.wait(payment);
    reversal = new PostgresExpertResidencyProviderInboxRepository(
      reversing.db,
    ).reverse(event(f.grants[0]!.source, "refunded"));
    void reversal.catch(() => {});
    await reversing.wait(reversal);
    paying.release();
    await payment;
    reversing.release();
    await reversal;
    expect(reversing.attempts()).toBeGreaterThanOrEqual(2);
  } finally {
    paying.release();
    reversing.release();
    await Promise.allSettled([payment, reversal]);
  }
  expect((await stored(f.order.id)).status).toBe("settled");
  const facts = await reservationFacts(f.order.id);
  expect(facts.filter((r) => r.source_type === "provider_reversal")).toEqual(
    [],
  );
  expect(
    facts
      .filter((r) => r.kind === "release")
      .map((r) => r.allocation)
      .sort(),
  ).toEqual(["100000", "79820"]);
  expect(
    facts
      .filter((r) => r.kind === "spend")
      .map((r) => r.allocation)
      .sort(),
  ).toEqual(["-100000", "-79820"]);
  expect(await legacy().balance(owner.expertId)).toMatchObject({
    availableCreditMinor: "0",
    reservedCreditMinor: "0",
    debtMinor: "79820",
  });
});

it("reversal retries a checkout allocation phantom and cancels every newly affected pending order", async () => {
  const f = await splitCreditOrder();
  const next = command((await quote()).id);
  const creating = gate((text) =>
    text.startsWith("insert into expert_residency_orders"),
  );
  const reversing = gate((text) =>
    text.startsWith("select id from experts where id in"),
  );
  const checkout = orders(creating.db).createCheckoutOrder(next);
  void checkout.catch(() => {});
  let reversal: Promise<unknown> | undefined;
  try {
    await creating.wait(checkout);
    reversal = new PostgresExpertResidencyProviderInboxRepository(
      reversing.db,
    ).reverse(event(f.grants[1]!.source, "refunded"));
    void reversal.catch(() => {});
    await reversing.wait(reversal);
    creating.release();
    const additional = await checkout;
    expect(additional.allocations).toEqual([
      { grantId: f.grants[1]!.grantId, amountMinor: "20180" },
    ]);
    reversing.release();
    await reversal;
    expect(reversing.attempts()).toBeGreaterThanOrEqual(2);
    expect((await stored(additional.id)).status).toBe("failed");
    expect(
      (await reservationFacts(additional.id)).filter(
        (r) => r.kind === "release",
      ),
    ).toEqual([
      expect.objectContaining({
        amount: "20180",
        allocation: "20180",
        grant_id: f.grants[1]!.grantId,
        source_type: "provider_reversal",
        source_id: f.grants[1]!.source.id,
      }),
    ]);
  } finally {
    creating.release();
    reversing.release();
    await Promise.allSettled([checkout, reversal]);
  }
  expect((await stored(f.order.id)).status).toBe("failed");
  expect(await legacy().balance(owner.expertId)).toMatchObject({
    availableCreditMinor: "100000",
    reservedCreditMinor: "0",
    debtMinor: "0",
  });
});

// P1 repayment-backed cancellation: added before its production correction.
async function repaymentBackedOrders(priorRepayment: 0 | 60000, held: boolean) {
  await credit(1);
  const old = (
    await database.db.execute<{
      id: string;
      cashMinor: string;
      grantId: string;
      rewardId: string;
    }>(sql`
    select o.id,o.cash_minor::text as "cashMinor",g.id as "grantId",e.id as "rewardId"
    from expert_referral_reward_grants g join expert_residency_orders o on o.id=g.qualifying_order_id
    join expert_referral_ledger_entries e on e.source_id=g.id and e.entry_kind='reward_grant'
    where g.expert_id=${owner.expertId}::uuid`)
  ).rows[0]!;
  await provider().reverse(event(old, "refunded"));
  if (priorRepayment) {
    // Explicit historical partial-repayment fixture. No production debt policy
    // is changed: B must repay the remaining40000 and issue only60000 credit.
    await database.db.transaction(async (tx) => {
      const reversal = (
        await tx.execute<{ id: string }>(
          sql`select id from expert_referral_ledger_entries where entry_kind='reversal' and original_entry_id=${old.rewardId}::uuid`,
        )
      ).rows[0]!.id;
      const id = randomUUID();
      await tx.execute(
        sql`insert into expert_referral_ledger_entries(id,expert_id,entry_kind,amount_minor,original_entry_id,source_type,source_id,idempotency_key) values(${id}::uuid,${owner.expertId}::uuid,'debt_repayment',60000,${reversal}::uuid,'historical_repayment_fixture',${randomUUID()}::uuid,${`historical-repayment:${id}`})`,
      );
      await tx.execute(
        sql`insert into expert_referral_ledger_allocations(ledger_entry_id,reward_grant_id,expert_id,amount_minor) values(${id}::uuid,${old.grantId}::uuid,${owner.expertId}::uuid,60000)`,
      );
    });
  }
  const invitee = await referral();
  const version = await tariff(
    `repayment-${randomUUID()}`,
    "legacy_residency_v1",
  );
  const qualifying = await legacy().createCheckoutOrder({
    expertId: invitee.expertId,
    tariffVersionId: version,
    providerDeadline: new Date(Date.now() + 3600000),
    idempotencyKey: randomUUID(),
  });
  if (held)
    await database.db.execute(
      sql`update expert_referral_feature_controls set version=version+1,reward_grants_enabled=false where control_key='expert_referrals'`,
    );
  expect((await provider().settle(event(qualifying))).rewardGranted).toBe(
    !held,
  );
  if (held) {
    await database.db.execute(
      sql`update expert_referral_feature_controls set version=version+1,reward_grants_enabled=true where control_key='expert_referrals'`,
    );
    expect(await provider().replayHeldReward(invitee.expertId)).toMatchObject({
      kind: "granted",
    });
  }
  const markerId = (
    await database.db.execute<{ id: string }>(
      sql`select id from expert_first_residency_settlements where qualifying_order_id=${qualifying.id}::uuid`,
    )
  ).rows[0]!.id;
  const benefit = (
    await database.db.execute<{
      id: string;
      amount: string;
      sourceType: string;
      grantId: string;
    }>(
      sql`select e.id,e.amount_minor::text amount,e.source_type as "sourceType",a.reward_grant_id as "grantId" from expert_referral_ledger_entries e join expert_referral_ledger_allocations a on a.ledger_entry_id=e.id where e.entry_kind='debt_repayment' and e.source_id=${markerId}::uuid`,
    )
  ).rows;
  expect(benefit).toEqual([
    expect.objectContaining({
      amount: priorRepayment ? "40000" : "100000",
      sourceType: held ? "held_reward_replay" : "first_settlement",
      grantId: old.grantId,
    }),
  ]);
  const direct = (
    await database.db.execute<{ id: string; rewardId: string; amount: string }>(
      sql`select g.id,e.id as "rewardId",e.amount_minor::text amount from expert_referral_reward_grants g join expert_referral_ledger_entries e on e.source_id=g.id and e.entry_kind='reward_grant' where g.first_settlement_id=${markerId}::uuid`,
    )
  ).rows;
  expect(direct).toEqual(
    priorRepayment ? [expect.objectContaining({ amount: "60000" })] : [],
  );
  // A separate genuine reward has no connection to B's reversed benefits.
  await credit(1);
  const unaffectedGrant = (
    await database.db.execute<{ id: string }>(
      sql`select id from expert_referral_reward_grants where expert_id=${owner.expertId}::uuid and id<>${old.grantId}::uuid and first_settlement_id<>${markerId}::uuid`,
    )
  ).rows[0]!.id;
  const c = command((await quote()).id),
    pending = await orders().createCheckoutOrder(c);
  expect(pending).toMatchObject({ creditMinor: "179820", cashMinor: "419580" });
  expect(pending.allocations).toEqual(
    priorRepayment
      ? [
          { grantId: old.grantId, amountMinor: "100000" },
          { grantId: direct[0]!.id, amountMinor: "60000" },
          { grantId: unaffectedGrant, amountMinor: "19820" },
        ]
      : [
          { grantId: old.grantId, amountMinor: "100000" },
          { grantId: unaffectedGrant, amountMinor: "79820" },
        ],
  );
  const unrelated = await orders().createCheckoutOrder(
    command((await quote()).id),
  );
  expect(unrelated.allocations).toEqual([
    {
      grantId: unaffectedGrant,
      amountMinor: priorRepayment ? "80180" : "20180",
    },
  ]);
  return {
    old,
    qualifying,
    markerId,
    benefit: benefit[0]!,
    direct,
    unaffectedGrant,
    c,
    pending,
    unrelated,
  };
}

it.each([
  [0, false],
  [0, true],
  [60000, false],
  [60000, true],
] as const)(
  "invalidates repayment-backed reservations (prior repayment=%s, held=%s) with exact benefit reversals and payment evidence",
  async (priorRepayment, held) => {
    const f = await repaymentBackedOrders(priorRepayment, held);
    const original = await stored(f.pending.id);
    const unrelated = await reservationFacts(f.unrelated.id);
    const result = await provider().reverse(event(f.qualifying, "refunded"));
    expect(result).toMatchObject({
      terminated: true,
      rewardReversed: true,
      debtMinor: 0n,
    });
    expect(await stored(f.pending.id)).toMatchObject({
      status: "failed",
      price_minor: original.price_minor,
      credit_minor: "179820",
      cash_minor: "419580",
      settled_at: null,
      residency_starts_at: null,
    });
    expect((await stored(f.unrelated.id)).status).toBe("payment_pending");
    expect(await reservationFacts(f.unrelated.id)).toEqual(unrelated);
    const facts = await reservationFacts(f.pending.id);
    const reservation = facts.find((r) => r.kind === "reservation")!;
    const releases = facts.filter((r) => r.kind === "release");
    expect(releases).toHaveLength(f.pending.allocations.length);
    expect(new Set(releases.map((r) => r.id)).size).toBe(1);
    for (const a of f.pending.allocations)
      expect(releases.find((r) => r.grant_id === a.grantId)).toMatchObject({
        amount: "179820",
        allocation: a.amountMinor,
        original: reservation.id,
        source_type: "provider_reversal",
        source_id: f.qualifying.id,
        idempotency_key: `refund-release:${f.markerId}:${reservation.id}`,
      });
    expect(facts.filter((r) => r.kind === "spend")).toEqual([]);
    const reversed = (
      await database.db.execute(
        sql`select e.idempotency_key key,e.original_entry_id original,e.amount_minor::text amount,e.source_type,e.source_id,a.reward_grant_id grant_id,a.amount_minor::text allocation from expert_referral_ledger_entries e join expert_referral_ledger_allocations a on a.ledger_entry_id=e.id where e.entry_kind='reversal' and e.source_id=${f.qualifying.id}::uuid order by e.idempotency_key`,
      )
    ).rows;
    expect(reversed).toEqual([
      {
        key: `repayment-reversal:${f.benefit.id}`,
        original: f.benefit.id,
        amount: priorRepayment ? "-40000" : "-100000",
        source_type: "provider_reversal",
        source_id: f.qualifying.id,
        grant_id: f.old.grantId,
        allocation: priorRepayment ? "-40000" : "-100000",
      },
      ...(priorRepayment
        ? [
            {
              key: `reward-reversal:${f.markerId}`,
              original: f.direct[0]!.rewardId,
              amount: "-60000",
              source_type: "provider_reversal",
              source_id: f.qualifying.id,
              grant_id: f.direct[0]!.id,
              allocation: "-60000",
            },
          ]
        : []),
    ]);
    const totals = (
      await database.db.execute<{ id: string; amount: string }>(
        sql`select g.id,sum(a.amount_minor)::text amount from expert_referral_reward_grants g join expert_referral_ledger_allocations a on a.reward_grant_id=g.id where g.expert_id=${owner.expertId}::uuid group by g.id order by g.id`,
      )
    ).rows;
    expect(totals).toEqual(
      [
        { id: f.old.grantId, amount: priorRepayment ? "60000" : "0" },
        { id: f.unaffectedGrant, amount: priorRepayment ? "19820" : "79820" },
        ...(priorRepayment ? [{ id: f.direct[0]!.id, amount: "0" }] : []),
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(await legacy().balance(owner.expertId)).toMatchObject({
      availableCreditMinor: "79820",
      reservedCreditMinor: priorRepayment ? "80180" : "20180",
      debtMinor: "0",
    });
    await expect(provider().settle(event(f.pending))).rejects.toMatchObject({
      code: "EXPERT_RESIDENCY_CREDIT_INVALIDATED",
    });
    const error = (
      await database.db.execute<{ id: string }>(
        sql`select id from integration_errors where provider='expert_residency' and reason_code='expert_residency_paid_after_credit_invalidation'`,
      )
    ).rows;
    expect(error).toHaveLength(1);
    expect(
      (
        await database.db.execute(
          sql`select status,result_code,amount_minor::text amount from expert_residency_provider_event_inbox where order_id=${f.pending.id}::uuid and event_kind='settled'`,
        )
      ).rows,
    ).toEqual([
      {
        status: "rejected",
        result_code: "EXPERT_RESIDENCY_CREDIT_INVALIDATED",
        amount: "419580",
      },
    ]);
    expect(
      await new PostgresAdminRepository(database.db).getLatePayment({
        sessionIdHash: await supportSession(),
        errorId: error[0]!.id,
      }),
    ).toMatchObject({
      allowed: true,
      item: {
        orderId: f.pending.id,
        amountMinor: 419580,
        paymentId: event(f.pending).paymentId,
      },
    });
    await provider().reverse(event(f.qualifying, "refunded"));
    await expect(provider().settle(event(f.pending))).rejects.toMatchObject({
      code: "EXPERT_RESIDENCY_CREDIT_INVALIDATED",
    });
    expect(await orders().createCheckoutOrder(f.c)).toEqual({
      ...f.pending,
      status: "failed",
    });
    expect(await reservationFacts(f.pending.id)).toEqual(facts);
    expect(await reservationFacts(f.unrelated.id)).toEqual(unrelated);
    expect(
      (
        await database.db.execute(
          sql`select id from integration_errors where reason_code='expert_residency_paid_after_credit_invalidation'`,
        )
      ).rows,
    ).toEqual(error);
  },
);

it("does not recognize unrelated repayment reversal as failed-order credit-invalidation provenance", async () => {
  const f = await repaymentBackedOrders(0, false);
  await provider().reverse(event(f.qualifying, "refunded"));
  const original = (await reservationFacts(f.unrelated.id)).find(
    (r) => r.kind === "reservation",
  )!;
  // Privileged forged linkage: B really reversed a benefit on A, but this
  // reservation was funded ONLY by D. Same expert/source order is insufficient.
  await database.db.transaction(async (tx) => {
    const id = randomUUID();
    await tx.execute(
      sql`update expert_residency_orders set status='failed' where id=${f.unrelated.id}::uuid`,
    );
    await tx.execute(
      sql`insert into expert_referral_ledger_entries(id,expert_id,entry_kind,amount_minor,order_id,original_entry_id,source_type,source_id,idempotency_key) values(${id}::uuid,${owner.expertId}::uuid,'release',20180,${f.unrelated.id}::uuid,${original.id}::uuid,'provider_reversal',${f.qualifying.id}::uuid,${`forged-unrelated:${id}`})`,
    );
    await tx.execute(
      sql`insert into expert_referral_ledger_allocations(ledger_entry_id,reward_grant_id,expert_id,amount_minor) values(${id}::uuid,${f.unaffectedGrant}::uuid,${owner.expertId}::uuid,20180)`,
    );
  });
  const facts = await reservationFacts(f.unrelated.id);
  await expect(provider().settle(event(f.unrelated))).rejects.toMatchObject({
    code: "EXPERT_RESIDENCY_ORDER_NOT_PENDING",
  });
  expect(
    (
      await database.db.execute(
        sql`select id from expert_residency_provider_event_inbox where order_id=${f.unrelated.id}::uuid`,
      )
    ).rows,
  ).toEqual([]);
  expect(
    (await database.db.execute(sql`select id from integration_errors`)).rows,
  ).toEqual([]);
  expect(await reservationFacts(f.unrelated.id)).toEqual(facts);
});
