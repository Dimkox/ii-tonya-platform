import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  PostgresPlanerkaServiceMappingAdmin,
  parsePlanerkaServiceMappingFile,
} from "../../packages/db/src/repositories/planerka-service-mapping-admin.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let database: TestDatabase;
beforeAll(async () => {
  database = await startTestPostgres();
  await database.migrate();
}, 120000);
afterAll(async () => database?.stop(), 120000);

const serviceOf = async (): Promise<string> => {
  const slotId = await database.createSlot({
    capacity: 1,
    startsAt: new Date(Date.now() + 172800000).toISOString(),
  });
  return (
    await database.db.execute<{ id: string }>(
      sql`select expert_service_id as id from slots where id=${slotId}::uuid`,
    )
  ).rows[0]!.id;
};

it("plans, applies idempotently, rejects clashes and toggles (SCRUM-519)", async () => {
  const admin = new PostgresPlanerkaServiceMappingAdmin(database.db);
  const service = await serviceOf();
  const other = await serviceOf();
  const file = parsePlanerkaServiceMappingFile({
    accountId: 901,
    mappings: [{ expertServiceId: service, eventTypeId: 5, timeZone: "UTC" }],
  });
  expect((await admin.plan(file))[0]!.action).toBe("insert");
  expect(await admin.list()).toEqual([]);
  expect((await admin.apply(file))[0]!.action).toBe("insert");
  const [row] = await admin.list();
  expect(row).toMatchObject({
    expertServiceId: service,
    accountId: 901,
    eventTypeId: 5,
    timeZone: "UTC",
    enabled: true,
  });
  expect((await admin.apply(file))[0]!.action).toBe("unchanged");
  await expect(
    admin.apply(
      parsePlanerkaServiceMappingFile({
        accountId: 901,
        mappings: [{ expertServiceId: other, eventTypeId: 5, timeZone: "UTC" }],
      }),
    ),
  ).rejects.toThrow("planerka_mapping_event_type_taken:5");
  await expect(
    admin.plan(
      parsePlanerkaServiceMappingFile({
        accountId: 901,
        mappings: [
          {
            expertServiceId: "00000000-0000-4000-8000-00000000dead",
            eventTypeId: 6,
            timeZone: "UTC",
          },
        ],
      }),
    ),
  ).rejects.toThrow("planerka_mapping_service_unknown");
  expect(await admin.setEnabled(service, false)).toBe(true);
  expect(await admin.setEnabled(service, false)).toBe(false);
  expect((await admin.list())[0]!.enabled).toBe(false);
}, 120000);
