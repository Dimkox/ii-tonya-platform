import {
  mkdirSync,
  readFileSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
type BridgeRow = { hash: string; created_at: string };
it("boots the archived API through its ordinary main with all non-migration DB imports intact", async () => {
  const temp = mkdtempSync(join(tmpdir(), "promo-schema-bridge-api-"));
  try {
    const api = join(temp, "api"),
      dep = join(api, "node_modules/@ii-tonya/db");
    mkdirSync(dep, { recursive: true });
    mkdirSync(join(api, "dist"));
    const bridge = readFileSync(
      "scripts/build-expert-promo-journal-bridge.mjs",
    );
    writeFileSync(join(api, "expert-promo-bridge.mjs"), bridge);
    const { databaseFacadeSource } = await promoBridge();
    writeFileSync(join(api, "journal-db.mjs"), databaseFacadeSource ?? "");
    writeFileSync(
      join(api, "package.json"),
      JSON.stringify({ type: "module" }),
    );
    writeFileSync(
      join(dep, "package.json"),
      JSON.stringify({ type: "module", exports: "./index.js" }),
    );
    writeFileSync(
      join(dep, "index.js"),
      "export const provider = Symbol('original'); export function migrateDb() {throw Error('migrator must never run')}",
    );
    writeFileSync(
      join(api, "dist/normal-provider.js"),
      "export {migrateDb,provider} from '@ii-tonya/db';",
    );
    writeFileSync(
      join(api, "dist/server.js"),
      `
      import {migrateDb,provider} from '@ii-tonya/db';
      import * as ordinary from './normal-provider.js';
      export async function main(...args) {
        if (args.length || provider !== ordinary.provider || migrateDb === ordinary.migrateDb) throw Error('ordinary bootstrap or database exports changed');
        try { await migrateDb({ $client:{query: async()=>({rows:[]})} }); } catch (error) {
          if(error.message==='bridge_migration_history_reconciliation_required') { console.log('ordinary-bootstrap:drift-refused'); return; }
          throw error;
        }
        throw Error('would listen with a drifted journal');
      }`,
    );
    const child = spawnSync(
      process.execPath,
      [join(api, "expert-promo-bridge.mjs"), "api"],
      { encoding: "utf8" },
    );
    expect(child.stderr).toBe("");
    expect(child.status).toBe(0);
    expect(child.stdout.trim()).toBe("ordinary-bootstrap:drift-refused");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
async function promoBridge() {
  return import(
    pathToFileURL(resolve("scripts/build-expert-promo-journal-bridge.mjs")).href
  ) as Promise<{
    assertJournal(db: {
      $client: { query(sql: string): Promise<{ rows: BridgeRow[] }> };
    }): Promise<void>;
    workerEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
    databaseFacadeSource: string;
  }>;
}
it("accepts only the reviewed 91 and 93 row journals without executing SQL migrations", async () => {
  const bridge = await promoBridge();
  const folder = "packages/db/migrations";
  const old: BridgeRow[] = JSON.parse(
    readFileSync(join(folder, "meta/_journal.json"), "utf8"),
  )
    .entries.slice(0, 91)
    .map((entry: { tag: string; when: number }) => ({
      hash: createHash("sha256")
        .update(readFileSync(join(folder, entry.tag + ".sql")))
        .digest("hex"),
      created_at: String(entry.when),
    }));
  const next = [
    ...old,
    {
      hash: "fd6424c977730ce127a4b54c3d1b44989696e0b64ecf9d7d17934fa7fd251ddd",
      created_at: "1793152800022",
    },
    {
      hash: "7d6fdf64b179bc507d7f50a6a617f3c74694c9df88290dc35081928b56f89fb4",
      created_at: "1793152800023",
    },
  ];
  const calls: string[] = [];
  const read = (rows: BridgeRow[]) =>
    bridge.assertJournal({
      $client: {
        query: async (statement) => {
          calls.push(statement);
          return { rows };
        },
      },
    });
  await read(old);
  await read(next);
  for (const bad of [
    [],
    old.slice(1),
    next.slice(0, -1),
    [...next, next[0]!],
    [...next].reverse(),
    [{ ...old[0]!, hash: "0".repeat(64) }, ...old.slice(1)],
    [...old.slice(0, -1), { ...old.at(-1)!, created_at: "1" }],
  ]) {
    await expect(read(bad)).rejects.toThrow(
      "bridge_migration_history_reconciliation_required",
    );
  }
  expect(new Set(calls)).toEqual(
    new Set([
      "select hash, created_at::text from drizzle.__drizzle_migrations order by id",
    ]),
  );
});
it("holds only the archived promotional job in the bridge worker", async () => {
  const bridge = await promoBridge();
  const original = Object.freeze({
    WAITLIST_FUNNEL_V4_ENABLED: "true",
    EXPERT_APPLICANT_ENABLED: "true",
    PAYMENT_PROVIDER: "yookassa_gateway",
    PAYMENTS_ENABLED: "true",
    OWNER_TEST: "test",
  });
  expect(bridge.workerEnvironment(original)).toEqual({
    ...original,
    WAITLIST_FUNNEL_V4_ENABLED: "false",
  });
  expect(original.WAITLIST_FUNNEL_V4_ENABLED).toBe("true");
});

const script = readFileSync("scripts/deploy-native-remote.sh", "utf8");
function fn(name: string) {
  const value = script.match(
    new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, "m"),
  );
  if (!value) throw new Error(`missing deployment function: ${name}`);
  return value[0];
}
function run(code: string) {
  return spawnSync("bash", ["-c", `set -Eeuo pipefail\n${code}`], {
    encoding: "utf8",
  });
}

it("quiesces API, worker and an installed gateway before changing executables", () => {
  const result = run(`
ctl() { printf '%s\\n' loaded; }
stop_unit() { printf '%s\\n' "$1"; }
${fn("stop_gateway_if_installed")}
${fn("stop_apps")}
stop_apps`);
  expect(result.status).toBe(0);
  expect(result.stdout.trim().split("\n")).toEqual([
    "ii-tonya-api.service",
    "ii-tonya-worker.service",
    "ii-tonya-yookassa-gateway.service",
  ]);
});

it("keeps deployments without a gateway compatible, but propagates unknown stop failures", () => {
  for (const [state, code, expected] of [
    ["not-found", 1, 0],
    ["", 1, 1],
  ] as const) {
    const result = run(`
ctl() { printf '%s\\n' '${state}'; return ${code}; }
stop_unit() { exit 99; }
${fn("stop_gateway_if_installed")}
stop_gateway_if_installed`);
    expect(result.status).toBe(expected);
  }
});

it("starts the configured gateway before apps and refuses an invalid environment file", () => {
  const directory = mkdtempSync(join(tmpdir(), "gateway-release-"));
  try {
    const path = join(directory, "runtime.env");
    writeFileSync(path, 'PAYMENT_PROVIDER="yookassa_gateway"\n');
    const required = run(
      `${fn("gateway_required")}\ngateway_required "$1"`.replace(
        '"$1"',
        `'${path}'`,
      ),
    );
    expect(required.status).toBe(0);
    const disabled = run(
      `${fn("gateway_required")}\ngateway_required '${path}.missing'`,
    );
    expect(disabled.status).not.toBe(0);
    expect(disabled.status).not.toBe(42);
    writeFileSync(path, "PAYMENT_PROVIDER=disabled\n");
    expect(
      run(`${fn("gateway_required")}\ngateway_required '${path}'`).status,
    ).toBe(42);
    const result = run(`
gateway_required() { return 0; }
ctl() { printf '%s\\n' "$2"; }
property() { case "$2" in Type) echo notify ;; ActiveState) echo active ;; MainPID) echo 123 ;; esac; }
health() { printf '%s\\n' ready; }
${fn("start_gateway")}
${fn("start_apps")}
start_apps`);
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual([
      "ii-tonya-yookassa-gateway.service",
      "ii-tonya-api.service",
      "ii-tonya-worker.service",
      "ready",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("does not start applications after an asynchronous gateway failure or a stale unit", () => {
  for (const [type, state] of [
    ["notify", "failed"],
    ["simple", "active"],
  ]) {
    const result = run(`
gateway_required() { return 0; }
ctl() { printf '%s\\n' "$2"; }
property() { case "$2" in Type) echo ${type} ;; ActiveState) echo ${state} ;; MainPID) echo 123 ;; esac; }
health() { exit 99; }
${fn("start_gateway")}
${fn("start_apps")}
start_apps`);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("ii-tonya-api.service");
    expect(result.stdout).not.toContain("ii-tonya-worker.service");
  }
});

it("waits for a queued start job to move from inactive through activating to ready", () => {
  const directory = mkdtempSync(join(tmpdir(), "gateway-start-"));
  const states = join(directory, "states");
  writeFileSync(states, "inactive\nactivating\nactive\n");
  try {
    const result = run(`
ctl() { return 0; }
sleep() { :; }
property() {
 case "$2" in
  Type) echo notify ;;
  ActiveState) head -n 1 '${states}'; sed -i '1d' '${states}' ;;
  MainPID) echo 123 ;;
 esac
}
${fn("start_gateway")}
start_gateway`);
    expect(result.status).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("fails gateway health when the process disappears after initial readiness", () => {
  for (const [state, pid, expected] of [
    ["active", "123", 0],
    ["failed", "0", 1],
    ["active", "0", 1],
  ] as const) {
    const result = run(`
gateway_required() { return 0; }
property() { case "$2" in Type) echo notify ;; ActiveState) echo ${state} ;; MainPID) echo ${pid} ;; esac; }
${fn("gateway_health")}
gateway_health`);
    expect(result.status).toBe(expected);
  }
});

it("binds a bridge payment stop to the selected release provenance and SHA", () => {
  const directory = mkdtempSync(join(tmpdir(), "native-bridge-"));
  try {
    mkdirSync(join(directory, "current"));
    const env = join(directory, "runtime.env");
    writeFileSync(env, "PAYMENT_PROVIDER=yookassa_gateway\n");
    writeFileSync(join(directory, "current/SOURCE_SHA"), "a".repeat(40) + "\n");
    const run = () =>
      spawnSync("bash", [
        "-c",
        `set -Eeuo pipefail\ndeploy_root="$1"\n${fn("gateway_required")}\ngateway_required "$2"`,
        "test",
        directory,
        env,
      ]);
    const provenance = (profile: string | undefined, sha = "a".repeat(40)) =>
      writeFileSync(
        join(directory, "current/provenance.json"),
        JSON.stringify({
          format: "ii-tonya-native-v1",
          source_sha: sha,
          runtime_source_sha: "b".repeat(40),
          ...(profile === undefined ? {} : { profile }),
        }),
      );
    provenance("early-bird-compatibility-bridge-v1");
    expect(run().status).toBe(43);
    provenance(undefined);
    expect(run().status).toBe(0);
    provenance("unknown-profile");
    expect(run().status).toBe(1);
    provenance("early-bird-compatibility-bridge-v1", "c".repeat(40));
    expect(run().status).toBe(1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("requires the gateway to be stopped before starting or accepting a bridge", () => {
  for (const stopped of [true, false]) {
    const result = spawnSync(
      "bash",
      [
        "-c",
        `set -Eeuo pipefail
gateway_required() { return 43; }
gateway_stopped_if_installed() { ${stopped ? "return 0" : "return 1"}; }
ctl() { printf '%s\\n' "$2"; }
health() { ${fn("gateway_health")} ; gateway_health; }
${fn("start_apps")}
start_apps`,
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(stopped ? 0 : 1);
    expect(result.stdout.includes("ii-tonya-api.service")).toBe(stopped);
  }
});
