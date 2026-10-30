const same = (a, b) =>
  a.length === b.length &&
  a.every(
    (row, i) =>
      row.hash === b[i].hash &&
      String(row.created_at) === String(b[i].created_at),
  );
const valid = (rows) =>
  Array.isArray(rows) &&
  rows.length > 0 &&
  rows.every(
    (x) =>
      typeof x.hash === "string" &&
      /^[0-9a-f]{64}$/.test(x.hash) &&
      /^\d+$/.test(String(x.created_at)),
  );
export function validateJournal(rows, old, candidate) {
  if (
    !valid(rows) ||
    !valid(old) ||
    !valid(candidate) ||
    candidate.length <= old.length ||
    !same(old, candidate.slice(0, old.length))
  )
    return false;
  return same(rows, old) || same(rows, candidate);
}
export function safeEnvironment(env) {
  const out = { ...env };
  for (const name of Object.keys(out)) {
    if (name.startsWith("YOOKASSA_")) delete out[name];
    else if (
      /^(?:EXPERT_.*(?:CHECKOUT|PAYMENT).*_ENABLED|PAYMENTS_ENABLED)$/.test(
        name,
      )
    )
      out[name] = "false";
  }
  out.PAYMENT_PROVIDER = "disabled";
  out.EXPERT_RESIDENCY_BILLING_ENABLED = "false";
  out.YOOKASSA_ENABLED = "false";
  out.PAYMENTS_ENABLED = "false";
  return out;
}
export async function assertDatabaseHistory(db, manifest) {
  const result = await db.$client.query(
    "select hash, created_at::text from drizzle.__drizzle_migrations order by id",
  );
  if (!validateJournal(result.rows, manifest.old, manifest.candidate))
    throw new Error("bridge_migration_history_reconciliation_required");
}
export async function startValidatedWorker(
  { createDb, closeDb, start },
  databaseUrl,
  manifest,
) {
  try {
    const db = createDb(databaseUrl, {
      options: "-c lock_timeout=10000 -c statement_timeout=10000",
      connectionTimeoutMillis: 10000,
      query_timeout: 15000,
    });
    try {
      await assertDatabaseHistory(db, manifest);
    } finally {
      await closeDb(db);
    }
  } catch {
    throw new Error("bridge_worker_history_validation_failed");
  }
  await start();
}
