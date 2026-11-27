import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { setImmediate, setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ExperimentalGatewayIpc } from "@ii-tonya/integrations";
import { getTestPostgresPorts } from "../../../../tests/support/test-docker-runner.mjs";
import {
  createPublicExpertPaymentRuntime,
  publicExpertConnectionNames,
} from "../public-expert-payment-runtime.js";
import { publicTestVault } from "./public-expert-payment.js";
import { createDb, migrateDb, type DrizzleDb } from "../client.js";
import { createPublicExpertRuntimePrincipals } from "./public-expert-runtime-principals.js";

let database: DrizzleDb;
let container: string | undefined;
const factories: Awaited<
  ReturnType<typeof createPublicExpertRuntimePrincipals>
>[] = [];
beforeAll(async () => {
  const credential = randomBytes(24).toString("hex");
  const ports = await getTestPostgresPorts();
  const containerId = execFileSync(
    "docker",
    [
      "run",
      "-d",
      "--name",
      "public-principals-" + randomBytes(8).toString("hex"),
      ...ports.dockerArgs,
      "-e",
      "POSTGRES_PASSWORD",
      "-e",
      "POSTGRES_DB=principals_fixture",
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
  if (!/^[a-f0-9]{64}$/u.test(containerId))
    throw new Error("principals_fixture_container_id_invalid");
  container = containerId;
  const port = ports.clientPort(containerId);
  const connectionString = `postgresql://postgres:${credential}@127.0.0.1:${port}/principals_fixture`;
  database = createDb(connectionString, {
    max: 3,
    connectionTimeoutMillis: 1000,
  });
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const authenticated = await database.$client.query(
        "select current_setting('server_version_num') as version, session_user as login, current_database() as database",
      );
      expect(authenticated.rows[0]).toEqual({
        version: "170005",
        login: "postgres",
        database: "principals_fixture",
      });
      break;
    } catch (error) {
      if (Date.now() >= deadline)
        throw new Error("principals_fixture_pg_readiness_failed", {
          cause: error,
        });
      await delay(200);
    }
  }
  const wrongPasswordUrl = new URL(connectionString);
  wrongPasswordUrl.password = randomBytes(16).toString("hex");
  const unauthenticated = createDb(wrongPasswordUrl.toString(), {
    max: 1,
    connectionTimeoutMillis: 1000,
  });
  try {
    await expect(
      unauthenticated.$client.query("select 1"),
    ).rejects.toMatchObject({
      code: "28P01",
    });
  } finally {
    await unauthenticated.$client.end();
  }
  await migrateDb(database, "packages/db/migrations");
}, 120_000);
afterAll(async () => {
  try {
    const results = await Promise.allSettled(
      factories.map((factory) => factory.close()),
    );
    const failed = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failed.length)
      throw new AggregateError(
        failed.map((result) => result.reason as unknown),
        "principals_fixture_cleanup_failed",
      );
  } finally {
    try {
      await database?.$client.end();
    } finally {
      if (container)
        execFileSync("docker", ["rm", "-fv", container], {
          stdio: "ignore",
          timeout: 60_000,
        });
    }
  }
}, 120_000);
function runtime(principals: (typeof factories)[number]) {
  const key = randomBytes(32);
  return createPublicExpertPaymentRuntime(database, {
    connections: principals.connections,
    gateway: new ExperimentalGatewayIpc({
      address: "\0unused-principals",
      key,
      authKey: randomBytes(32),
      timeoutMs: 10,
    }),
    mode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
    vault: publicTestVault,
    requestKey: key,
    requestKeyReference: "principals:v1",
    retainedRequestKeys: new Map([["principals:v1", key]]),
    returnUrl: "https://example.invalid/return",
    vatCode: 1,
  });
}
it("provisions genuine runtime roles, preserves an active factory on conflict, and drains before removing only its logins", async () => {
  const query = database.$client.query.bind(database.$client);
  const first = await createPublicExpertRuntimePrincipals(database);
  factories.push(first);
  const firstRuntime = runtime(first);
  try {
    await expect(firstRuntime.assertReady()).resolves.toBeUndefined();
  } finally {
    await firstRuntime.stop();
  }
  await expect(
    createPublicExpertRuntimePrincipals(database),
  ).rejects.toMatchObject({ message: "early_bird_role_membership_unsafe" });
  const names = publicExpertConnectionNames.map(
    (name) => first.connections[name].login,
  );
  expect(
    (
      await query(
        "select rolname from pg_roles where rolname like 'public_runtime_fixture_%' order by rolname",
      )
    ).rows.map((row) => row.rolname),
  ).toEqual([...names].sort());
  const retained = runtime(first);
  try {
    await expect(retained.assertReady()).resolves.toBeUndefined();
  } finally {
    await retained.stop();
  }
  const held = await first.connections.binder.db.$client.connect();
  let released = false;
  let finished = false;
  try {
    const closing = first.close();
    void closing.then(() => {
      finished = true;
    });
    expect(first.close()).toBe(closing);
    await setImmediate();
    expect(finished).toBe(false);
    expect(
      (
        await query(
          "select count(*)::int n from pg_roles where rolname=any($1::text[])",
          [names],
        )
      ).rows[0]!.n,
    ).toBe(5);
    expect((await held.query("select session_user name")).rows[0]!.name).toBe(
      first.connections.binder.login,
    );
    held.release();
    released = true;
    await closing;
    expect(finished).toBe(true);
  } finally {
    if (!released) held.release();
  }
  expect(
    (
      await query(
        "select count(*)::int n from pg_roles where rolname=any($1::text[])",
        [names],
      )
    ).rows[0]!.n,
  ).toBe(0);
  expect(
    (
      await query(
        "select has_function_privilege('ii_tonya_public_payment_binder','early_bird_private.public_payment_bind(uuid,text,jsonb)','EXECUTE') allowed",
      )
    ).rows[0]!.allowed,
  ).toBe(true);
  const second = await createPublicExpertRuntimePrincipals(database);
  factories.push(second);
  expect(
    publicExpertConnectionNames.map((name) => second.connections[name].login),
  ).not.toEqual(names);
  const secondRuntime = runtime(second);
  try {
    await expect(secondRuntime.assertReady()).resolves.toBeUndefined();
  } finally {
    await secondRuntime.stop();
  }
  await second.close();
  expect(
    (
      await query(
        "select count(*)::int n from pg_roles where rolname like 'public_runtime_fixture_%'",
      )
    ).rows[0]!.n,
  ).toBe(0);
}, 120_000);
