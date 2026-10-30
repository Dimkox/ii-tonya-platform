import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildEarlyBirdRoleProvisioningSql,
  loadEarlyBirdRoleCapabilities,
} from "./provision-early-bird-runtime-roles.mjs";

test("maps each audited capability only to its reviewed function set", async () => {
  const catalogue = await loadEarlyBirdRoleCapabilities();
  const expected = {
    ii_tonya_wave_gateway: [
      "public.early_bird_gateway_revoke(uuid)",
      "public.early_bird_gateway_claim(uuid,uuid,uuid,uuid,text)",
    ],
    ii_tonya_wave_sender: [
      "early_bird_private.owner_send_snapshot(uuid,uuid,uuid)",
      "early_bird_private.owner_admit_send(uuid,uuid,uuid,text)",
    ],
    ii_tonya_wave_standard_sender: [
      "early_bird_private.standard_send_snapshot(uuid,uuid,uuid)",
      "early_bird_private.standard_admit_send(uuid,uuid,uuid,text)",
    ],
    ii_tonya_wave_intent_reader: [
      "early_bird_private.find_candidate_intent(uuid)",
    ],
    ii_tonya_wave_verifier: [
      "early_bird_private.bind_verified(uuid,uuid,text,text,jsonb)",
    ],
    ii_tonya_wave_verified_payment_reader: [
      "early_bird_private.find_verified_payment(text,text)",
    ],
    ii_tonya_wave_settlement_writer: [
      "public.early_bird_commit_verified_payment(jsonb,text,timestamp with time zone)",
    ],
    ii_tonya_wave_refund_binding_reader: [
      "public.early_bird_read_verified_refund(text)",
    ],
    ii_tonya_wave_refund_binder: [
      "public.early_bird_bind_verified_refund(jsonb)",
    ],
    ii_tonya_wave_refund_writer: [
      "public.early_bird_commit_verified_refund(jsonb,bigint,text,timestamp with time zone)",
    ],
    ii_tonya_deferred_account_writer: [
      "public.early_bird_deferred_prepare(uuid,uuid,uuid,uuid,uuid)",
    ],
    ii_tonya_deferred_invoice_writer: [
      "public.early_bird_deferred_invoice(uuid,uuid,uuid,uuid,text)",
    ],
    ii_tonya_deferred_sender: [
      "public.early_bird_deferred_admit_send(uuid,uuid,uuid)",
    ],
    ii_tonya_deferred_invoice_reader: [
      "public.early_bird_deferred_read_invoice(uuid)",
    ],
    ii_tonya_deferred_bound_reader: [
      "public.early_bird_deferred_read_bound(uuid)",
    ],
    ii_tonya_deferred_binding_writer: [
      "public.early_bird_deferred_bind_verified(uuid,uuid,text,bigint,text)",
    ],
    ii_tonya_deferred_settlement_writer: [
      "public.early_bird_deferred_commit_verified(uuid,uuid,text,bigint,text,timestamp with time zone)",
    ],
    ii_tonya_deferred_refund_reader: [
      "public.early_bird_deferred_refund_payment(text)",
    ],
    ii_tonya_deferred_refund_binding: [
      "public.early_bird_deferred_bind_refund(uuid,uuid,text,text,bigint,text)",
    ],
    ii_tonya_deferred_refund_settlement: [
      "public.early_bird_deferred_commit_refund(uuid,uuid,text,text,bigint,text)",
    ],
    ii_tonya_deferred_refund_cancel: [
      "public.early_bird_deferred_cancel_refund(uuid,uuid,text,text,bigint,text)",
    ],
    ii_tonya_deferred_payment_route_reader: [
      "public.early_bird_deferred_payment_lookup(text)",
    ],
    ii_tonya_worker_review_source: [
      "public.early_bird_worker_review_list(uuid,integer)",
      "public.early_bird_worker_review_resolve(uuid,uuid)",
    ],
    ii_tonya_worker_wave_retention: [
      "public.early_bird_wave_retention_list(integer)",
      "public.early_bird_wave_retention_expire(uuid,uuid)",
    ],
    ii_tonya_worker_deferred_retention: [
      "public.early_bird_deferred_retention_list(integer)",
      "public.early_bird_deferred_retention_expire(uuid,uuid)",
    ],
    ii_tonya_wave_final_call_worker: [
      "public.early_bird_final_call_worker(text,jsonb)",
    ],
    ii_tonya_wave_publication_worker: [
      "public.early_bird_publication_worker(text,jsonb)",
    ],
    ii_tonya_wave_launch_kit_worker: [
      "public.early_bird_launch_kit_worker(text,jsonb)",
    ],
  };
  assert.deepEqual(
    Object.fromEntries(catalogue.map((entry) => [entry.role, entry.functions])),
    expected,
  );
  assert.equal(
    new Set(catalogue.flatMap((entry) => entry.runtimeKeys)).size,
    catalogue.flatMap((entry) => entry.runtimeKeys).length,
  );
  assert.deepEqual(
    [81, 82, 83].map(
      (migration) =>
        catalogue.filter((entry) => entry.migration === migration).length,
    ),
    [22, 4, 2],
  );
});

test("caller cannot choose functions, share logins across capabilities or supply a credential", async () => {
  for (const mapping of [
    null,
    {},
    [],
    { arbitrary_role: "some_login" },
    { ii_tonya_wave_sender: "postgres://secret" },
    { ii_tonya_wave_sender: "x';grant all" },
    { ii_tonya_wave_sender: { login: "one", functions: ["arbitrary()"] } },
    {
      ii_tonya_wave_sender: "same_login",
      ii_tonya_wave_intent_reader: "same_login",
    },
    { ii_tonya_wave_sender: "ii_tonya_shared_owner" },
  ])
    await assert.rejects(
      buildEarlyBirdRoleProvisioningSql(mapping),
      /early_bird_role_mapping_invalid/,
    );
});

test("operator transaction grants function execution and schema usage only", async () => {
  const sql = await buildEarlyBirdRoleProvisioningSql({
    ii_tonya_wave_sender: "dedicated_sender",
  });
  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /COMMIT;\n$/u);
  assert.match(sql, /CREATE ROLE %I NOLOGIN NOINHERIT NOSUPERUSER/u);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION %s TO %I/u);
  assert.match(sql, /GRANT USAGE ON SCHEMA %I TO %I/u);
  assert.doesNotMatch(
    sql,
    /GRANT\s+(?:ALL|CREATE|SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)\b/iu,
  );
  assert.doesNotMatch(sql, /PASSWORD\s+['"]|ALTER\s+DEFAULT\s+PRIVILEGES/iu);
  assert.match(sql, /early_bird_role_extra_privilege/u);
  const catalogue = await loadEarlyBirdRoleCapabilities();
  const requested = JSON.parse(
    sql.match(/set_config\('ii_tonya.runtime_role_provision','([^']+)'/u)[1],
  );
  assert.deepEqual(requested, [
    {
      capability: "ii_tonya_wave_sender",
      login: "dedicated_sender",
      functions: catalogue.find(
        (entry) => entry.role === "ii_tonya_wave_sender",
      ).functions,
    },
  ]);
});

test("SQL rejects owner and broad principals rather than revoking or repairing them", async () => {
  const sql = await readFile(
    new URL("./sql/provision-early-bird-runtime-roles.sql", import.meta.url),
    "utf8",
  );
  for (const predicate of [
    "login_name=current_user",
    "has_database_privilege",
    "has_schema_privilege",
    "has_any_column_privilege",
    "has_sequence_privilege",
    "pg_has_role",
    "m.admin_option",
    "has_function_privilege('public'",
  ])
    assert.ok(sql.includes(predicate), predicate);
  assert.doesNotMatch(sql, /ALTER ROLE|DROP ROLE|REVOKE /u);
});

test("operational API and worker examples use the same valid dedicated logins as the capability map", async () => {
  const catalogue = await loadEarlyBirdRoleCapabilities();
  const logins = JSON.parse(
    await readFile(
      new URL(
        "../docs/operations/early-bird-role-logins.example.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await buildEarlyBirdRoleProvisioningSql(logins);
  assert.equal(Object.keys(logins).length, catalogue.length);
  const deferredKeys = {
    prepare: "deferredAccountWriter",
    invoice: "deferredInvoiceWriter",
    send: "deferredSender",
    bound: "deferredBoundReader",
  };
  for (const name of [
    "early-bird-gateway-api-config.example.json",
    "early-bird-gateway-worker-config.example.json",
  ]) {
    const config = JSON.parse(
      await readFile(
        new URL(`../docs/operations/${name}`, import.meta.url),
        "utf8",
      ),
    );
    for (const group of ["databases", "webhookDatabases", "deferredDatabases"])
      for (const [key, value] of Object.entries(config[group] ?? {})) {
        const runtimeKey =
          group === "deferredDatabases" ? deferredKeys[key] : key;
        const capability = catalogue.find((entry) =>
          entry.runtimeKeys.includes(runtimeKey),
        );
        assert.ok(capability, `${name}:${group}:${key}`);
        assert.equal(value.login, logins[capability.role]);
      }
  }
});

test("worker example uses an actual consent-policy version and the shared contact-key version", async () => {
  const api = JSON.parse(
    await readFile(
      new URL(
        "../docs/operations/early-bird-gateway-api-config.example.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const worker = JSON.parse(
    await readFile(
      new URL(
        "../docs/operations/early-bird-gateway-worker-config.example.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(worker.ipc.subjectKeyVersion, api.ipc.subjectKeyVersion);
  assert.match(
    worker.messagingPolicyVersion,
    /^(?:client-)?messaging-v[1-9][0-9]*$/u,
  );
  const exampleEnvironment = await readFile(
    new URL("../.env.example", import.meta.url),
    "utf8",
  );
  assert.ok(
    exampleEnvironment.includes(
      `CLIENT_MESSAGING_CONSENT_POLICY_VERSION=${worker.messagingPolicyVersion}`,
    ),
  );
});
