import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";
import { PostgresClientPaidOrderRepository } from "./client-paid-order-repository.js";

describe("client paid settlement on PostgreSQL", () => {
  let fixture: TestDatabase;
  let repository: PostgresClientPaidOrderRepository;
  beforeAll(async () => {
    fixture = await startTestPostgres();
    await fixture.migrate();
    repository = new PostgresClientPaidOrderRepository(fixture.db);
    const version = await fixture.db.execute<{ version: string }>(
      sql`select current_setting('server_version') as version`,
    );
    expect(version.rows[0]?.version).toMatch(/^17\.5/);
  });
  afterAll(async () => {
    await fixture?.stop();
  });

  async function order(mode: "live" | "test" = "live", packageCode = "start") {
    return repository.createOrder({
      userId: await fixture.createUser(),
      packageCode,
      mode,
      idempotencyKey: randomUUID(),
    });
  }
  async function payment(
    mode: "live" | "test" = "live",
    packageCode = "start",
    amountMinor = 499900n,
  ) {
    const purchase = await order(mode, packageCode);
    const providerPaymentId = randomUUID();
    await repository.bindPayment({ orderId: purchase.id, providerPaymentId });
    return {
      orderId: purchase.id,
      providerPaymentId,
      metadataOrderId: purchase.id,
      amountMinor,
      currency: "RUB",
      mode,
      status: "succeeded",
      paid: true,
      capturedAt: new Date(purchase.createdAt.getTime() + 1000),
    };
  }
  async function facts(orderId: string) {
    const result = await fixture.db.execute<{
      packages: number;
      coupons: number;
      settlements: number;
      ledger: number;
    }>(sql`
      select (select count(*)::int from message_packages where grant_idempotency_key = ${`client-paid:${orderId}`}) as packages,
      (select count(*)::int from client_coupon_grants where order_id = ${orderId}::uuid) as coupons,
      (select count(*)::int from client_paid_settlements where order_id = ${orderId}::uuid) as settlements,
      (select count(*)::int from message_ledger_entries where idempotency_key = ${`client-paid:${orderId}`}) as ledger
    `);
    return result.rows[0];
  }
  it("freezes server terms and serializes duplicate creation without crossing users", async () => {
    const command = {
      userId: await fixture.createUser(),
      packageCode: "start",
      mode: "live" as const,
      idempotencyKey: randomUUID(),
    };
    const [first, second] = await Promise.all([
      repository.createOrder(command),
      repository.createOrder(command),
    ]);
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      priceMinor: 499900n,
      units: 500,
      couponGrantMinor: 999800n,
      currency: "RUB",
      policyVersion: "client_paid_v1",
    });
    for (const patch of [{ packageCode: "base" }, { mode: "test" as const }]) {
      await expect(
        repository.createOrder({ ...command, ...patch }),
      ).rejects.toThrow("CLIENT_PAID_CONFLICT");
    }
    expect(
      (
        await repository.createOrder({
          ...command,
          userId: await fixture.createUser(),
        })
      ).id,
    ).not.toBe(first.id);
    for (const packageCode of ["base", "deep", "maximum"]) {
      expect(
        (
          await repository.createOrder({
            ...command,
            packageCode,
            idempotencyKey: randomUUID(),
          })
        ).packageCode,
      ).toBe(packageCode);
    }
  });
  it("binds immutably and prevents reuse across orders and modes", async () => {
    const first = await order();
    const providerPaymentId = randomUUID();
    const command = { orderId: first.id, providerPaymentId };
    const bindings = await Promise.all([
      repository.bindPayment(command),
      repository.bindPayment(command),
    ]);
    expect(bindings[0]).toEqual(bindings[1]);
    await expect(
      repository.bindPayment({ ...command, providerPaymentId: randomUUID() }),
    ).rejects.toThrow("CLIENT_PAID_CONFLICT");
    await expect(
      repository.bindPayment({
        orderId: (await order("test")).id,
        providerPaymentId,
      }),
    ).rejects.toThrow("CLIENT_PAID_CONFLICT");
  });
  it.each(["different payments, same order", "same payment, different orders"])(
    "allows exactly one simultaneous conflicting binding: %s",
    async (scenario) => {
      const first = {
        orderId: (await order()).id,
        providerPaymentId: randomUUID(),
      };
      const second =
        scenario === "different payments, same order"
          ? { ...first, providerPaymentId: randomUUID() }
          : { ...first, orderId: (await order()).id };
      const results = await Promise.allSettled([
        repository.bindPayment(first),
        repository.bindPayment(second),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      const winner = results.find((result) => result.status === "fulfilled");
      const loser = results.find((result) => result.status === "rejected");
      if (winner?.status !== "fulfilled" || loser?.status !== "rejected") {
        throw new Error("expected exactly one binding winner and one conflict");
      }
      expect(loser.reason).toMatchObject({ code: "CLIENT_PAID_CONFLICT" });
      const stored = await fixture.db.execute<{
        order_id: string;
        provider_payment_id: string;
      }>(sql`
        select order_id, provider_payment_id from client_paid_payment_bindings
        where order_id in (${first.orderId}::uuid, ${second.orderId}::uuid)
      `);
      expect(stored.rows).toEqual([
        {
          order_id: winner.value.orderId,
          provider_payment_id: winner.value.providerPaymentId,
        },
      ]);
      expect(await repository.bindPayment(winner.value)).toEqual(winner.value);
    },
  );
  it("snapshots payment Date and primitive fields before asynchronous work", async () => {
    const command = await payment();
    const original = {
      ...command,
      capturedAt: new Date(command.capturedAt.getTime()),
    };
    const pending = repository.settleVerifiedPayment(command);
    command.capturedAt.setTime(0);
    Object.assign(command, {
      orderId: randomUUID(),
      metadataOrderId: randomUUID(),
      providerPaymentId: randomUUID(),
      amountMinor: 1n,
      currency: "USD",
      mode: "test",
      status: "canceled",
      paid: false,
    });
    const settled = await pending;
    expect(settled).toMatchObject({
      orderId: original.orderId,
      providerPaymentId: original.providerPaymentId,
      capturedAt: original.capturedAt,
    });
    expect(await repository.settleVerifiedPayment(original)).toEqual(settled);
    expect(await facts(original.orderId)).toEqual({
      packages: 1,
      coupons: 1,
      settlements: 1,
      ledger: 1,
    });
    expect(await facts(command.orderId)).toEqual({
      packages: 0,
      coupons: 0,
      settlements: 0,
      ledger: 0,
    });
  });
  it.each([
    { packageCode: "start", priceMinor: 499900n, units: 500, coupon: "999800" },
    {
      packageCode: "base",
      priceMinor: 599900n,
      units: 1000,
      coupon: "1199800",
    },
    {
      packageCode: "deep",
      priceMinor: 799900n,
      units: 1500,
      coupon: "1599800",
    },
    {
      packageCode: "maximum",
      priceMinor: 1099000n,
      units: 2000,
      coupon: "2198000",
    },
  ])(
    "commits $packageCode facts exactly once with payment-anchored expiry and stable replay",
    async ({ packageCode, priceMinor, units, coupon }) => {
      const command = await payment("live", packageCode, priceMinor);
      const results = await Promise.all([
        repository.settleVerifiedPayment(command),
        repository.settleVerifiedPayment(command),
        repository.settleVerifiedPayment(command),
      ]);
      expect(results[1]).toEqual(results[0]);
      expect(results[2]).toEqual(results[0]);
      expect(await facts(command.orderId)).toEqual({
        packages: 1,
        coupons: 1,
        settlements: 1,
        ledger: 1,
      });
      const result = results[0]!;
      const rows = await fixture.db.execute<{
        units: number;
        delta: number;
        package_expiry: string;
        coupon_expiry: string;
        coupon: string;
      }>(sql`
      select p.granted_messages as units, l.delta, p.expires_at as package_expiry, c.expires_at as coupon_expiry, c.amount_minor::text as coupon
      from client_paid_settlements s join message_packages p on p.id=s.package_id
      join message_ledger_entries l on l.id=s.ledger_entry_id join client_coupon_grants c on c.id=s.coupon_grant_id
      where s.id=${result.id}::uuid`);
      const stored = rows.rows[0]!;
      expect({
        ...stored,
        package_expiry: new Date(stored.package_expiry),
        coupon_expiry: new Date(stored.coupon_expiry),
      }).toEqual({
        units,
        delta: units,
        coupon,
        package_expiry: new Date(command.capturedAt.getTime() + 60 * 86400000),
        coupon_expiry: new Date(command.capturedAt.getTime() + 45 * 86400000),
      });
      for (const patch of [
        { capturedAt: new Date(command.capturedAt.getTime() + 1) },
        { amountMinor: 1n },
        { paid: false },
      ]) {
        await expect(
          repository.settleVerifiedPayment({ ...command, ...patch }),
        ).rejects.toThrow("CLIENT_PAID_CONFLICT");
      }
      expect(await facts(command.orderId)).toEqual({
        packages: 1,
        coupons: 1,
        settlements: 1,
        ledger: 1,
      });
    },
  );
  it("rejects every mismatched provider field and all sandbox settlement", async () => {
    const command = await payment();
    for (const patch of [
      { amountMinor: 499899n },
      { currency: "USD" },
      { mode: "test" as const },
      { metadataOrderId: randomUUID() },
      { providerPaymentId: randomUUID() },
      { status: "pending" },
      { status: "canceled" },
      { paid: false },
      { capturedAt: new Date(0) },
      { capturedAt: new Date(NaN) },
      { capturedAt: new Date(8640000000000000) },
      { capturedAt: undefined },
      { orderId: "bad" },
      { providerPaymentId: "" },
      { amountMinor: -1n },
    ]) {
      await expect(
        repository.settleVerifiedPayment({ ...command, ...patch } as Parameters<
          typeof repository.settleVerifiedPayment
        >[0]),
      ).rejects.toThrow(/CLIENT_PAID_(INVALID|CONFLICT)/);
    }
    expect(await facts(command.orderId)).toEqual({
      packages: 0,
      coupons: 0,
      settlements: 0,
      ledger: 0,
    });
    const sandbox = await payment("test");
    await expect(repository.settleVerifiedPayment(sandbox)).rejects.toThrow(
      "CLIENT_PAID_CONFLICT",
    );
    expect(await facts(sandbox.orderId)).toEqual({
      packages: 0,
      coupons: 0,
      settlements: 0,
      ledger: 0,
    });
    const unbound = await order();
    await expect(
      repository.settleVerifiedPayment({
        ...command,
        orderId: unbound.id,
        metadataOrderId: unbound.id,
        capturedAt: new Date(unbound.createdAt.getTime() + 1000),
      }),
    ).rejects.toThrow("CLIENT_PAID_CONFLICT");
    expect(await facts(unbound.id)).toEqual({
      packages: 0,
      coupons: 0,
      settlements: 0,
      ledger: 0,
    });
  });
  it("rejects malformed inputs before PostgreSQL receives them", async () => {
    const command = {
      userId: await fixture.createUser(),
      packageCode: "start",
      mode: "live" as const,
      idempotencyKey: randomUUID(),
    };
    for (const patch of [
      { userId: "bad" },
      { packageCode: "other" },
      { idempotencyKey: "" },
      { idempotencyKey: "x".repeat(201) },
      { mode: "other" },
    ]) {
      await expect(
        repository.createOrder({ ...command, ...patch } as Parameters<
          typeof repository.createOrder
        >[0]),
      ).rejects.toThrow("CLIENT_PAID_INVALID");
    }
    await expect(
      repository.bindPayment({
        orderId: randomUUID(),
        providerPaymentId: "x".repeat(65),
      }),
    ).rejects.toThrow("CLIENT_PAID_INVALID");
  });
  it.each(["client_coupon_grants", "client_paid_settlements"])(
    "rolls back all facts when %s insertion fails, then recovers",
    async (table) => {
      const command = await payment();
      await fixture.db.execute(
        sql`create function test_reject_client_paid_fact() returns trigger language plpgsql as $$ begin raise exception 'injected purchase fact failure'; end $$`,
      );
      await fixture.db.execute(
        sql`create trigger test_reject_client_paid_fact before insert on ${sql.identifier(table)} for each row execute function test_reject_client_paid_fact()`,
      );
      try {
        await expect(
          repository.settleVerifiedPayment(command),
        ).rejects.toThrow();
        expect(await facts(command.orderId)).toEqual({
          packages: 0,
          coupons: 0,
          settlements: 0,
          ledger: 0,
        });
      } finally {
        await fixture.db.execute(
          sql`drop trigger test_reject_client_paid_fact on ${sql.identifier(table)}`,
        );
        await fixture.db.execute(
          sql`drop function test_reject_client_paid_fact()`,
        );
      }
      await repository.settleVerifiedPayment(command);
      expect(await facts(command.orderId)).toEqual({
        packages: 1,
        coupons: 1,
        settlements: 1,
        ledger: 1,
      });
    },
  );
  it("database rejects update/delete of all purchase facts", async () => {
    const command = await payment();
    await repository.settleVerifiedPayment(command);
    for (const table of [
      "client_paid_orders",
      "client_paid_payment_bindings",
      "client_coupon_grants",
      "client_paid_settlements",
    ]) {
      const column = table === "client_paid_orders" ? "id" : "order_id";
      await expect(
        fixture.db.execute(
          sql`update ${sql.identifier(table)} set ${sql.identifier(column)}=${command.orderId}::uuid where ${sql.identifier(column)}=${command.orderId}::uuid`,
        ),
      ).rejects.toThrow();
      await expect(
        fixture.db.execute(
          sql`delete from ${sql.identifier(table)} where ${sql.identifier(column)}=${command.orderId}::uuid`,
        ),
      ).rejects.toThrow();
    }
  });
});
