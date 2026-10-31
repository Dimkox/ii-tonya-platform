import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

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
