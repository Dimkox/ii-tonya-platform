import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const run = (file, args, options = {}) =>
  execFileSync(file, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });

test("sandbox image contains its packaged runtime closure and is hardened", () => {
  const tag = `ii-tonya-sandbox-smoke:${process.env.VCS_REF ?? "local"}`;
  try {
    const archive = process.env.SANDBOX_SOURCE_ARCHIVE;
    assert.ok(archive);
    const sourceArchiveSha = createHash("sha256")
      .update(readFileSync(archive))
      .digest("hex");
    const sourceSha = process.env.VCS_REF;
    assert.match(sourceSha ?? "", /^[0-9a-f]{40}$/);
    run("bash", ["scripts/build-sandbox-image-offline.sh"], {
      stdio: "inherit",
      timeout: 480_000,
      env: {
        ...process.env,
        SOURCE_ARCHIVE: archive,
        SOURCE_ARCHIVE_SHA: sourceArchiveSha,
        SOURCE_SHA: sourceSha,
        SANDBOX_IMAGE_REF: tag,
      },
    });
    const inspected = JSON.parse(run("docker", ["image", "inspect", tag]))[0];
    assert.equal(
      inspected.Config.Labels["org.opencontainers.image.revision"],
      sourceSha,
    );
    assert.equal(inspected.Config.User, "10001:10001");
    assert.deepEqual(inspected.Config.Cmd, ["node", "dist/server.js"]);
    const probe = [
      "await import('/app/dist/server.js');",
      "for(const p of ['@ii-tonya/db','@ii-tonya/sandbox-payments']){",
      "const r=import.meta.resolve(p);",
      "if(!r.startsWith('file:///app/node_modules/')||r.includes('/workspace/'))process.exit(41);",
      "await import(p)}",
    ].join("");
    run("docker", [
      "run",
      "--rm",
      "--read-only",
      "--tmpfs",
      "/tmp",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--entrypoint=node",
      tag,
      "--input-type=module",
      "--eval",
      probe,
    ]);
  } finally {
    try {
      run("docker", ["image", "rm", "--force", tag]);
    } catch {}
  }
});
