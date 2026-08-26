import pg from "pg";
import fs from "node:fs";
const url = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
const sourceSha = process.env.CLAW_SOURCE_SHA;
if (!url) throw new Error("II_TONYA_TEST_POSTGRES_ADMIN_URL is required");
if (!/^[0-9a-f]{40}$/u.test(sourceSha ?? "")) throw new Error("invalid_claw_source_sha");
const pool = new pg.Pool({ connectionString: url, max: 1 });
const expected = {
  client_conversation_grants: ["id", "provider_subject_mapping_id", "scope", "created_at", "expires_at", "revoked_at"],
  client_conversation_runtime_leases: ["capability", "instance_id", "contract_version", "build_sha", "heartbeat_at", "lease_until"],
  client_conversation_operation_cases: ["id", "operation_id", "case_kind", "reason", "created_at"],
};
try {
  const version = await pool.query("SHOW server_version_num");
  if (version.rows[0]?.server_version_num !== "160015") throw new Error("unsupported_postgres_test_target");
  for (const [table, columns] of Object.entries(expected)) {
    const rows = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", [table]);
    if (rows.rows.map((r) => r.column_name).join("\0") !== columns.join("\0")) throw new Error(`schema_parity_${table}`);
  }
  const counts = await pool.query("SELECT (SELECT count(*) FROM client_conversation_grants) grants,(SELECT count(*) FROM client_conversation_operations) operations,(SELECT count(*) FROM client_conversation_runtime_leases) leases,(SELECT count(*) FROM client_conversation_operation_cases) cases,(SELECT count(*) FROM provider_subject_mappings WHERE provider='selarti.client-thread.v1') providers,(SELECT count(*) FROM integration_outbox WHERE topic IN ('selarti.send','client.no_package','conversation.dispatch')) provider_attempts,(SELECT count(*) FROM integration_outbox WHERE topic LIKE 'billing.%') billing_attempts");
  for (const key of ["grants", "operations", "leases", "cases", "providers", "provider_attempts", "billing_attempts"]) if (counts.rows[0][key] !== "0") throw new Error(`nonzero_seed_count_${key}`);
  const topics = await pool.query("SELECT topic,count(*)::int AS count FROM integration_outbox GROUP BY topic ORDER BY topic");
  const allowed = new Map([["catalog.show", 0], ["selarti.send", 0], ["client.no_package", 0]]);
  for (const row of topics.rows) if (!allowed.has(row.topic) || row.count !== allowed.get(row.topic)) throw new Error("outbox_topic_set_mismatch");
  const constraints = await pool.query("SELECT count(*)::int AS count FROM pg_constraint WHERE conrelid IN ('client_conversation_grants'::regclass,'client_conversation_operations'::regclass,'client_conversation_runtime_leases'::regclass,'client_conversation_operation_cases'::regclass)");
  if (constraints.rows[0].count < 15) throw new Error("conversation_invariants_missing");
  const sentinels = /(ch1\.|bk1\.|choiceHandle|ciphertext|rawBody|authorization|Bearer\s|subject_token|payload_nonce)/iu;
  for (const file of fs.readdirSync("docs/test-evidence", { recursive: true })) if (typeof file === "string" && file.endsWith(".md") && sentinels.test(fs.readFileSync(`docs/test-evidence/${file}`, "utf8"))) throw new Error("forbidden_evidence_sentinel");
  process.stdout.write(JSON.stringify({ server_version_num: "160015", source_sha: sourceSha, invocation_identity_bound: sourceSha === process.env.CLAW_SOURCE_SHA, schema_parity: true, seeded_counts_zero: true, outbox_topics_exact: true }) + "\n");
} finally { await pool.end(); }
