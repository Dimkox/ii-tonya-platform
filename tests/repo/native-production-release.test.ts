import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("native dedicated-server production release", () => {
  it("declares Docker as dev/test-only and links the canonical graph", () => {
    const readme = read("README.md");
    const requirements = read("docs/spec/normalized-requirements.md");

    expect(readme).toContain(
      "[Open the full project connectivity graph](docs/architecture/project-connectivity-graph.md)",
    );
    expect(readme).toContain(
      "Docker and Compose are development and Claw test tools only",
    );
    expect(readme).toContain("GitHub Actions are not used");
    expect(requirements).toContain("OPS-DEPLOY-001");
    expect(requirements).toContain("без контейнеров приложения");
  });

  it("ships native bundle and systemd deployment assets", () => {
    for (const path of [
      "scripts/build-native-release.sh",
      "scripts/provision-claw-syft.sh",
      "scripts/deploy-native-remote.sh",
      "deploy/systemd/ii-tonya-api.service",
      "deploy/systemd/ii-tonya-worker.service",
      "docs/runbooks/native-production-deployment.md",
    ]) {
      expect(existsSync(path), path).toBe(true);
    }
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
      'claw_syft="$($source_root/scripts/provision-claw-syft.sh)"',
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
    expect(script).toContain("pnpm --filter @ii-tonya/api --prod deploy");
    expect(script).toContain(
      "pnpm --filter @ii-tonya/app-worker --prod deploy",
    );
    expect(script).toContain("native-release.tar.gz");
    expect(script).toContain("native-release.sha256");
    expect(script).toContain("native-release.spdx.json");
    expect(script).toContain('syft "dir:$work_dir/release"');
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
    expect(script).toContain("releases/$RELEASE_SHA");
    expect(script).toContain("sha256sum -c");
    expect(script).toContain("cosign verify-blob");
    expect(script).toContain("systemctl restart ii-tonya-api.service");
    expect(script).toContain("systemctl restart ii-tonya-worker.service");
    expect(script).toContain("rollback)");
    expect(script).toContain("readlink");
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
    expect(api).toContain("/usr/bin/node api/dist/server.js");
    expect(worker).toContain("/usr/bin/node worker/dist/main.js");
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
  });
});
