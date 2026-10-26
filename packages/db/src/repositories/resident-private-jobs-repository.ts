import { canonicalPrivateProfile } from "@ii-tonya/contracts";
import { privateObjectErasureSubjectKey } from "./resident-private-erasure.js";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { sql } from "drizzle-orm";
import {
  applyResidentPatch,
  type ResidentDraft,
  type ResidentDocument,
} from "@ii-tonya/domain";
import type { DrizzleDb } from "../client.js";
import {
  lockClientConsentSubject,
  captureClientConsentAuthority,
} from "./client-consent-authority.js";
import {
  lockExpertManagerAuthority,
  type ExpertManagerTransaction as Tx,
} from "./expert-manager-authority.js";
export type PrivateOwnerScope = {
  botId: string;
  botKey: string;
  chatId: string;
  telegramUserId: string;
};
const proposalFields = new Set([
  "city",
  "motivation",
  "specialization",
  "methods",
  "path",
  "cases",
  "premisesType",
  "eventFormat",
  "programme",
  "speakers",
  "pastEvents",
  "projectName",
  "teachingTeam",
  "graduateReviews",
  "experienceYears",
]);
function checkProposal(proposal: Record<string, unknown>) {
  if (
    Object.keys(proposal).some((k) => !proposalFields.has(k)) ||
    Buffer.byteLength(JSON.stringify(proposal)) > 16000
  )
    throw Error("private_proposal_invalid");
  applyResidentPatch({}, proposal, 2);
}
interface Source extends Record<string, unknown> {
  id: string;
  userId: string;
  botId: string;
  botKey: string;
  chatId: string;
  revision: number;
  generation: number;
  status: string;
  draft: ResidentDraft;
  submittedDraft: ResidentDraft | null;
  authority: unknown;
}
export interface DocumentClaim {
  id: string;
  applicationId: string;
  claimToken: string;
  key: string;
  purpose: string;
  reference: ResidentDocument;
  botId: string;
  sourceRevision: number;
  generation: number;
  draft: ResidentDraft;
}
export interface PrivateEvidenceClaim {
  applicationId: string;
  generation: number;
  claimToken: string;
  draft: ResidentDraft;
  documents: DocumentClaim[];
  socialLinks: string[];
}
export class PostgresResidentPrivateJobsRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly policy: { messagingConsentPolicyVersion: string },
  ) {}
  private tx<T>(f: (tx: Tx) => Promise<T>) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout='5000ms'`);
      await tx.execute(sql`set local lock_timeout='2000ms'`);
      return f(tx);
    });
  }
  private async source(
    tx: Tx,
    id: string,
    scope?: PrivateOwnerScope,
  ): Promise<Source> {
    const initial = (
      await tx.execute<{ userId: string }>(
        sql`select user_id as "userId" from residents_applications where id=${id}::uuid`,
      )
    ).rows[0];
    if (!initial) throw Error("private_source_unavailable");
    await lockClientConsentSubject(tx, initial.userId);
    const f = (
      await tx.execute<Source>(
        sql`select id,user_id as "userId",bot_id as "botId",bot_key as "botKey",chat_id as "chatId",revision,check_generation as generation,status,draft,submitted_draft as "submittedDraft" from residents_applications where id=${id}::uuid and is_current and form_version=2 for update`,
      )
    ).rows[0];
    if (
      !f ||
      (scope &&
        (scope.botId !== f.botId ||
          scope.botKey !== f.botKey ||
          scope.chatId !== f.chatId ||
          scope.telegramUserId !== f.chatId))
    )
      throw Error("private_source_unavailable");
    const authority = await captureClientConsentAuthority(tx, {
      subjectId: f.userId,
      botKey: f.botKey,
      chatId: f.chatId,
      externalUserId: f.chatId,
      messagingPolicyVersion: this.policy.messagingConsentPolicyVersion,
    });
    if (!authority) throw Error("private_source_unavailable");
    return { ...f, authority };
  }
  private async allocate(
    tx: Tx,
    f: Source,
    purpose: string,
    reference: ResidentDocument,
    revision: number,
    generation: number,
  ) {
    const prior = (
      await tx.execute<{ id: string }>(
        sql`select id from resident_private_objects where application_id=${f.id}::uuid and purpose=${purpose} and generation=${generation} and source_revision=${revision} and reference=${JSON.stringify(reference)}::jsonb`,
      )
    ).rows[0];
    if (prior) return prior;
    const id = randomUUID();
    await tx.execute(
      sql`insert into resident_object_deletions(custody_id,object_key,subject_erasure_key) values(${id}::uuid,${"custody/" + id},${privateObjectErasureSubjectKey(f.userId)})`,
    );
    await tx.execute(
      sql`insert into resident_private_objects(id,application_id,generation,source_revision,purpose,reference,consent_authority) values(${id}::uuid,${f.id}::uuid,${generation},${revision},${purpose},${JSON.stringify(reference)}::jsonb,${JSON.stringify(f.authority)}::jsonb)`,
    );
    return { id };
  }
  async addBrief(
    scope: PrivateOwnerScope,
    applicationId: string,
    revision: number,
    reference: ResidentDocument,
  ) {
    applyResidentPatch({}, { education: [reference] }, 2);
    if (
      reference.kind !== "document" ||
      ![
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ].includes(reference.mimeType ?? "")
    )
      throw Error("private_brief_invalid");
    return this.tx(async (tx) => {
      const f = await this.source(tx, applicationId, scope);
      if (f.revision !== revision || f.status !== "PENDING_DOCS")
        throw Error("private_proposal_stale");
      const prior = (
        await tx.execute<{ id: string }>(
          sql`select id from resident_private_objects where application_id=${f.id}::uuid and purpose='brief' and source_revision=${revision} and reference=${JSON.stringify(reference)}::jsonb`,
        )
      ).rows[0];
      if (prior) return prior;
      const count = (
        await tx.execute<{ n: number }>(
          sql`select count(*)::int n from resident_private_objects where application_id=${f.id}::uuid and purpose='brief'`,
        )
      ).rows[0]!.n;
      if (count >= 3) throw Error("private_brief_limit");
      return this.allocate(tx, f, "brief", reference, revision, 0);
    });
  }
  async listDocuments(limit = 5) {
    return (
      await this.db.execute<{ id: string }>(
        sql`select id from resident_private_objects where state='allocated' order by created_at,id limit ${Math.min(10, Math.max(1, limit))}`,
      )
    ).rows;
  }
  async claimDocument(id: string): Promise<DocumentClaim | null> {
    return this.tx(async (tx) => {
      const first = (
        await tx.execute<{ applicationId: string }>(
          sql`select application_id as "applicationId" from resident_private_objects where id=${id}::uuid`,
        )
      ).rows[0];
      if (!first) return null;
      let f: Source;
      try {
        f = await this.source(tx, first.applicationId);
      } catch {
        await tx.execute(
          sql`update resident_private_objects set state='unavailable' where id=${id}::uuid and state='allocated'`,
        );
        return null;
      }
      const row = (
        await tx.execute<{
          id: string;
          purpose: string;
          reference: ResidentDocument;
          sourceRevision: number;
          generation: number;
          authority: unknown;
        }>(
          sql`select id,purpose,reference,source_revision as "sourceRevision",generation,consent_authority as authority from resident_private_objects where id=${id}::uuid and state='allocated' for update`,
        )
      ).rows[0];
      if (!row) return null;
      if (
        !isDeepStrictEqual(row.authority, f.authority) ||
        (row.purpose === "brief"
          ? f.status !== "PENDING_DOCS" || f.revision !== row.sourceRevision
          : f.generation !== row.generation)
      ) {
        await tx.execute(
          sql`update resident_private_objects set state='unavailable' where id=${id}::uuid and state='allocated'`,
        );
        return null;
      }
      const claimToken = randomUUID();
      await tx.execute(
        sql`update resident_object_deletions set write_state='inflight',claim_token=${claimToken}::uuid,updated_at=clock_timestamp() where custody_id=${id}::uuid and not erased`,
      );
      await tx.execute(
        sql`update resident_private_objects set state='inflight',claim_token=${claimToken}::uuid,started_at=clock_timestamp() where id=${id}::uuid`,
      );
      return {
        ...row,
        applicationId: f.id,
        claimToken,
        key: "custody/" + id,
        botId: f.botId,
        draft: row.purpose === "brief" ? f.draft : f.submittedDraft!,
      };
    });
  }
  async completeDocument(
    claim: DocumentClaim,
    result: {
      kind: "verified" | "unknown" | "unavailable";
      sha256?: string;
      proposal?: Record<string, unknown>;
      observation?: Record<string, unknown>;
    },
  ) {
    if (result.proposal) checkProposal(result.proposal);
    if (
      result.kind === "verified" &&
      !/^[0-9a-f]{64}$/u.test(result.sha256 ?? "")
    )
      throw Error("private_proof_invalid");
    return this.tx(async (tx) => {
      // No applicant INSERT is possible on completion. The independent key row is always retained.
      const current = (
        await tx.execute<{ applicationId: string }>(
          sql`select application_id as "applicationId" from resident_private_objects where id=${claim.id}::uuid`,
        )
      ).rows[0];
      let source: Source | undefined;
      if (current) {
        try {
          source = await this.source(tx, current.applicationId);
        } catch {
          /* Revoked source cannot receive private results. */
        }
      }
      const row = (
        await tx.execute<{
          claimToken: string;
          authority: unknown;
          state: string;
          sha256: string | null;
        }>(
          sql`select claim_token as "claimToken",consent_authority as authority,state,sha256 from resident_private_objects where id=${claim.id}::uuid for update`,
        )
      ).rows[0];
      if (row && row.claimToken !== claim.claimToken) return;
      if (
        row?.state === "verified" &&
        (result.kind !== "verified" || result.sha256 !== row.sha256)
      )
        return;
      await tx.execute(
        sql`update resident_object_deletions set write_state=${result.kind === "unknown" ? "unknown" : "settled"},updated_at=clock_timestamp(),delete_state=case when erased then 'pending' else delete_state end where custody_id=${claim.id}::uuid and claim_token=${claim.claimToken}::uuid and write_state in('inflight','unknown')`,
      );
      if (!row) return;
      if (!source || !isDeepStrictEqual(source.authority, row.authority)) {
        await tx.execute(
          sql`delete from resident_private_objects where id=${claim.id}::uuid`,
        );
        return;
      }
      const fresh =
        claim.purpose === "brief"
          ? source.status === "PENDING_DOCS" &&
            source.revision === claim.sourceRevision
          : source.generation === claim.generation;
      await tx.execute(
        sql`update resident_private_objects set state=${result.kind},sha256=${result.sha256 ?? null},proposal=${fresh && result.proposal ? JSON.stringify(result.proposal) : null}::jsonb,observation=${fresh && result.observation ? JSON.stringify(result.observation) : null}::jsonb where id=${claim.id}::uuid`,
      );
    });
  }
  async briefStatus(scope: PrivateOwnerScope, applicationId: string) {
    return this.tx(async (tx) => {
      await this.source(tx, applicationId, scope);
      return (
        await tx.execute(
          sql`select id,state,proposal,source_revision as revision,confirmed_at as "confirmedAt" from resident_private_objects where application_id=${applicationId}::uuid and purpose='brief' order by created_at desc limit 3`,
        )
      ).rows;
    });
  }
  async confirmBrief(
    scope: PrivateOwnerScope,
    applicationId: string,
    id: string,
    revision: number,
  ) {
    return this.tx(async (tx) => {
      const f = await this.source(tx, applicationId, scope);
      const p = (
        await tx.execute<{
          proposal: Record<string, unknown>;
          revision: number;
          confirmed: unknown;
        }>(
          sql`select proposal,source_revision as revision,confirmed_at as confirmed from resident_private_objects where id=${id}::uuid and application_id=${f.id}::uuid and purpose='brief' and state='verified' for update`,
        )
      ).rows[0];
      if (
        !p?.proposal ||
        JSON.stringify(p.proposal).length > 2500 ||
        p.confirmed ||
        p.revision !== revision ||
        f.revision !== revision ||
        f.status !== "PENDING_DOCS"
      )
        throw Error("private_proposal_stale");
      checkProposal(p.proposal);
      if (
        Object.keys(p.proposal).some(
          (k) => f.draft[k as keyof ResidentDraft] !== undefined,
        )
      )
        throw Error("private_proposal_stale");
      const draft = applyResidentPatch(f.draft, p.proposal, 2);
      await tx.execute(
        sql`update residents_applications set draft=${JSON.stringify(draft)}::jsonb,revision=revision+1,updated_at=clock_timestamp() where id=${f.id}::uuid`,
      );
      await tx.execute(
        sql`insert into resident_verification_application_updates(application_id,user_id,revision,kind,answers) values(${f.id}::uuid,${f.userId}::uuid,${revision + 1},'patch',${JSON.stringify(p.proposal)}::jsonb)`,
      );
      await tx.execute(
        sql`update resident_private_objects set confirmed_at=clock_timestamp() where id=${id}::uuid`,
      );
      return { confirmed: true };
    });
  }
  async listReconciliations() {
    return (
      await this.db.execute<
        DocumentClaim & { sha256: string } & Record<string, unknown>
      >(
        sql`select o.id,o.application_id as "applicationId",o.claim_token as "claimToken",'custody/'||o.id::text as key,o.purpose,o.reference,o.source_revision as "sourceRevision",o.generation,o.sha256,f.bot_id as "botId",f.draft from resident_private_objects o join residents_applications f on f.id=o.application_id where o.reconciliation_requested and o.state='unknown' and o.sha256 is not null order by o.created_at limit 5`,
      )
    ).rows;
  }
  async finishReconciliation(id: string) {
    await this.db.execute(
      sql`update resident_private_objects set reconciliation_requested=false where id=${id}::uuid`,
    );
  }
  async listDeletions() {
    return (
      await this.db.execute<{ id: string; key: string; writeState: string }>(
        sql`select custody_id as id,object_key as key,write_state as "writeState" from resident_object_deletions where erased and delete_state in('pending','unknown') and delete_attempts<3 and (deletion_started_at is null or deletion_started_at<clock_timestamp()-interval '1 minute') order by updated_at,custody_id limit 5`,
      )
    ).rows;
  }
  async claimDeletion(id: string) {
    return this.tx(async (tx) => {
      const token = randomUUID();
      return (
        (
          await tx.execute<{ id: string; key: string; token: string }>(
            sql`update resident_object_deletions set deletion_token=${token}::uuid,deletion_started_at=clock_timestamp(),deletion_write_state=write_state,delete_attempts=delete_attempts+1 where custody_id=${id}::uuid and erased and delete_state in('pending','unknown') and delete_attempts<3 and (deletion_started_at is null or deletion_started_at<clock_timestamp()-interval '1 minute') returning custody_id as id,object_key as key,deletion_token as token`,
          )
        ).rows[0] ?? null
      );
    });
  }
  async recordDeletion(
    id: string,
    outcome: "absent" | "unknown",
    token: string,
  ) {
    await this.db.execute(
      sql`update resident_object_deletions set delete_state=case when ${outcome}='absent' and deletion_write_state in('allocated','settled') and write_state=deletion_write_state then 'verified' else 'unknown' end,subject_erasure_key=case when ${outcome}='absent' and deletion_write_state in('allocated','settled') and write_state=deletion_write_state then null else subject_erasure_key end,deletion_token=null,deletion_started_at=null,deletion_write_state=null,updated_at=clock_timestamp() where custody_id=${id}::uuid and erased and delete_state in('pending','unknown') and deletion_token=${token}::uuid`,
    );
  }
  async recoverStalled() {
    await this.db.execute(
      sql`update resident_evidence_jobs set status='unknown' where status='claimed' and claimed_at<clock_timestamp()-interval '1 minute'`,
    );
    await this.db.execute(
      sql`update resident_object_deletions d set write_state='unknown',updated_at=clock_timestamp() where write_state='inflight' and updated_at<clock_timestamp()-interval '1 minute'`,
    );
    await this.db.execute(
      sql`update resident_private_objects set state='unknown' where state='inflight' and started_at<clock_timestamp()-interval '1 minute'`,
    );
  }
  async managerObjects(
    sessionHash: string,
    applicationId: string,
    after?: string,
  ) {
    return this.tx(async (tx) => {
      await lockExpertManagerAuthority(tx, sessionHash);
      const id = (
        await tx.execute<{ id: string }>(
          sql`select form_id as id from expert_sales_form_bridges where application_id=${applicationId}::uuid`,
        )
      ).rows[0]?.id;
      if (!id) throw Error("private_source_unavailable");
      const f = await this.source(tx, id);
      return (
        await tx.execute(
          sql`select id,purpose,state,observation from resident_private_objects where application_id=${f.id}::uuid and generation in(0,${f.generation}) and (${after ?? null}::uuid is null or id>${after ?? null}::uuid) order by id limit 30`,
        )
      ).rows;
    });
  }
  async managerLink(
    sessionHash: string,
    applicationId: string,
    id: string,
    presign: (p: {
      key: string;
      custodyId: string;
      sha256: string;
      size: number;
      mimeType: string;
    }) => Promise<string>,
  ) {
    return this.tx(async (tx) => {
      const managerId = await lockExpertManagerAuthority(tx, sessionHash),
        formId = (
          await tx.execute<{ id: string }>(
            sql`select form_id as id from expert_sales_form_bridges where application_id=${applicationId}::uuid`,
          )
        ).rows[0]?.id;
      if (!formId) throw Error("private_source_unavailable");
      const f = await this.source(tx, formId);
      const o = (
        await tx.execute<{
          sha256: string;
          reference: ResidentDocument;
          authority: unknown;
        }>(
          sql`select o.sha256,o.reference,o.consent_authority as authority from resident_private_objects o join resident_object_deletions d on d.custody_id=o.id and not d.erased and d.write_state='settled' where o.id=${id}::uuid and o.application_id=${f.id}::uuid and o.state='verified' and o.generation in(0,${f.generation}) for share of o,d`,
        )
      ).rows[0];
      if (
        !o ||
        o.reference.size === null ||
        (o.reference.mimeType === null && o.reference.kind !== "photo") ||
        !isDeepStrictEqual(o.authority, f.authority)
      )
        throw Error("private_source_unavailable");
      const url = await presign({
        key: "custody/" + id,
        custodyId: id,
        sha256: o.sha256,
        size: o.reference.size,
        mimeType:
          o.reference.kind === "photo" ? "image/jpeg" : o.reference.mimeType!,
      });
      await lockExpertManagerAuthority(tx, sessionHash);
      await tx.execute(
        sql`insert into resident_document_access_audit(custody_id,manager_id,action) values(${id}::uuid,${managerId}::uuid,'link_issued')`,
      );
      return { url, expiresIn: 120, bearerUntilExpiry: true };
    });
  }
  async recoveryList(sessionHash: string, after?: string) {
    return this.tx(async (tx) => {
      await lockExpertManagerAuthority(tx, sessionHash);
      return (
        await tx.execute(
          sql`select custody_id as id,write_state as "writeState",delete_state as "deleteState",delete_attempts as attempts from resident_object_deletions where erased and delete_state<>'verified' and (${after ?? null}::uuid is null or custody_id>${after ?? null}::uuid) order by custody_id limit 50`,
        )
      ).rows;
    });
  }
  async requestRecovery(sessionHash: string, id: string) {
    return this.tx(async (tx) => {
      const managerId = await lockExpertManagerAuthority(tx, sessionHash);
      const object = (
        await tx.execute<{ applicationId: string }>(
          sql`select application_id as "applicationId" from resident_private_objects where id=${id}::uuid and state='unknown'`,
        )
      ).rows[0];
      if (object) {
        await this.source(tx, object.applicationId);
        await tx.execute(
          sql`update resident_private_objects set reconciliation_requested=true where id=${id}::uuid and state='unknown'`,
        );
      }
      await tx.execute(
        sql`update resident_object_deletions set delete_attempts=0,delete_state='pending',deletion_token=null,deletion_started_at=null,deletion_write_state=null where custody_id=${id}::uuid and erased and delete_state<>'verified'`,
      );
      await tx.execute(
        sql`insert into resident_document_access_audit(custody_id,manager_id,action) values(${id}::uuid,${managerId}::uuid,'reconcile_requested')`,
      );
      return { queued: true };
    });
  }
  async listEvidenceJobs() {
    await this.db.execute(
      sql`with due as (select j.application_id,j.generation from resident_evidence_jobs j join residents_applications f on f.id=j.application_id and f.is_current and f.check_generation=j.generation where (j.status='complete' and exists(select 1 from jsonb_array_elements(coalesce(j.result->'social','[]'::jsonb)) o where (o->>'expiresAt')::timestamptz<=clock_timestamp())) or (j.status='unknown' and j.claimed_at<=clock_timestamp()-interval '24 hours') order by j.completed_at nulls last,j.application_id limit 5 for update of j skip locked) update resident_evidence_jobs j set status='pending',claim_token=null,claimed_at=null,consent_authority=null from due where j.application_id=due.application_id and j.generation=due.generation`,
    );

    await this.db.execute(
      sql`insert into resident_evidence_jobs(application_id,generation) select g.application_id,g.generation from resident_check_generations g join residents_applications f on f.id=g.application_id and f.is_current and f.check_generation=g.generation where g.status in('pending','manual_review') and f.form_version=2 and not exists(select 1 from resident_evidence_jobs j where j.application_id=g.application_id and j.generation=g.generation) order by g.created_at,g.application_id,g.generation limit 5 on conflict do nothing`,
    );
    return (
      await this.db.execute<{ applicationId: string; generation: number }>(
        sql`select application_id as "applicationId",generation from resident_evidence_jobs where status='pending' order by application_id,generation limit 5`,
      )
    ).rows;
  }
  async claimEvidence(applicationId: string, generation: number) {
    return this.tx(async (tx) => {
      const cancel = async () => {
        await tx.execute(
          sql`update resident_evidence_jobs set status='cancelled' where application_id=${applicationId}::uuid and generation=${generation} and status='pending'`,
        );
        return null;
      };
      let f: Source;
      try {
        f = await this.source(tx, applicationId);
      } catch {
        return cancel();
      }
      if (f.generation !== generation || !f.submittedDraft) return cancel();
      const job = (
        await tx.execute(
          sql`select 1 from resident_evidence_jobs where application_id=${applicationId}::uuid and generation=${generation} and status='pending' for update`,
        )
      ).rows[0];
      if (!job) return null;
      const g = (
        await tx.execute<{
          submittedRevision: number;
          supplementRevision: number;
          requestId: string | null;
        }>(
          sql`select submitted_revision as "submittedRevision",supplement_revision as "supplementRevision",request_id as "requestId" from resident_check_generations where application_id=${applicationId}::uuid and generation=${generation} and status in('pending','manual_review')`,
        )
      ).rows[0];
      if (!g) return cancel();
      const token = randomUUID();
      await tx.execute(
        sql`update resident_evidence_jobs set status='claimed',claim_token=${token}::uuid,claimed_at=clock_timestamp(),consent_authority=${JSON.stringify(f.authority)}::jsonb where application_id=${applicationId}::uuid and generation=${generation}`,
      );
      for (const purpose of [
        "education",
        "propertyEvidence",
        "tourMedia",
        "licence",
      ] as const) {
        for (const ref of f.submittedDraft[purpose] ?? [])
          await this.allocate(
            tx,
            f,
            purpose,
            ref,
            g.submittedRevision,
            generation,
          );
      }
      return {
        applicationId,
        generation,
        claimToken: token,
        draft: f.submittedDraft,
        socialLinks: f.submittedDraft.socialLinks ?? [],
      };
    });
  }
  async listMaterializationJobs() {
    return (
      await this.db.execute<{ applicationId: string; generation: number }>(
        sql`select application_id as "applicationId",generation from resident_evidence_jobs where not documents_materialized and status in('claimed','complete','unknown') order by application_id,generation limit 5`,
      )
    ).rows;
  }
  async materializeEvidenceDocuments(
    applicationId: string,
    generation: number,
  ) {
    return this.tx(async (tx) => {
      const cancel = async () => {
        await tx.execute(
          sql`update resident_evidence_jobs set documents_materialized=true where application_id=${applicationId}::uuid and generation=${generation}`,
        );
        return;
      };
      let f: Source;
      try {
        f = await this.source(tx, applicationId);
      } catch {
        return cancel();
      }
      if (f.generation !== generation) return cancel();
      const job = (
        await tx.execute<{ cursor: number; authority: unknown }>(
          sql`select document_cursor as cursor,consent_authority as authority from resident_evidence_jobs where application_id=${applicationId}::uuid and generation=${generation} and not documents_materialized and status in('claimed','complete','unknown') for update`,
        )
      ).rows[0];
      if (!job) return;
      if (!isDeepStrictEqual(job.authority, f.authority)) return cancel();
      const g = (
        await tx.execute<{ requestId: string | null; watermark: number }>(
          sql`select request_id as "requestId",supplement_revision as watermark from resident_check_generations where application_id=${applicationId}::uuid and generation=${generation}`,
        )
      ).rows[0];
      if (!g?.requestId) return cancel();
      const updates = (
        await tx.execute<{
          answers: { documents?: ResidentDocument[] };
          revision: number;
        }>(
          sql`select answers,revision from resident_verification_application_updates where application_id=${f.id}::uuid and kind='followup' and request_id=${g.requestId}::uuid and revision>${job.cursor} and revision<=${g.watermark} order by revision limit 2`,
        )
      ).rows;
      for (const update of updates)
        for (const ref of update.answers.documents ?? [])
          await this.allocate(
            tx,
            f,
            "followup",
            ref,
            update.revision,
            generation,
          );
      await tx.execute(
        sql`update resident_evidence_jobs set document_cursor=${updates.at(-1)?.revision ?? job.cursor},documents_materialized=${updates.length < 2} where application_id=${applicationId}::uuid and generation=${generation}`,
      );
    });
  }
  async cachedSocial(
    applicationId: string,
    profile: string,
    adapterVersion: string,
  ) {
    return this.tx(async (tx) => {
      const f = await this.source(tx, applicationId);
      return (
        await tx.execute<{ observation: Record<string, unknown> }>(
          sql`select observation from resident_social_observations where user_id=${f.userId}::uuid and profile=${canonicalPrivateProfile(profile)} and adapter_version=${adapterVersion} and expires_at>clock_timestamp()`,
        )
      ).rows[0]?.observation;
    });
  }
  async completeEvidence(
    claim: { applicationId: string; generation: number; claimToken: string },
    observations: Record<string, unknown>[],
  ) {
    if (
      observations.length > 10 ||
      Buffer.byteLength(JSON.stringify(observations)) > 60000
    )
      throw Error("private_observation_invalid");
    return this.tx(async (tx) => {
      let f: Source;
      try {
        f = await this.source(tx, claim.applicationId);
      } catch {
        return false;
      }
      const job = (
        await tx.execute<{ authority: unknown }>(
          sql`select consent_authority as authority from resident_evidence_jobs where application_id=${f.id}::uuid and generation=${claim.generation} and claim_token=${claim.claimToken}::uuid and status='claimed' for update`,
        )
      ).rows[0];
      if (
        !job ||
        f.generation !== claim.generation ||
        !isDeepStrictEqual(job.authority, f.authority)
      )
        return false;
      const valid = (o: Record<string, unknown>) =>
        Object.keys(o).every((k) =>
          [
            "profile",
            "adapterVersion",
            "observedAt",
            "expiresAt",
            "source",
            "coverage",
            "reason",
            "posts",
            "activity",
            "score",
            "scorePolicy",
          ].includes(k),
        ) &&
        typeof o.profile === "string" &&
        f.submittedDraft?.socialLinks?.some(
          (p) =>
            canonicalPrivateProfile(p) ===
            canonicalPrivateProfile(o.profile as string),
        ) &&
        typeof o.adapterVersion === "string" &&
        ["manual-v1", "vk-wall-v1", "telegram-preview-v1"].includes(
          o.adapterVersion,
        ) &&
        typeof o.observedAt === "string" &&
        typeof o.expiresAt === "string" &&
        Number.isFinite(Date.parse(o.observedAt)) &&
        Date.parse(o.expiresAt) - Date.parse(o.observedAt) === 86400000 &&
        ["manual", "vk_api", "telegram_public_preview"].includes(
          String(o.source),
        ) &&
        ["complete_latest", "partial", "unavailable"].includes(
          String(o.coverage),
        ) &&
        ["ACTIVE", "INACTIVE", "UNKNOWN"].includes(String(o.activity)) &&
        (o.coverage === "complete_latest" || o.activity === "UNKNOWN") &&
        o.score === null &&
        o.scorePolicy === "not_configured" &&
        (o.reason === null ||
          (typeof o.reason === "string" &&
            /^[a-z_]{1,100}$/u.test(o.reason))) &&
        Array.isArray(o.posts) &&
        o.posts.length <= 5 &&
        o.posts.every((p: unknown) => {
          if (!p || typeof p !== "object" || Array.isArray(p)) return false;
          const v = p as Record<string, unknown>;
          return (
            Object.keys(v).sort().join() ===
              "comments,hasMedia,id,publishedAt" &&
            typeof v.id === "string" &&
            /^[0-9]{1,20}$/u.test(v.id) &&
            typeof v.publishedAt === "string" &&
            Number.isFinite(Date.parse(v.publishedAt)) &&
            typeof v.hasMedia === "boolean" &&
            (v.comments === null ||
              (Number.isSafeInteger(v.comments) && Number(v.comments) >= 0))
          );
        });
      if (observations.some((o) => !valid(o)))
        throw Error("private_observation_invalid");
      for (const o of observations) {
        if (typeof o.profile === "string")
          o.profile = canonicalPrivateProfile(o.profile);
        if (
          typeof o.profile !== "string" ||
          typeof o.adapterVersion !== "string" ||
          typeof o.observedAt !== "string" ||
          typeof o.expiresAt !== "string" ||
          !f.submittedDraft?.socialLinks?.some(
            (p) =>
              canonicalPrivateProfile(p) ===
              canonicalPrivateProfile(o.profile as string),
          ) ||
          Date.parse(o.expiresAt) - Date.parse(o.observedAt) !== 86400000
        )
          continue;
        await tx.execute(
          sql`insert into resident_social_observations(user_id,application_id,profile,adapter_version,observed_at,expires_at,observation) values(${f.userId}::uuid,${f.id}::uuid,${o.profile},${o.adapterVersion},${o.observedAt}::timestamptz,${o.expiresAt}::timestamptz,${JSON.stringify(o)}::jsonb) on conflict(user_id,profile,adapter_version) do update set application_id=excluded.application_id,observed_at=excluded.observed_at,expires_at=excluded.expires_at,observation=excluded.observation where resident_social_observations.observed_at<excluded.observed_at`,
        );
      }
      await tx.execute(
        sql`update resident_evidence_jobs set status='complete',result=${JSON.stringify({ social: observations, education: f.submittedDraft?.education?.length ? "UNKNOWN" : "NO_DOCUMENT", scorePolicy: "not_configured" })}::jsonb,completed_at=clock_timestamp() where application_id=${f.id}::uuid and generation=${claim.generation}`,
      );
      return true;
    });
  }
  async managerEvidence(sessionHash: string, applicationId: string) {
    return this.tx(async (tx) => {
      await lockExpertManagerAuthority(tx, sessionHash);
      const id = (
        await tx.execute<{ id: string }>(
          sql`select form_id as id from expert_sales_form_bridges where application_id=${applicationId}::uuid`,
        )
      ).rows[0]?.id;
      if (!id) throw Error("private_source_unavailable");
      const f = await this.source(tx, id);
      return (
        (
          await tx.execute(
            sql`select status,result,not exists(select 1 from jsonb_array_elements(coalesce(result->'social','[]'::jsonb)) o where (o->>'expiresAt')::timestamptz<=clock_timestamp()) as current,case when exists(select 1 from jsonb_array_elements(coalesce(result->'social','[]'::jsonb)) o where (o->>'expiresAt')::timestamptz<=clock_timestamp()) then 'cache_expired' else null end as reason from resident_evidence_jobs where application_id=${id}::uuid and generation=${f.generation}`,
          )
        ).rows[0] ?? { status: "pending", result: null }
      );
    });
  }
}
