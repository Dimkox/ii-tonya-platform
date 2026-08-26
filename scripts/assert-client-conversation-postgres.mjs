import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const SHA_RE = /^[0-9a-f]{40}$/u;
export const EXPECTED_TOPICS = Object.freeze({ "catalog.show": 1, "selarti.send": 1, "client.no_package": 1 });
export const EXPECTED_SCHEMA = Object.freeze({
  client_conversation_grants: { columns: ["id","provider_subject_mapping_id","scope","expires_at","revoked_at","created_at"], constraints: ["client_conversation_grants_mapping_scope_unique","client_conversation_grants_pkey","client_conversation_grants_provider_subject_mapping_id_provider_subject_mappings_id_fk","client_conversation_grants_scope_check","client_conversation_grants_expiry_check","client_conversation_grants_revocation_check"], indexes: ["client_conversation_grants_mapping_scope_lookup_idx","client_conversation_grants_mapping_scope_unique"] },
  client_conversation_operations: { columns: ["id","message_event_id","binding_id","required_scope","tool_kind","proposal_digest","payload_envelope_version","payload_key_id","payload_nonce","payload_ciphertext","payload_tag","payload_expires_at","status","claim_fence","claim_owner_id","claim_token","lease_until","reconciliation_owner_id","reconciliation_claim_token","reconciliation_lease_until","attempt","reconciliation_attempt","next_attempt_at","result_digest","terminal_reason","created_at","updated_at"], constraints: ["client_conversation_operations_binding_id_provider_subject_mappings_id_fk","client_conversation_operations_crypto_check","client_conversation_operations_expiry_check","client_conversation_operations_fence_check","client_conversation_operations_key_check","client_conversation_operations_lease_check","client_conversation_operations_message_event_id_message_events_id_fk","client_conversation_operations_message_event_unique","client_conversation_operations_nonce_unique","client_conversation_operations_pkey","client_conversation_operations_proposal_digest_check","client_conversation_operations_result_digest_check","client_conversation_operations_retry_check","client_conversation_operations_terminal_check","client_conversation_operations_tool_scope_check"], indexes: ["client_conversation_operations_dispatch_idx","client_conversation_operations_expiry_idx","client_conversation_operations_message_event_unique","client_conversation_operations_nonce_unique","client_conversation_operations_pkey"] },
  client_conversation_runtime_leases: { columns: ["capability","instance_id","contract_version","build_sha","heartbeat_at","lease_until"], constraints: ["client_conversation_runtime_leases_capability_check","client_conversation_runtime_leases_contract_check","client_conversation_runtime_leases_duration_check","client_conversation_runtime_leases_pkey","client_conversation_runtime_leases_sha_check"], indexes: [] },
  client_conversation_operation_cases: { columns: ["operation_id","case_kind","reason","created_at"], constraints: ["client_conversation_operation_cases_kind_check","client_conversation_operation_cases_operation_id_client_conversation_operations_id_fk","client_conversation_operation_cases_operation_kind_unique","client_conversation_operation_cases_reason_check"], indexes: ["client_conversation_operation_cases_operation_kind_unique"] },
  provider_subject_mappings: { columns: ["tenant_token","token_version"], constraints: ["provider_subject_mappings_conversation_token_check"], indexes: ["provider_subject_mappings_conversation_lookup_idx"] },
});
export const normalizeMetadata = (metadata) => ({ columns: [...metadata.columns].sort(), constraints: [...metadata.constraints].sort(), indexes: [...metadata.indexes].sort() });
export const conversationIdentity = (positional, env, head) => {
  if (![positional, env, head].every((v) => SHA_RE.test(v ?? "")) || positional !== env || env !== head) throw new Error("invocation_identity_mismatch");
  return positional;
};
export const fixtureDatabaseName = (sha, suffix) => {
  if (!SHA_RE.test(sha) || !/^[0-9a-f]{16}$/u.test(suffix)) throw new Error("invalid_fixture_identifier");
  return `ii_tonya_ccv_${sha.slice(0, 12)}_${suffix}`;
};
export const assertSnapshot = (s) => {
  if (s.serverVersion !== "160015" || s.identity !== s.sourceSha) throw new Error("snapshot_identity_or_version");
  if (JSON.stringify(s.topics) !== JSON.stringify(EXPECTED_TOPICS)) throw new Error("outbox_topic_set_mismatch");
  if (s.providerAttempts !== 0 || s.billingAttempts !== 0) throw new Error("outbound_attempts_present");
  if (s.expired !== 1 || s.secondCleanup !== 0 || s.status !== "privacy_expired" || s.fence !== 1 || s.cryptoNulls !== 5 || s.operatorCases !== 1 || s.deletionReceipts !== 1 || !s.schemaParity) throw new Error("expiry_cleanup_invariant");
  const expectedMetadata = Object.fromEntries(Object.entries(EXPECTED_SCHEMA).map(([k, v]) => [k, normalizeMetadata(v)]));
  if (JSON.stringify(s.metadata) !== JSON.stringify(expectedMetadata)) throw new Error("schema_metadata_mismatch");
};

const main = async () => {
  const { default: pg } = await import("pg");
  const adminUrl = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
  const sourceSha = conversationIdentity(process.argv[2], process.env.CLAW_SOURCE_SHA, execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim());
  if (!adminUrl) throw new Error("II_TONYA_TEST_POSTGRES_ADMIN_URL is required");
  const admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
  const dbName = fixtureDatabaseName(sourceSha, crypto.createHash("sha256").update(`${sourceSha}:fixture`).digest("hex").slice(0, 16));
  const quote = (v) => `"${v.replaceAll('"', '""')}"`;
  let target;
  try {
    const version = (await admin.query("SHOW server_version_num")).rows[0]?.server_version_num;
    if (version !== "160015") throw new Error("unsupported_postgres_test_target");
    await admin.query(`DROP DATABASE IF EXISTS ${quote(dbName)}`);
    await admin.query(`CREATE DATABASE ${quote(dbName)}`);
    const u = new URL(adminUrl); u.pathname = `/${dbName}`;
    const { createDb, migrateDb, closeDb, PostgresClientConversationOperationRepository } = await import("@ii-tonya/db");
    target = createDb(u.toString());
    await migrateDb(target, "packages/db/migrations");
    const pool = target.$client;
    const digest = crypto.createHash("sha256").update(sourceSha).digest("hex");
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    await pool.query("insert into users(id) values($1)", [ids[0]]);
    await pool.query("insert into provider_subject_mappings(id,user_id,provider,subject_token,subject_ciphertext,tenant_token,token_version) values($1,$2,'selarti.client-thread.v1',$3,'fixture','hmac-sha256:v1:'||repeat('a',64),1)",[ids[1],ids[0],digest.slice(0,32)]);
    await pool.query("insert into client_conversation_grants(provider_subject_mapping_id,scope,expires_at) values($1,'client_catalog:read',now()+interval '1 hour')",[ids[1]]);
    await pool.query("insert into message_events(id,user_id,provider,external_message_id,direction) values($1,$2,'fixture',$3,'inbound')",[ids[2],ids[0],digest]);
    await pool.query("insert into client_conversation_operations(id,message_event_id,binding_id,required_scope,tool_kind,proposal_digest,payload_envelope_version,payload_key_id,payload_nonce,payload_ciphertext,payload_tag,payload_expires_at,status,created_at,updated_at) values($1,$2,$3,'client_catalog:read','show_catalog',repeat('a',64),1,'fixture-key',decode(repeat('b',24),'hex'),decode(repeat('c',32),'hex'),decode(repeat('d',32),'hex'),now()-interval '1 minute','pending',now()-interval '2 minutes',now()-interval '2 minutes')",[ids[3],ids[2],ids[1]]);
    for (const topic of Object.keys(EXPECTED_TOPICS)) await pool.query("insert into integration_outbox(idempotency_key,topic,payload,correlation_id,reconciliation_key,payload_hash) values($1,$2,'{}',$1,$1,repeat('a',64))",[`${sourceSha}:${topic}`,topic]);
    const repo = new PostgresClientConversationOperationRepository(target,{ decrypt: async () => ({kind:"show_catalog"}) },{issuer:{issue:(x)=>x}});
    const first = await repo.cleanupExpired({limit:10}); const second = await repo.cleanupExpired({limit:10});
    const row=(await pool.query("select status,claim_fence,payload_envelope_version,payload_key_id,payload_nonce,payload_ciphertext,payload_tag from client_conversation_operations where id=$1",[ids[3]])).rows[0];
    const cases=(await pool.query("select case_kind,count(*)::int n from client_conversation_operation_cases where operation_id=$1 group by case_kind",[ids[3]])).rows;
    const topics=Object.fromEntries((await pool.query("select topic,count(*)::int count from integration_outbox group by topic order by topic")).rows.map(r=>[r.topic,r.count]));
    const a=(await pool.query("select count(*) filter(where topic like 'provider.%' or topic like 'conversation.%')::int provider,count(*) filter(where topic like 'billing.%')::int billing from integration_outbox")).rows[0];
    const metadata={}; for (const [table,expectedShape] of Object.entries(EXPECTED_SCHEMA)) { const projected=table === "provider_subject_mappings"; const columnSql=projected ? "select column_name from information_schema.columns where table_name=$1 and column_name in ('tenant_token','token_version') order by ordinal_position" : "select column_name from information_schema.columns where table_name=$1 order by ordinal_position"; const cols=(await pool.query(columnSql,[table])).rows.map(r=>r.column_name); const constraints=(await pool.query("select conname from pg_constraint where conrelid=$1::regclass",[table])).rows.map(r=>r.conname); const indexes=(await pool.query("select indexname from pg_indexes where schemaname='public' and tablename=$1",[table])).rows.map(r=>r.indexname); metadata[table]=normalizeMetadata({columns:cols,constraints,indexes}); }
    const expectedMetadata=Object.fromEntries(Object.entries(EXPECTED_SCHEMA).map(([k,v])=>[k,normalizeMetadata(v)]));
    assertSnapshot({serverVersion:version,identity:sourceSha,sourceSha,topics,providerAttempts:Number(a.provider),billingAttempts:Number(a.billing),expired:first.expired,secondCleanup:second.expired,status:row.status,fence:Number(row.claim_fence),cryptoNulls:["payload_envelope_version","payload_key_id","payload_nonce","payload_ciphertext","payload_tag"].filter(k=>row[k]===null).length,operatorCases:Number(cases.find(r=>r.case_kind==="operator_case")?.n??0),deletionReceipts:Number(cases.find(r=>r.case_kind==="deletion_receipt")?.n??0),schemaParity:JSON.stringify(metadata)===JSON.stringify(expectedMetadata),metadata});
    process.stdout.write(JSON.stringify({server_version_num:version,identity_sha256:crypto.createHash("sha256").update(sourceSha).digest("hex"),invocation_identity_bound:true,schema_parity:true,cleanup_verified:true,exact_outbox_topics:true,provider_attempts:0,billing_attempts:0})+"\n"); await closeDb(target); target=undefined;
  } finally { if(target) await target.$client.end().catch(()=>undefined); await admin.query(`DROP DATABASE IF EXISTS ${quote(dbName)}`).catch(()=>undefined); const left=await admin.query("select 1 from pg_database where datname=$1",[dbName]); if(left.rowCount!==0) throw new Error("fixture_database_cleanup_failed"); await admin.end(); }
};
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e=>{process.stderr.write(`${e?.message??"gate_failed"}\n`);process.exitCode=1;});
