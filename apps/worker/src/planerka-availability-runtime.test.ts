import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { createLogger } from "@ii-tonya/observability";
import { planerkaRequestFingerprint } from "../../../packages/db/src/repositories/planerka-booking-repository.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { loadEnv } from "@ii-tonya/config";
import { createProductionWorkerRuntimeFactory } from "./main.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../../packages/db/src/testkit/postgres.js";
import { PostgresCatalogRepository } from "../../../packages/db/src/repositories/catalog-repository.js";

let database: TestDatabase;
beforeAll(async () => {
  database = await startTestPostgres();
  await database.migrate();
}, 120000);
afterAll(async () => database?.stop(), 120000);
const base = {
  DATABASE_URL: "postgresql://local:local@localhost/test",
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
};
it("requires recovery and credentials for availability, independently of creation", () => {
  expect(() =>
    loadEnv({ ...base, PLANERKA_AVAILABILITY_ENABLED: "true" }),
  ).toThrow();
  expect(
    loadEnv({
      ...base,
      PLANERKA_AVAILABILITY_ENABLED: "true",
      PLANERKA_RECOVERY_ENABLED: "true",
      PLANERKA_API_KEY: "cal_synthetic",
      PLANERKA_ACCOUNT_ID: "42",
    }).planerkaWorkflow,
  ).toEqual({
    createEnabled: false,
    availabilityEnabled: true,
    apiKey: "cal_synthetic",
    accountId: 42,
  });
  expect(
    loadEnv({
      ...base,
      PLANERKA_RECOVERY_ENABLED: "true",
      PLANERKA_API_KEY: "cal_synthetic",
      PLANERKA_ACCOUNT_ID: "42",
    }).planerkaWorkflow,
  ).toEqual({ createEnabled: false, apiKey: "cal_synthetic", accountId: 42 });
});
it("runs real publication and catalogue consumption in the ordinary factory; empty refresh retires it", async () => {
  const output: string[] = [];
  const logger = createLogger(
    new Writable({
      write(chunk, _encoding, done) {
        output.push(String(chunk));
        done();
      },
    }),
  );
  const startsAt = new Date(Date.now() + 172800000);
  const endsAt = new Date(startsAt.getTime() + 3600000);
  const slotId = await database.createSlot({
    capacity: 1,
    startsAt: startsAt.toISOString(),
  });
  const serviceId = (
    await database.db.execute<{ id: string }>(
      sql`update slots set provider='planerka',observed_at=null where id=${slotId}::uuid returning expert_service_id as id`,
    )
  ).rows[0]!.id;
  await database.db.execute(
    sql`update expert_services set code='consultation',language='ru' where id=${serviceId}::uuid`,
  );
  await database.db.execute(
    sql`insert into planerka_service_mappings values(${serviceId}::uuid,42,7,60,'UTC',true,clock_timestamp())`,
  );
  let empty = false;
  const methods: string[] = [];
  const factory = createProductionWorkerRuntimeFactory({
    logger,
    planerkaTransport: async (url, init) => {
      methods.push(init.method!);
      const data = url.endsWith("/me")
        ? { id: 42, timeZone: "UTC", weekStart: "Monday" }
        : url.endsWith("/event-types")
          ? [
              {
                id: 7,
                ownerId: 42,
                title: "Synthetic",
                slug: "fixture",
                length: 60,
                lengthInMinutes: 60,
                hidden: false,
                position: 0,
                locations: [],
                price: 0,
                currency: "RUB",
                requiresConfirmation: false,
                disableGuests: true,
                minimumBookingNotice: 0,
                beforeEventBuffer: 0,
                afterEventBuffer: 0,
              },
            ]
          : empty
            ? {}
            : {
                [startsAt.toISOString().slice(0, 10)]: [
                  { start: startsAt.toISOString(), end: endsAt.toISOString() },
                ],
              };
      return Response.json({ status: "success", data });
    },
  });
  const runtime = await factory.create(
    loadEnv({
      ...base,
      DATABASE_URL: database.db.$client.options.connectionString!,
      PLANERKA_AVAILABILITY_ENABLED: "true",
      PLANERKA_RECOVERY_ENABLED: "true",
      PLANERKA_API_KEY: "cal_synthetic",
      PLANERKA_ACCOUNT_ID: "42",
    }),
  );
  try {
    expect((await runtime.runOnce()).planerkaAvailability).toEqual({
      processed: 1,
      published: 1,
    });
    const catalog = new PostgresCatalogRepository(database.db);
    expect(
      await catalog.read({ sourceKey: serviceId, databaseNow: new Date() }),
    ).toMatchObject({
      kind: "complete",
      slots: [{ localSlotId: slotId, startsAt }],
    });
    empty = true;
    await database.db.execute(
      sql`update planerka_availability_refreshes set next_attempt_at=clock_timestamp()-interval '1 second' where expert_service_id=${serviceId}::uuid`,
    );
    expect((await runtime.runOnce()).planerkaAvailability).toEqual({
      processed: 1,
      published: 0,
    });
    expect(
      await catalog.read({ sourceKey: serviceId, databaseNow: new Date() }),
    ).toEqual({ kind: "complete", slots: [] });
    expect(methods.every((m) => m === "GET")).toBe(true);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const logs = output.map((line) => JSON.parse(line));
    expect(
      logs.map(({ event, outcome, processed, published }) => ({
        event,
        outcome,
        processed,
        published,
      })),
    ).toEqual([
      {
        event: "planerka_availability",
        outcome: "published",
        processed: 1,
        published: 1,
      },
      {
        event: "planerka_availability",
        outcome: "empty",
        processed: 1,
        published: 0,
      },
    ]);
    expect(output.join("")).not.toContain(serviceId);
    expect(output.join("")).not.toContain("cal_synthetic");
    expect(output.join("")).not.toContain("https://");
  } finally {
    await runtime.close();
  }
}, 30000);
it("keeps the disabled cycle shape and makes no provider requests", async () => {
  let requests = 0;
  const runtime = await createProductionWorkerRuntimeFactory({
    planerkaTransport: async () => {
      requests++;
      throw new Error("unexpected");
    },
  }).create(
    loadEnv({
      ...base,
      DATABASE_URL: database.db.$client.options.connectionString!,
    }),
  );
  try {
    expect(await runtime.runOnce()).not.toHaveProperty("planerkaAvailability");
    expect(requests).toBe(0);
  } finally {
    await runtime.close();
  }
});
async function runtimeFixture(accountId: number) {
  const startsAt = new Date(Date.now() + 172800000).toISOString();
  const endsAt = new Date(Date.parse(startsAt) + 3600000).toISOString();
  const slotId = await database.createSlot({ capacity: 1, startsAt });
  const serviceId = (
    await database.db.execute<{ id: string }>(
      sql`update slots set provider='planerka' where id=${slotId}::uuid returning expert_service_id as id`,
    )
  ).rows[0]!.id;
  await database.db.execute(
    sql`insert into planerka_service_mappings values(${serviceId}::uuid,${accountId},7,60,'UTC',true,clock_timestamp())`,
  );
  await database.db.execute(
    sql`update slots set observed_at=clock_timestamp() where id=${slotId}::uuid`,
  );
  return {
    slotId,
    serviceId,
    startsAt,
    endsAt,
    config: (enabled: boolean) =>
      loadEnv({
        ...base,
        DATABASE_URL: database.db.$client.options.connectionString!,
        PLANERKA_RECOVERY_ENABLED: "true",
        PLANERKA_AVAILABILITY_ENABLED: enabled ? "true" : "false",
        PLANERKA_API_KEY: "cal_synthetic",
        PLANERKA_ACCOUNT_ID: String(accountId),
      }),
  };
}
it("continues real recovery with availability OFF and leaves mapped observations and report unchanged", async () => {
  const f = await runtimeFixture(43);
  const userId = await database.createUser();
  const reservation = (
    await database.db.execute<{ id: string }>(
      sql`insert into reservations(user_id,slot_id,expert_id,expert_service_id,status,idempotency_key,reserved_until) select ${userId}::uuid,${f.slotId}::uuid,expert_id,id,'reserved',${randomUUID()},clock_timestamp()+interval '1 hour' from expert_services where id=${f.serviceId}::uuid returning id`,
    )
  ).rows[0]!.id;
  const request = {
    eventTypeId: 7,
    start: f.startsAt,
    lengthInMinutes: 60,
    attendee: { name: "Synthetic", timeZone: "UTC" },
  };
  await database.db.execute(
    sql`insert into planerka_booking_operations(reservation_id,account_id,event_type_id,request,request_fingerprint,starts_at,ends_at,state,send_admitted_at) values(${reservation}::uuid,43,7,${JSON.stringify(request)}::jsonb,${planerkaRequestFingerprint(request)},${f.startsAt}::timestamptz,${f.endsAt}::timestamptz,'unknown',clock_timestamp())`,
  );
  const paths: string[] = [];
  const runtime = await createProductionWorkerRuntimeFactory({
    planerkaTransport: async (url) => {
      paths.push(new URL(url).pathname);
      return Response.json({
        status: "success",
        data: { id: 43, timeZone: "UTC", weekStart: "Monday" },
      });
    },
  }).create(f.config(false));
  const before = (
    await database.db.execute(
      sql`select id,observed_at from slots where expert_service_id=${f.serviceId}::uuid`,
    )
  ).rows;
  try {
    const report = await runtime.runOnce();
    expect(report).not.toHaveProperty("planerkaAvailability");
    expect(report.providerReconciliation).toEqual({ processed: 1 });
    expect(paths).toEqual(["/rest/v2/me"]);
    expect(
      (
        await database.db.execute(
          sql`select state from planerka_booking_operations where reservation_id=${reservation}::uuid`,
        )
      ).rows,
    ).toEqual([{ state: "manual" }]);
    expect(
      (
        await database.db.execute(
          sql`select id,observed_at from slots where expert_service_id=${f.serviceId}::uuid`,
        )
      ).rows,
    ).toEqual(before);
    expect(
      (
        await database.db.execute(
          sql`select 1 from planerka_availability_refreshes where expert_service_id=${f.serviceId}::uuid`,
        )
      ).rows,
    ).toEqual([]);
  } finally {
    await runtime.close();
  }
});
it("reports durable account exhaustion after preflight without GETs or fabricated freshness", async () => {
  const f = await runtimeFixture(44);
  const paths: string[] = [];
  const output: string[] = [];
  const runtime = await createProductionWorkerRuntimeFactory({
    logger: createLogger(
      new Writable({
        write(chunk, _encoding, done) {
          output.push(String(chunk));
          done();
        },
      }),
    ),
    planerkaTransport: async (url) => {
      paths.push(new URL(url).pathname);
      return Response.json({
        status: "success",
        data: { id: 44, timeZone: "UTC", weekStart: "Monday" },
      });
    },
  }).create(f.config(true));
  await database.db.execute(
    sql`update planerka_account_requests set next_request_at=clock_timestamp()+interval '1 hour' where account_id=44`,
  );
  const before = (
    await database.db.execute(
      sql`select id,observed_at from slots where expert_service_id=${f.serviceId}::uuid`,
    )
  ).rows;
  try {
    expect((await runtime.runOnce()).planerkaAvailability).toEqual({
      processed: 1,
      published: 0,
      reason: "account_rate_limit",
    });
    expect(paths).toEqual(["/rest/v2/me"]);
    expect(
      (
        await database.db.execute(
          sql`select id,observed_at from slots where expert_service_id=${f.serviceId}::uuid`,
        )
      ).rows,
    ).toEqual(before);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(output.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({
        event: "planerka_availability",
        outcome: "account_rate_limit",
        processed: 1,
        published: 0,
      }),
    ]);
  } finally {
    await runtime.close();
  }
}, 15000);
it("sanitizes availability outcome events through the actual logger", async () => {
  const output: string[] = [];
  const logger = createLogger(
    new Writable({
      write(chunk, _encoding, done) {
        output.push(String(chunk));
        done();
      },
    }),
  );
  logger.info({
    event: "planerka_availability",
    outcome: "invalid_response",
    processed: 1,
    published: 0,
    accountId: 42,
    serviceId: "private",
    body: "private",
    url: "https://private",
    apiKey: "cal_private",
  });
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  const { level, time, ...data } = JSON.parse(output[0]!);
  expect(level).toBe(30);
  expect(typeof time).toBe("number");
  expect(data).toEqual({
    event: "planerka_availability",
    outcome: "invalid_response",
    processed: 1,
    published: 0,
  });
});
