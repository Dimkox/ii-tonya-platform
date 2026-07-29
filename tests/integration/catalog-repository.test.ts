import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PostgresCatalogRepository } from "../../packages/db/src/index.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

describe("catalog repository", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    await testDb.migrate();
  });

  beforeEach(async () => {
    await testDb.reset();
  });

  afterAll(async () => {
    await testDb.stop();
  });

  it("returns only verified, active, fresh, future, matching experts with capacity", async () => {
    const now = new Date("2026-07-28T10:00:00.000Z");
    const eligible = await seedCatalogEntry(testDb, {
      suffix: "eligible",
      startsAt: new Date("2026-07-30T10:00:00.000Z"),
      observedAt: now,
    });
    await seedCatalogEntry(testDb, {
      suffix: "unverified",
      verified: false,
      startsAt: new Date("2026-07-30T11:00:00.000Z"),
      observedAt: now,
    });
    await seedCatalogEntry(testDb, {
      suffix: "inactive-expert",
      active: false,
      startsAt: new Date("2026-07-30T12:00:00.000Z"),
      observedAt: now,
    });
    await seedCatalogEntry(testDb, {
      suffix: "inactive-service",
      serviceActive: false,
      startsAt: new Date("2026-07-30T13:00:00.000Z"),
      observedAt: now,
    });
    await seedCatalogEntry(testDb, {
      suffix: "stale",
      startsAt: new Date("2026-07-30T14:00:00.000Z"),
      observedAt: new Date("2026-07-28T09:44:59.999Z"),
    });
    await seedCatalogEntry(testDb, {
      suffix: "too-soon",
      startsAt: new Date("2026-07-29T09:59:59.999Z"),
      observedAt: now,
    });
    const full = await seedCatalogEntry(testDb, {
      suffix: "full",
      startsAt: new Date("2026-07-30T15:00:00.000Z"),
      observedAt: now,
    });
    const clientId = await testDb.createUser();
    await testDb.db.execute(sql`
      insert into reservations (
        user_id, slot_id, expert_id, expert_service_id, status,
        idempotency_key, reserved_until
      ) values (
        ${clientId}::uuid, ${full.slotId}::uuid, ${full.expertId}::uuid,
        ${full.serviceId}::uuid, 'booked', 'catalog-full',
        ${new Date("2026-08-01T10:00:00.000Z")}
      )
    `);

    const result = await new PostgresCatalogRepository(
      testDb.db,
    ).findEligible({
      serviceCode: "consultation",
      language: "ru",
      from: new Date("2026-07-29T00:00:00.000Z"),
      to: new Date("2026-08-06T00:00:00.000Z"),
      now,
      minimumLeadMs: 86_400_000,
      requireExpertActive: true,
      requireExpertVerified: true,
      requireServiceActive: true,
    });

    expect(result).toEqual([
      expect.objectContaining({
        expertId: eligible.expertId,
        displayName: "Expert eligible",
        serviceCode: "consultation",
        language: "ru",
        slotId: eligible.slotId,
        slotStartsAt: new Date("2026-07-30T10:00:00.000Z"),
      }),
    ]);
  });
});

const seedCatalogEntry = async (
  testDb: TestDatabase,
  input: {
    readonly suffix: string;
    readonly active?: boolean;
    readonly verified?: boolean;
    readonly serviceActive?: boolean;
    readonly startsAt: Date;
    readonly observedAt: Date;
  },
): Promise<{
  expertId: string;
  serviceId: string;
  slotId: string;
}> => {
  const userId = await testDb.createUser();
  const expert = await testDb.db.execute<{ id: string }>(sql`
    insert into experts (user_id, public_display_name, active, verified)
    values (
      ${userId}::uuid,
      ${`Expert ${input.suffix}`},
      ${input.active ?? true},
      ${input.verified ?? true}
    )
    returning id
  `);
  const expertId = expert.rows[0]?.id;
  if (expertId === undefined) throw new Error("Expert seed failed");
  const service = await testDb.db.execute<{ id: string }>(sql`
    insert into expert_services (
      expert_id, name, code, language, active, duration_minutes
    ) values (
      ${expertId}::uuid, 'Consultation', 'consultation', 'ru',
      ${input.serviceActive ?? true}, 60
    )
    returning id
  `);
  const serviceId = service.rows[0]?.id;
  if (serviceId === undefined) throw new Error("Service seed failed");
  const slot = await testDb.db.execute<{ id: string }>(sql`
    insert into slots (
      expert_service_id, provider, external_slot_id, starts_at, ends_at,
      observed_at, capacity
    ) values (
      ${serviceId}::uuid, 'test', ${`slot-${input.suffix}`},
      ${input.startsAt},
      ${new Date(input.startsAt.getTime() + 60 * 60 * 1_000)},
      ${input.observedAt}, 1
    )
    returning id
  `);
  const slotId = slot.rows[0]?.id;
  if (slotId === undefined) throw new Error("Slot seed failed");
  return { expertId, serviceId, slotId };
};
