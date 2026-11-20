import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ExpertServiceOfferInvalidError } from "@ii-tonya/contracts";
import { PostgresExpertServiceOfferRepository } from "./expert-service-offer.js";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";

let database: TestDatabase;
beforeAll(async () => {
  database = await startTestPostgres();
  await database.migrate();
}, 180_000);
afterAll(async () => database?.stop(), 120_000);

it("round-trips an offer and keeps a legacy row valid", async () => {
  const slotId = await database.createSlot({
    capacity: 1,
    startsAt: new Date(Date.now() + 172_800_000).toISOString(),
  });
  const serviceId = (
    await database.db.execute<{ id: string }>(
      sql`select expert_service_id as id from slots where id=${slotId}::uuid`,
    )
  ).rows[0]!.id;
  const offers = new PostgresExpertServiceOfferRepository(database.db);
  await expect(offers.read(serviceId)).resolves.toEqual({
    priceMinor: null,
    currency: "RUB",
    format: null,
    location: null,
  });
  await expect(
    offers.updateOffer(serviceId, {
      priceMinor: 300_000,
      format: "offline",
      location: "Москва",
    }),
  ).resolves.toBe("updated");
  await expect(offers.read(serviceId)).resolves.toEqual({
    priceMinor: 300_000,
    currency: "RUB",
    format: "offline",
    location: "Москва",
  });
  await expect(
    offers.updateOffer(serviceId, { priceMinor: -1 }),
  ).rejects.toThrow(ExpertServiceOfferInvalidError);
  await expect(
    offers.updateOffer(serviceId, { format: "EVENT" as "online" }),
  ).rejects.toThrow(/:format$/);
  await expect(
    offers.updateOffer(serviceId, { format: "hybrid", location: null }),
  ).rejects.toThrow(/:location$/);
  await expect(offers.read(serviceId)).resolves.toMatchObject({
    priceMinor: 300_000,
    format: "offline",
    location: "Москва",
  });
  await expect(
    constraintOf(
      database.db.execute(
        sql`update expert_services set price_minor = -1 where id = ${serviceId}::uuid`,
      ),
    ),
  ).resolves.toBe("expert_services_price_minor_nonnegative");
  await expect(
    constraintOf(
      database.db.execute(
        sql`update expert_services set format = 'remote' where id = ${serviceId}::uuid`,
      ),
    ),
  ).resolves.toBe("expert_services_format_known");
});

const constraintOf = async (
  query: Promise<unknown>,
): Promise<string | undefined> => {
  try {
    await query;
    return undefined;
  } catch (error) {
    const seen = new Set<unknown>();
    let current: unknown = error;
    while (
      typeof current === "object" &&
      current !== null &&
      !seen.has(current)
    ) {
      seen.add(current);
      const evidence = current as { constraint?: unknown; cause?: unknown };
      if (typeof evidence.constraint === "string") return evidence.constraint;
      current = evidence.cause;
    }
    throw error;
  }
};
