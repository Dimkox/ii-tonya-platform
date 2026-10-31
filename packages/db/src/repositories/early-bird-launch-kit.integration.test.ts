import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { DrizzleDb } from "../client.js";
import {
  startDisposableTestPostgres,
  type TestDatabase,
} from "../testkit/postgres.js";
import { PostgresEarlyBirdLaunchKit } from "./early-bird-launch-kit.js";
let fixture: TestDatabase;
const user = randomUUID(),
  expert = randomUUID(),
  draft = randomUUID(),
  config = randomUUID();
const login = `launchkit_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
const version = "early-bird-launch.v1",
  digest =
    "sha256:68ae1b75b98db4ab821e3f41dfe2f2100ac440c75a559d9b33faeb543edb5ff1";
beforeAll(async () => {
  fixture = await startDisposableTestPostgres();
  await fixture.db.execute(
    sql.raw(`
 create table consent_document_versions(id uuid);
 create table users(id uuid primary key,active boolean);
 create table experts(id uuid primary key,user_id uuid,active boolean,verified boolean);
 create table expert_card_drafts(id uuid primary key,user_id uuid,messaging_policy_version text);
 create table experts_published(expert_id uuid primary key,user_id uuid,active boolean,wave_intent_id uuid,draft_id uuid);
 create table early_bird_launch_configs(id uuid primary key,active boolean,client_start_at timestamptz);
 create table expert_sales_erased_cohorts(user_id uuid);
 create table channel_identities(id uuid primary key,user_id uuid,provider text,bot_key text,status text,external_id text,external_chat_id text);
 create table test_publication_authority(allowed boolean);insert into test_publication_authority values(false);
 create function expert_card_current_messaging_authority(uuid,text) returns boolean language sql as $$select $2='current'$$;
 create function early_bird_current_publication_valid(uuid) returns boolean language sql as $$select allowed from public.test_publication_authority$$;
 create function early_bird_final_call_check_schema() returns void language plpgsql set search_path=pg_catalog as $$begin if has_schema_privilege('public','public','CREATE') then raise exception 'unsafe_schema';end if;end$$;
 `),
  );
  await fixture.db.execute(
    sql.raw(
      readFileSync(
        "docs/superpowers/implementation-artifacts/drafts/early_bird_launch_kit.sql",
        "utf8",
      ),
    ),
  );
  await fixture.db.execute(
    sql.raw(`
 insert into users values('${user}',true);insert into experts values('${expert}','${user}',true,true);
 insert into expert_card_drafts values('${draft}','${user}','current');
 insert into experts_published values('${expert}','${user}',true,gen_random_uuid(),'${draft}');
 insert into early_bird_launch_configs values('${config}',true,clock_timestamp()+interval '1 day');
 insert into channel_identities values(gen_random_uuid(),'${user}','telegram','promo','active','123','123');
 create role ${login} login inherit;grant ii_tonya_wave_launch_kit_worker to ${login};
 `),
  );
}, 120000);
afterAll(async () => {
  if (fixture) {
    try {
      await fixture.db.execute(
        sql.raw(
          `DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${login}') THEN EXECUTE 'drop owned by ${login}';EXECUTE 'drop role ${login}';END IF;END$$`,
        ),
      );
    } finally {
      await fixture.stop();
    }
  }
}, 120000);
it("gates by actual launch and verified publication, persists once-only dispatch under an isolated role", async () => {
  const client = await fixture.db.$client.connect();
  await client.query(`set session authorization ${login}`);
  try {
    const store = new PostgresEarlyBirdLaunchKit(
      drizzle(client) as unknown as DrizzleDb,
      {
        expectedLogin: login,
        botKey: "promo",
        messagingPolicyVersion: "current",
        contentVersion: version,
        payloadDigest: digest,
      },
    );
    await expect(
      client.query("select * from early_bird_launch_kit_jobs"),
    ).rejects.toMatchObject({ code: "42501" });
    expect(await store.enqueue(20)).toBe(0);
    expect(await store.claim()).toBeNull();
    await fixture.db.execute(
      sql`update early_bird_launch_configs set client_start_at=clock_timestamp()-interval '1 second'`,
    );
    expect(await store.enqueue(20)).toBe(0); // Date alone is insufficient.
    await fixture.db.execute(
      sql`update test_publication_authority set allowed=true`,
    );
    await fixture.db.execute(sql`update experts set verified=false`);
    expect(await store.enqueue(20)).toBe(0);
    await fixture.db.execute(sql`update experts set verified=true`);
    expect(await store.enqueue(20)).toBe(1);
    expect(await store.enqueue(20)).toBe(0);
    const claim = await store.claim();
    expect(claim?.userId).toBe(user);
    expect(await store.claim()).toBeNull();
    const targets: unknown[] = [];
    const sent = await store.sendIfCurrent(claim!, async (target) => {
      targets.push(target);
      return { messageIds: ["42", "43"] };
    });
    expect(sent).toEqual({ kind: "delivered", messageIds: ["42", "43"] });
    expect(targets).toEqual([{ chatId: "123" }]);
    await expect(
      store.finish(claim!, { kind: "delivered", messageIds: ["42", "42"] }),
    ).rejects.toThrow();
    expect(await store.finish(claim!, sent)).toBe(true);
    expect(await store.finish(claim!, sent)).toBe(false);
    expect(
      await new PostgresEarlyBirdLaunchKit(
        drizzle(client) as unknown as DrizzleDb,
        {
          expectedLogin: login,
          botKey: "promo",
          messagingPolicyVersion: "current",
          contentVersion: version,
          payloadDigest: digest,
        },
      ).claim(),
    ).toBeNull();
    // Replacing a public expert row must not erase a delivered/unknown ledger.
    const replacement = randomUUID();
    await fixture.db.execute(sql`delete from experts where id=${expert}::uuid`);
    await fixture.db.execute(
      sql`insert into experts values(${replacement}::uuid,${user}::uuid,true,true)`,
    );
    await fixture.db.execute(
      sql`update experts_published set expert_id=${replacement}::uuid where user_id=${user}::uuid`,
    );
    expect(await store.enqueue(20)).toBe(0);
    expect(
      (
        await fixture.db.execute(
          sql`select id from early_bird_launch_kit_jobs where user_id=${user}::uuid`,
        )
      ).rows,
    ).toHaveLength(1);
    await fixture.db.execute(
      sql.raw(`grant select on early_bird_launch_kit_jobs to ${login}`),
    );
    await expect(store.enqueue(20)).rejects.toThrow(
      "early_bird_deferred_principal_unsafe",
    );
  } finally {
    await client.query("reset session authorization");
    client.release();
  }
}, 120000);
it("rechecks publication after dispatch and never retries partial/uncertain delivery", async () => {
  const uid = randomUUID(),
    eid = randomUUID(),
    did = randomUUID();
  await fixture.db.execute(sql`insert into users values(${uid}::uuid,true)`);
  await fixture.db.execute(
    sql`insert into experts values(${eid}::uuid,${uid}::uuid,true,true)`,
  );
  await fixture.db.execute(
    sql`insert into expert_card_drafts values(${did}::uuid,${uid}::uuid,'current')`,
  );
  await fixture.db.execute(
    sql`insert into experts_published values(${eid}::uuid,${uid}::uuid,true,gen_random_uuid(),${did}::uuid)`,
  );
  await fixture.db.execute(
    sql`insert into channel_identities values(gen_random_uuid(),${uid}::uuid,'telegram','promo','active','456','456')`,
  );
  await fixture.db.execute(
    sql.raw(`revoke select on early_bird_launch_kit_jobs from ${login}`),
  );
  const client = await fixture.db.$client.connect();
  await client.query(`set session authorization ${login}`);
  try {
    const store = new PostgresEarlyBirdLaunchKit(
      drizzle(client) as unknown as DrizzleDb,
      {
        expectedLogin: login,
        botKey: "promo",
        messagingPolicyVersion: "current",
        contentVersion: version,
        payloadDigest: digest,
      },
    );
    expect(await store.enqueue(20)).toBe(1);
    const claim = (await store.claim())!;
    await fixture.db.execute(
      sql`update experts_published set active=false where user_id=${uid}::uuid`,
    );
    let sends = 0;
    expect(
      await store.sendIfCurrent(claim, async () => {
        sends++;
        return { messageIds: ["50", "51"] };
      }),
    ).toEqual({ kind: "cancelled" });
    expect(sends).toBe(0);
    await fixture.db.execute(
      sql`update experts_published set active=true where user_id=${uid}::uuid`,
    );
    expect(
      await store.sendIfCurrent(claim, async () => {
        throw new Error("synthetic partialdelivery");
      }),
    ).toEqual({ kind: "uncertain" });
    expect(await store.finish(claim, { kind: "uncertain" })).toBe(true);
    expect(await store.enqueue(20)).toBe(0);
    expect(await store.claim()).toBeNull();
    await fixture.db.execute(
      sql`insert into expert_sales_erased_cohorts values(${uid}::uuid)`,
    );
    expect(
      (
        await fixture.db.execute(
          sql`select id from early_bird_launch_kit_jobs where user_id=${uid}::uuid`,
        )
      ).rows,
    ).toHaveLength(0);
  } finally {
    await client.query("reset session authorization");
    client.release();
  }
}, 120000);

it("rechecks launch-kit eligibility after waiting for an in-progress erasure subject lock", async () => {
  const uid = randomUUID(),
    eid = randomUUID(),
    did = randomUUID();
  await fixture.db.execute(sql`insert into users values(${uid}::uuid,true)`);
  await fixture.db.execute(
    sql`insert into experts values(${eid}::uuid,${uid}::uuid,true,true)`,
  );
  await fixture.db.execute(
    sql`insert into expert_card_drafts values(${did}::uuid,${uid}::uuid,'current')`,
  );
  await fixture.db.execute(
    sql`insert into experts_published values(${eid}::uuid,${uid}::uuid,true,gen_random_uuid(),${did}::uuid)`,
  );
  await fixture.db.execute(
    sql`insert into channel_identities values(gen_random_uuid(),${uid}::uuid,'telegram','promo','active','789','789')`,
  );
  const privacy = await fixture.db.$client.connect(),
    enqueue = await fixture.db.$client.connect();
  let pending: Promise<number> | undefined;
  try {
    await privacy.query("begin");
    await privacy.query(
      "select pg_advisory_xact_lock(hashtextextended($1::uuid::text,0))",
      [uid],
    );
    await privacy.query(
      "insert into expert_sales_erased_cohorts(user_id) values($1::uuid)",
      [uid],
    );
    const pid = Number(
      (await enqueue.query("select pg_backend_pid() as id")).rows[0].id,
    );
    await enqueue.query(`set session authorization ${login}`);
    const store = new PostgresEarlyBirdLaunchKit(
      drizzle(enqueue) as unknown as DrizzleDb,
      {
        expectedLogin: login,
        botKey: "promo",
        messagingPolicyVersion: "current",
        contentVersion: version,
        payloadDigest: digest,
      },
    );
    let completed = false;
    pending = store.enqueue(20);
    void pending.then(
      () => {
        completed = true;
      },
      () => {
        completed = true;
      },
    );
    let waiting = false;
    const end = Date.now() + 1200;
    while (Date.now() < end && !completed) {
      const activity = await fixture.db.execute<{ waiting: boolean }>(
        sql`select wait_event='advisory' as waiting from pg_stat_activity where pid=${pid}`,
      );
      if (activity.rows[0]?.waiting === true) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(waiting).toBe(true);
    expect(completed).toBe(false);
    await privacy.query("commit");
    expect(await pending).toBe(0);
    expect(
      (
        await fixture.db.execute(
          sql`select id from early_bird_launch_kit_jobs where user_id=${uid}::uuid`,
        )
      ).rows,
    ).toHaveLength(0);
  } finally {
    await privacy.query("rollback").catch(() => undefined);
    await pending?.catch(() => undefined);
    await enqueue.query("reset session authorization");
    enqueue.release();
    privacy.release();
  }
}, 120000);
