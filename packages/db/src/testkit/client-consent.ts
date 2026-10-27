import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { clientDispatchPayloadDigest } from "@ii-tonya/contracts";

/** Synthetic trusted evidence only; production grants redeem verified presentations. */
export async function seedClientConsent(
  db: Pick<DrizzleDb, "execute">,
  userId: string,
  purpose: "client_messaging" | "selarti_ai_processing",
  policyVersion = purpose === "client_messaging"
    ? "client-messaging-v1"
    : "selarti-ai-v1",
) {
  const body = `Synthetic ${purpose} document`;
  const digest = createHash("sha256").update(body).digest("hex");
  const document =
    (
      await db.execute<{ id: string }>(sql`
    insert into consent_document_versions(document_key,version,title,body,text_sha256,status,effective_at,approved_at,approved_by)
    values(${`consent.${purpose}`},1,'Synthetic consent',${body},${digest},'approved','2020-01-01',clock_timestamp(),'test-fixture')
    on conflict(document_key,version) do nothing returning id
  `)
    ).rows[0] ??
    (
      await db.execute<{ id: string }>(
        sql`select id from consent_document_versions where document_key=${`consent.${purpose}`} and version=1`,
      )
    ).rows[0]!;
  const presentation = (
    await db.execute<{ id: string }>(sql`
    insert into consent_presentations(user_id,purpose,document_version_id,token_digest,channel,expires_at,consumed_at)
    values(${userId}::uuid,${purpose},${document.id}::uuid,${`sha256:${createHash("sha256").update(randomUUID()).digest("hex")}`},'telegram',clock_timestamp()+interval '1 hour',clock_timestamp()) returning id
  `)
  ).rows[0]!;
  const decision = (
    await db.execute<{ id: string }>(sql`
    insert into consents(user_id,consent_type,decision,policy_version,channel,scope_fields,document_version_id,presentation_id,text_sha256,basis,created_at)
    values(${userId}::uuid,${purpose},'granted',${policyVersion},'telegram','{}'::jsonb,${document.id}::uuid,${presentation.id}::uuid,${digest},'consent',clock_timestamp()) returning id
  `)
  ).rows[0]!;
  const state = (
    await db.execute<{ revision: string }>(sql`
    insert into consent_states(user_id,purpose,decision,document_version_id,last_decision_id,revision)
    values(${userId}::uuid,${purpose},'granted',${document.id}::uuid,${decision.id}::uuid,1)
    on conflict(user_id,purpose) do update set decision=excluded.decision,document_version_id=excluded.document_version_id,last_decision_id=excluded.last_decision_id,revision=consent_states.revision+1
    returning revision::text
  `)
  ).rows[0]!;
  return { decisionId: decision.id, revision: state.revision };
}

/** Historical start fixture for response tests, with the exact original request binding. */
export async function seedClientRequestStarted(
  db: Pick<DrizzleDb, "execute">,
  requestId: string,
) {
  const row = (
    await db.execute<{ id: string; payload: unknown; attempt: number }>(
      sql`select id,payload,attempt from integration_outbox where idempotency_key=${requestId} and topic='selarti.request.v1'`,
    )
  ).rows[0]!;
  await db.execute(sql`insert into delivery_attempts(outbox_id,attempt_id,attempt,provider,outcome,reconciliation_key,normalized_reason)
    values(${row.id}::uuid,${randomUUID()},${row.attempt},'selarti','started',${requestId},${clientDispatchPayloadDigest(row.payload)})`);
}
