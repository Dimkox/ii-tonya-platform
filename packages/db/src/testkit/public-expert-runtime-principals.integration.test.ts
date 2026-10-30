import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { setImmediate, setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ExperimentalGatewayIpc } from "@ii-tonya/integrations";
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
  container = "public-principals-" + randomBytes(8).toString("hex");
  execFileSync(
    "docker",
    [
      "run",
      "-d",
      "--name",
      container,
      "-p",
      "127.0.0.1::5432",
      "-e",
      "POSTGRES_PASSWORD",
      "-e",
      "POSTGRES_DB=principals_fixture",
      "postgres:17.5-bookworm",
    ],
    {
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, POSTGRES_PASSWORD: credential },
    },
  );
  const port = execFileSync(
    "docker",
    [
      "inspect",
      "--format",
      '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
      container,
    ],
    { encoding: "utf8", timeout: 15_000 },
  ).trim();
  database = createDb(
    `postgresql://postgres:${credential}@127.0.0.1:${port}/principals_fixture`,
    { max: 3, connectionTimeoutMillis: 1000 },
  );
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      expect(
        (await database.$client.query("show server_version_num")).rows[0]!
          .server_version_num,
      ).toBe("170005");
      break;
    } catch (error) {
      if (Date.now() >= deadline)
        throw new Error("principals_fixture_pg_readiness_failed", {
          cause: error,
        });
      await delay(200);
    }
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
