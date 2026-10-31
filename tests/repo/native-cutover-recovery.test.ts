import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const oldSha = "b".repeat(40);
const candidateSha = "a".repeat(40);
const script = () => readFileSync("scripts/deploy-native-remote.sh", "utf8");

function drill(fault = "", action = "deploy", first = false) {
  const root = mkdtempSync(join(tmpdir(), "native-cutover-"));
  const bin = join(root, "bin");
  const incoming = join(root, "incoming", "unique-upload");
  const payload = join(root, "payload");
  const candidate = join(root, "releases", candidateSha);
  for (const path of [
    bin,
    incoming,
    payload,
    join(root, "etc/systemd/system"),
    join(root, "etc/ii-tonya"),
    join(root, "releases"),
  ])
    mkdirSync(path, { recursive: true });
  const put = (path: string, value: string) =>
    writeFileSync(join(root, path), value);
  const shim = (name: string, body: string) => {
    const path = join(bin, name);
    writeFileSync(path, `#!/usr/bin/env bash\nset -Eeuo pipefail\n${body}\n`);
    chmodSync(path, 0o755);
  };
  put("clock", "200");
  put("api", first ? "inactive" : "active");
  put("worker", first ? "inactive" : "active");
  put("migrate", "inactive");
  put(
    "etc/ii-tonya/runtime.env",
    "WORKER_POLL_INTERVAL_MS=1000\nDATABASE_URL=postgres://test@db/test\n",
  );
  for (const dir of [payload, join(root, "releases", oldSha)]) {
    mkdirSync(join(dir, "systemd"), { recursive: true });
    mkdirSync(join(dir, "scripts"), { recursive: true });
    mkdirSync(join(dir, "migrations"), { recursive: true });
    mkdirSync(join(dir, "api/node_modules/@ii-tonya/db"), { recursive: true });
    writeFileSync(
      join(dir, "api/migrate-native.mjs"),
      readFileSync("scripts/migrate-native.mjs"),
    );
    writeFileSync(
      join(dir, "api/node_modules/@ii-tonya/db/package.json"),
      JSON.stringify({ type: "module", exports: "./index.js" }),
    );
    writeFileSync(
      join(dir, "api/node_modules/@ii-tonya/db/index.js"),
      'export function createDb() { throw new Error("preflight must not connect"); } export function migrateDb() {} export function closeDb() {}',
    );
    writeFileSync(
      join(dir, "SOURCE_SHA"),
      dir === payload ? candidateSha : oldSha,
    );
    writeFileSync(
      join(dir, "provenance.json"),
      JSON.stringify({
        format: "ii-tonya-native-v1",
        source_sha: dir === payload ? candidateSha : oldSha,
      }),
    );
    for (const unit of ["api", "worker", "migrate"])
      writeFileSync(
        join(dir, "systemd", `ii-tonya-${unit}.service`),
        readFileSync(`deploy/systemd/ii-tonya-${unit}.service`),
      );
    writeFileSync(
      join(dir, "scripts/validate-runtime-env.sh"),
      '[[ "$FAULT" != runtime ]]',
    );
    writeFileSync(join(dir, "migrations/0050.sql"), "select 1;\n");
  }
  if (!first) symlinkSync(`releases/${oldSha}`, join(root, "current"));
  if (fault === "marker")
    put(".deployment-in-progress", "prior interrupted operation\n");
  if (fault === "inactive") put("worker", "inactive");
  if (fault === "poll")
    put(
      "etc/ii-tonya/runtime.env",
      "WORKER_POLL_INTERVAL_MS=999999\nDATABASE_URL=postgres://test@db/test\n",
    );
  if (fault === "slow-poll")
    put(
      "etc/ii-tonya/runtime.env",
      "WORKER_POLL_INTERVAL_MS=60000\nDATABASE_URL=postgres://test@db/test\n",
    );
  if (fault === "pgoptions")
    put(
      "etc/ii-tonya/runtime.env",
      "DATABASE_URL=postgres://test@db/test\nPGOPTIONS=-c statement_timeout=0\n",
    );
  const manifest = spawnSync(
    "bash",
    [
      "-c",
      "find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum",
    ],
    { cwd: join(payload, "migrations"), encoding: "utf8" },
  ).stdout.split(" ")[0];
  put(
    "incoming/unique-upload/compatibility.json",
    JSON.stringify({
      format: "ii-tonya-schema-compatibility-v1",
      previous_sha: oldSha,
      candidate_sha: candidateSha,
      migration_manifest_sha256:
        fault === "manifest" ? "0".repeat(64) : manifest,
      old_schema: { result: "pass", evidence_sha256: "c".repeat(64) },
      candidate_schema: { result: "pass", evidence_sha256: "d".repeat(64) },
    }),
  );
  if (fault === "missing-evidence")
    put("incoming/unique-upload/compatibility.json", "{}");
  if (action === "rollback") {
    mkdirSync(candidate, { recursive: true });
    spawnSync("cp", ["-R", `${payload}/.`, candidate]);
    spawnSync("ln", [
      "-sfn",
      `releases/${candidateSha}`,
      join(root, "current"),
    ]);
    put(".previous-release", `releases/${oldSha}\n`);
  }
  spawnSync("tar", [
    "-czf",
    join(incoming, "native-release.tar.gz"),
    "-C",
    payload,
    ".",
  ]);
  writeFileSync(
    join(incoming, "native-release.provenance.json"),
    readFileSync(join(payload, "provenance.json")),
  );
  put("incoming/unique-upload/native-release.spdx.json", "{}\n");
  const checksums = [
    "native-release.tar.gz",
    "native-release.spdx.json",
    "native-release.provenance.json",
  ]
    .map((name) => {
      const digest = createHash("sha256")
        .update(readFileSync(join(incoming, name)))
        .digest("hex");
      return `${digest}  ${name}\n`;
    })
    .join("");
  put("incoming/unique-upload/native-release.sha256", checksums);
  const checksumDigest = createHash("sha256")
    .update(readFileSync(join(incoming, "native-release.sha256")))
    .digest("hex");
  if (fault === "checksum")
    put("incoming/unique-upload/native-release.tar.gz", "corrupt");
  shim(
    "sudo",
    'printf "sudo %s\\n" "$*" >> "$ROOT/events"\n[[ "$1" != -n ]] || shift\nexec "$@"',
  );
  shim("flock", '[[ "$FAULT" != lock ]] || exit 1\nexec /usr/bin/flock "$@"');
  // Fast-forward only the intentionally stale candidate wait. Recovery still
  // samples the old worker normally; production deadlines are never changed.
  shim(
    "sleep",
    `n=$(<"$ROOT/clock"); step=1
if [[ "$FAULT" == health && "$(readlink "$ROOT/current" || :)" == releases/${candidateSha} ]]; then
  step=60; echo candidate-wait-elapsed >> "$ROOT/events"
fi
echo "$((n+step))" > "$ROOT/clock"`,
  );
  shim(
    "date",
    'if [[ "${1:-}" == -d ]]; then echo 100; else n=$(<"$ROOT/clock"); if [[ -e "$ROOT/clock-backwards" ]]; then n=$((n-2)); echo backwards-wall >> "$ROOT/events"; else n=$((n+2)); fi; echo "$n" > "$ROOT/clock"; echo "$n"; fi',
  );
  // Only backwards-clock cases substitute the shell elapsed-time read with a
  // deterministic monotonic clock. The real loop/body/control flow is unchanged.
  shim(
    "monotonic",
    'if [[ ! -e "$ROOT/clock-backwards" ]]; then echo 0; else n=$(cat "$ROOT/elapsed" 2>/dev/null || echo 0); n=$((n+2)); echo "$n" > "$ROOT/elapsed"; echo "$n"; fi',
  );
  shim(
    "stat",
    `if [[ "$*" == *ii-tonya-worker-heartbeat* ]]; then
  current=$(readlink "$ROOT/current" || :)
  if [[ "$FAULT" == slow-poll ]]; then
    n=$(cat "$ROOT/heartbeat-reads" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$ROOT/heartbeat-reads"
    echo "$((200 + (n-1)/2))"; exit 0
  fi
  if [[ -e "$ROOT/clock-backwards" && "$FAULT" == backwards-stat ]]; then exit 1; fi
  if [[ -e "$ROOT/clock-backwards" && "$FAULT" == backwards-stale ]]; then echo 99; exit 0; fi
  if [[ "$FAULT" == unchanged ]]; then echo 201; exit 0; fi
  if [[ "$FAULT" == stale || ( "$FAULT" == recovery-health && -e "$ROOT/migration-done" ) || ( "$FAULT" == health && "$current" == releases/${candidateSha} ) ]]; then echo 99; else cat "$ROOT/clock"; fi
else exec /usr/bin/stat "$@"; fi`,
  );
  shim(
    "curl",
    'printf "curl %s\\n" "$*" >> "$ROOT/events"\n[[ "$FAULT" != api-health ]]',
  );
  shim(
    "mv",
    `if [[ "$FAULT" == link && "$*" == *current* && -e "$ROOT/migration-done" ]]; then exit 1; fi
exec /usr/bin/mv "$@"`,
  );
  shim(
    "systemctl",
    `printf 'systemctl %s\\n' "$*" >> "$ROOT/events"
command="$1"; shift
args="$*"
if [[ "$command" == show && "$args" == *ii-tonya-yookassa-gateway.service* && "$args" == *LoadState* ]]; then echo not-found; exit 0; fi
unit="api"
[[ "$args" != *worker* ]] || unit="worker"
[[ "$args" != *migrate* ]] || unit="migrate"
case "$command" in
  show)
    state=$(<"$ROOT/$unit")
    case "$args" in
      *MainPID*) if [[ "$state" == active ]]; then
        if [[ "$FAULT" == pid-change && "$unit" == worker ]]; then n=$(cat "$ROOT/pid-count" 2>/dev/null || echo 222); echo "$((n+1))" > "$ROOT/pid-count"; echo "$n"; else echo 222; fi
      else echo 0; fi ;;
      *ExecMainStartTimestampMonotonic*) echo 100000000 ;;
      *ExecMainStartTimestamp*) echo 100 ;;
      *ActiveState*) echo "$state" ;;
      *LoadState*) if [[ "$FIRST" == true && ! -e "$ROOT/etc/systemd/system/ii-tonya-$unit.service" ]]; then echo not-found; else echo loaded; fi ;;
      *Result*) if [[ "$FAULT" == migrate ]]; then echo exit-code; else echo success; fi ;;
    esac ;;
  stop)
    if [[ "$FAULT" == backwards-stop && "$unit" == worker ]]; then touch "$ROOT/clock-backwards"; exit 0; fi
    if [[ "$FAULT" == stop && "$unit" == worker && ! -e "$ROOT/stop-failed" ]]; then touch "$ROOT/stop-failed"; exit 1; fi
    if [[ "$FAULT" == migration-stuck && "$unit" == migrate ]]; then exit 1; fi
    if [[ "$FAULT" == stop-stuck && "$unit" == worker ]]; then exit 0; fi
    echo inactive > "$ROOT/$unit" ;;
  start|restart)
    if [[ "$unit" == migrate ]]; then
      printf 'migration api=%s worker=%s\\n' "$(<"$ROOT/api")" "$(<"$ROOT/worker")" >> "$ROOT/events"
      if [[ "$FAULT" == migration-stuck ]]; then echo active > "$ROOT/migrate"; exit 1; fi
      [[ "$FAULT" != migrate ]] || exit 1
      touch "$ROOT/migration-done"
    else
      if [[ "$FAULT" == link || "$FAULT" == recovery-health ]]; then
        [[ "$(readlink "$ROOT/current")" != releases/${candidateSha} ]] || exit 1
      fi
      echo active > "$ROOT/$unit"
      if [[ "$unit" == worker && "$FAULT" == backwards-* && "$FAULT" != backwards-stop ]]; then
        touch "$ROOT/clock-backwards"
        if [[ "$FAULT" == backwards-inactive ]]; then echo inactive > "$ROOT/worker"; fi
      fi
    fi ;;
  is-active) [[ "$(<"$ROOT/$unit")" == active ]] ;;
  daemon-reload|disable|enable) : ;;
  *) exit 2 ;;
esac`,
  );
  // Execute the actual final remote body. Filesystem substitutions isolate fixed
  // host paths; systemctl/SSH are never invoked outside the shim PATH.
  const bodies = [...script().matchAll(/<<'REMOTE'\n([\s\S]*?)\nREMOTE/gu)];
  const body = bodies.at(-1)?.[1];
  if (!body) throw new Error("remote body not found");
  const runner = join(root, "runner.sh");
  let isolatedBody = body
    .replaceAll("/etc/", `${root}/etc/`)
    .replaceAll("/proc/", `${root}/proc/`);
  if (fault.startsWith("backwards-"))
    isolatedBody = isolatedBody.replace(/\bSECONDS\b/gu, "$(monotonic)");
  writeFileSync(runner, isolatedBody);
  const result = spawnSync(
    "bash",
    [runner, root, candidateSha, incoming, action, checksumDigest],
    {
      encoding: "utf8",
      timeout: 15_000,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        ROOT: root,
        FAULT: fault,
        FIRST: String(first),
      },
    },
  );
  return {
    ...result,
    root,
    incoming,
    candidate,
    events: existsSync(join(root, "events"))
      ? readFileSync(join(root, "events"), "utf8")
      : "",
    selected: existsSync(join(root, "current"))
      ? readlinkSync(join(root, "current"))
      : null,
  };
}

describe("native cutover remote fault drill", () => {
  it("retains the heartbeat baseline across a slow poll update between sampling pairs", () => {
    const r = drill("slow-poll");
    expect(r.error).toBeUndefined();
    expect(r.status, r.stderr).toBe(0);
    expect(r.selected).toBe(`releases/${candidateSha}`);
  });

  it.each([
    "backwards-stop",
    "backwards-inactive",
    "backwards-stat",
    "backwards-stale",
  ])("bounds %s by elapsed time despite backwards wall time", (fault) => {
    const r = drill(fault);
    expect(r.error).toBeUndefined(); // No outer harness timeout may mask an infinite loop.
    expect(r.status).not.toBe(0);
    expect(r.events).toContain("backwards-wall");
    expect(existsSync(r.incoming)).toBe(true);
    if (fault === "backwards-stop") {
      expect(r.selected).toBe(`releases/${oldSha}`);
      expect(r.events).not.toContain("start ii-tonya-migrate.service");
    }
  });

  it("cleans a terminated first-install migration failure but retains the database-unknown incident", () => {
    const r = drill("migrate", "deploy", true);
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(70);
    expect(r.selected).toBeNull();
    for (const unit of ["api", "worker", "migrate"]) {
      expect(
        existsSync(
          join(r.root, "etc/systemd/system", `ii-tonya-${unit}.service`),
        ),
      ).toBe(false);
    }
    expect(r.events).toContain("disable ii-tonya-api.service");
    expect(r.events).toContain("disable ii-tonya-worker.service");
    expect(r.events).not.toContain("start ii-tonya-api.service");
    expect(r.events).not.toContain("start ii-tonya-worker.service");
    expect(existsSync(r.candidate)).toBe(true);
    expect(existsSync(r.incoming)).toBe(true);
    expect(existsSync(join(r.root, ".deployment-in-progress"))).toBe(true);
    expect(r.stderr).toContain(
      "Database backend termination/commit state unknown",
    );
  });

  it("does not unselect first installation when migration termination is unverified", () => {
    const r = drill("migration-stuck", "deploy", true);
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(70);
    expect(r.selected).toBe(`releases/${candidateSha}`);
    expect(r.events).not.toContain("disable");
    expect(
      existsSync(join(r.root, "etc/systemd/system/ii-tonya-api.service")),
    ).toBe(true);
    expect(existsSync(r.candidate)).toBe(true);
    expect(existsSync(r.incoming)).toBe(true);
    expect(existsSync(join(r.root, ".deployment-in-progress"))).toBe(true);
  });
  it("stops both applications before migration and starts only after success", () => {
    const r = drill();
    expect(r.status, r.stderr).toBe(0);
    expect(r.events).toContain("migration api=inactive worker=inactive");
    expect(r.events.indexOf("start ii-tonya-api.service")).toBeGreaterThan(
      r.events.indexOf("start ii-tonya-migrate.service"),
    );
    expect(r.selected).toBe(`releases/${candidateSha}`);
    expect(existsSync(join(r.root, ".deployment-in-progress"))).toBe(false);
  });

  it.each([
    "checksum",
    "runtime",
    "manifest",
    "inactive",
    "marker",
    "lock",
    "poll",
    "pgoptions",
    "missing-evidence",
    "api-health",
    "pid-change",
    "unchanged",
  ])("refuses %s before quiescence", (fault) => {
    const r = drill(fault);
    expect(r.status).not.toBe(0);
    expect(r.events).not.toContain("systemctl stop");
    expect(r.selected).toBe(`releases/${oldSha}`);
    expect(existsSync(r.incoming)).toBe(true);
  });

  it("recovers both services after partial stop without switching", () => {
    const r = drill("stop");
    expect(r.status).not.toBe(0);
    expect(r.selected).toBe(`releases/${oldSha}`);
    expect(r.events).toContain("start ii-tonya-api.service");
    expect(r.events).toContain("start ii-tonya-worker.service");
    expect(r.events).not.toContain("start ii-tonya-migrate.service");
    expect(existsSync(r.incoming)).toBe(true);
  });

  it.each(["migrate", "migration-stuck"])(
    "keeps applications stopped and marker on %s uncertainty",
    (fault) => {
      const r = drill(fault);
      expect(r.status).toBe(70);
      expect(r.events).not.toContain("start ii-tonya-api.service");
      expect(r.events).not.toContain("start ii-tonya-worker.service");
      expect(existsSync(r.candidate)).toBe(true);
      expect(existsSync(r.incoming)).toBe(true);
      expect(existsSync(join(r.root, ".deployment-in-progress"))).toBe(true);
      expect(r.stderr).toContain("manual recovery required");
    },
  );

  it("restores and independently verifies the old application after candidate health failure", () => {
    const r = drill("health");
    expect(r.error, r.stderr).toBeUndefined();
    expect(r.signal).toBeNull();
    expect(r.status).toBe(1);
    expect(r.events).toContain("candidate-wait-elapsed");
    expect(existsSync(join(r.root, ".deployment-in-progress"))).toBe(false);
    expect(r.selected).toBe(`releases/${oldSha}`);
    expect(existsSync(r.candidate)).toBe(true);
    expect(existsSync(r.incoming)).toBe(true);
    expect(r.stderr).toContain("database migrations were not rolled back");
  });

  it.each(["link", "recovery-health"])(
    "reports %s recovery failure distinctly and retains artifacts",
    (fault) => {
      const r = drill(fault);
      expect(r.status).toBe(70);
      expect(existsSync(r.candidate)).toBe(true);
      expect(existsSync(r.incoming)).toBe(true);
      expect(existsSync(join(r.root, ".deployment-in-progress"))).toBe(true);
      expect(r.stderr).toContain("recovery failed");
    },
  );

  it("rejects stale worker readiness even when systemd is active", () => {
    const r = drill("stale");
    expect(r.status).not.toBe(0);
    expect(r.events).not.toContain("systemctl stop");
  });

  it("safely unselects a failed first installation and preserves its artifacts", () => {
    const r = drill("health", "deploy", true);
    expect(r.status).not.toBe(0);
    expect(r.selected).toBeNull();
    expect(existsSync(r.candidate)).toBe(true);
    expect(existsSync(r.incoming)).toBe(true);
    expect(r.events).toContain("disable ii-tonya-api.service");
    expect(r.stderr).toContain("no previous release");
  });

  it("performs target validation without stopping or switching", () => {
    const r = drill("", "validate");
    expect(r.status, r.stderr).toBe(0);
    expect(r.events).toContain("systemctl show");
    expect(r.events).not.toContain("systemctl stop");
    expect(r.selected).toBe(`releases/${oldSha}`);
  });

  it("bounds SSH connection and liveness waits", () => {
    expect(script()).toContain("ConnectTimeout=10");
    expect(script()).toContain("ServerAliveInterval=5");
    expect(script()).toContain("ServerAliveCountMax=3");
  });

  it("refuses switching while a stopped service still reports a live process", () => {
    const r = drill("stop-stuck");
    expect(r.status, r.stderr).toBe(70);
    expect(r.selected).toBe(`releases/${oldSha}`);
    expect(r.events).not.toContain("start ii-tonya-migrate.service");
    expect(existsSync(r.incoming)).toBe(true);
  });

  it("manual rollback uses the same lock, quiescence and readiness checks", () => {
    const r = drill("", "rollback");
    expect(r.status, r.stderr).toBe(0);
    expect(r.selected).toBe(`releases/${oldSha}`);
    expect(r.events).toContain("stop ii-tonya-api.service");
    expect(r.events).toContain("stop ii-tonya-worker.service");
    expect(r.events).not.toContain("start ii-tonya-migrate.service");
    expect(r.stdout).toContain("database migrations were not rolled back");
  });

  it("manual rollback refuses an unresolved prior incident", () => {
    const r = drill("marker", "rollback");
    expect(r.status).toBe(70);
    expect(r.selected).toBe(`releases/${candidateSha}`);
    expect(r.events).not.toContain("systemctl stop");
  });
});
