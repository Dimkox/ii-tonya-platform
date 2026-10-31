import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  startDisposableTestPostgres,
  type TestDatabase,
} from "../../../packages/db/src/testkit/postgres.js";
import { PostgresWorkerReceiptRetention } from "../../../packages/db/src/repositories/early-bird-worker-receipt-retention.js";
import { requireDeferredPrincipal } from "../../../packages/db/src/repositories/early-bird-deferred-principal.js";
import { createDb, closeDb } from "../../../packages/db/src/client.js";
import { createGatewayWorkerBootstrap } from "./gateway-worker-bootstrap.js";
import type { RuntimeConfig } from "@ii-tonya/config";
let fixture: TestDatabase;
let temp: string;
beforeAll(async () => {
  fixture = await startDisposableTestPostgres();
  await fixture.migrate();
  for (const signature of [
    "public.early_bird_wave_retention_list(integer)",
    "public.early_bird_worker_review_list(uuid,integer)",
    "public.early_bird_final_call_worker(text,jsonb)",
    "public.early_bird_publication_worker(text,jsonb)",
    "public.early_bird_launch_kit_worker(text,jsonb)",
  ]) {
    const present = await fixture.db.$client.query(
      "select to_regprocedure($1) is not null as present",
      [signature],
    );
    expect(present.rows[0]?.present).toBe(true);
  }
  await fixture.db.$client.query(`
    create role ii_tonya_worker_review_source nologin noinherit;
    create role ii_tonya_deferred_account_writer nologin noinherit;
    do $$ begin if not exists (select 1 from pg_roles where rolname='ii_tonya_wave_final_call_worker') then create role ii_tonya_wave_final_call_worker nologin noinherit; end if; end $$;
    create role ii_tonya_worker_wave_retention nologin noinherit;
    create role ii_tonya_worker_deferred_retention nologin noinherit;
    create role ii_tonya_wave_publication_worker nologin noinherit;
    create role ii_tonya_wave_launch_kit_worker nologin noinherit;
    grant usage on schema public to ii_tonya_worker_review_source,ii_tonya_deferred_account_writer,ii_tonya_wave_final_call_worker,ii_tonya_worker_wave_retention,ii_tonya_worker_deferred_retention,ii_tonya_wave_publication_worker,ii_tonya_wave_launch_kit_worker;
    grant execute on function early_bird_worker_review_list(uuid,integer),early_bird_worker_review_resolve(uuid,uuid) to ii_tonya_worker_review_source;
    grant execute on function early_bird_deferred_prepare(uuid,uuid,uuid,uuid,uuid) to ii_tonya_deferred_account_writer;
    grant execute on function early_bird_final_call_worker(text,jsonb) to ii_tonya_wave_final_call_worker;
    grant execute on function early_bird_wave_retention_list(integer),early_bird_wave_retention_expire(uuid,uuid) to ii_tonya_worker_wave_retention;
    grant execute on function early_bird_deferred_retention_list(integer),early_bird_deferred_retention_expire(uuid,uuid) to ii_tonya_worker_deferred_retention;
    grant execute on function early_bird_publication_worker(text,jsonb) to ii_tonya_wave_publication_worker;
    grant execute on function early_bird_launch_kit_worker(text,jsonb) to ii_tonya_wave_launch_kit_worker;
    create role worker_review_source login password 'synthetic'; grant ii_tonya_worker_review_source to worker_review_source;
    create role worker_review_prepare login password 'synthetic'; grant ii_tonya_deferred_account_writer to worker_review_prepare;
    create role worker_final_call login password 'synthetic'; grant ii_tonya_wave_final_call_worker to worker_final_call;
    create role worker_wave_retention login password 'synthetic'; grant ii_tonya_worker_wave_retention to worker_wave_retention;
    create role worker_deferred_retention login password 'synthetic'; grant ii_tonya_worker_deferred_retention to worker_deferred_retention;
    create role worker_publication login password 'synthetic'; grant ii_tonya_wave_publication_worker to worker_publication;
    create role worker_launch_kit login password 'synthetic'; grant ii_tonya_wave_launch_kit_worker to worker_launch_kit;
  `);
}, 120000);
afterAll(async () => {
  if (temp) rmSync(temp, { recursive: true, force: true });
  await fixture?.stop();
}, 120000);
it("starts the worker capabilities with seven distinct database logins and closes them", async () => {
  temp = mkdtempSync(join(tmpdir(), "worker-real-roles-"));
  const file = (name: string, value: string) => {
    const p = join(temp, name);
    writeFileSync(p, value, { mode: 0o600 });
    return p;
  };
  const initial = fixture.db.$client.options.connectionString!;
  const users = {
    reviewSource: "worker_review_source",
    reviewPrepare: "worker_review_prepare",
    finalCall: "worker_final_call",
    waveRetention: "worker_wave_retention",
    deferredRetention: "worker_deferred_retention",
    publication: "worker_publication",
    launchKit: "worker_launch_kit",
  };
  const databases = Object.fromEntries(
    Object.entries(users).map(([name, login]) => {
      const url = new URL(initial);
      url.username = login;
      url.password = "synthetic";
      return [name, { login, urlFile: file(name, url.toString()) }];
    }),
  );
  const descriptor = file(
    "descriptor",
    JSON.stringify({
      version: 1,
      ipc: {
        address: "@synthetic",
        subjectKeyFile: file(
          "subject",
          Buffer.alloc(32, 1).toString("base64url"),
        ),
        authKeyFile: file("auth", Buffer.alloc(32, 2).toString("base64url")),
        subjectKeyVersion: "v1",
      },
      identityKeyFile: file(
        "identity",
        Buffer.alloc(32, 3).toString("base64url"),
      ),
      tokenFile: file("token", "123:abcdefghijklmnopqrstuvwxyz"),
      botKey: "expert",
      messagingPolicyVersion: "v1",
      databases,
    }),
  );
  const config = {
    databaseUrl: initial,
    yookassaGateway: { workerConfigFile: descriptor },
  } as RuntimeConfig;
  const bootstrap = await createGatewayWorkerBootstrap(config);
  const prepareUrl = new URL(initial);
  prepareUrl.username = users.reviewPrepare;
  prepareUrl.password = "synthetic";
  const prepareDb = createDb(prepareUrl.toString());
  try {
    await prepareDb.transaction((tx) =>
      requireDeferredPrincipal(
        tx,
        users.reviewPrepare,
        "ii_tonya_deferred_account_writer",
        "public.early_bird_deferred_prepare(uuid,uuid,uuid,uuid,uuid)",
      ),
    );
    expect(
      await new PostgresWorkerReceiptRetention(
        bootstrap.waveRetentionDb,
        bootstrap.waveRetentionLogin,
        "wave",
      ).listExpired(),
    ).toEqual([]);
    expect(
      await new PostgresWorkerReceiptRetention(
        bootstrap.deferredRetentionDb,
        bootstrap.deferredRetentionLogin,
        "deferred",
      ).listExpired(),
    ).toEqual([]);
    await bootstrap.review.run(10, new AbortController().signal);
    await bootstrap.finalCall.run(10, new AbortController().signal);
    await bootstrap.publication.run(10, new AbortController().signal);
    await bootstrap.launchKit.run(10, new AbortController().signal);
  } finally {
    await closeDb(prepareDb);
    await bootstrap.close();
  }
}, 120000);
