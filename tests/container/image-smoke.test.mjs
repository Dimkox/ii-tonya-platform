import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const run = (file, args) =>
  execFileSync(file, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const compose = (args) => run("docker", ["compose", ...args]);

test("boots portable final images and imports emitted internal packages", () => {
  try {
    compose(["up", "--build", "--wait"]);
    run(process.execPath, [
      "scripts/smoke.mjs",
      "--base-url=http://127.0.0.1:3000",
    ]);
    for (const [service, command, packages] of [
      [
        "api",
        "dist/server.js",
        [
          "@ii-tonya/application",
          "@ii-tonya/config",
          "@ii-tonya/db",
          "@ii-tonya/integrations",
          "@ii-tonya/observability",
        ],
      ],
      [
        "worker",
        "dist/main.js",
        [
          "@ii-tonya/config",
          "@ii-tonya/db",
          "@ii-tonya/integrations",
          "@ii-tonya/observability",
          "@ii-tonya/worker",
        ],
      ],
    ]) {
      const id = compose(["ps", "-q", service]).trim();
      assert.notEqual(id, "");
      const inspected = JSON.parse(run("docker", ["inspect", id]))[0];
      assert.equal(inspected.Config.User, "10001:10001");
      assert.equal(inspected.HostConfig.ReadonlyRootfs, true);
      assert.equal(inspected.State.Health.Status, "healthy");
      assert.deepEqual(inspected.Config.Cmd, ["node", command]);
      if (service === "worker") {
        run("docker", [
          "compose",
          "exec",
          "-T",
          service,
          "node",
          "--eval",
          "const s=(await import('node:fs/promises')).stat;const m=(await s('/tmp/ii-tonya-worker-heartbeat')).mtimeMs;if(Date.now()-m>30000)process.exit(42)",
        ]);
      }
      const env = new Set(inspected.Config.Env ?? []);
      for (const liveFlag of [
        "MINOR_ONBOARDING_ENABLED",
        "SELARTI_ENABLED",
        "PLANERKA_ENABLED",
        "TELEGRAM_ENABLED",
        "PAYMENTS_ENABLED",
        "LLM_ENABLED",
        "INTENT_MODEL_ENABLED",
        "MAKE_PROJECTION_ENABLED",
        "GOOGLE_SHEETS_PROJECTION_ENABLED",
      ]) {
        assert.equal(
          env.has(`${liveFlag}=false`),
          true,
          `${service} must keep ${liveFlag}=false`,
        );
      }
      for (const packageName of packages) {
        const probe = [
          `const resolved=import.meta.resolve('${packageName}');`,
          "if(!resolved.includes('/app/node_modules/@ii-tonya/')",
          "||!resolved.endsWith('/dist/index.js'))process.exit(41);",
          `await import('${packageName}');`,
        ].join("");
        run("docker", [
          "compose",
          "exec",
          "-T",
          service,
          "node",
          "--input-type=module",
          "--eval",
          probe,
        ]);
      }
    }
  } finally {
    compose(["down", "--volumes", "--remove-orphans"]);
  }
});
