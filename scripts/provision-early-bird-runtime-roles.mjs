#!/usr/bin/env node
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
export async function loadEarlyBirdRoleCapabilities(
  throughMigration = Infinity,
) {
  return JSON.parse(
    await readFile(
      path.join(directory, "early-bird-role-capabilities.json"),
      "utf8",
    ),
  )
    .capabilities.filter((entry) => entry.migration <= throughMigration)
    .map((entry) => ({
      ...entry,
      functions: entry.functions.filter(
        (signature) =>
          (entry.functionMigrations?.[signature] ?? entry.migration) <=
          throughMigration,
      ),
    }));
}
/** Mapping contains existing login NAMES only; never credentials or DSNs. */
export async function buildEarlyBirdRoleProvisioningSql(mapping, options = {}) {
  if (
    !mapping ||
    typeof mapping !== "object" ||
    Array.isArray(mapping) ||
    Object.keys(mapping).length === 0
  )
    throw new Error("early_bird_role_mapping_invalid");
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Object.keys(options).some(
      (key) => !["financialLogin", "throughMigration"].includes(key),
    ) ||
    (options.throughMigration !== undefined &&
      (!Number.isSafeInteger(options.throughMigration) ||
        options.throughMigration < 0))
  )
    throw new Error("early_bird_role_horizon_invalid");
  const latest = await loadEarlyBirdRoleCapabilities();
  if (
    options.throughMigration !== undefined &&
    options.throughMigration >
      Math.max(...latest.map((entry) => entry.migration))
  )
    throw new Error("early_bird_role_horizon_invalid");
  if (
    options.financialLogin !== undefined &&
    options.throughMigration !== undefined &&
    options.throughMigration < 84
  )
    throw new Error("early_bird_financial_horizon_invalid");
  const capabilities = await loadEarlyBirdRoleCapabilities(
    options.throughMigration,
  );
  const logins = new Set();
  const entries = [];
  for (const [role, login] of Object.entries(mapping)) {
    const capability = capabilities.find((value) => value.role === role);
    if (
      !capability ||
      typeof login !== "string" ||
      !/^[a-z][a-z0-9_]{0,62}$/u.test(login) ||
      login.startsWith("ii_tonya_") ||
      logins.has(login)
    )
      throw new Error("early_bird_role_mapping_invalid");
    logins.add(login);
    entries.push({ capability: role, login, functions: capability.functions });
  }
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Object.keys(options).some(
      (key) => !["financialLogin", "throughMigration"].includes(key),
    ) ||
    (options.financialLogin !== undefined &&
      (typeof options.financialLogin !== "string" ||
        !/^[a-z][a-z0-9_]{0,62}$/u.test(options.financialLogin) ||
        capabilities.some((entry) => entry.role === options.financialLogin) ||
        logins.has(options.financialLogin)))
  )
    throw new Error("early_bird_financial_login_invalid");
  const financialFunctions = JSON.parse(
    await readFile(
      path.join(directory, "early-bird-role-capabilities.json"),
      "utf8",
    ),
  ).financialFunctions;
  const financial = JSON.stringify(
    options.financialLogin === undefined
      ? null
      : {
          login: options.financialLogin,
          functions: financialFunctions,
        },
  ).replaceAll("'", "''");
  const value = JSON.stringify(entries).replaceAll("'", "''");
  const body = await readFile(
    path.join(directory, "sql/provision-early-bird-runtime-roles.sql"),
    "utf8",
  );
  return `BEGIN;\nSET LOCAL statement_timeout='30s';\nSET LOCAL lock_timeout='5s';\nSELECT set_config('ii_tonya.runtime_role_provision','${value}',true);\nSELECT set_config('ii_tonya.runtime_financial_provision','${financial}',true);\n${body}\nCOMMIT;\n`;
}

async function main(args) {
  if (
    (args.length !== 2 && args.length !== 4) ||
    args[0] !== "--mapping" ||
    (args.length === 4 && args[2] !== "--financial-login")
  )
    throw new Error(
      "usage: --mapping LOGIN_MAPPING_JSON_FILE [--financial-login EXISTING_PRIMARY_LOGIN]",
    );
  // libpq credentials come exclusively from an operator-managed PGSERVICE/
  // PGPASSFILE environment. No connection URI/password CLI options are accepted.
  const mapping = JSON.parse(await readFile(args[1], "utf8"));
  const sql = await buildEarlyBirdRoleProvisioningSql(
    mapping,
    args.length === 4 ? { financialLogin: args[3] } : {},
  );
  const temporary = await mkdtemp(
    path.join(tmpdir(), "early-bird-role-provision-"),
  );
  try {
    const filename = path.join(temporary, "provision.sql");
    await writeFile(filename, sql, { mode: 0o600, flag: "wx" });
    await new Promise((resolve, reject) => {
      const child = spawn(
        "psql",
        ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--file", filename],
        { stdio: "ignore", env: { ...process.env, PGCONNECT_TIMEOUT: "10" } },
      );
      child.once("error", () =>
        reject(new Error("early_bird_role_provision_failed")),
      );
      child.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error("early_bird_role_provision_failed")),
      );
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2)).catch(() => {
    process.stderr.write("early_bird_role_provision_failed\n");
    process.exitCode = 1;
  });
