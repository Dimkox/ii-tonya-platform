import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PREVIOUS = "b".repeat(40);
const CURRENT = "a".repeat(40);

const extractRollbackRemote = (script: string): string => {
  const match = script.match(
    /if \[\[ "\$action" == rollback \]\]; then\n[\s\S]*?<<'REMOTE'\n([\s\S]*?)\nREMOTE\n  exit 0\nfi/u,
  );
  if (!match?.[1]) {
    throw new Error("rollback remote script not found");
  }
  return match[1];
};

describe("native rollback drill", () => {
  it("extracts the production rollback remote body from the deploy adapter", () => {
    const remote = extractRollbackRemote(
      readFileSync("scripts/deploy-native-remote.sh", "utf8"),
    );
    expect(remote).toContain('previous="$(cat .previous-release)"');
    expect(remote).toContain("ln -sfn \"$previous\" .current.next");
    expect(remote).toContain("mv -Tf .current.next current");
    expect(remote).toContain("sudo systemctl restart ii-tonya-api.service");
    expect(remote).toContain("sudo systemctl restart ii-tonya-worker.service");
    expect(remote).toContain("http://127.0.0.1:3000/health/ready");
    expect(remote).not.toMatch(/docker|compose/iu);
  });

  it("switches current to the prior immutable release directory and restores units", () => {
    const root = mkdtempSync(join(tmpdir(), "ii-tonya-rollback-drill-"));
    const deployRoot = join(root, "opt", "ii-tonya-platform");
    const fakeEtc = join(root, "etc", "systemd", "system");
    const bin = join(root, "bin");
    const log = join(root, "drill.log");
    mkdirSync(join(deployRoot, "releases", PREVIOUS, "systemd"), {
      recursive: true,
    });
    mkdirSync(join(deployRoot, "releases", CURRENT, "systemd"), {
      recursive: true,
    });
    mkdirSync(fakeEtc, { recursive: true });
    mkdirSync(bin, { recursive: true });

    for (const unit of [
      "ii-tonya-api.service",
      "ii-tonya-worker.service",
      "ii-tonya-migrate.service",
    ]) {
      const bytes = readFileSync(`deploy/systemd/${unit}`);
      writeFileSync(
        join(deployRoot, "releases", PREVIOUS, "systemd", unit),
        bytes,
      );
      writeFileSync(
        join(deployRoot, "releases", CURRENT, "systemd", unit),
        Buffer.concat([bytes, Buffer.from("\n# current-release marker\n")]),
      );
    }

    writeFileSync(
      join(deployRoot, ".previous-release"),
      `releases/${PREVIOUS}\n`,
    );
    spawnSync("ln", ["-sfn", `releases/${CURRENT}`, "current"], {
      cwd: deployRoot,
    });

    const sudo = join(bin, "sudo");
    writeFileSync(
      sudo,
      `#!/usr/bin/env bash
set -Eeuo pipefail
printf 'sudo %s\\n' "$*" >>${JSON.stringify(log)}
args=()
for arg in "$@"; do
  if [[ "$arg" == /etc/* ]]; then
    args+=(${JSON.stringify(root)}"\$arg")
  else
    args+=("$arg")
  fi
done
exec "\${args[@]}"
`,
    );
    chmodSync(sudo, 0o755);

    const systemctl = join(bin, "systemctl");
    writeFileSync(
      systemctl,
      `#!/usr/bin/env bash
set -Eeuo pipefail
printf 'systemctl %s\\n' "$*" >>${JSON.stringify(log)}
exit 0
`,
    );
    chmodSync(systemctl, 0o755);

    const curl = join(bin, "curl");
    writeFileSync(
      curl,
      `#!/usr/bin/env bash
set -Eeuo pipefail
printf 'curl %s\\n' "$*" >>${JSON.stringify(log)}
current="$(readlink ${JSON.stringify(join(deployRoot, "current"))})"
if [[ "$current" != "releases/${PREVIOUS}" ]]; then
  printf 'health-check against non-previous current: %s\\n' "$current" >&2
  exit 22
fi
exit 0
`,
    );
    chmodSync(curl, 0o755);

    const remote = extractRollbackRemote(
      readFileSync("scripts/deploy-native-remote.sh", "utf8"),
    );
    const runner = join(root, "run-rollback.sh");
    writeFileSync(runner, `${remote}\n`);
    chmodSync(runner, 0o755);

    const result = spawnSync("bash", [runner, deployRoot], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(readlinkSync(join(deployRoot, "current"))).toBe(
      `releases/${PREVIOUS}`,
    );
    const apiUnit = readFileSync(
      join(root, "etc/systemd/system/ii-tonya-api.service"),
      "utf8",
    );
    expect(apiUnit).toContain("Description=ii-Tonya API");
    expect(apiUnit).not.toContain("current-release marker");
    const commands = readFileSync(log, "utf8");
    expect(commands).toContain("systemctl daemon-reload");
    expect(commands).toContain("systemctl restart ii-tonya-api.service");
    expect(commands).toContain("systemctl restart ii-tonya-worker.service");
    expect(commands).toContain("http://127.0.0.1:3000/health/ready");
  });

  it("refuses rollback when the prior immutable directory is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "ii-tonya-rollback-missing-"));
    const deployRoot = join(root, "opt", "ii-tonya-platform");
    mkdirSync(deployRoot, { recursive: true });
    writeFileSync(
      join(deployRoot, ".previous-release"),
      `releases/${PREVIOUS}\n`,
    );
    const remote = extractRollbackRemote(
      readFileSync("scripts/deploy-native-remote.sh", "utf8"),
    );
    const runner = join(root, "run-rollback.sh");
    writeFileSync(runner, `${remote}\n`);
    const result = spawnSync("bash", [runner, deployRoot], {
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
  });
});
