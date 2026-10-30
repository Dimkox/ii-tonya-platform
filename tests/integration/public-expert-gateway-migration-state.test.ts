import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  startDisposableTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import {
  captureMigrationSqlState,
  normalizeMigrationSnapshot,
} from "../../packages/db/src/testkit/migration-state.js";
import {
  buildEarlyBirdRoleProvisioningSql,
  loadEarlyBirdRoleCapabilities,
} from "../../scripts/provision-early-bird-runtime-roles.mjs";
import {
  startPublicExpertTestDatabase,
  createPublicOnboardingFixture,
} from "../../packages/db/src/testkit/public-expert-payment.js";
const SYNTHETIC_FIXTURE_VALUE_1 = "synthetic-only";

const folder = "packages/db/migrations";
const dbRequire = createRequire(
  new URL("../../packages/db/package.json", import.meta.url),
);
const { Pool } = dbRequire("pg") as {
  Pool: new (options: {
    connectionString: string;
    max: number;
  }) => TestDatabase["db"]["$client"];
};
const latest = 84;
const tag = String(latest).padStart(4, "0");
const previousTag = String(latest - 1).padStart(4, "0");
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const digest = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
let database: TestDatabase;
let output: string;
const limitedPools: TestDatabase["db"]["$client"][] = [];
beforeAll(async () => {
  database = await startDisposableTestPostgres();
  await database.migrate();
}, 120_000);
afterAll(async () => {
  await Promise.all(limitedPools.map((pool) => pool.end()));
  await database?.stop();
  if (output) rmSync(output, { recursive: true, force: true });
}, 120_000);

it("provisions exactly five public roles and the existing gateway extension", async () => {
  const capabilities = await loadEarlyBirdRoleCapabilities();
  expect(capabilities).toHaveLength(33);
  const byRole = Object.fromEntries(
    capabilities.map((c) => [c.role, c.functions]),
  );
  const prefix = "early_bird_private.";
  const send = (product: string) => [
    `public_${product}_source(uuid,uuid)`,
    `public_${product}_prepare(uuid,uuid,uuid,jsonb)`,
    `public_${product}_snapshot(uuid,uuid)`,
    `public_${product}_admit(uuid,uuid,text)`,
  ];
  const expected = {
    ii_tonya_public_onboarding_sender: [
      ...send("onboarding"),
      "public_onboarding_invoice(uuid)",
      "public_onboarding_pending(integer,uuid)",
    ],
    ii_tonya_public_main_sender: send("main"),
    ii_tonya_public_refund_sender: [
      ...send("refund"),
      "public_refund_pending(integer,uuid)",
    ],
    ii_tonya_public_payment_binder: [
      "public_payment_candidate(uuid)",
      "public_payment_bound(uuid)",
      "public_payment_bind(uuid,text,jsonb)",
      "public_payment_pending(integer,uuid)",
      "public_payment_hint(text,uuid,boolean)",
    ],
    ii_tonya_public_payment_fact_writer: [
      "public_payment_observe(uuid,text,jsonb)",
      "public_payment_resolve(uuid,uuid)",
      "public_payment_expire(uuid,uuid)",
      "public_payment_complete(uuid,uuid)",
    ],
  };
  for (const [role, signatures] of Object.entries(expected))
    expect(byRole[role]).toEqual(signatures.map((s) => prefix + s));
  expect(byRole.ii_tonya_wave_gateway).toEqual([
    "public.early_bird_gateway_revoke(uuid)",
    "public.early_bird_gateway_claim(uuid,uuid,uuid,uuid,text)",
    "public.public_expert_gateway_claim(uuid,uuid,uuid,uuid,text,text)",
  ]);
});

it(`reproduces canonical ${tag} state and private capability ACLs from an independent full PostgreSQL replay`, async () => {
  const version = (
    await database.db.execute(
      sql`select current_setting('server_version_num') version`,
    )
  ).rows[0]?.version;
  expect(version).toBe("170005");
  const journal = read(`${folder}/meta/_journal.json`);
  expect(journal.entries.at(-1)).toMatchObject({
    idx: latest,
    tag: "0084_public_expert_payment_gateway",
    breakpoints: true,
  });
  const expected = read(`${folder}/meta/${tag}_snapshot.json`);
  const manifest = read(`${folder}/state/${tag}_manifest.json`);
  expect(expected.prevId).toBe(
    read(`${folder}/meta/${previousTag}_snapshot.json`).id,
  );
  expect(manifest.migrations).toHaveLength(latest + 1);
  for (const entry of journal.entries.filter(
    (entry: { idx: number }) => entry.idx <= latest,
  ))
    expect(manifest.migrations[entry.idx]).toEqual({
      idx: entry.idx,
      tag: entry.tag,
      sha256: digest(`${folder}/${entry.tag}.sql`),
    });
  expect(manifest.snapshotSha256).toBe(
    digest(`${folder}/meta/${tag}_snapshot.json`),
  );
  expect(manifest.sqlObjectsSha256).toBe(
    digest(`${folder}/state/${tag}_sql_objects.json`),
  );
  expect(manifest.generatePermitted).toBe(false);
  expect(manifest.migrations.slice(0, 84)).toEqual(
    read(`${folder}/state/0083_manifest.json`).migrations,
  );
  expect(manifest.drizzleKitVersion).toBe("0.31.10");
  output = mkdtempSync(join(tmpdir(), `ii-tonya-${tag}-state-validation-`));
  const connection = database.db.$client.options.connectionString;
  if (!connection) throw new Error("disposable_connection_missing");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "node_modules/drizzle-kit/bin.cjs",
        "introspect",
        "--dialect=postgresql",
        `--url=${connection}`,
        `--out=${output}`,
      ],
      { stdio: "ignore", timeout: 120_000 },
    );
    child.once("error", () =>
      reject(new Error("disposable_introspection_failed")),
    );
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("disposable_introspection_failed")),
    );
  });
  const state = await captureMigrationSqlState(database.db, true, true);
  expect(state).toEqual(read(`${folder}/state/${tag}_sql_objects.json`));
  const actual = normalizeMigrationSnapshot(
    read(join(output, "meta/0000_snapshot.json")),
    { constraints: state.constraints, indexes: state.indexes },
  );
  actual.id = expected.id;
  actual.prevId = expected.prevId;
  expect(actual).toEqual(expected);
  expect(Object.keys(actual.tables)).toHaveLength(280);
  expect(state.functions).toHaveLength(325);
  expect(state.triggers).toHaveLength(293);
  expect(state.constraints).toHaveLength(1922);
  if (!("sequences" in state)) throw Error("sequence_evidence_missing");
  expect(state.sequences).toContainEqual({
    schema: "public",
    name: "public_expert_payment_observations_observation_sequence_seq",
    start: "1",
    increment: "1",
    minimum: "1",
    maximum: "9223372036854775807",
    cache: "1",
    cycle: false,
    table_name: "public_expert_payment_observations",
    column_name: "observation_sequence",
    identity_kind: "a",
    public_usage: false,
    public_select: false,
    public_update: false,
  });
  expect(state.indexes).toHaveLength(672);
  expect(
    state.functions.filter((row) =>
      String(row.definition).includes("FUNCTION early_bird_private."),
    ),
  ).toHaveLength(55);
  if (!("schemas" in state) || !("functionPrivileges" in state))
    throw new Error("private_state_evidence_missing");
  expect(state.schemas).toEqual([
    { name: "early_bird_private", public_usage: false, public_create: false },
  ]);
  expect(state.functionPrivileges).toContainEqual(
    expect.objectContaining({
      schema: "early_bird_private",
      name: "public_onboarding_committed_matches",
      security_definer: true,
      public_execute: false,
    }),
  );
  const privileged = state.functionPrivileges.filter(
    (row) => row.security_definer === true,
  );
  expect(privileged.length).toBeGreaterThan(0);
  expect(privileged.every((row) => row.public_execute === false)).toBe(true);
  // Old baseline consumers retain their public-only object shape. No historical
  // artifacts or public-only extraction semantics are silently rewritten.
  const historical = await captureMigrationSqlState(database.db);
  expect(Object.keys(historical).sort()).toEqual([
    "constraints",
    "exclusionConstraints",
    "extensions",
    "functions",
    "indexes",
    "triggers",
  ]);
  expect(
    historical.functions.some((row) =>
      String(row.definition).includes("FUNCTION early_bird_private."),
    ),
  ).toBe(false);
  const capabilities = (await loadEarlyBirdRoleCapabilities()).filter(
    (capability) => capability.migration <= latest,
  );
  expect(capabilities).toHaveLength(33);
  const mapping = Object.fromEntries(
    capabilities.map((capability, index) => [
      capability.role,
      `state_runtime_${index}`,
    ]),
  );
  for (const login of Object.values(mapping))
    await database.db.execute(
      sql.raw(
        `create role ${login} login password 'synthetic-only' inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls`,
      ),
    );
  const provisioning = await buildEarlyBirdRoleProvisioningSql(mapping);
  const operator = await database.db.$client.connect();
  try {
    await operator.query(provisioning);
    await operator.query(provisioning);
    // Resolve the private signature as the operator. PUBLIC-only capabilities
    // intentionally lack private-schema USAGE, but can inspect effective ACLs by OID.
    const committedMatchOid = (
      await operator.query<{ oid: number }>(
        "select 'early_bird_private.public_onboarding_committed_matches(public.public_expert_payment_requests,public.public_expert_payment_observations)'::regprocedure::oid oid",
      )
    ).rows[0]!.oid;
    for (const capability of capabilities) {
      const login = mapping[capability.role]!;
      const address = new URL(connection);
      address.username = login;
      address.password = SYNTHETIC_FIXTURE_VALUE_1;
      const pool = new Pool({ connectionString: address.toString(), max: 1 });
      limitedPools.push(pool);
      expect(
        (await pool.query("select current_user as login")).rows[0]?.login,
      ).toBe(login);
      expect(
        (
          await pool.query(
            "select parent.rolname as role,m.admin_option from pg_auth_members m join pg_roles child on child.oid=m.member join pg_roles parent on parent.oid=m.roleid where child.rolname=current_user",
          )
        ).rows,
      ).toEqual([{ role: capability.role, admin_option: false }]);
      expect(
        (
          await pool.query(
            "select count(*)::integer as n from pg_proc where oid=any($1::regprocedure[]) and prosecdef and has_function_privilege(current_user,oid,'EXECUTE')",
            [capability.functions],
          )
        ).rows[0]?.n,
      ).toBe(capability.functions.length);
      expect(
        (
          await pool.query(
            "select count(*)::integer as n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where left(ns.nspname,3)<>'pg_' and ns.nspname<>'information_schema' and p.prosecdef and has_function_privilege(current_user,p.oid,'EXECUTE') and not p.oid=any($1::regprocedure[])",
            [capability.functions],
          )
        ).rows[0]?.n,
      ).toBe(0);
      if (capability.role === "ii_tonya_wave_gateway")
        expect(
          (
            await pool.query(
              readFileSync(
                "scripts/experimental/yookassa_gateway/readiness.sql",
                "utf8",
              ),
            )
          ).rows,
        ).toEqual([{ exists: true }]);
      await expect(
        pool.query(
          "select nextval('public.public_expert_payment_observations_observation_sequence_seq')",
        ),
      ).rejects.toMatchObject({ code: "42501" });
      expect(
        (
          await pool.query(
            "select has_function_privilege(current_user,$1::oid,'EXECUTE') allowed",
            [committedMatchOid],
          )
        ).rows[0]?.allowed,
      ).toBe(false);
      await expect(
        pool.query("select * from public_expert_payment_requests"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        pool.query("select * from early_bird_composite_intents"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        pool.query("select * from early_bird_deferred_receipt_contacts"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        pool.query("create table public.forbidden_state_runtime(id integer)"),
      ).rejects.toMatchObject({ code: "42501" });
    }
    const owner = (await operator.query("select current_user as name")).rows[0]
      .name as string;
    await expect(
      operator.query(
        await buildEarlyBirdRoleProvisioningSql({
          [capabilities[0]!.role]: owner,
        }),
      ),
    ).rejects.toMatchObject({ message: "early_bird_role_login_unsafe" });
    await operator.query("ROLLBACK");
    await operator.query(
      "grant select on early_bird_composite_intents to state_runtime_0",
    );
    await expect(operator.query(provisioning)).rejects.toMatchObject({
      message: "early_bird_role_extra_privilege",
    });
    await operator.query("ROLLBACK");
    await operator.query(
      "revoke select on early_bird_composite_intents from state_runtime_0",
    );
    await operator.query(
      "grant usage on sequence public_expert_payment_observations_observation_sequence_seq to state_runtime_0",
    );
    await expect(operator.query(provisioning)).rejects.toMatchObject({
      message: "early_bird_role_extra_privilege",
    });
    await operator.query("ROLLBACK");
    await operator.query(
      "revoke usage on sequence public_expert_payment_observations_observation_sequence_seq from state_runtime_0",
    );
    await operator.query(
      "grant execute on function early_bird_private.public_payment_apply_guard(uuid,uuid,uuid) to state_runtime_0",
    );
    await expect(operator.query(provisioning)).rejects.toMatchObject({
      message: "early_bird_role_extra_privilege",
    });
    await operator.query("ROLLBACK");
    await operator.query(
      "revoke execute on function early_bird_private.public_payment_apply_guard(uuid,uuid,uuid) from state_runtime_0",
    );
    await operator.query(
      "create role task6_existing_primary login password 'synthetic-only' inherit",
    );
    await operator.query("grant select on users to task6_existing_primary");
    const privileges = async () =>
      (
        await operator.query(
          "select c.relname,has_table_privilege('task6_existing_primary',c.oid,'SELECT') s,has_table_privilege('task6_existing_primary',c.oid,'INSERT,UPDATE,DELETE') w from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','p','v') order by c.relname",
        )
      ).rows;
    const before = await privileges();
    const financialSql = await buildEarlyBirdRoleProvisioningSql(mapping, {
      financialLogin: "task6_existing_primary",
    });
    await operator.query(financialSql);
    await operator.query(financialSql);
    expect(await privileges()).toEqual(before);
    const primaryAddress = new URL(connection);
    primaryAddress.username = "task6_existing_primary";
    primaryAddress.password = SYNTHETIC_FIXTURE_VALUE_1;
    const primary = new Pool({
      connectionString: primaryAddress.toString(),
      max: 1,
    });
    limitedPools.push(primary);
    expect(
      (
        await primary.query(
          "select early_bird_private.public_time('2027-01-11T12:00:00.123456Z'::timestamptz) value",
        )
      ).rows[0]?.value,
    ).toBe("2027-01-11T12:00:00.123456Z");
    expect(
      (
        await primary.query(
          "select early_bird_private.public_order_expiry_allowed($1) value",
          [randomUUID()],
        )
      ).rows[0]?.value,
    ).toBe(true);
    expect(
      (
        await primary.query(
          "select count(*)::integer n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='early_bird_private' and has_function_privilege(current_user,p.oid,'EXECUTE')",
        )
      ).rows[0]?.n,
    ).toBe(7);
    expect(
      (
        await primary.query(
          "select count(*)::integer n from pg_auth_members m join pg_roles r on r.oid=m.member where r.rolname=current_user",
        )
      ).rows[0]?.n,
    ).toBe(0);
    await expect(
      primary.query("select early_bird_private.public_payment_candidate(null)"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      buildEarlyBirdRoleProvisioningSql(mapping, {
        financialLogin: "x'; grant all",
      }),
    ).rejects.toThrow("early_bird_financial_login_invalid");
    await expect(
      buildEarlyBirdRoleProvisioningSql(mapping, {
        financialLogin: "state_runtime_0",
      }),
    ).rejects.toThrow("early_bird_financial_login_invalid");
  } finally {
    await operator.query("ROLLBACK");
    operator.release();
  }
  expect(
    (
      await database.db.execute(
        sql`select count(*)::integer as n from early_bird_payment_successes`,
      )
    ).rows[0]?.n,
  ).toBe(0);
}, 180_000);

it("uses operator-provisioned sender and gateway LOGINs for a genuine approved onboarding source", async () => {
  const context = await startPublicExpertTestDatabase();
  const pools: TestDatabase["db"]["$client"][] = [];
  try {
    const fixture = await createPublicOnboardingFixture(context);
    const q = context.db.db.$client;
    const mapping = {
      ii_tonya_public_onboarding_sender: "task6_onboarding_runtime",
      ii_tonya_wave_gateway: "task6_gateway_runtime",
    };
    for (const login of Object.values(mapping))
      await q.query(
        `create role ${login} login password 'synthetic-only' inherit`,
      );
    await q.query(await buildEarlyBirdRoleProvisioningSql(mapping));
    const connect = (login: string) => {
      const url = new URL(q.options.connectionString!);
      url.username = login;
      url.password = SYNTHETIC_FIXTURE_VALUE_1;
      const pool = new Pool({ connectionString: url.toString(), max: 1 });
      pools.push(pool);
      return pool;
    };
    const sender = connect(mapping.ii_tonya_public_onboarding_sender),
      gateway = connect(mapping.ii_tonya_wave_gateway);
    const source = (
      await sender.query(
        "select early_bird_private.public_onboarding_invoice($1) value",
        [fixture.invoiceId],
      )
    ).rows[0]?.value;
    expect(source).toMatchObject({
      userId: fixture.userId,
      sourceId: fixture.invoiceId,
      amountMinor: "300000",
      current: true,
    });
    const descriptor = {
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      legacyDeliveryOperationId: null,
      kind: "onboarding_create",
      requestDigest: `sha256:${"d".repeat(64)}`,
      bodyVersion: 1,
      ciphertext: "synthetic-provisioning-envelope",
      keyReference: "fixture:key",
      bodyExpiresAt: "2027-01-11T13:00:00.000000Z",
    };
    expect(
      (
        await sender.query(
          "select early_bird_private.public_onboarding_prepare($1,$2,$3,$4) value",
          [fixture.userId, fixture.invoiceId, fixture.contactId, descriptor],
        )
      ).rows[0]?.value,
    ).toMatchObject({ requestId: descriptor.requestId, state: "prepared" });
    expect(
      (
        await sender.query(
          "select early_bird_private.public_onboarding_admit($1,$2,$3) value",
          [fixture.userId, descriptor.requestId, descriptor.requestDigest],
        )
      ).rows[0]?.value,
    ).toMatchObject({ state: "admitted" });
    const claimArgs = [
      fixture.userId,
      descriptor.requestId,
      fixture.contactId,
      descriptor.idempotencyKey,
      descriptor.requestDigest,
      descriptor.kind,
    ];
    expect(
      (
        await gateway.query(
          "select public.public_expert_gateway_claim($1,$2,$3,$4,$5,$6) value",
          claimArgs,
        )
      ).rows[0]?.value,
    ).toBeTruthy();
    await expect(
      sender.query(
        "select public.public_expert_gateway_claim($1,$2,$3,$4,$5,$6)",
        claimArgs,
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      gateway.query("select early_bird_private.public_onboarding_invoice($1)", [
        fixture.invoiceId,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      sender.query(
        "select early_bird_private.public_payment_observe(null,null,null)",
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      sender.query("select * from payer_receipt_contacts"),
    ).rejects.toMatchObject({ code: "42501" });
  } finally {
    await Promise.all(pools.map((pool) => pool.end()));
    await context.db.stop();
  }
}, 120_000);
