import { applyEarlyBirdPublicationDraftIfNeeded } from "../testkit/early-bird-draft-helper.js";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { startExpertReferralTestDatabase } from "../testkit/expert-referral.js";
import { PostgresEarlyBirdPublicationWorker } from "./early-bird-publication-worker.js";

it("scans through the dedicated principal and denies direct financial access", async () => {
  const db = await startExpertReferralTestDatabase(undefined, {
    forceDisposableCluster: true,
  });
  let pool: Pool | undefined;
  try {
    await applyEarlyBirdPublicationDraftIfNeeded(db.db);
    await db.db.execute(
      sql`DO $$ DECLARE p record; BEGIN FOR p IN SELECT oid::regprocedure as fn FROM pg_proc WHERE prosecdef AND pronamespace IN(SELECT oid FROM pg_namespace WHERE nspname IN('public','early_bird_private')) LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',p.fn); END LOOP; END $$`,
    );
    await db.db.execute(
      sql`create role ii_tonya_wave_publication_worker nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls`,
    );
    await db.db.execute(
      sql`create role publication_test_login login password 'synthetic-only' inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls`,
    );
    await db.db.execute(
      sql`grant ii_tonya_wave_publication_worker to publication_test_login`,
    );
    await db.db.execute(
      sql`grant execute on function public.early_bird_publication_worker(text,jsonb) to ii_tonya_wave_publication_worker`,
    );
    const url = new URL(db.db.$client.options.connectionString!);
    url.username = "publication_test_login";
    url.password = "synthetic-only";
    pool = new Pool({ connectionString: url.toString() });
    const store = new PostgresEarlyBirdPublicationWorker(
      drizzle(pool) as never,
      "publication_test_login",
    );
    expect(await store.scan(20, null)).toEqual([]);
    await expect(
      pool.query("select * from early_bird_payment_successes"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      pool.query("select early_bird_activate_projection($1::uuid,$2::uuid)", [
        crypto.randomUUID(),
        crypto.randomUUID(),
      ]),
    ).rejects.toMatchObject({ code: "42501" });
  } finally {
    await pool?.end();
    await db.stop();
  }
}, 120_000);
