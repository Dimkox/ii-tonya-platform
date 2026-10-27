import { sql } from "drizzle-orm";
import {
  clientConsentAuthoritySchema,
  clientDispatchPayloadDigest,
  matchesClientDispatchAdmission,
  type ClientConsentAuthority,
  type ClientConsentPurpose,
  type ClientDispatchAdmissionGate,
} from "@ii-tonya/contracts";
import type { DrizzleDb } from "../client.js";
import { originalClientConsentSql } from "./consent-current.js";

type Executor = Pick<DrizzleDb, "execute">;

/** Must precede user/identity/dialogue/outbox locks; READ COMMITTED reads follow the wait. */
export async function lockClientConsentSubject(tx: Executor, userId: string) {
  await tx.execute(sql`lock table consent_document_versions in share mode`);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${userId}::uuid::text,0))`,
  );
}

export async function captureClientConsentAuthority(
  tx: Executor,
  input: {
    subjectId: string;
    botKey: string;
    chatId: string;
    externalUserId?: string;
    messagingPolicyVersion: string;
    selartiPolicyVersion?: string;
  },
): Promise<ClientConsentAuthority | undefined> {
  if (!(await ownsChannel(tx, input))) return undefined;
  const purposes: ClientConsentAuthority["purposes"] =
    {} as ClientConsentAuthority["purposes"];
  const required: ClientConsentPurpose[] =
    input.selartiPolicyVersion === undefined
      ? ["client_messaging"]
      : ["client_messaging", "selarti_ai_processing"];
  for (const purpose of required) {
    const rows = (
      await tx.execute<{
        decisionId: string;
        revision: string;
        policyVersion: string;
      }>(originalClientConsentSql(input.subjectId, purpose))
    ).rows;
    const evidence = rows[0];
    if (
      rows.length !== 1 ||
      !evidence ||
      evidence.policyVersion !==
        (purpose === "client_messaging"
          ? input.messagingPolicyVersion
          : input.selartiPolicyVersion)
    )
      return undefined;
    purposes[purpose] = {
      decisionId: evidence.decisionId,
      revision: evidence.revision,
    };
  }
  const parsed = clientConsentAuthoritySchema.safeParse({
    v: 1,
    subjectId: input.subjectId,
    purposes,
  });
  return parsed.success ? parsed.data : undefined;
}

async function ownsChannel(
  tx: Executor,
  input: {
    subjectId: string;
    botKey: string;
    chatId: string;
    externalUserId?: string;
  },
) {
  const rows = (
    await tx.execute<{ userId: string }>(sql`
    select ci.user_id::text as "userId" from channel_identities ci join users u on u.id=ci.user_id and u.active=true
    where ci.provider='telegram' and ci.bot_key=${input.botKey}
      and ci.external_chat_id=${input.chatId} and ci.status='active'
      ${input.externalUserId === undefined ? sql`` : sql`and ci.external_id=${input.externalUserId}`}
    order by ci.id for share of ci,u
  `)
  ).rows;
  return rows.length === 1 && rows[0]!.userId === input.subjectId;
}

/** Caller holds subject barrier. Extra Selarti purpose can never be dropped on a derived reply. */
export async function validateClientConsentAuthority(
  tx: Executor,
  raw: unknown,
  dialogueId: unknown,
  requireSelarti: boolean,
): Promise<ClientConsentAuthority | undefined> {
  const parsed = clientConsentAuthoritySchema.safeParse(raw);
  if (
    !parsed.success ||
    typeof dialogueId !== "string" ||
    !/^[0-9a-f-]{36}$/u.test(dialogueId)
  )
    return undefined;
  const authority = parsed.data;
  if (requireSelarti && !authority.purposes.selarti_ai_processing)
    return undefined;
  const dialogue = (
    await tx.execute<{ userId: string; botKey: string; chatId: string }>(sql`
    select user_id::text as "userId",bot_key as "botKey",external_chat_id as "chatId" from dialogues
    where id=${dialogueId}::uuid and provider='telegram' and tenant_key=bot_key for share
  `)
  ).rows[0];
  if (
    !dialogue ||
    dialogue.userId !== authority.subjectId ||
    !(await ownsChannel(tx, { subjectId: authority.subjectId, ...dialogue }))
  )
    return undefined;
  for (const purpose of [
    "client_messaging",
    "selarti_ai_processing",
  ] as const) {
    const original = authority.purposes[purpose];
    if (!original) continue;
    const rows = (
      await tx.execute<{ decisionId: string; revision: string }>(
        originalClientConsentSql(authority.subjectId, purpose),
      )
    ).rows;
    if (
      rows.length !== 1 ||
      rows[0]!.decisionId !== original.decisionId ||
      rows[0]!.revision !== original.revision
    )
      return undefined;
  }
  return authority;
}

/** A committed start is authority for one invocation, even if withdrawal commits afterwards. */
export function createClientDispatchAdmissionGate(
  db: DrizzleDb,
): ClientDispatchAdmissionGate {
  return {
    async consume(message, admission) {
      if (!matchesClientDispatchAdmission(message, admission)) return false;
      return db.transaction(async (tx) => {
        const row = (
          await tx.execute<{ payload: unknown }>(sql`
        select payload from integration_outbox where id=${admission.outboxId}::uuid
          and topic=${admission.topic} and status='processing' and attempt=${admission.attempt}
          and dispatch_owner_id=${admission.owner} and dispatch_claim_token=${admission.claimToken}
          and reconciliation_key=${admission.reconciliationKey} and lease_until>=clock_timestamp()
        for update
      `)
        ).rows[0];
        if (
          !row ||
          clientDispatchPayloadDigest(row.payload) !== admission.payloadDigest
        )
          return false;
        const facts = (
          await tx.execute<{ started: boolean; consumed: boolean }>(sql`
        select exists(select 1 from delivery_attempts where outbox_id=${admission.outboxId}::uuid
          and attempt=${admission.attempt} and attempt_id=${admission.attemptId}
          and reconciliation_key=${admission.reconciliationKey} and outcome='started'
          and normalized_reason=${admission.payloadDigest}) as started,
        exists(select 1 from delivery_attempts where outbox_id=${admission.outboxId}::uuid
          and attempt=${admission.attempt} and outcome='dispatch_consumed') as consumed
      `)
        ).rows[0];
        if (facts?.started !== true || facts.consumed) return false;
        // The first SELECT may have waited after evaluating its WHERE clause.
        // Holding the row now, re-evaluate all lease/binding/clock facts immediately before consumption.
        const current = (
          await tx.execute(sql`select id from integration_outbox
          where id=${admission.outboxId}::uuid and topic=${admission.topic}
            and status='processing' and attempt=${admission.attempt}
            and dispatch_owner_id=${admission.owner} and dispatch_claim_token=${admission.claimToken}
            and reconciliation_key=${admission.reconciliationKey} and lease_until>=clock_timestamp()
            and (topic<>'selarti.request.v1' or (payload->>'deadline')::timestamptz>clock_timestamp())`)
        ).rows[0];
        if (!current) return false;
        await tx.execute(sql`insert into delivery_attempts(outbox_id,attempt_id,attempt,provider,outcome,reconciliation_key)
        values(${admission.outboxId}::uuid,${admission.attemptId},${admission.attempt},split_part(${admission.topic},'.',1),'dispatch_consumed',${admission.reconciliationKey})`);
        return true;
      });
    },
  };
}

/** Immutable, content-free outcomes survive withdrawal and source-body retention. */
export async function reconcileClientSelartiRequest(
  db: DrizzleDb,
  botKey: string,
  id: string,
  requestId: string,
): Promise<
  | "applied"
  | "still_unknown"
  | { kind: "terminal"; reasonCode: "provider_not_applied" }
> {
  const facts = (
    await db.execute<{
      started: boolean;
      applied: boolean;
      notApplied: boolean;
    }>(sql`
    select exists(select 1 from delivery_attempts a where a.outbox_id=o.id and a.reconciliation_key=o.reconciliation_key and a.outcome='started') started,
      (exists(select 1 from selarti_response_proposals p where p.request_id=o.idempotency_key and p.request_payload_hash=o.payload_hash)
       or exists(select 1 from selarti_actual_usage_facts f where f.request_id=o.idempotency_key and f.outcome='applied')
       or exists(select 1 from test_expert_outcomes t where t.provider_request_id=o.idempotency_key and t.outcome='applied')) applied,
      (exists(select 1 from selarti_actual_usage_facts f where f.request_id=o.idempotency_key and f.outcome='not_applied')
       or exists(select 1 from test_expert_outcomes t where t.provider_request_id=o.idempotency_key and t.outcome='not_applied')) "notApplied"
    from integration_outbox o join dialogues d on d.id::text=coalesce(o.dialogue_id::text,o.payload->>'dialogueId',
      (select p.dialogue_id::text from selarti_response_proposals p where p.request_id=o.idempotency_key),
      (select r.dialogue_id::text from selarti_cost_reservations r where r.request_id=o.idempotency_key))
    where o.id=${id}::uuid and o.topic='selarti.request.v1' and o.idempotency_key=${requestId} and o.reconciliation_key=${requestId} and d.bot_key=${botKey}
  `)
  ).rows[0];
  if (!facts || !facts.started || facts.applied === facts.notApplied)
    return "still_unknown";
  // These are final accounting facts, not a retryable before-write transport result.
  // The runner's string "not_applied" contract schedules another dispatch.
  return facts.applied
    ? "applied"
    : { kind: "terminal", reasonCode: "provider_not_applied" };
}
