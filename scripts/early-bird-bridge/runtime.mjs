// Compatibility bridge: old business code, exact reviewed journal only.
import { readFile } from "node:fs/promises";
import {
  safeEnvironment,
  assertDatabaseHistory,
  startValidatedWorker,
} from "./journal-validation.mjs";

const safe = safeEnvironment(process.env);
for (const name of Object.keys(process.env))
  if (!(name in safe)) delete process.env[name];
Object.assign(process.env, safe);
const mode = process.argv[2];
const manifest = JSON.parse(
  await readFile(new URL("./approved-journals.json", import.meta.url), "utf8"),
);
if (mode === "api") {
  const old = await import("../dist/server.js");
  const lifecycle = old.createDefaultLifecycle();
  await old.main({
    ...lifecycle,
    migrate: (db) => assertDatabaseHistory(db, manifest),
  });
} else if (mode === "worker") {
  const raw = process.env.DATABASE_URL;
  if (!raw || process.env.PGOPTIONS)
    throw new Error("invalid worker database config");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("invalid worker database config");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("invalid worker database config");
  const seen = new Set();
  for (const [name] of url.searchParams) {
    const key = name.toLowerCase();
    if (
      name.includes("%") ||
      seen.has(key) ||
      key === "options" ||
      key.includes("timeout")
    )
      throw new Error("invalid worker database config");
    seen.add(key);
  }
  const { createDb, closeDb } = await import("@ii-tonya/db");
  await startValidatedWorker(
    {
      createDb,
      closeDb,
      start: async () => {
        const old = await import("../../worker/dist/main.js");
        await old.main();
      },
    },
    raw,
    manifest,
  );
} else if (mode === "migrate") {
  const raw = process.env.DATABASE_URL;
  if (!raw || process.env.PGOPTIONS)
    throw new Error("invalid migration config");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("invalid migration config");
  }
  const seen = new Set();
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("invalid migration config");
  for (const [name] of url.searchParams) {
    const key = name.toLowerCase();
    if (
      name.includes("%") ||
      seen.has(key) ||
      key === "options" ||
      key.includes("timeout")
    )
      throw new Error("invalid migration config");
    seen.add(key);
  }
  if (!process.argv.includes("--validate-config")) {
    const { createDb, closeDb } = await import("@ii-tonya/db");
    const db = createDb(raw, {
      options: "-c lock_timeout=10000 -c statement_timeout=120000",
      connectionTimeoutMillis: 10000,
    });
    try {
      await assertDatabaseHistory(db, manifest);
    } finally {
      await closeDb(db);
    }
  }
} else throw new Error("invalid bridge mode");
