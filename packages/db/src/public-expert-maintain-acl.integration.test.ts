import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  ExperimentalGatewayIpc,
  createPayerReceiptVault,
} from "@ii-tonya/integrations";
import {
  startDisposableTestPostgres,
  type TestDatabase,
} from "./testkit/postgres.js";
import { createDb, closeDb, type DrizzleDb } from "./client.js";
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
let gateway: DrizzleDb;
let provision: string;
const connections = {} as PublicExpertRuntimeConfiguration["connections"];
const mapping: Record<string, string> = {};
const gatewayRole = "ii_tonya_wave_gateway",
  senderRole = "ii_tonya_public_onboarding_sender";
const oldPrivileges = "SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER";
const readiness = () =>
  readFileSync("scripts/experimental/yookassa_gateway/readiness.sql", "utf8");
beforeAll(async () => {
  database = await startDisposableTestPostgres();
  await database.migrate();
  expect(
    (await database.db.$client.query("show server_version_num")).rows[0]
      ?.server_version_num,
  ).toBe("170005");
  const capabilities = await loadEarlyBirdRoleCapabilities();
  for (const [index, capability] of capabilities.entries()) {
    const login = `maintain_runtime_${index}`;
    mapping[capability.role] = login;
    await database.db.$client.query(
      `create role ${login} login password 'synthetic-maintain-only' inherit`,
    );
  }
  provision = await buildEarlyBirdRoleProvisioningSql(mapping);
  await database.db.$client.query(provision);
  const connect = (login: string) => {
    const address = new URL(database.db.$client.options.connectionString!);
    address.username = login;
    address.password = "synthetic-maintain-only";
    return createDb(address.toString(), { max: 1 });
  };
  for (const name of publicExpertConnectionNames) {
    const capability = capabilities.find(
      (entry) => entry.migration === 84 && entry.runtimeKeys.includes(name),
    )!;
    const login = mapping[capability.role]!;
    connections[name] = { login, db: connect(login) };
  }
  gateway = connect(mapping[gatewayRole]!);
  const key = Buffer.alloc(32, 9);
  runtime = createPublicExpertPaymentRuntime(database.db, {
    connections,
    gateway: new ExperimentalGatewayIpc({
      address: "\0unused-maintain",
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
  await Promise.all([
    ...Object.values(connections).map((entry) => closeDb(entry.db)),
    ...(gateway ? [closeDb(gateway)] : []),
  ]);
  await database?.stop();
}, 120_000);
const clean = async () => {
  await expect(runtime.assertReady()).resolves.toBeUndefined();
  await database.db.$client.query(provision);
  expect((await gateway.$client.query(readiness())).rows).toEqual([
    { exists: true },
  ]);
};
it("accepts clean function-only roles before any MAINTAIN grant", clean);
it.each(["runtime", "provision", "gateway"] as const)(
  "%s denies effective MAINTAIN from LOGIN, capability and PUBLIC",
  async (gate) => {
    const capability = gate === "gateway" ? gatewayRole : senderRole,
      login = mapping[capability]!;
    const operator = await database.db.$client.connect();
    try {
      for (const recipient of [login, capability, "public"]) {
        await operator.query(
          `grant maintain on table public.users to ${recipient}`,
        );
        try {
          const privileges = (
            await operator.query(
              "select has_table_privilege($1,'public.users','MAINTAIN') maintain,has_table_privilege($1,'public.users',$2) legacy",
              [login, oldPrivileges],
            )
          ).rows[0];
          expect(privileges).toEqual({ maintain: true, legacy: false });
          if (gate === "runtime")
            await expect(runtime.assertReady()).rejects.toThrow(
              "public_expert_capability_grants_invalid",
            );
          else if (gate === "gateway")
            expect((await gateway.$client.query(readiness())).rows).toEqual([
              { exists: false },
            ]);
          else {
            await expect(operator.query(provision)).rejects.toMatchObject({
              message: "early_bird_role_extra_privilege",
            });
            await operator.query("ROLLBACK");
          }
        } finally {
          await operator.query("ROLLBACK");
          await operator.query(
            `revoke maintain on table public.users from ${recipient}`,
          );
        }
      }
    } finally {
      operator.release();
    }
  },
);
it("all exact legacy audits select MAINTAIN only for PostgreSQL17+", async () => {
  const files = [
    "worker-principal",
    "deferred-principal",
    "refund-binding-store",
    "candidate-intent-reader",
    "verified-payment-reader",
    "standard-send-admission",
    "refund-settlement-store",
    "payment-settlement-store",
    "verified-binding-repository",
    "owner-send-admission",
    "refund-binding-reader",
  ].map((name) => `packages/db/src/repositories/early-bird-${name}.ts`);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    expect(source, file).toContain(
      "current_setting('server_version_num')::integer >= 170000",
    );
    expect(source, file).toContain(oldPrivileges + ",MAINTAIN");
  }
  const expression = readiness().match(
    /CASE WHEN current_setting\('server_version_num'\)::integer >= 170000 THEN '[^']+' ELSE '[^']+' END/u,
  )?.[0];
  expect(expression).toBeDefined();
  if (!expression) throw Error("version_selector_missing");
  for (const [version, expected] of [
    ["160000", oldPrivileges],
    ["170005", oldPrivileges + ",MAINTAIN"],
  ] as const) {
    const selected = (
      await database.db.$client.query(
        `select ${expression.replace("current_setting('server_version_num')", `'${version}'`)} selected`,
      )
    ).rows[0]?.selected;
    expect(selected).toBe(expected);
  }
});
it(
  "restored exact rights pass all gates after MAINTAIN drift is removed",
  clean,
);
