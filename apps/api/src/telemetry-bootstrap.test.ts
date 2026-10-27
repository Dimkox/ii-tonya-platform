import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it.each([
  ["api", "../../../apps/api/src/server.ts"],
  ["worker", "../../../apps/worker/src/main.ts"],
] as const)(
  "executes the real %s startup catch without DB/provider access or a fatal crash",
  async (module, entry) => {
    const canary = "ordinary_private_startup_configuration";
    // An invalid URL fails loadEnv before createDb, migrations, listening or providers.
    // Run the executable (not an imported helper): its direct-execution guard and
    // bottom-level catch must actually be reached. Do not inherit local credentials.
    const child = spawn(
      process.execPath,
      ["--import", "tsx", fileURLToPath(new URL(entry, import.meta.url))],
      {
        cwd: fileURLToPath(new URL("../../../", import.meta.url)),
        env: { NODE_ENV: "test", DATABASE_URL: canary },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 10_000,
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const result = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code, signal) => resolve({ code, signal }));
    });
    expect(result).toEqual({ code: 1, signal: null });
    expect(stderr).toBe("");
    expect(stdout).not.toContain(canary);
    const records = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      level: 60,
      time: expect.any(Number),
      event: "startup_failure",
      module,
      failureClass: "internal_error",
    });
  },
  15_000,
);
