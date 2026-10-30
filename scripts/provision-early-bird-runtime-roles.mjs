#!/usr/bin/env node
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
export async function loadEarlyBirdRoleCapabilities() {
  return JSON.parse(
    await readFile(
      path.join(directory, "early-bird-role-capabilities.json"),
      "utf8",
    ),
  ).capabilities;
}
/** Mapping contains existing login NAMES only; never credentials or DSNs. */
export async function buildEarlyBirdRoleProvisioningSql(mapping) {
  if (
    !mapping ||
    typeof mapping !== "object" ||
    Array.isArray(mapping) ||
    Object.keys(mapping).length === 0
  )
    throw new Error("early_bird_role_mapping_invalid");
  const capabilities = await loadEarlyBirdRoleCapabilities();
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
  const value = JSON.stringify(entries).replaceAll("'", "''");
  const body = await readFile(
    path.join(directory, "sql/provision-early-bird-runtime-roles.sql"),
    "utf8",
  );
  return `BEGIN;\nSET LOCAL statement_timeout='30s';\nSET LOCAL lock_timeout='5s';\nSELECT set_config('ii_tonya.runtime_role_provision','${value}',true);\n${body}\nCOMMIT;\n`;
}

async function main(args) {
  if (args.length !== 2 || args[0] !== "--mapping")
    throw new Error("usage: --mapping LOGIN_MAPPING_JSON_FILE");
  // libpq credentials come exclusively from an operator-managed PGSERVICE/
  // PGPASSFILE environment. No connection URI/password CLI options are accepted.
  const mapping = JSON.parse(await readFile(args[1], "utf8"));
  const sql = await buildEarlyBirdRoleProvisioningSql(mapping);
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
