import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildEarlyBirdRoleProvisioningSql } from "../../../scripts/provision-early-bird-runtime-roles.mjs";

// A role-audit compatibility probe, not a migration or business-flow witness.
// Regressing the version selector to unconditional MAINTAIN must fail the clean
// acceptance; dropping ordinary privilege checks must fail the drift cases.
const image = "postgres:16.15-bookworm";
const capability = "ii_tonya_wave_gateway";
const login = "pg16_gateway_probe";
const table = "public.pg16_role_probe";
const supportedPrivileges = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
] as const;
const readiness = readFileSync(
  "scripts/experimental/yookassa_gateway/readiness.sql",
  "utf8",
);
const signatures = [
  "public.early_bird_gateway_claim(uuid,uuid,uuid,uuid,text)",
  "public.early_bird_gateway_revoke(uuid)",
  "public.public_expert_gateway_claim(uuid,uuid,uuid,uuid,text,text)",
];
let container: Awaited<ReturnType<PostgreSqlContainer["start"]>> | undefined;
let operator: Pool | undefined;
let gateway: Pool | undefined;
let provision: string;

beforeAll(async () => {
  // Deliberately never consult II_TONYA_TEST_POSTGRES_ADMIN_URL or any target.
  container = await new PostgreSqlContainer(image).start();
  operator = new Pool({
    connectionString: container.getConnectionUri(),
    max: 1,
  });
  expect((await operator.query("show server_version_num")).rows).toEqual([
    { server_version_num: "160015" },
  ]);
  const password = randomUUID();
  await operator.query(
    `create role ${login} login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '${password}'`,
  );
  await operator.query("revoke create on schema public from public");
  // These empty relations and definer signatures provide only the catalogue
  // shape consumed by readiness. No business function is invoked or emulated.
  for (const name of [
    "public_expert_payment_requests",
    "public_expert_provider_identities",
    "receipt_revocation_outbox",
    "early_bird_deferred_invoices",
    "early_bird_deferred_accounts",
    "early_bird_deferred_receipt_contacts",
    "early_bird_deferred_requests",
    "early_bird_gateway_claims",
    "early_bird_gateway_contact_state",
    "pg16_role_probe",
  ])
    await operator.query(`create table public.${name}(id integer)`);
  for (const signature of signatures) {
    await operator.query(
      `create function ${signature} returns boolean language sql security definer set search_path=pg_catalog,public,pg_temp as 'select true'`,
    );
    await operator.query(`revoke all on function ${signature} from public`);
  }
  provision = await buildEarlyBirdRoleProvisioningSql({ [capability]: login });
  await operator.query(provision);
  const address = new URL(container.getConnectionUri());
  address.username = login;
  address.password = password;
  gateway = new Pool({ connectionString: address.toString(), max: 1 });
  expect(
    (
      await gateway.query(
        "select current_user as login,session_user as authenticated_login",
      )
    ).rows,
  ).toEqual([{ login, authenticated_login: login }]);
}, 120_000);

afterAll(async () => {
  try {
    await Promise.all([gateway?.end(), operator?.end()]);
  } finally {
    await container?.stop();
  }
}, 120_000);

async function assertClean() {
  if (!operator || !gateway) throw Error("isolated_pg16_probe_not_started");
  await operator.query(provision);
  expect((await gateway.query(readiness)).rows).toEqual([{ exists: true }]);
  await expect(gateway.query(`select * from ${table}`)).rejects.toMatchObject({
    code: "42501",
  });
}

it("accepts current provisioning and gateway audits on real PG16 despite unsupported MAINTAIN", async () => {
  if (!operator) throw Error("isolated_pg16_probe_not_started");
  await expect(
    operator.query(`select has_table_privilege($1,'${table}','MAINTAIN')`, [
      login,
    ]),
  ).rejects.toMatchObject({ code: "22023" });
  // Every fixture table has no effective privileges for either role, forcing
  // both table-privilege arguments through the real audit's version selector.
  expect(
    (
      await operator.query(
        `select has_table_privilege($1,'${table}',$3) login_rights,
                has_table_privilege($2,'${table}',$3) capability_rights`,
        [login, capability, supportedPrivileges.join(",")],
      )
    ).rows,
  ).toEqual([{ login_rights: false, capability_rights: false }]);
  await assertClean();
});

it.each(supportedPrivileges)(
  "both PG16 audits reject extra %s from LOGIN, capability and PUBLIC",
  async (privilege) => {
    if (!operator || !gateway) throw Error("isolated_pg16_probe_not_started");
    const client = await operator.connect();
    try {
      for (const recipient of [login, capability, "public"]) {
        await client.query(
          `grant ${privilege} on table ${table} to ${recipient}`,
        );
        try {
          expect(
            (
              await client.query(
                `select has_table_privilege($1,'${table}',$2) allowed`,
                [login, privilege],
              )
            ).rows,
          ).toEqual([{ allowed: true }]);
          await expect(client.query(provision)).rejects.toMatchObject({
            code: "P0001",
            message: "early_bird_role_extra_privilege",
          });
          await client.query("ROLLBACK");
          expect((await gateway.query(readiness)).rows).toEqual([
            { exists: false },
          ]);
        } finally {
          await client.query("ROLLBACK");
          await client.query(
            `revoke ${privilege} on table ${table} from ${recipient}`,
          );
        }
      }
    } finally {
      client.release();
    }
    await assertClean();
  },
);
