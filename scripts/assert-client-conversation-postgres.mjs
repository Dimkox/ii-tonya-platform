import pg from "pg";
import fs from "node:fs";
const url = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
if (!url) throw new Error("II_TONYA_TEST_POSTGRES_ADMIN_URL is required");
const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const version = await pool.query("SHOW server_version_num");
  if (version.rows[0]?.server_version_num !== "160015") throw new Error("unsupported_postgres_test_target");
  const tables = ["client_conversation_grants", "client_conversation_operations", "client_conversation_runtime_leases", "client_conversation_operation_cases", "integration_outbox"];
  for (const table of tables) {
    const found = await pool.query("SELECT to_regclass($1) IS NOT NULL AS present", [table]);
    if (!found.rows[0].present) throw new Error(`missing_schema_${table}`);
  }
  const topics = await pool.query("SELECT topic, count(*)::int AS count FROM integration_outbox GROUP BY topic");
  const allowed = new Set(["catalog.show", "selarti.send", "client.no_package"]);
  for (const row of topics.rows) if (!allowed.has(row.topic)) throw new Error("unexpected_outbox_topic");
  const providers = await pool.query("SELECT count(*)::int AS count FROM provider_subject_mappings WHERE provider <> 'selarti.client-thread.v1'");
  if (providers.rows[0].count !== 0) throw new Error("provider_activation_present");
  const sentinels = /(ch1\.|bk1\.|choiceHandle|ciphertext|rawBody|authorization|Bearer\s)/iu;
  for (const file of fs.readdirSync("docs/test-evidence", { recursive: true })) {
    if (typeof file === "string" && file.endsWith(".md") && sentinels.test(fs.readFileSync(`docs/test-evidence/${file}`, "utf8"))) throw new Error("forbidden_evidence_sentinel");
  }
  process.stdout.write(JSON.stringify({ server_version_num: "160015", schema_tables: tables.length, provider_activation_rows: 0, outbox_topics_checked: topics.rows.length }) + "\n");
} finally { await pool.end(); }
