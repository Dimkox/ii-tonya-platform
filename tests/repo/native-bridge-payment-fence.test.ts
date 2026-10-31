import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

const source = readFileSync("scripts/deploy-native-remote.sh", "utf8");
const fn = (name: string) => {
  const value = source.match(
    new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, "m"),
  );
  if (!value) throw new Error(`deployment function missing: ${name}`);
  return value[0];
};
it("binds a bridge payment stop to the selected release provenance and SHA", () => {
  const directory = mkdtempSync(join(tmpdir(), "native-bridge-"));
  try {
    mkdirSync(join(directory, "current"));
    const env = join(directory, "runtime.env");
    writeFileSync(env, "PAYMENT_PROVIDER=yookassa_gateway\n");
    writeFileSync(join(directory, "current/SOURCE_SHA"), "a".repeat(40) + "\n");
    const run = () =>
      spawnSync("bash", [
        "-c",
        `set -Eeuo pipefail\ndeploy_root="$1"\n${fn("gateway_required")}\ngateway_required "$2"`,
        "test",
        directory,
        env,
      ]);
    const provenance = (profile: string | undefined, sha = "a".repeat(40)) =>
      writeFileSync(
        join(directory, "current/provenance.json"),
        JSON.stringify({
          format: "ii-tonya-native-v1",
          source_sha: sha,
          runtime_source_sha: "b".repeat(40),
          ...(profile === undefined ? {} : { profile }),
        }),
      );
    provenance("early-bird-compatibility-bridge-v1");
    expect(run().status).toBe(43);
    provenance(undefined);
    expect(run().status).toBe(0);
    provenance("unknown-profile");
    expect(run().status).toBe(1);
    provenance("early-bird-compatibility-bridge-v1", "c".repeat(40));
    expect(run().status).toBe(1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("requires the gateway to be stopped before starting or accepting a bridge", () => {
  for (const stopped of [true, false]) {
    const result = spawnSync(
      "bash",
      [
        "-c",
        `set -Eeuo pipefail
gateway_required() { return 43; }
gateway_stopped_if_installed() { ${stopped ? "return 0" : "return 1"}; }
ctl() { printf '%s\\n' "$2"; }
health() { ${fn("gateway_health")} ; gateway_health; }
${fn("start_apps")}
start_apps`,
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(stopped ? 0 : 1);
    expect(result.stdout.includes("ii-tonya-api.service")).toBe(stopped);
  }
});
