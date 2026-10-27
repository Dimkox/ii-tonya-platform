import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresCatalogRepository } from "../../packages/db/src/repositories/catalog-repository.js";
import { PostgresBookingRepository } from "../../packages/db/src/repositories/booking-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

describe("residency archive read and booking admission fences", () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await startTestPostgres();
    await database.migrate();
    expect(
      (await database.db.execute(sql`show server_version_num`)).rows[0]
        ?.server_version_num,
    ).toBe("170005");
  }, 120000);
  afterAll(async () => {
    await database?.stop();
  }, 120000);

  for (const state of ["archived", "paused"] as const) {
    it(`excludes ${state} experts without waiting for the worker`, async () => {
      const fixture = await database.createReservableFixture();
      const scope = (
        await database.db.execute<{ userId: string; serviceId: string }>(sql`
        select e.user_id as "userId", es.id as "serviceId" from experts e join expert_services es on es.expert_id=e.id where e.id=${fixture.expertId}::uuid
      `)
      ).rows[0]!;
      await database.db.execute(
        sql`update expert_services set code='consultation',language='ru' where id=${scope.serviceId}::uuid`,
      );
      const catalog = new PostgresCatalogRepository(database.db);
      const booking = new PostgresBookingRepository(database.db);
      const discovery = {
        from: fixture.command.now,
        to: new Date("2026-08-06T00:00:00Z"),
        now: fixture.command.now,
        minimumLeadMs: 0,
      };
      const eligibility = {
        ...discovery,
        requireExpertActive: true,
        requireExpertVerified: true,
        requireServiceActive: true,
      } as const;
      expect(
        (
          await catalog.read({
            sourceKey: scope.serviceId,
            databaseNow: fixture.command.now,
          })
        ).kind,
      ).toBe("complete");
      expect(
        (await catalog.findEligible(eligibility)).some(
          (row) => row.expertId === fixture.expertId,
        ),
      ).toBe(true);
      if (state === "archived") {
        await database.db.execute(
          sql`insert into expert_onboarding_applications(user_id,archived_at,archive_until_date) values(${scope.userId}::uuid,clock_timestamp(),clock_timestamp()+interval '1 month')`,
        );
      } else {
        await database.db.execute(
          sql`insert into expert_residency_lifecycle(user_id,expert_id,status,paused_until) values(${scope.userId}::uuid,${fixture.expertId}::uuid,'paused',current_date+1)`,
        );
      }
      expect(
        (await catalog.listPublicServices({ limit: 20 })).some(
          (row) => row.sourceKey === scope.serviceId,
        ),
      ).toBe(false);
      expect(
        (await catalog.findEligible(eligibility)).some(
          (row) => row.expertId === fixture.expertId,
        ),
      ).toBe(false);
      expect(
        await catalog.read({
          sourceKey: scope.serviceId,
          databaseNow: fixture.command.now,
        }),
      ).toEqual({ kind: "complete", slots: [] });
      expect(
        (await booking.searchSlots(discovery)).some(
          (row) => row.expertId === fixture.expertId,
        ),
      ).toBe(false);
      expect(await booking.reserve(fixture.command)).toEqual({
        kind: "unavailable",
        reason: "expert_ineligible",
      });
    });
  }
  it("denies confirmation after archive while preserving cancellation", async () => {
    const fixture = await database.createReservableFixture();
    const booking = new PostgresBookingRepository(database.db);
    const reserved = await booking.reserve(fixture.command);
    expect(reserved.kind).toBe("reserved");
    if (reserved.kind !== "reserved") throw new Error("fixture_reserve_failed");
    await database.db.execute(
      sql`insert into expert_onboarding_applications(user_id,archived_at,archive_until_date) select user_id,clock_timestamp(),clock_timestamp()+interval '1 month' from experts where id=${fixture.expertId}::uuid`,
    );
    await expect(
      booking.transition({
        reservationId: reserved.reservationId,
        expectedVersion: reserved.version,
        action: "expert_confirm",
        actor: { type: "expert", id: fixture.expertId },
        now: fixture.command.now,
        correlationId: "archive-confirm",
      }),
    ).rejects.toThrow("Expert is not eligible");
    expect(
      await booking.transition({
        reservationId: reserved.reservationId,
        expectedVersion: reserved.version,
        action: "client_cancel",
        actor: { type: "client", id: fixture.command.userId },
        now: fixture.command.now,
        correlationId: "archive-cancel",
      }),
    ).toMatchObject({ status: "cancelled_by_client" });
  });
});
