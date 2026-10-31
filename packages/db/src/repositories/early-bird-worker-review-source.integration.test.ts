import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { DrizzleDb } from "../client.js";
import {
  startDisposableTestPostgres,
  type TestDatabase,
} from "../testkit/postgres.js";
import { PostgresWorkerReviewSource } from "./early-bird-worker-review-source.js";
let fixture: TestDatabase;
beforeAll(async () => {
  fixture = await startDisposableTestPostgres();
  await fixture.db.execute(
    sql.raw(`
    create table worker_review_fixture(application_id uuid,event_id uuid,user_id uuid,base_id uuid,choice_id uuid,config_id uuid);
    create function early_bird_worker_review_list(uuid,integer) returns table(application_id uuid,event_id uuid) language sql security definer set search_path=pg_catalog as $$select application_id,event_id from public.worker_review_fixture limit $2$$;
    create function early_bird_worker_review_resolve(uuid,uuid) returns table(user_id uuid,base_id uuid,choice_id uuid,config_id uuid) language sql security definer set search_path=pg_catalog as $$select user_id,base_id,choice_id,config_id from public.worker_review_fixture where application_id=$1 and event_id=$2$$;
    create function worker_review_extra() returns integer language sql security definer set search_path=pg_catalog as $$select 1$$;
    revoke all on function early_bird_worker_review_list(uuid,integer),early_bird_worker_review_resolve(uuid,uuid),worker_review_extra() from public;
    create role ii_tonya_worker_review_source nologin noinherit;
    create role worker_review_login login inherit;
    grant ii_tonya_worker_review_source to worker_review_login;
    grant execute on function early_bird_worker_review_list(uuid,integer),early_bird_worker_review_resolve(uuid,uuid) to ii_tonya_worker_review_source;
  `),
  );
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);
it("requires exactly two capabilities and rejects direct data or extra functions", async () => {
  const applicationId = randomUUID(),
    eventId = randomUUID(),
    userId = randomUUID(),
    baseId = randomUUID(),
    choiceId = randomUUID(),
    configId = randomUUID();
  await fixture.db.execute(
    sql`insert into worker_review_fixture values(${applicationId}::uuid,${eventId}::uuid,${userId}::uuid,${baseId}::uuid,${choiceId}::uuid,${configId}::uuid)`,
  );
  const client = await fixture.db.$client.connect();
  try {
    await client.query("set session authorization worker_review_login");
    const reader = new PostgresWorkerReviewSource(
      drizzle(client) as unknown as DrizzleDb,
      "worker_review_login",
    );
    expect(await reader.list(undefined, 10)).toEqual([
      { applicationId, eventId },
    ]);
    expect(await reader.resolve({ applicationId, eventId })).toEqual({
      userId,
      baseId,
      choiceId,
      configId,
    });
    await fixture.db.execute(
      sql`revoke execute on function early_bird_worker_review_resolve(uuid,uuid) from ii_tonya_worker_review_source`,
    );
    await expect(reader.list(undefined, 10)).rejects.toThrow(
      "early_bird_worker_review_principal_unsafe",
    );
    await fixture.db.execute(
      sql`grant execute on function early_bird_worker_review_resolve(uuid,uuid) to ii_tonya_worker_review_source`,
    );
    await fixture.db.execute(
      sql`grant execute on function worker_review_extra() to ii_tonya_worker_review_source`,
    );
    await expect(reader.resolve({ applicationId, eventId })).rejects.toThrow(
      "early_bird_worker_review_principal_unsafe",
    );
    await fixture.db.execute(
      sql`revoke execute on function worker_review_extra() from ii_tonya_worker_review_source`,
    );
    await fixture.db.execute(
      sql`grant select on worker_review_fixture to worker_review_login`,
    );
    await expect(reader.list(undefined, 10)).rejects.toThrow(
      "early_bird_worker_review_principal_unsafe",
    );
  } finally {
    await client.query("reset session authorization");
    client.release();
  }
}, 120_000);
