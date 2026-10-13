import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("native dedicated-server production release", () => {
  it("declares Docker as dev/test-only and links the canonical graph", () => {
    const readme = read("README.md");
    const requirements = read("docs/spec/normalized-requirements.md");
    const environment = read("docs/handoffs/environment-manifest.md");

    expect(readme).toContain(
      "[Open the full project connectivity graph](docs/architecture/project-connectivity-graph.md)",
    );
    expect(readme).toContain(
      "Docker and Compose are development and Claw test tools only",
    );
    expect(readme).toContain("GitHub Actions are not used");
    expect(environment).toContain("## Direct Claw and native release tooling");
    expect(environment).toContain("`ii_tonya_native_smoke`");
    expect(environment).not.toContain(
      "The CI workflows pin their action revisions",
    );
    expect(requirements).toContain("OPS-DEPLOY-001");
    expect(requirements).toContain("без контейнеров приложения");
  });

  it("ships native bundle and systemd deployment assets", () => {
    for (const path of [
      "scripts/build-native-release.sh",
      "scripts/provision-claw-syft.sh",
      "scripts/smoke-native-release.sh",
      "scripts/deploy-native-remote.sh",
      "deploy/systemd/ii-tonya-api.service",
      "deploy/systemd/ii-tonya-worker.service",
      "docs/runbooks/native-production-deployment.md",
    ]) {
      expect(existsSync(path), path).toBe(true);
    }
  });

  it("rehearses the native bundle against an isolated Claw PostgreSQL database", () => {
    const smoke = read("scripts/smoke-native-release.sh");

    expect(smoke).toContain("II_TONYA_TEST_POSTGRES_ADMIN_URL");
    expect(smoke).toContain('db_name="ii_tonya_native_smoke"');
    expect(smoke).toContain("migrate-native.mjs");
    expect(smoke).toContain("/health/ready");
    expect(smoke).toContain("ii-tonya-worker-heartbeat");
    expect(smoke).toContain("DROP SCHEMA IF EXISTS public CASCADE");
    expect(smoke).toContain("DROP SCHEMA IF EXISTS drizzle CASCADE");
    expect(smoke).not.toContain("DROP DATABASE");
    expect(smoke).toContain("trap cleanup EXIT");
    expect(smoke).not.toMatch(/set -x|echo.*DATABASE_URL/iu);
  });

  it("pins and verifies the Claw SBOM tool before mounting it read-only", () => {
    const provision = read("scripts/provision-claw-syft.sh");
    const runner = read("scripts/run-claw-ci.sh");

    expect(provision).toContain('syft_version="1.42.3"');
    expect(provision).toContain(
      'archive_sha="0d6be741479eddd2c8644a288990c04f3df0d609bbc1599a005532a9dff63509"',
    );
    expect(provision).toContain(
      'binary_sha="6c1eb5c6f15c177fa3dd727ee186c61a660a3939a4e1dc1bc4b3e00eafec098e"',
    );
    expect(provision).toContain("gh release download");
    expect(provision).toContain("printf '%s  %s\\n' \"$archive_sha\"");
    expect(provision).toContain("printf '%s  %s\\n' \"$binary_sha\"");
    expect(runner).toContain(
      'claw_syft="$(bash "$source_root/scripts/provision-claw-syft.sh")"',
    );
    expect(runner).toContain('-v "$claw_syft:/usr/local/bin/syft:ro"');
  });

  it("builds one exact-SHA production bundle without secrets or containers", () => {
    const script = read("scripts/build-native-release.sh");

    expect(script).toContain(
      'source_sha="${SOURCE_SHA:?SOURCE_SHA is required}"',
    );
    expect(script).toContain("^[0-9a-f]{40}$");
    expect(script).toContain("git archive");
    expect(script).toContain(
      "pnpm --offline --frozen-lockfile --trust-lockfile --filter @ii-tonya/api --prod deploy",
    );
    expect(script).toContain(
      "pnpm --offline --frozen-lockfile --trust-lockfile --filter @ii-tonya/app-worker --prod deploy",
    );
    expect(script).toContain("native-release.tar.gz");
    expect(script).toContain("native-release.sha256");
    expect(script).toContain("native-release.spdx.json");
    expect(script).toContain('syft "dir:$work_dir/release"');
    expect(script).toContain(
      'cp scripts/validate-runtime-env.sh "$work_dir/release/scripts/validate-runtime-env.sh"',
    );
    expect(script).not.toMatch(/docker|compose|\.env/iu);
  });

  it("deploys immutable native releases and rolls back the current symlink", () => {
    const script = read("scripts/deploy-native-remote.sh");

    expect(script).toContain("set -Eeuo pipefail");
    expect(script).toContain("UserKnownHostsFile");
    expect(script).not.toContain("StrictHostKeyChecking=no");
    expect(script).not.toContain("ssh-keyscan");
    expect(script).not.toMatch(
      /docker|compose|API_IMAGE_REF|WORKER_IMAGE_REF/u,
    );
    expect(script).toContain("releases/$release_sha");
    expect(script).toContain("sha256sum -c");
    expect(script).toContain("cosign verify-blob");
    expect(script).toContain(
      'bash "$release_dir/scripts/validate-runtime-env.sh" /etc/ii-tonya/runtime.env "$release_sha"',
    );
    expect(script).toContain("ctl start ii-tonya-api.service --no-block");
    expect(script).toContain("ctl start ii-tonya-worker.service --no-block");
    expect(script).toContain("rollback)");
    expect(script).toContain("readlink");
    expect(script).toContain('install_release_units "$deploy_root/$previous"');
    expect(script).toContain("ctl daemon-reload");
    expect(script.indexOf("trap 'recover \"$?\"' ERR")).toBeLessThan(
      script.indexOf('install_release_units "$release_dir"'),
    );
    expect(script).toContain("unit_install_started=true");
    expect(script).toContain('select_release "$target"');
    expect(script).not.toContain('find "$release_dir" -mindepth 1 -delete');
    expect(script).toContain('find "$incoming" -mindepth 1 -delete');
    expect(script).toContain('if [[ -n "$previous" ]]');
    expect(script).toContain('rm -f "$deploy_root/current"');
    expect(script).toContain(
      'rm -f "/etc/systemd/system/ii-tonya-$unit.service"',
    );
    expect(script).toContain('ctl disable "ii-tonya-$unit.service"');
    expect(script).toContain("flock -w 10 9");
    expect(script).toContain(".deployment-in-progress");
  });

  it("preserves interactive root password access without storing the password", () => {
    const runbook = read("docs/runbooks/native-production-deployment.md");
    const deploymentAssets = [
      read("scripts/deploy-native-remote.sh"),
      read("deploy/systemd/ii-tonya-api.service"),
      read("deploy/systemd/ii-tonya-worker.service"),
    ].join("\n");

    expect(runbook).toContain("PROD_ROOT_PASSWORD_LOGIN_ENABLED=true");
    expect(runbook).toContain("PROD_ROOT_PASSWORD_SOURCE=interactive");
    expect(runbook).toContain("only at the interactive SSH password prompt");
    expect(runbook).toContain("never stored in project `.env`");
    expect(deploymentAssets).not.toMatch(
      /PermitRootLogin\s+(?:no|prohibit-password)|PasswordAuthentication\s+no/u,
    );
    expect(read("deploy/systemd/ii-tonya-api.service")).toContain(
      "User=ii_tonya",
    );
    expect(read("deploy/systemd/ii-tonya-worker.service")).toContain(
      "User=ii_tonya",
    );
  });

  it("runs API and worker directly under hardened systemd units", () => {
    const api = read("deploy/systemd/ii-tonya-api.service");
    const worker = read("deploy/systemd/ii-tonya-worker.service");

    for (const unit of [api, worker]) {
      expect(unit).toContain("User=ii_tonya");
      expect(unit).toContain("EnvironmentFile=/etc/ii-tonya/runtime.env");
      expect(unit).toContain("WorkingDirectory=/opt/ii-tonya-platform/current");
      expect(unit).toContain("NoNewPrivileges=true");
      expect(unit).toContain("ProtectSystem=strict");
      expect(unit).not.toMatch(/pnpm|docker|compose/u);
    }
    expect(api).toContain(
      "ExecStart=/usr/bin/node --jitless api/dist/server.js",
    );
    expect(worker).toContain(
      "ExecStart=/usr/bin/node --jitless worker/dist/main.js",
    );
  });

  it("keeps Node compatible with W^X hardening and creates writable state paths", () => {
    const api = read("deploy/systemd/ii-tonya-api.service");
    const worker = read("deploy/systemd/ii-tonya-worker.service");
    const migrate = read("deploy/systemd/ii-tonya-migrate.service");

    for (const unit of [api, worker, migrate]) {
      expect(unit).toContain("MemoryDenyWriteExecute=true");
      expect(unit).not.toContain("Environment=NODE_OPTIONS=");
      expect(unit).toContain("ExecStart=/usr/bin/node --jitless");
    }
    for (const unit of [api, worker]) {
      expect(unit).toContain("StateDirectory=ii-tonya");
      expect(unit).toContain("StateDirectoryMode=0750");
      expect(unit).toContain("LogsDirectory=ii-tonya");
      expect(unit).toContain("LogsDirectoryMode=0750");
      expect(unit).toContain("StartLimitIntervalSec=60s");
      expect(unit).toContain("StartLimitBurst=5");
      expect(unit).toContain("OOMPolicy=stop");
      expect(unit).toContain("MemoryHigh=192M");
      expect(unit).toContain("MemoryMax=256M");
    }
  });

  it("publishes native provenance through direct Claw verification, never Actions", () => {
    const workflows = existsSync(".github/workflows")
      ? readdirSync(".github/workflows").filter((name) =>
          /\.ya?ml$/u.test(name),
        )
      : [];
    const claw = read("scripts/run-claw-ci.sh");
    expect(workflows).toEqual([]);
    expect(claw).toContain("scripts/build-native-release.sh");
    expect(claw).toContain("native-release.tar.gz");
    expect(claw).not.toMatch(
      /GITHUB_|docker push|API_IMAGE_REF|WORKER_IMAGE_REF/u,
    );
    // Two builds: the ci gate and the database gate. Since the runner started recording
    // per-step timings, each build may sit behind the step recorder instead of standing bare.
    expect(claw.match(/^\s*(?:step \S+ )?pnpm build$/gmu)).toHaveLength(2);
  });
});
