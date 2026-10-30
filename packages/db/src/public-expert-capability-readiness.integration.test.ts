import { afterAll, beforeAll, expect, it } from "vitest";
import {
  ExperimentalGatewayIpc,
  createPayerReceiptVault,
} from "@ii-tonya/integrations";
import {
  startDisposableTestPostgres,
  type TestDatabase,
} from "./testkit/postgres.js";
import { createDb, closeDb } from "./client.js";
import {
  createPublicExpertPaymentRuntime,
  publicExpertConnectionNames,
  type PublicExpertRuntimeConfiguration,
} from "./public-expert-payment-runtime.js";
import {
  buildEarlyBirdRoleProvisioningSql,
  loadEarlyBirdRoleCapabilities,
} from "../../../scripts/provision-early-bird-runtime-roles.mjs";
let database: TestDatabase;
let runtime: ReturnType<typeof createPublicExpertPaymentRuntime>;
const connections = {} as PublicExpertRuntimeConfiguration["connections"];
const sender = "readiness_onboard";
const cap = "ii_tonya_public_onboarding_sender";
const password = ["synthetic", "readiness", "only"].join("-");
beforeAll(async () => {
  database = await startDisposableTestPostgres();
  await database.migrate();
  expect(
    (await database.db.$client.query("show server_version_num")).rows[0]
      ?.server_version_num,
  ).toBe("170005");
  const capabilities = (await loadEarlyBirdRoleCapabilities()).filter(
    (entry) => entry.migration === 84,
  );
  const mapping: Record<string, string> = {};
  for (const [index, name] of publicExpertConnectionNames.entries()) {
    const capability = capabilities.find((entry) =>
      entry.runtimeKeys.includes(name),
    )!;
    const login = index === 0 ? sender : `readiness_${name.toLowerCase()}`;
    mapping[capability.role] = login;
    await database.db.$client.query(
      `create role ${login} login password '${password}' inherit`,
    );
    const url = new URL(database.db.$client.options.connectionString!);
    url.username = login;
    url.password = password;
    connections[name] = { login, db: createDb(url.toString(), { max: 1 }) };
  }
  await database.db.$client.query(
    await buildEarlyBirdRoleProvisioningSql(mapping),
  );
  await database.db.$client.query(
    "create role readiness_other login; create role readiness_indirect nologin; create schema readiness_extra; create table readiness_extra.hidden(id integer)",
  );
  const key = Buffer.alloc(32, 7);
  runtime = createPublicExpertPaymentRuntime(database.db, {
    connections,
    gateway: new ExperimentalGatewayIpc({
      address: "\0unused-readiness",
      key,
      authKey: Buffer.alloc(32, 8),
      timeoutMs: 100,
    }),
    mode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
    vault: createPayerReceiptVault({
      activeKeyId: "fixture",
      keys: new Map([["fixture", key]]),
    }),
    requestKey: key,
    requestKeyReference: "request:v1",
    retainedRequestKeys: new Map([["request:v1", key]]),
    returnUrl: "https://example.invalid/return",
    vatCode: 1,
  });
}, 120_000);
afterAll(async () => {
  await Promise.all(
    Object.values(connections).map((entry) => closeDb(entry.db)),
  );
  await database?.stop();
}, 120_000);
it("accepts the exact five provisioned LOGINs without provider I/O", async () => {
  await expect(runtime.assertReady()).resolves.toBeUndefined();
});
const grants = [
  [
    "extra financial helper",
    `execute on function early_bird_private.public_payment_apply_guard(uuid,uuid,uuid)`,
    sender,
  ],
  ["direct unrelated table", "select on users", sender],
  ["column privilege", "select(id) on users", sender],
  [
    "identity sequence",
    "usage on sequence public_expert_payment_observations_observation_sequence_seq",
    sender,
  ],
  [
    "capability sequence",
    "usage on sequence public_expert_payment_observations_observation_sequence_seq",
    cap,
  ],
  ["schema CREATE", "create on schema public", sender],
  ["capability schema CREATE", "create on schema public", cap],
  ["other namespace table", "select on readiness_extra.hidden", sender],
  ["other namespace CREATE", "create on schema readiness_extra", sender],
  ["nested membership", "readiness_indirect", cap],
  ["additional membership", "ii_tonya_public_payment_binder", sender],
  ["additional capability LOGIN", cap, "readiness_other"],
  [
    "PUBLIC execution",
    "execute on function early_bird_private.public_onboarding_snapshot(uuid,uuid)",
    "public",
  ],
] as const;
it.each(grants)(
  "rejects %s drift at actual startup",
  async (_name, privilege, principal) => {
    const q = database.db.$client;
    await q.query(`grant ${privilege} to ${principal}`);
    try {
      await expect(runtime.assertReady()).rejects.toThrow(/public_expert_/);
    } finally {
      await q.query(`revoke ${privilege} from ${principal}`);
    }
  },
);
it("rejects database CREATE even when the required functions remain executable", async () => {
  const q = database.db.$client,
    name = (await q.query("select current_database() name")).rows[0]
      .name as string;
  await q.query(
    `grant create on database "${name.replaceAll('"', '""')}" to ${sender}`,
  );
  try {
    await expect(runtime.assertReady()).rejects.toThrow(/public_expert_/);
  } finally {
    await q.query(
      `revoke create on database "${name.replaceAll('"', '""')}" from ${sender}`,
    );
  }
});
it("rejects replication privilege omitted by the former subset audit", async () => {
  const q = database.db.$client;
  await q.query(`alter role ${sender} replication`);
  try {
    await expect(runtime.assertReady()).rejects.toThrow(/public_expert_/);
  } finally {
    await q.query(`alter role ${sender} noreplication`);
  }
});
it.each([
  [
    "ii_tonya_public_onboarding_sender",
    "public_onboarding_snapshot(uuid,uuid)",
  ],
  ["ii_tonya_public_main_sender", "public_main_snapshot(uuid,uuid)"],
  ["ii_tonya_public_refund_sender", "public_refund_snapshot(uuid,uuid)"],
  ["ii_tonya_public_payment_binder", "public_payment_bound(uuid)"],
  ["ii_tonya_public_payment_fact_writer", "public_payment_expire(uuid,uuid)"],
])("rejects missing required execution on %s / %s", async (role, signature) => {
  const q = database.db.$client;
  await q.query(
    `revoke execute on function early_bird_private.${signature} from ${role}`,
  );
  try {
    await expect(runtime.assertReady()).rejects.toThrow(/public_expert_/);
  } finally {
    await q.query(
      `grant execute on function early_bird_private.${signature} to ${role}`,
    );
  }
});
it("accepts restored exact rights after every drift was removed", async () => {
  await expect(runtime.assertReady()).resolves.toBeUndefined();
});
