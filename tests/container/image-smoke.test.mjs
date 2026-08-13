import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const run = (file, args) =>
  execFileSync(file, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const compose = (args) => run("docker", ["compose", ...args]);
const forbiddenProductionInventory = [
  "@ii-tonya/sandbox-api",
  "@ii-tonya/sandbox-payments",
  "/sandbox/v1/",
  "createCanonicalExpertResidencyPaymentEventVerifier",
];
const assertFileContentClean = (path, relative) => {
  const handle = openSync(path, "r");
  const buffer = Buffer.alloc(64 * 1024);
  let carry = "";
  try {
    for (;;) {
      const count = readSync(handle, buffer, 0, buffer.length, null);
      if (count === 0) break;
      const content = carry + buffer.subarray(0, count).toString("utf8");
      for (const forbidden of forbiddenProductionInventory)
        assert.equal(
          content.includes(forbidden),
          false,
          `${relative}: ${forbidden}`,
        );
      carry = content.slice(-256);
    }
  } finally {
    closeSync(handle);
  }
};

const assertDeepInventoryClean = (id) => {
  const root = mkdtempSync(join(tmpdir(), "ii-tonya-production-inventory-"));
  try {
    run("docker", ["cp", `${id}:/app/.`, root]);
    const pending = [root];
    while (pending.length > 0) {
      const current = pending.pop();
      for (const name of readdirSync(current)) {
        const path = join(current, name);
        const relative = path.slice(root.length).replaceAll("\\", "/");
        for (const forbidden of forbiddenProductionInventory)
          assert.equal(relative.includes(forbidden), false, relative);
        const stat = statSync(path);
        if (stat.isDirectory()) pending.push(path);
        else if (stat.isFile()) assertFileContentClean(path, relative);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test("boots portable final images and imports emitted internal packages", () => {
  try {
    compose(["up", "--build", "--wait"]);
    compose(["--profile", "smoke", "run", "--rm", "smoke"]);
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
      assertDeepInventoryClean(id);
      const inspected = JSON.parse(run("docker", ["inspect", id]))[0];
      assert.equal(inspected.Config.User, "10001:10001");
      assert.equal(inspected.HostConfig.ReadonlyRootfs, true);
      assert.equal(inspected.State.Health.Status, "healthy");
      assert.deepEqual(inspected.Config.Cmd, ["node", command]);
      assert.equal(
        inspected.Config.Labels?.["org.opencontainers.image.revision"],
        process.env.VCS_REF ?? "local",
      );
      if (service === "worker") {
        run("docker", [
          "compose",
          "exec",
          "-T",
          service,
          "node",
          "--input-type=module",
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
          "if(!resolved.startsWith('file:///app/node_modules/')",
          "||resolved.includes('/workspace/')",
          `||!resolved.endsWith('/node_modules/${packageName}/dist/index.js'))process.exit(41);`,
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
      for (const forbidden of [
        "@ii-tonya/sandbox-api",
        "@ii-tonya/sandbox-payments",
      ]) {
        const probe = `try{import.meta.resolve('${forbidden}');process.exit(43)}catch{}`;
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
    const sandboxRouteStatus = run("docker", [
      "compose",
      "exec",
      "-T",
      "api",
      "node",
      "--input-type=module",
      "--eval",
      "const r=await fetch('http://127.0.0.1:3000/sandbox/v1/payments/sandbox_payment_abcdefghijklmnopqrstuv');process.stdout.write(String(r.status))",
    ]).trim();
    assert.equal(sandboxRouteStatus, "404");
  } finally {
    compose(["down", "--volumes", "--remove-orphans"]);
  }
});
