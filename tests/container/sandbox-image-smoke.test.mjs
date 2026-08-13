import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
    run("docker", [
      "build",
      "--file",
      "Dockerfile.sandbox",
      "--target",
      "sandbox-api",
      "--tag",
      tag,
      ".",
    ]);
    const inspected = JSON.parse(run("docker", ["image", "inspect", tag]))[0];
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
