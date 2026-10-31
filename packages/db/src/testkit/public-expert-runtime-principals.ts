import { randomBytes, randomUUID } from "node:crypto";
import { createDb, type DrizzleDb } from "../client.js";
import {
  publicExpertConnectionNames,
  type PublicExpertRuntimeConfiguration,
} from "../public-expert-payment-runtime.js";
import {
  buildEarlyBirdRoleProvisioningSql,
  loadEarlyBirdRoleCapabilities,
} from "../../../../scripts/provision-early-bird-runtime-roles.mjs";

/** One set per disposable cluster: runtime capability roles have exactly one
 * LOGIN member. Call close after all runtimes stop, before the primary DB stops.
 * Cleanup drains pools and removes only generated LOGINs, never shared caps. */
export async function createPublicExpertRuntimePrincipals(database: DrizzleDb) {
  const primary = database.$client;
  const connections = {} as PublicExpertRuntimeConfiguration["connections"];
  const created: string[] = [];
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      const results = await Promise.allSettled(
        Object.values(connections).map(({ db }) => db.$client.end()),
      );
      const failures = results
        .filter(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        )
        .map((result) => result.reason as unknown);
      if (failures.length)
        throw new AggregateError(
          failures,
          "public_runtime_fixture_drain_failed",
        );
      // Only these generated LOGINs can own local fixture grants. Shared NOLOGIN
      // capabilities and their reviewed function ACLs remain for other fixtures.
      for (const login of created) {
        await primary.query(`drop owned by ${login}`);
        await primary.query(`drop role ${login}`);
      }
    })());
  const capabilities = await loadEarlyBirdRoleCapabilities();
  const mapping: Record<string, string> = {};
  const labels: Array<{
    name: (typeof publicExpertConnectionNames)[number];
    login: string;
  }> = [];
  const prefix = "public_runtime_fixture_" + randomUUID().replaceAll("-", "");
  const password = randomBytes(24).toString("hex");
  for (const [index, name] of publicExpertConnectionNames.entries()) {
    const capability = capabilities.find(
      (entry) => entry.migration === 84 && entry.runtimeKeys.includes(name),
    );
    if (!capability) throw Error("public_runtime_fixture_capability_missing");
    const login = `${prefix}_${index}`;
    mapping[capability.role] = login;
    labels.push({ name, login });
  }
  const provision = await buildEarlyBirdRoleProvisioningSql(mapping);
  const admin = await primary.connect();
  let failure: { error: unknown } | undefined;
  try {
    for (const { login } of labels) {
      await admin.query(
        `create role ${login} login inherit password '${password}'`,
      );
      created.push(login);
    }
    await admin.query(provision);
    for (const { name, login } of labels) {
      const url = new URL(primary.options.connectionString!);
      url.username = login;
      url.password = password;
      connections[name] = { login, db: createDb(url.toString(), { max: 1 }) };
    }
  } catch (error) {
    failure = { error };
    try {
      await admin.query("rollback");
    } catch (rollback) {
      failure.error = new AggregateError(
        [error, rollback],
        "public_runtime_fixture_rollback_failed",
      );
    }
  } finally {
    admin.release();
  }
  if (failure) {
    try {
      await close();
    } catch (cleanup) {
      throw new AggregateError(
        [failure.error, cleanup],
        "public_runtime_fixture_setup_failed",
      );
    }
    throw failure.error;
  }
  return { connections, close };
}
