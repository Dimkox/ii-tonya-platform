import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// Execute the shipped entrypoint with only the DB boundary substituted. No
// connection can escape this test, including malformed-URL failure paths.
async function run(
  databaseUrl: string | undefined,
  pgoptions = "",
  fail = false,
  validateOnly = false,
) {
  const createDb = vi.fn(() => ({}));
  const closeDb = vi.fn(async () => undefined);
  const migrateDb = vi.fn(async () => {
    if (fail) throw new Error("private database diagnostic");
  });
  const source = readFileSync("scripts/migrate-native.mjs", "utf8")
    .replace(/^import .* from "@ii-tonya\/db";\n/mu, "")
    .replace(/^import .* from "node:url";\n/mu, "")
    .replaceAll("import.meta.url", '"file:///release/api/migrate-native.mjs"');
  const execute = new Function(
    "createDb",
    "closeDb",
    "migrateDb",
    "fileURLToPath",
    "process",
    `return (async () => {${source}\n})();`,
  );
  let error: unknown;
  try {
    await execute(createDb, closeDb, migrateDb, (url: URL) => url.pathname, {
      env: { DATABASE_URL: databaseUrl, PGOPTIONS: pgoptions },
      argv: validateOnly ? ["--validate-config"] : [],
    });
  } catch (caught) {
    error = caught;
  }
  return { createDb, closeDb, migrateDb, error };
}

describe("native migration connection deadlines", () => {
  it("validates configuration without connecting before downtime", async () => {
    const result = await run(
      "postgres://operator:secret@db/example",
      "",
      false,
      true,
    );
    expect(result.error).toBeUndefined();
    expect(result.createDb).not.toHaveBeenCalled();
    expect(result.migrateDb).not.toHaveBeenCalled();
  });
  it("applies server-side bounds to the pool and closes it after success", async () => {
    const url = "postgres://operator:secret@db/example?sslmode=verify-full";
    const result = await run(url);
    expect(result.error).toBeUndefined();
    expect(result.createDb).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        options: "-c lock_timeout=10000 -c statement_timeout=120000",
        connectionTimeoutMillis: 10_000,
      }),
    );
    expect(result.closeDb).toHaveBeenCalledOnce();
  });

  it("closes on migration failure without exposing database diagnostics", async () => {
    const result = await run("postgres://operator:secret@db/example", "", true);
    expect(result.closeDb).toHaveBeenCalledOnce();
    expect(String(result.error)).toContain("Native migration failed");
    expect(String(result.error)).not.toMatch(/secret|private database/u);
  });

  it.each([
    "options=-c%20statement_timeout%3D0",
    "%6fptions=-c%20lock_timeout%3D0",
    "options=x&options=y",
    "statement_timeout=0",
    "lock_timeout=0",
    "query_timeout=0",
    "connect_timeout=0",
    "connectionTimeoutMillis=0",
    "%2573tatement_timeout=0",
  ])("rejects conflicting URL configuration: %s", async (query) => {
    const result = await run(`postgres://operator:secret@db/example?${query}`);
    expect(result.error).toBeDefined();
    expect(result.createDb).not.toHaveBeenCalled();
    expect(String(result.error)).not.toContain("secret");
  });

  it("rejects inherited PGOPTIONS before connecting", async () => {
    const result = await run(
      "postgres://operator:secret@db/example",
      "-c lock_timeout=0",
    );
    expect(result.error).toBeDefined();
    expect(result.createDb).not.toHaveBeenCalled();
  });

  it("rejects missing and malformed database URLs before connecting", async () => {
    for (const input of [undefined, "operator:secret", "https://db/example"]) {
      const result = await run(input);
      expect(result.error).toBeDefined();
      expect(result.createDb).not.toHaveBeenCalled();
    }
  });

  it("bounds systemd migration startup and termination", () => {
    const unit = readFileSync(
      "deploy/systemd/ii-tonya-migrate.service",
      "utf8",
    );
    expect(unit).toContain("TimeoutStartSec=180s");
    expect(unit).toContain("TimeoutStopSec=15s");
  });
});
