import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { migrateDb } from "../../packages/db/src/client.js";
import { startTestPostgres } from "../../packages/db/src/testkit/postgres.js";

it("R1 normal migrateDb applies 0074 to a populated main0073 database exactly once", async () => {
  const database = await startTestPostgres();
  const folder = await mkdtemp(join(tmpdir(), "native-migration-0073-"));
  try {
    const source = "packages/db/migrations";
    const journal = JSON.parse(
      await readFile(join(source, "meta/_journal.json"), "utf8"),
    );
    const previous = journal.entries.filter(
      (entry: { idx: number }) => entry.idx < 74,
    );
    await mkdir(join(folder, "meta"));
    await writeFile(
      join(folder, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries: previous }),
    );
    for (const entry of previous)
      await copyFile(
        join(source, entry.tag + ".sql"),
        join(folder, entry.tag + ".sql"),
      );
    await migrateDb(database.db, folder);
    const user = (
      await database.db.execute<{ id: string }>(
        sql`insert into users default values returning id`,
      )
    ).rows[0]!;
    const expert = (
      await database.db.execute<{ id: string }>(
        sql`insert into experts(user_id,active,verified) values(${user.id}::uuid,true,true) returning id`,
      )
    ).rows[0]!;
    const service = (
      await database.db.execute<{ id: string }>(
        sql`insert into expert_services(expert_id,name,code,language,duration_minutes,active) values(${expert.id}::uuid,'Историческая услуга','r1-legacy','ru',60,true) returning id`,
      )
    ).rows[0]!;
    const slot = (
      await database.db.execute<{ id: string }>(
        sql`insert into slots(expert_service_id,provider,external_slot_id,starts_at,ends_at,observed_at,capacity) values(${service.id}::uuid,'planerka','r1-legacy',clock_timestamp()+interval '4 days',clock_timestamp()+interval '4 days 1 hour',clock_timestamp(),1) returning id`,
      )
    ).rows[0]!;
    const snapshot = () =>
      database.db.execute(
        sql`select to_jsonb(s) as slot,to_jsonb(es) as service from slots s join expert_services es on es.id=s.expert_service_id where s.id=${slot.id}::uuid`,
      );
    const before = (await snapshot()).rows;
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
        )
      ).rows[0]?.n,
    ).toBe(74);
    await migrateDb(database.db, source);
    expect(
      (
        await database.db.execute(
          sql`select to_regclass('resident_native_confirmations') as native`,
        )
      ).rows[0]?.native,
    ).toBe("resident_native_confirmations");
    expect((await snapshot()).rows).toEqual(before);
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int as n,max(created_at)::text as latest from drizzle.__drizzle_migrations`,
        )
      ).rows[0],
    ).toEqual({ n: 75, latest: String(journal.entries.at(-1).when) });
    await migrateDb(database.db, source);
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
        )
      ).rows[0]?.n,
    ).toBe(75);
    expect((await snapshot()).rows).toEqual(before);
  } finally {
    await database.stop();
    await rm(folder, { recursive: true, force: true });
  }
}, 120000);

it("canonical migrateDb rejects the real archived native0070 lineage without writes", async () => {
  const database = await startTestPostgres();
  const folder = await mkdtemp(join(tmpdir(), "native-old-lineage-"));
  try {
    const source = "packages/db/migrations";
    const archive = join(source, "history/native-before-main-20261027");
    const journal = JSON.parse(
      await readFile(join(archive, "meta/_journal.json"), "utf8"),
    );
    await mkdir(join(folder, "meta"));
    await writeFile(
      join(folder, "meta/_journal.json"),
      JSON.stringify(journal),
    );
    for (const entry of journal.entries)
      await copyFile(
        join(entry.idx === 70 ? archive : source, entry.tag + ".sql"),
        join(folder, entry.tag + ".sql"),
      );
    await migrateDb(database.db, folder);
    const userId = await database.createUser();
    const snapshot = async () =>
      (
        await database.db.execute(sql`select
      (select jsonb_agg(to_jsonb(m) order by id) from drizzle.__drizzle_migrations m) as journal,
      (select jsonb_agg(to_jsonb(u) order by id) from users u) as users,
      (select count(*)::int from pg_class where relnamespace='public'::regnamespace) as relations,
      to_regclass('lifecycle_jobs') as lifecycle`)
      ).rows;
    expect(userId).toBeTruthy();
    const before = await snapshot();
    await expect(migrateDb(database.db, source)).rejects.toThrow(
      "migration_history_reconciliation_required",
    );
    expect(await snapshot()).toEqual(before);
  } finally {
    await database.stop();
    await rm(folder, { recursive: true, force: true });
  }
}, 120000);

it("fresh canonical migration preserves tags and schedule independently in confirmation digest", async () => {
  const database = await startTestPostgres();
  try {
    await migrateDb(database.db, "packages/db/migrations");
    const digest = async (value: object) =>
      (
        await database.db.execute<{ digest: string }>(
          sql`select resident_rich_digest(jsonb_populate_record(null::expert_card_drafts,${JSON.stringify({ revision: 1, rich_pending_services: [], semantic_tags: [], ...value })}::jsonb)) digest`,
        )
      ).rows[0]!.digest;
    const empty = await digest({});
    expect(await digest({ initial_schedule: null, semantic_tags: [] })).toBe(
      empty,
    );
    expect(await digest({ semantic_tags: ["#тревожность"] })).not.toBe(empty);
    expect(
      await digest({ initial_schedule: { previewId: "fixture" } }),
    ).not.toBe(empty);
    expect(
      await digest({
        semantic_tags: ["#тревожность"],
        initial_schedule: { previewId: "fixture" },
      }),
    ).not.toBe(await digest({ initial_schedule: { previewId: "fixture" } }));
  } finally {
    await database.stop();
  }
}, 120000);
