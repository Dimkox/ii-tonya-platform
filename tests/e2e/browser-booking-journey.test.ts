import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import type { FastifyInstance } from "../../apps/api/node_modules/fastify/fastify.js";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import {
  createClientBookingService,
  createClientCatalogService,
  createClientSessionService,
} from "../../packages/application/src/index.js";
import { PostgresBookingRepository } from "../../packages/db/src/repositories/booking-repository.js";
import { PostgresClientCatalogRepository } from "../../packages/db/src/repositories/client-catalog-repository.js";
import { PostgresClientSessionRepository } from "../../packages/db/src/repositories/client-session-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import { createClientPrincipalResolver } from "../../apps/api/src/client-principal-resolver.js";
import { createClientBookingPrincipalResolver } from "../../apps/api/src/client-booking-principal-resolver.js";
import {
  clientSessionTokenHash,
  createClientSessionToken,
} from "../../apps/api/src/client-session-token.js";
import { browserAccountRoutes } from "../../apps/api/src/routes/browser-account.js";
import { clientBookingRoutes } from "../../apps/api/src/routes/client-booking.js";
import { clientCatalogRoutes } from "../../apps/api/src/routes/client-catalog.js";

const origin = "https://example.invalid";
const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const Fastify = apiRequire(
  "fastify",
) as typeof import("../../apps/api/node_modules/fastify/fastify.js").default;
const choiceHandle = `ch1.${"A".repeat(43)}` as const;
let testDb: TestDatabase;
beforeAll(async () => {
  if (!process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL)
    throw new Error("explicit PG17.5 required");
  testDb = await startTestPostgres();
  await testDb.migrate();
}, 120000);
beforeEach(async () => testDb.reset());
afterAll(async () => testDb?.stop(), 120000);
async function appFor(userId: string, grants = true, reserve = true) {
  const sessions = new PostgresClientSessionRepository(testDb.db);
  const catalog = new PostgresClientCatalogRepository(testDb.db);
  const principals = createClientPrincipalResolver(sessions);
  const bookingPrincipals = createClientBookingPrincipalResolver(sessions);
  const service = createClientSessionService({
    sessions,
    bookingGrantsEnabled: grants,
    generateToken: createClientSessionToken,
    digestToken: clientSessionTokenHash,
    // Synthetic proof boundary only; this is not real Telegram login evidence.
    verifier: {
      verify: async ({ identityProof }) => ({
        userId,
        audience: "ii-tonya-client",
        scope: "client_session:create",
        expiresAt: new Date(Date.now() + 1800000),
        replayDigest: `hmac-sha256:v1:${createHash("sha256").update(identityProof).digest("hex")}`,
      }),
    },
  });
  const app = Fastify();
  await app.register(clientCatalogRoutes, {
    principals,
    catalog: createClientCatalogService({
      repository: catalog,
      bookingAware: true,
    }),
  });
  await app.register(clientBookingRoutes, {
    principals: bookingPrincipals,
    bookings: createClientBookingService({
      repository: new PostgresBookingRepository(testDb.db),
    }),
    reserveEnabled: reserve,
  });
  await app.register(browserAccountRoutes, {
    origin,
    botUsername: "fixture_bot",
    widgetEnabled: false,
    privacyEnabled: false,
    catalogEnabled: true,
    bookingEnabled: true,
    bookingReserveEnabled: reserve,
    principals,
    bookingPrincipals,
    sessions: {
      issue: service.issue,
      revoke: (digest) => sessions.revoke(digest),
    },
  });
  return { app, catalog };
}
async function login(app: FastifyInstance, label: string) {
  const probe = await app.inject({ url: "/v1/browser/session" });
  const response = await app.inject({
    method: "POST",
    url: "/v1/browser/session",
    headers: {
      origin,
      cookie: probe.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
      "x-csrf-token": probe.json().csrfToken,
    },
    payload: { identityProof: `fixture-${label}-${"P".repeat(32)}` },
  });
  expect(response.statusCode).toBe(201);
  return {
    origin,
    cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    "x-csrf-token": response.json().csrfToken as string,
  };
}

it("fresh grant -> protected catalogue -> reserve -> reload list -> cancel; old reads remain denied", async () => {
  const fixture = await testDb.createReservableFixture();
  await testDb.db.execute(
    sql`update slots set starts_at=now()+interval '48 hours',ends_at=now()+interval '49 hours',observed_at=now() where id=${fixture.command.slotId}::uuid`,
  );
  const old = await appFor(fixture.command.userId, false);
  try {
    const headers = await login(old.app, "old");
    expect(
      (await old.app.inject({ url: "/v1/browser/bookings", headers }))
        .statusCode,
    ).toBe(403);
  } finally {
    await old.app.close();
  }
  const { app, catalog } = await appFor(fixture.command.userId);
  try {
    const headers = await login(app, "fresh");
    const request = await app.inject({
      method: "POST",
      url: "/v1/browser/catalog-requests",
      headers,
      payload: {},
    });
    expect(request.statusCode).toBe(202);
    const catalogRequestId = request.json().catalogRequestId as string;
    const startsAt = (
      await testDb.db.execute<{ value: string }>(
        sql`select starts_at::text value from slots where id=${fixture.command.slotId}::uuid`,
      )
    ).rows[0]!.value;
    // Isolated worker materialization fixture, not an external provider response.
    expect(
      await catalog.materializeBookingAware({
        catalogRequestId,
        cards: [
          {
            displayName: "Fixture",
            serviceCode: "career",
            language: "ru",
            availability: "fresh_slots",
            slots: [
              { startsAt: new Date(startsAt).toISOString(), choiceHandle },
            ],
          },
        ],
        choices: [
          {
            choiceDigest: `sha256:${createHash("sha256").update(choiceHandle).digest("hex")}`,
            localSlotId: fixture.command.slotId,
            expiresAt: new Date(Date.now() + 300000),
          },
        ],
      }),
    ).toBe("ready");
    const snapshot = await app.inject({
      url: `/v1/browser/catalog-requests/${catalogRequestId}`,
      headers,
    });
    expect(snapshot.json().cards[0].slots[0].choiceHandle).toBe(choiceHandle);
    const reserved = await app.inject({
      method: "POST",
      url: "/v1/browser/bookings",
      headers,
      payload: { choiceHandle },
    });
    expect(reserved.statusCode).toBe(201);
    const handle = reserved.json().bookingHandle as string;
    const probe = await app.inject({
      url: "/v1/browser/session",
      headers: { cookie: headers.cookie },
    });
    expect(probe.json()).toMatchObject({
      bookingAvailable: true,
      bookingReserveAvailable: true,
    });
    const reloaded = {
      ...headers,
      "x-csrf-token": probe.json().csrfToken as string,
    };
    const page = await app.inject({
      url: "/v1/browser/bookings",
      headers: reloaded,
    });
    expect(page.json().bookings).toHaveLength(1);
    expect(page.json().bookings[0]).toMatchObject({
      bookingHandle: handle,
      state: "reserved",
    });
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/v1/browser/bookings/${handle}`,
          headers: reloaded,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({ url: "/v1/browser/bookings", headers: reloaded })
      ).json(),
    ).toEqual({ bookings: [], nextCursor: null });
  } finally {
    await app.close();
  }
});

it("fresh login while reserve is off can list and cancel a previously owned reservation", async () => {
  const fixture = await testDb.createReservableFixture();
  const booking = await new PostgresBookingRepository(
    testDb.db,
  ).reserveAndPublish(fixture.command);
  if (booking.kind === "unavailable") throw new Error("fixture unavailable");
  const handle = `bk1.${"B".repeat(43)}`;
  await testDb.db.execute(
    sql`insert into client_booking_receipts(user_id,choice_digest,booking_handle,reservation_id) values (${fixture.command.userId}::uuid,${`sha256:${"b".repeat(64)}`},${handle},${booking.reservationId}::uuid)`,
  );
  const { app } = await appFor(fixture.command.userId, true, false);
  try {
    const headers = await login(app, "reserve-off");
    expect(
      (await app.inject({ url: "/v1/browser/bookings", headers })).json()
        .bookings,
    ).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/browser/bookings",
          headers,
          payload: { choiceHandle },
        })
      ).statusCode,
    ).toBe(503);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/v1/browser/bookings/${handle}`,
          headers,
        })
      ).statusCode,
    ).toBe(200);
  } finally {
    await app.close();
  }
});
