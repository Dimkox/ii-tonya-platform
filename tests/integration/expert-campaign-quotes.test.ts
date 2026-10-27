import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DrizzleDb } from "../../packages/db/src/client.js";
import {
  PostgresExpertCampaignQuoteRepository,
  type CreateExpertCampaignQuote,
} from "../../packages/db/src/repositories/expert-campaign-quote-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";

const HOUR = 3_600_000;
const RULE = "expert_energy_start_v1";
let database: ExpertReferralTestDatabase;
let userId: string;
let tariffVersionId: string;
const repository = () => new PostgresExpertCampaignQuoteRepository(database.db);
const command = (
  extra: Partial<CreateExpertCampaignQuote> = {},
): CreateExpertCampaignQuote => ({
  userId,
  tariffVersionId,
  termMonths: 1,
  idempotencyKey: randomUUID(),
  ...extra,
});
async function nowMs() {
  const result = await database.db.execute<{ ms: string }>(
    sql`select floor(extract(epoch from clock_timestamp())*1000)::text ms`,
  );
  return Number(result.rows[0]!.ms);
}
async function counts() {
  return (
    await database.db.execute(sql`select
    (select count(*)::int from expert_campaign_anchors) anchors,
    (select count(*)::int from expert_campaign_quotes) quotes,
    (select count(*)::int from expert_residency_orders) orders,
    (select count(*)::int from expert_referral_ledger_entries) ledger,
    (select count(*)::int from integration_outbox) outbox`)
  ).rows[0];
}
async function anchor(timestamp: number) {
  await database.db
    .execute(sql`insert into expert_campaign_anchors(user_id,rule_version,calculation_timestamp)
    values(${userId}::uuid,${RULE},${new Date(timestamp).toISOString()}::timestamptz)`);
}
async function tariff(key = "PRO") {
  return database.createResidencyTariff({
    tariffKey: key,
    displayName: key,
    priceMinor: 999000,
    durationSeconds: 2592000,
  });
}
// Historical immutable facts are fixtures only: the runtime command has no clock input.
async function historical(elapsed: number, term = 1, quotedAt?: number) {
  const issue = quotedAt ?? (await nowMs());
  const start = issue - elapsed;
  await anchor(start);
  const energy =
    elapsed < 72 * HOUR
      ? 4000
      : elapsed < 144 * HOUR
        ? 3000
        : elapsed < 216 * HOUR
          ? 2000
          : 0;
  const extra =
    term === 3
      ? elapsed < 72 * HOUR
        ? 1500
        : elapsed < 144 * HOUR
          ? 1000
          : 0
      : 0;
  const monthly =
    term === 3
      ? energy === 4000
        ? 509490
        : 629370
      : (
          { 4000: 599400, 3000: 699300, 2000: 799200, 0: 999000 } as Record<
            number,
            number
          >
        )[energy]!;
  const boundary =
    elapsed < 72 * HOUR
      ? start + 72 * HOUR
      : elapsed < 144 * HOUR
        ? start + 144 * HOUR
        : elapsed < 216 * HOUR
          ? start + 216 * HOUR
          : Infinity;
  return {
    id: randomUUID(),
    user_id: userId,
    tariff_version_id: tariffVersionId,
    idempotency_key: randomUUID(),
    rule_version: RULE,
    calculation_timestamp: new Date(start).toISOString(),
    quoted_at: new Date(issue).toISOString(),
    expires_at: new Date(Math.min(issue + 900000, boundary)).toISOString(),
    term_months: term,
    duration_seconds: 2592000 * term,
    base_monthly_minor: "999000",
    discounted_monthly_minor: String(monthly),
    monthly_price_minor: String(monthly),
    price_minor: String(monthly * term),
    currency: "RUB",
    energy_discount_bps: energy,
    start_discount_bps: extra,
    floor_applied: false,
    display_name: "Про",
    credit_cap_bps: 3000,
    individual_services_enabled: true,
    group_event_limit: 3,
    statistics_level: "expanded",
    support_priority: "priority",
  };
}
async function insertFact(fact: object) {
  await database.db.execute(
    sql`insert into expert_campaign_quotes select (jsonb_populate_record(null::expert_campaign_quotes,${JSON.stringify(fact)}::jsonb)).*`,
  );
}
function pgCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? pgCode(error.cause) : undefined;
}
async function deniedSql(action: Promise<unknown>, codes = ["23514"]) {
  const outcome = await action.then(() => "accepted", pgCode);
  expect(codes).toContain(outcome);
}

// This gate identifies the real backend BEFORE submitting its authority SQL.
// Releasing it is NOT proof of contention: observeBlocked below must see the
// original SQL waiting on the blocker, which stays open until that observation.
function gateBeforeAuthority(
  db: DrizzleDb,
  boundary: "tariff" | "subject" = "tariff",
) {
  let release!: () => void;
  let reached!: () => void;
  const paused = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const resume = new Promise<void>((resolve) => {
    release = resolve;
  });
  const dialect = new PgDialect();
  let used = false;
  let transactionStartedAtMs = Number.NaN;
  let backendPid = 0;
  const gated = new Proxy(db, {
    get(target, property) {
      if (property === "transaction")
        return (
          callback: Parameters<DrizzleDb["transaction"]>[0],
          config?: Parameters<DrizzleDb["transaction"]>[1],
        ) =>
          target.transaction(
            (tx) =>
              callback(
                new Proxy(tx, {
                  get(transaction, key) {
                    if (key === "execute")
                      return async (
                        query: Parameters<typeof tx.execute>[0],
                      ) => {
                        const text =
                          typeof query === "string"
                            ? query
                            : dialect.sqlToQuery(query.getSQL()).sql;
                        const matches =
                          boundary === "subject"
                            ? /pg_advisory_xact_lock/iu.test(text)
                            : /from expert_residency_tariff_versions/iu.test(
                                text,
                              ) && /for share/iu.test(text);
                        if (!used && matches) {
                          used = true;
                          const started = await transaction.execute<{
                            ms: string;
                            pid: number;
                          }>(
                            sql`select floor(extract(epoch from transaction_timestamp())*1000)::text ms,pg_backend_pid() pid`,
                          );
                          transactionStartedAtMs = Number(started.rows[0]!.ms);
                          backendPid = started.rows[0]!.pid;
                          reached();
                          await resume;
                        }
                        return transaction.execute(query);
                      };
                    const value: unknown = Reflect.get(transaction, key);
                    return typeof value === "function"
                      ? value.bind(transaction)
                      : value;
                  },
                }),
              ),
            config,
          );
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    db: gated,
    release,
    get transactionStartedAtMs() {
      return transactionStartedAtMs;
    },
    get backendPid() {
      return backendPid;
    },
    async wait(work: Promise<unknown>) {
      await Promise.race([
        paused,
        work.then(() => {
          throw new Error("completed before authority boundary");
        }),
      ]);
    },
  };
}

async function observeBlocked(
  observer: Pick<DrizzleDb["$client"], "query">,
  waiterPid: number,
  blockerPid: number,
  work: Promise<unknown>,
) {
  // Dedicated AUTOCOMMIT observer: no transaction-local statistics snapshot and
  // no short pg_stat_activity query-text window. The blocker remains held for
  // this entire bounded observation, and both the edge and waiting lock are required.
  const ended = work.then(() => {
    throw new Error("consumer completed before observed lock wait");
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await Promise.race([
      observer.query<{ blocked: boolean; waiting: boolean; ms: string }>(
        `select $1::int=any(pg_blocking_pids($2::int)) as blocked,
        exists(select 1 from pg_locks where pid=$2::int and not granted) as waiting,
        floor(extract(epoch from clock_timestamp())*1000)::text ms`,
        [blockerPid, waiterPid],
      ),
      ended,
    ]);
    const state = result.rows[0]!;
    if (state.blocked && state.waiting) return Number(state.ms);
    await Promise.race([delay(10), ended]);
  }
  throw new Error("real backend lock wait was not observed");
}

describe("immutable expert campaign quotes (PG17.5)", () => {
  beforeAll(async () => {
    database = await startExpertReferralTestDatabase();
    expect(
      (await database.db.execute(sql`show server_version_num`)).rows[0]
        ?.server_version_num,
    ).toBe("170005");
  });
  afterAll(async () => {
    await database?.stop();
  });
  beforeEach(async () => {
    await database.reset();
    userId = await database.createUser();
    tariffVersionId = await tariff();
  });

  it("saves the literal PRO snapshot, restarts and replays canonical UUIDs without monetary effects", async () => {
    const input = command();
    const quote = await repository().createQuote(input);
    expect(quote).toMatchObject({
      userId,
      tariffVersionId,
      ruleVersion: RULE,
      termMonths: 1,
      durationSeconds: 2592000,
      baseMonthlyMinor: "999000",
      discountedMonthlyMinor: "599400",
      monthlyPriceMinor: "599400",
      priceMinor: "599400",
      currency: "RUB",
      energyDiscountBps: 4000,
      startDiscountBps: 0,
      floorApplied: false,
      displayName: "Про",
      creditCapBps: 3000,
      individualServicesEnabled: true,
      groupEventLimit: 3,
      statisticsLevel: "expanded",
      supportPriority: "priority",
    });
    expect(quote.calculationTimestamp).toBe(quote.quotedAt);
    expect(Date.parse(quote.expiresAt) - Date.parse(quote.quotedAt)).toBe(
      900000,
    );
    expect(quote.quotedAt).toMatch(/\.\d{3}Z$/u);
    expect(
      await repository().createQuote({
        ...input,
        userId: userId.toUpperCase(),
        tariffVersionId: tariffVersionId.toUpperCase(),
      }),
    ).toEqual(quote);
    expect(await counts()).toEqual({
      anchors: 1,
      quotes: 1,
      orders: 0,
      ledger: 0,
      outbox: 0,
    });
    expect(
      (
        await database.db.execute(
          sql`select id from experts where user_id=${userId}::uuid`,
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("applies the monthly floor before multiplying the three-month term", async () => {
    const start = await tariff("START");
    expect(
      await repository().createQuote(
        command({ tariffVersionId: start, termMonths: 3 }),
      ),
    ).toMatchObject({
      baseMonthlyMinor: "390000",
      discountedMonthlyMinor: "198900",
      monthlyPriceMinor: "500000",
      priceMinor: "1500000",
      floorApplied: true,
      startDiscountBps: 1500,
      durationSeconds: 7776000,
      groupEventLimit: 0,
    });
  });
  it("rejects changed term or tariff on an existing key", async () => {
    const input = command();
    await repository().createQuote(input);
    await expect(
      repository().createQuote({ ...input, termMonths: 3 }),
    ).rejects.toMatchObject({ code: "EXPERT_CAMPAIGN_IDEMPOTENCY_CONFLICT" });
    await expect(
      repository().createQuote({
        ...input,
        tariffVersionId: await tariff("BASE"),
      }),
    ).rejects.toMatchObject({ code: "EXPERT_CAMPAIGN_IDEMPOTENCY_CONFLICT" });
    expect(await counts()).toMatchObject({ anchors: 1, quotes: 1 });
  });
  it("serializes different-key first requests onto one never-reset anchor", async () => {
    const quotes = await Promise.all([
      repository().createQuote(command()),
      repository().createQuote(command()),
    ]);
    expect(quotes[0]!.id).not.toBe(quotes[1]!.id);
    expect(quotes[0]!.calculationTimestamp).toBe(
      quotes[1]!.calculationTimestamp,
    );
    await database.db.execute(
      sql`insert into experts(user_id) values(${userId}::uuid)`,
    );
    expect(
      (await repository().createQuote(command())).calculationTimestamp,
    ).toBe(quotes[0]!.calculationTimestamp);
    expect(await counts()).toMatchObject({ anchors: 1, quotes: 3 });
  });
  it("serializes a same-key race to one quote", async () => {
    const input = command();
    const quotes = await Promise.all([
      repository().createQuote(input),
      repository().createQuote(input),
    ]);
    expect(quotes[0]).toEqual(quotes[1]);
    expect(await counts()).toMatchObject({ anchors: 1, quotes: 1 });
  });
  it.each([
    null,
    [],
    {},
    { termMonths: "3" },
    { termMonths: 2 },
    { userId: "bad" },
    { tariffVersionId: "bad" },
    { idempotencyKey: " " },
    { idempotencyKey: "valid-key\n" },
    { userId: `${randomUUID()}\n` },
    { now: 0 },
    { priceMinor: "1" },
    { calculationTimestamp: 0 },
  ])("denies malformed command %j before any writes", async (invalid) => {
    const input =
      invalid === null || Array.isArray(invalid)
        ? invalid
        : { ...command(), ...invalid };
    // Empty object is a genuinely missing-input case, not the valid default command.
    const actual =
      invalid !== null &&
      !Array.isArray(invalid) &&
      Object.keys(invalid).length === 0
        ? {}
        : input;
    await expect(
      repository().createQuote(actual as CreateExpertCampaignQuote),
    ).rejects.toMatchObject({ code: "EXPERT_CAMPAIGN_INVALID_INPUT" });
    expect(await counts()).toMatchObject({ anchors: 0, quotes: 0 });
  });
  it("denies inactive and missing users, including otherwise valid replay", async () => {
    const input = command();
    await repository().createQuote(input);
    await database.db.execute(
      sql`update users set active=false where id=${userId}::uuid`,
    );
    for (const request of [
      input,
      command(),
      command({ userId: randomUUID() }),
    ]) {
      await expect(repository().createQuote(request)).rejects.toMatchObject({
        code: "EXPERT_CAMPAIGN_USER_INACTIVE",
      });
    }
    expect(await counts()).toMatchObject({ anchors: 1, quotes: 1 });
  });
  it.each(["missing", "expired", "future", "legacy"])(
    "denies %s tariff without creating an anchor",
    async (kind) => {
      if (kind === "expired")
        await database.db.execute(
          sql`update expert_residency_tariff_versions set active_to=clock_timestamp()-interval '1 minute' where id=${tariffVersionId}::uuid`,
        );
      if (kind === "future")
        await database.db.execute(
          sql`update expert_residency_tariff_versions set active_from=clock_timestamp()+interval '1 minute' where id=${tariffVersionId}::uuid`,
        );
      if (kind === "legacy")
        tariffVersionId = await database.createResidencyTariff({
          tariffKey: "legacy",
          displayName: "Legacy",
          priceMinor: 100000,
          durationSeconds: 2592000,
          commercialPolicyVersion: "legacy_residency_v1",
        });
      await expect(
        repository().createQuote(
          command({
            tariffVersionId:
              kind === "missing" ? randomUUID() : tariffVersionId,
          }),
        ),
      ).rejects.toMatchObject({ code: "EXPERT_CAMPAIGN_TARIFF_INACTIVE" });
      expect(await counts()).toMatchObject({ anchors: 0, quotes: 0 });
    },
  );
  it.each([
    [72 * HOUR - 1, 4000, 599400],
    [72 * HOUR, 3000, 699300],
    [72 * HOUR + 1, 3000, 699300],
    [144 * HOUR - 1, 3000, 699300],
    [144 * HOUR, 2000, 799200],
    [144 * HOUR + 1, 2000, 799200],
    [216 * HOUR - 1, 2000, 799200],
    [216 * HOUR, 0, 999000],
    [216 * HOUR + 1, 0, 999000],
  ])(
    "enforces exact historical boundary %i in SQL",
    async (elapsed, energy, price) => {
      const fact = await historical(elapsed);
      await insertFact(fact);
      expect(fact.energy_discount_bps).toBe(energy);
      expect(fact.price_minor).toBe(String(price));
      await deniedSql(
        insertFact({
          ...fact,
          id: randomUUID(),
          idempotency_key: randomUUID(),
          energy_discount_bps: energy === 4000 ? 3000 : 4000,
        }),
      );
    },
  );
  it("recalculates with the old anchor and denies three months after hour144", async () => {
    await anchor((await nowMs()) - 145 * HOUR);
    expect(await repository().createQuote(command())).toMatchObject({
      energyDiscountBps: 2000,
      priceMinor: "799200",
    });
    await expect(
      repository().createQuote(command({ termMonths: 3 })),
    ).rejects.toMatchObject({ code: "EXPERT_CAMPAIGN_TERM_UNAVAILABLE" });
    expect(await counts()).toMatchObject({ anchors: 1, quotes: 1 });
  });
  it("caps validity at the next stage and tariff end without resetting the anchor", async () => {
    const start = (await nowMs()) - 72 * HOUR + 300000;
    await anchor(start);
    const first = await repository().createQuote(command());
    expect(Date.parse(first.expiresAt)).toBe(start + 72 * HOUR);
    const end = (await nowMs()) + 60000;
    await database.db.execute(
      sql`update expert_residency_tariff_versions set active_to=${new Date(end).toISOString()}::timestamptz where id=${tariffVersionId}::uuid`,
    );
    expect(
      Date.parse((await repository().createQuote(command())).expiresAt),
    ).toBe(end);
  });
  it("replays an expired quote after retirement but denies a new key", async () => {
    const fact = await historical(0, 1, (await nowMs()) - HOUR);
    await insertFact(fact);
    const input = command({ idempotencyKey: fact.idempotency_key });
    const before = await repository().createQuote(input);
    expect(before.id).toBe(fact.id);
    expect(before.expiresAt).toBe(fact.expires_at);
    await database.db.execute(
      sql`update expert_residency_tariff_versions set active_to=clock_timestamp()-interval '1 second' where id=${tariffVersionId}::uuid`,
    );
    expect(await repository().createQuote(input)).toEqual(before);
    await expect(repository().createQuote(command())).rejects.toMatchObject({
      code: "EXPERT_CAMPAIGN_TARIFF_INACTIVE",
    });
    expect(await counts()).toMatchObject({ anchors: 1, quotes: 1 });
  });
  it("floors a fractional tariff end and uses 15 minutes after the final Energy stage", async () => {
    await anchor((await nowMs()) - 217 * HOUR);
    const first = await repository().createQuote(command());
    expect(first).toMatchObject({
      energyDiscountBps: 0,
      startDiscountBps: 0,
      priceMinor: "999000",
    });
    expect(Date.parse(first.expiresAt) - Date.parse(first.quotedAt)).toBe(
      900000,
    );
    const end = (await nowMs()) + 60000;
    const fractional = new Date(end).toISOString().replace("Z", "789Z");
    await database.db.execute(
      sql`update expert_residency_tariff_versions set active_to=${fractional}::timestamptz where id=${tariffVersionId}::uuid`,
    );
    const second = await repository().createQuote(command());
    expect(Date.parse(second.expiresAt)).toBe(end);
    expect(second.calculationTimestamp).toBe(first.calculationTimestamp);
  });
  it.each([
    [72 * HOUR - 1, 1500, "509490"],
    [72 * HOUR, 1000, "629370"],
    [144 * HOUR - 1, 1000, "629370"],
  ])(
    "pins the three-month Start boundary at %i",
    async (elapsed, start, monthly) => {
      const fact = await historical(Number(elapsed), 3);
      expect(fact.start_discount_bps).toBe(start);
      expect(fact.monthly_price_minor).toBe(monthly);
      await insertFact(fact);
      await deniedSql(
        insertFact({
          ...fact,
          id: randomUUID(),
          idempotency_key: randomUUID(),
          start_discount_bps: start === 1500 ? 1000 : 1500,
        }),
      );
    },
  );
  it.each([
    {
      base_monthly_minor: "1000000",
      discounted_monthly_minor: "600000",
      monthly_price_minor: "600000",
      price_minor: "600000",
    },
    { energy_discount_bps: 3000 },
    { start_discount_bps: 1500 },
    { term_months: 2 },
    { duration_seconds: 1 },
    { price_minor: "599401" },
    { price_minor: "1000000000000" },
    { base_monthly_minor: "9223372036854775807" },
    { monthly_price_minor: "1" },
    { floor_applied: true },
    { currency: "USD" },
    { rule_version: "invented" },
    { display_name: "forged" },
    { credit_cap_bps: 9999 },
    { individual_services_enabled: false },
    { group_event_limit: 2 },
    { statistics_level: "basic" },
    { support_priority: "standard" },
    { quoted_at: "infinity" },
    { expires_at: "infinity" },
    { idempotency_key: " " },
  ])("rejects SQL snapshot forgery %j", async (patch) => {
    const fact = await historical(0);
    await deniedSql(insertFact({ ...fact, ...patch }), ["23514", "23503"]);
  });
  it("rejects microseconds, wrong anchor, zero/extended validity and pre-anchor issue", async () => {
    const fact = await historical(0);
    for (const patch of [
      { quoted_at: fact.quoted_at.replace("Z", "001Z") },
      { expires_at: fact.quoted_at },
      { expires_at: new Date(Date.parse(fact.expires_at) + 1).toISOString() },
      {
        calculation_timestamp: new Date(
          Date.parse(fact.calculation_timestamp) - 1,
        ).toISOString(),
      },
      {
        quoted_at: new Date(
          Date.parse(fact.calculation_timestamp) - 1,
        ).toISOString(),
      },
    ])
      await deniedSql(insertFact({ ...fact, ...patch }), ["23514", "23503"]);
  });
  it("rejects late three-month SQL snapshots even if arithmetic is consistent", async () => {
    const fact = await historical(144 * HOUR);
    await deniedSql(
      insertFact({
        ...fact,
        term_months: 3,
        duration_seconds: 7776000,
        price_minor: String(799200 * 3),
      }),
    );
  });
  it("makes both facts append-only and preserves exact anchor/source FKs", async () => {
    const fact = await historical(0);
    await insertFact(fact);
    for (const query of [
      sql`update expert_campaign_quotes set price_minor=price_minor`,
      sql`delete from expert_campaign_quotes`,
      sql`update expert_campaign_anchors set calculation_timestamp=calculation_timestamp`,
      sql`delete from expert_campaign_anchors`,
    ]) {
      await deniedSql(database.db.execute(query), ["23514", "55000"]);
    }
    await deniedSql(
      insertFact({
        ...fact,
        id: randomUUID(),
        idempotency_key: randomUUID(),
        tariff_version_id: randomUUID(),
      }),
      ["23503", "23514"],
    );
  });
  it("rolls back the first anchor when quote insertion fails, exposing only a typed code", async () => {
    await database.db.execute(
      sql`create function test_reject_campaign_quote() returns trigger language plpgsql as $$ begin raise exception 'synthetic secret must not escape'; end $$`,
    );
    await database.db.execute(
      sql`create trigger test_reject_campaign_quote before insert on expert_campaign_quotes for each row execute function test_reject_campaign_quote()`,
    );
    try {
      await expect(repository().createQuote(command())).rejects.toMatchObject({
        code: "EXPERT_CAMPAIGN_STORAGE",
        message: "EXPERT_CAMPAIGN_STORAGE",
      });
      expect(await counts()).toMatchObject({ anchors: 0, quotes: 0 });
    } finally {
      await database.db.execute(
        sql`drop trigger test_reject_campaign_quote on expert_campaign_quotes`,
      );
      await database.db.execute(
        sql`drop function test_reject_campaign_quote()`,
      );
    }
  });
  it("checks applicability after the source wait, not transaction start", async () => {
    const gate = gateBeforeAuthority(database.db);
    const blocker = await database.db.$client.connect();
    const observer = await database.db.$client.connect();
    let work: Promise<unknown> | undefined;
    try {
      await blocker.query("begin");
      await blocker.query(
        "select id from expert_residency_tariff_versions where id=$1 for update",
        [tariffVersionId],
      );
      work = new PostgresExpertCampaignQuoteRepository(gate.db).createQuote(
        command(),
      );
      await gate.wait(work);
      const blockerPid = (
        await blocker.query<{ pid: number }>("select pg_backend_pid() pid")
      ).rows[0]!.pid;
      gate.release(); // Submit the real FOR SHARE while FOR UPDATE is still held.
      await observeBlocked(observer, gate.backendPid, blockerPid, work);
      // Competing source retirement commits only AFTER a real wait. Establish
      // a still-future endpoint within this statement, then cross it while held.
      const retirement = await blocker.query<{ end_ms: string }>(
        `update expert_residency_tariff_versions
         set active_to=date_trunc('milliseconds',clock_timestamp())+interval '100 milliseconds'
         where id=$1 returning (extract(epoch from active_to)*1000)::text end_ms`,
        [tariffVersionId],
      );
      const end = Number(retirement.rows[0]!.end_ms);
      expect(gate.transactionStartedAtMs).toBeLessThan(end);
      await blocker.query(
        "select pg_sleep(greatest(0,($1::numeric+2-extract(epoch from clock_timestamp())*1000)/1000)::double precision)",
        [end],
      );
      await blocker.query("commit");
      await expect(work).rejects.toMatchObject({
        code: "EXPERT_CAMPAIGN_TARIFF_INACTIVE",
      });
      expect(await counts()).toMatchObject({ anchors: 0, quotes: 0 });
    } finally {
      gate.release();
      await blocker.query("rollback");
      await work?.catch(() => undefined);
      observer.release();
      blocker.release();
    }
  });
  it("uses the later stage after a real transaction boundary wait", async () => {
    // Seed before checkout owns the subject lock: the anchor INSERT trigger
    // participates in the same authority as the real quote writer.
    const boundary = Date.now() + 1000;
    await anchor(boundary - 72 * HOUR);
    const gate = gateBeforeAuthority(database.db);
    const blocker = await database.db.$client.connect();
    const observer = await database.db.$client.connect();
    let work:
      | ReturnType<PostgresExpertCampaignQuoteRepository["createQuote"]>
      | undefined;
    try {
      await blocker.query("begin");
      await blocker.query(
        "select id from expert_residency_tariff_versions where id=$1 for update",
        [tariffVersionId],
      );
      work = new PostgresExpertCampaignQuoteRepository(gate.db).createQuote(
        command({ termMonths: 3 }),
      );
      await gate.wait(work);
      const blockerPid = (
        await blocker.query<{ pid: number }>("select pg_backend_pid() pid")
      ).rows[0]!.pid;
      gate.release();
      await observeBlocked(observer, gate.backendPid, blockerPid, work);
      // Cross the preseeded historical stage only after proving the real wait.
      expect(gate.transactionStartedAtMs).toBeLessThan(boundary);
      await blocker.query(
        "select pg_sleep(greatest(0,($1::numeric+2-extract(epoch from clock_timestamp())*1000)/1000)::double precision)",
        [boundary],
      );
      await blocker.query("commit");
      const quote = await work;
      expect(Date.parse(quote.quotedAt)).toBeGreaterThanOrEqual(boundary);
      expect(quote).toMatchObject({
        energyDiscountBps: 3000,
        startDiscountBps: 1000,
        monthlyPriceMinor: "629370",
        priceMinor: "1888110",
      });
      expect(Date.parse(quote.calculationTimestamp)).toBe(boundary - 72 * HOUR);
      expect(await counts()).toMatchObject({
        anchors: 1,
        quotes: 1,
        orders: 0,
        ledger: 0,
        outbox: 0,
      });
    } finally {
      gate.release();
      await blocker.query("rollback");
      await work?.catch(() => undefined);
      observer.release();
      blocker.release();
    }
  });
  it("denies a user deactivated by competing subject authority before quote admission", async () => {
    const gate = gateBeforeAuthority(database.db, "subject");
    const blocker = await database.db.$client.connect();
    const observer = await database.db.$client.connect();
    let work: Promise<unknown> | undefined;
    try {
      await blocker.query("begin");
      await blocker.query("lock table consent_document_versions in share mode");
      await blocker.query(
        "select pg_advisory_xact_lock(hashtextextended($1::uuid::text,0))",
        [userId],
      );
      work = new PostgresExpertCampaignQuoteRepository(gate.db).createQuote(
        command(),
      );
      await gate.wait(work);
      const blockerPid = (
        await blocker.query<{ pid: number }>("select pg_backend_pid() pid")
      ).rows[0]!.pid;
      gate.release();
      await observeBlocked(observer, gate.backendPid, blockerPid, work);
      await blocker.query("update users set active=false where id=$1", [
        userId,
      ]);
      await blocker.query("commit");
      await expect(work).rejects.toMatchObject({
        code: "EXPERT_CAMPAIGN_USER_INACTIVE",
      });
      expect(await counts()).toMatchObject({
        anchors: 0,
        quotes: 0,
        orders: 0,
        ledger: 0,
        outbox: 0,
      });
    } finally {
      gate.release();
      await blocker.query("rollback");
      await work?.catch(() => undefined);
      observer.release();
      blocker.release();
    }
  });
});
