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
import { describe, expect, it } from "vitest";

const PREVIOUS = "b".repeat(40);
const CURRENT = "a".repeat(40);

const extractRollbackRemote = (script: string): string => {
  const bodies = [...script.matchAll(/<<'REMOTE'\n([\s\S]*?)\nREMOTE/gu)];
  const body = bodies.at(-1)?.[1];
  if (!body?.includes('if [[ "$action" == rollback ]]')) {
    throw new Error("common rollback remote script not found");
  }
  return body;
};

function rollbackDrill(fault: "none" | "missing-previous" | "stale" = "none") {
  const root = mkdtempSync(join(tmpdir(), "ii-tonya-rollback-drill-"));
  const deployRoot = join(root, "opt/ii-tonya-platform");
  const incoming = join(deployRoot, "incoming/drill");
  const bin = join(root, "bin");
  const fakeEtc = join(root, "etc/systemd/system");
  for (const directory of [incoming, bin, fakeEtc, join(root, "etc/ii-tonya")])
    mkdirSync(directory, { recursive: true });
  const put = (path: string, value: string) =>
    writeFileSync(join(root, path), value);
  const shim = (name: string, body: string) => {
    const path = join(bin, name);
    writeFileSync(path, `#!/usr/bin/env bash\nset -Eeuo pipefail\n${body}\n`);
    chmodSync(path, 0o755);
  };
  put("api", "active");
  put("worker", "active");
  put("migrate", "inactive");
  put("clock", "200");
  put("etc/ii-tonya/runtime.env", "WORKER_POLL_INTERVAL_MS=1000\n");
  for (const sha of [CURRENT, PREVIOUS]) {
    if (sha === PREVIOUS && fault === "missing-previous") continue;
    const release = join(deployRoot, "releases", sha);
    for (const part of ["systemd", "scripts", "migrations"])
      mkdirSync(join(release, part), { recursive: true });
    writeFileSync(join(release, "SOURCE_SHA"), sha);
    writeFileSync(join(release, "scripts/validate-runtime-env.sh"), "exit 0\n");
    writeFileSync(join(release, "migrations/0050.sql"), "select 1;\n");
    for (const unit of ["api", "worker", "migrate"]) {
      const bytes = readFileSync(
        `deploy/systemd/ii-tonya-${unit}.service`,
        "utf8",
      );
      writeFileSync(
        join(release, "systemd", `ii-tonya-${unit}.service`),
        bytes + (sha === CURRENT ? "\n# current-release marker\n" : ""),
      );
    }
  }
  writeFileSync(
    join(deployRoot, ".previous-release"),
    `releases/${PREVIOUS}\n`,
  );
  symlinkSync(`releases/${CURRENT}`, join(deployRoot, "current"));
  const manifest = spawnSync(
    "bash",
    [
      "-c",
      "find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum",
    ],
    {
      cwd: join(deployRoot, "releases", CURRENT, "migrations"),
      encoding: "utf8",
    },
  );
  if (manifest.status !== 0)
    throw new Error("fixture manifest construction failed");
  // Synthetic attestation belongs only to this temporary shell fixture.
  writeFileSync(
    join(incoming, "compatibility.json"),
    JSON.stringify({
      format: "ii-tonya-schema-compatibility-v1",
      previous_sha: PREVIOUS,
      candidate_sha: CURRENT,
      migration_manifest_sha256: manifest.stdout.split(" ")[0],
      old_schema: { result: "pass", evidence_sha256: "c".repeat(64) },
      candidate_schema: { result: "pass", evidence_sha256: "d".repeat(64) },
    }),
  );
  shim(
    "sudo",
    '[[ "$1" != -n ]] || shift\ncase "$1" in install|systemctl|rm) exec "$@" ;; *) exit 99 ;; esac',
  );
  shim("ssh", "exit 99");
  shim("scp", "exit 99");
  shim("sleep", 'n=$(<"$ROOT/clock"); echo "$((n+1))" > "$ROOT/clock"');
  shim(
    "date",
    'if [[ "${1:-}" == -d ]]; then echo 100; else n=$(<"$ROOT/clock"); n=$((n+2)); echo "$n" > "$ROOT/clock"; echo "$n"; fi',
  );
  shim(
    "stat",
    `[[ "$*" == *"/proc/222/root/tmp/ii-tonya-worker-heartbeat" ]] || exit 1
current=$(readlink "$DEPLOY_FIXTURE/current")
value=$(<"$ROOT/clock")
if [[ "$FAULT" == stale && "$current" == releases/${PREVIOUS} ]]; then value=99; fi
printf 'heartbeat %s %s\\n' "$current" "$value" >> "$ROOT/drill.log"
echo "$value"`,
  );
  shim(
    "systemctl",
    `printf 'systemctl %s\\n' "$*" >> "$ROOT/drill.log"
command="$1"; shift
unit=api
[[ "$*" != *worker* ]] || unit=worker
[[ "$*" != *migrate* ]] || unit=migrate
case "$command" in
  show)
    state=$(<"$ROOT/$unit")
    case "$*" in
      *ActiveState*) echo "$state" ;;
      *MainPID*) if [[ "$state" == active ]]; then echo 222; else echo 0; fi ;;
      *ExecMainStartTimestampMonotonic*) echo 100000000 ;;
      *ExecMainStartTimestamp*) echo 100 ;;
      *) exit 99 ;;
    esac ;;
  stop) echo inactive > "$ROOT/$unit" ;;
  start)
    [[ "$unit" != migrate ]] || exit 99
    selected=$(readlink "$DEPLOY_FIXTURE/current")
    installed="$ROOT/etc/systemd/system/ii-tonya-$unit.service"
    cmp "$installed" "$DEPLOY_FIXTURE/$selected/systemd/ii-tonya-$unit.service"
    printf 'start-selected %s %s\\n' "$unit" "$selected" >> "$ROOT/drill.log"
    echo active > "$ROOT/$unit" ;;
  daemon-reload)
    [[ "$(<"$ROOT/api")" == inactive && "$(<"$ROOT/worker")" == inactive ]] ;;
  *) exit 99 ;;
esac`,
  );
  shim(
    "curl",
    `[[ "$(<"$ROOT/api")" == active && "$(<"$ROOT/worker")" == active ]] || exit 22
selected=$(readlink "$DEPLOY_FIXTURE/current")
[[ "$selected" == releases/${CURRENT} || "$selected" == releases/${PREVIOUS} ]] || exit 22
printf 'curl-selected %s %s\\n' "$selected" "$*" >> "$ROOT/drill.log"`,
  );
  const remote = extractRollbackRemote(
    readFileSync("scripts/deploy-native-remote.sh", "utf8"),
  );
  const runner = join(root, "run-rollback.sh");
  writeFileSync(
    runner,
    remote
      .replaceAll("/etc/", `${root}/etc/`)
      .replaceAll("/proc/", `${root}/proc/`),
  );
  const result = spawnSync(
    "bash",
    [runner, deployRoot, CURRENT, incoming, "rollback", "none"],
    {
      encoding: "utf8",
      timeout: 15_000,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        ROOT: root,
        DEPLOY_FIXTURE: deployRoot,
        FAULT: fault,
      },
    },
  );
  return {
    result,
    root,
    deployRoot,
    incoming,
    commands: existsSync(join(root, "drill.log"))
      ? readFileSync(join(root, "drill.log"), "utf8")
      : "",
  };
}

describe("native rollback drill", () => {
  it("extracts the production rollback remote body from the deploy adapter", () => {
    const remote = extractRollbackRemote(
      readFileSync("scripts/deploy-native-remote.sh", "utf8"),
    );
    expect(remote).toContain(
      'target="$(cat "$deploy_root/.previous-release")"',
    );
    expect(remote).toContain('select_release "$target"');
    expect(remote).toContain('install_release_units "$release_dir"');
    expect(remote).toContain("ctl start ii-tonya-api.service --no-block");
    expect(remote).toContain("ctl start ii-tonya-worker.service --no-block");
    expect(remote).toContain("http://127.0.0.1:3000/health/ready");
    expect(remote).toContain("/proc/$pid/root/tmp/ii-tonya-worker-heartbeat");
    expect(remote).not.toMatch(/docker|compose/iu);
  });

  it("switches current to the prior immutable release directory and restores units", () => {
    const { result, root, deployRoot, commands } = rollbackDrill();
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(readlinkSync(join(deployRoot, "current"))).toBe(
      `releases/${PREVIOUS}`,
    );
    for (const unit of ["api", "worker", "migrate"]) {
      const installed = readFileSync(
        join(root, "etc/systemd/system", `ii-tonya-${unit}.service`),
        "utf8",
      );
      expect(installed).toBe(
        readFileSync(
          join(
            deployRoot,
            "releases",
            PREVIOUS,
            "systemd",
            `ii-tonya-${unit}.service`,
          ),
          "utf8",
        ),
      );
      expect(installed).not.toContain("current-release marker");
    }
    expect(commands).toContain("systemctl daemon-reload");
    for (const unit of ["api", "worker"]) {
      expect(commands).toContain(`start-selected ${unit} releases/${PREVIOUS}`);
      expect(
        commands.indexOf(`systemctl stop ii-tonya-${unit}.service`),
      ).toBeLessThan(commands.indexOf("systemctl daemon-reload"));
    }
    expect(commands).not.toContain("systemctl start ii-tonya-migrate.service");
    expect(commands).toContain(`curl-selected releases/${CURRENT}`);
    expect(commands).toContain(`curl-selected releases/${PREVIOUS}`);
    expect(commands).toContain("http://127.0.0.1:3000/health/ready");
    const heartbeats = [
      ...commands.matchAll(
        new RegExp(`heartbeat releases/${PREVIOUS} (\\d+)`, "gu"),
      ),
    ].map((match) => Number(match[1]));
    expect(heartbeats.length).toBeGreaterThanOrEqual(2);
    expect(heartbeats[0]).toBeGreaterThan(100);
    expect(heartbeats.at(-1)).toBeGreaterThan(heartbeats[0]!);
    expect(existsSync(join(deployRoot, ".deployment-in-progress"))).toBe(false);
  });

  it("refuses rollback when the prior immutable directory is missing", () => {
    const { result, deployRoot, incoming, commands } =
      rollbackDrill("missing-previous");
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(readlinkSync(join(deployRoot, "current"))).toBe(
      `releases/${CURRENT}`,
    );
    expect(commands).not.toContain("systemctl stop");
    expect(commands).not.toContain("systemctl start");
    expect(existsSync(incoming)).toBe(true);
  });

  it("does not report successful rollback for an active worker with stale heartbeat", () => {
    const { result, deployRoot, incoming, commands } = rollbackDrill("stale");
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(commands).toContain(`start-selected worker releases/${PREVIOUS}`);
    expect(commands).toContain(`heartbeat releases/${PREVIOUS} 99`);
    expect(result.stderr).toContain("Worker readiness deadline expired");
    expect(readlinkSync(join(deployRoot, "current"))).toBe(
      `releases/${CURRENT}`,
    );
    expect(existsSync(incoming)).toBe(true);
  });
});
