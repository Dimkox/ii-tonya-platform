import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { getTestPostgresPorts } from "../../../tests/support/test-docker-runner.mjs";
import { PostgresWorkerReceiptRetention } from "../../../packages/db/src/repositories/early-bird-worker-receipt-retention.js";
import { requireDeferredPrincipal } from "../../../packages/db/src/repositories/early-bird-deferred-principal.js";
import {
  closeDb,
  createDb,
  migrateDb,
  type DrizzleDb,
} from "../../../packages/db/src/client.js";
import { createGatewayWorkerBootstrap } from "./gateway-worker-bootstrap.js";
import type { RuntimeConfig } from "@ii-tonya/config";
const roleCredential = randomBytes(24).toString("hex");
let database: DrizzleDb;
let container: string;
let temp: string;
beforeAll(async () => {
  const ports = await getTestPostgresPorts();
  const credential = randomBytes(24).toString("hex");
  container = execFileSync(
    "docker",
    [
      "run",
      "-d",
      ...ports.dockerArgs,
      "-e",
      "POSTGRES_PASSWORD",
      "-e",
      "POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256",
      "postgres:17.5-bookworm",
      "postgres",
      ...ports.postgresArgs,
    ],
    {
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, POSTGRES_PASSWORD: credential },
    },
  ).trim();
  const url = new URL(
    `postgresql://postgres@127.0.0.1:${ports.clientPort(container)}/postgres`,
  );
  url.password = credential;
  database = createDb(url.toString(), { connectionTimeoutMillis: 1000 });
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      await database.$client.query("select 1");
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(200);
    }
  }
  await migrateDb(database, "packages/db/migrations");
  for (const signature of [
    "public.early_bird_wave_retention_list(integer)",
    "public.early_bird_worker_review_list(uuid,integer)",
    "public.early_bird_final_call_worker(text,jsonb)",
    "public.early_bird_publication_worker(text,jsonb)",
    "public.early_bird_launch_kit_worker(text,jsonb)",
  ]) {
    const present = await database.$client.query(
      "select to_regprocedure($1) is not null as present",
      [signature],
    );
    expect(present.rows[0]?.present).toBe(true);
  }
  await database.$client.query(`
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
    create role worker_review_source login password '${roleCredential}'; grant ii_tonya_worker_review_source to worker_review_source;
    create role worker_review_prepare login password '${roleCredential}'; grant ii_tonya_deferred_account_writer to worker_review_prepare;
    create role worker_final_call login password '${roleCredential}'; grant ii_tonya_wave_final_call_worker to worker_final_call;
    create role worker_wave_retention login password '${roleCredential}'; grant ii_tonya_worker_wave_retention to worker_wave_retention;
    create role worker_deferred_retention login password '${roleCredential}'; grant ii_tonya_worker_deferred_retention to worker_deferred_retention;
    create role worker_publication login password '${roleCredential}'; grant ii_tonya_wave_publication_worker to worker_publication;
    create role worker_launch_kit login password '${roleCredential}'; grant ii_tonya_wave_launch_kit_worker to worker_launch_kit;
  `);
}, 120000);
afterAll(async () => {
  try {
    if (temp) rmSync(temp, { recursive: true, force: true });
  } finally {
    try {
      if (database) await closeDb(database);
    } finally {
      if (container)
        execFileSync("docker", ["rm", "-fv", container], {
          stdio: "ignore",
          timeout: 60_000,
        });
    }
  }
}, 120000);
it("starts the worker capabilities with seven distinct database logins and closes them", async () => {
  temp = mkdtempSync(join(tmpdir(), "worker-real-roles-"));
  const file = (name: string, value: string) => {
    const p = join(temp, name);
    writeFileSync(p, value, { mode: 0o600 });
    return p;
  };
  const initial = database.$client.options.connectionString!;
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
      url.password = roleCredential;
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
  prepareUrl.password = roleCredential;
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
