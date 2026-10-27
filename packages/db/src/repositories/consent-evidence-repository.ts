import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { withSerializableRetry } from "./message-repository.js";
import { currentConsentGrantedSql } from "./consent-current.js";

/**
 * Серверный путь согласия по ТЗ по ПД от 2026-09-21 (EVID-01…05, CONS-01/02).
 *
 * `consents` остаётся единственным журналом фактов решений; `consent_states` — проекция
 * «текущее состояние» с монотонной ревизией (барьер для EGRESS-03), `consent_presentations` —
 * одноразовое предъявление документа. Никакого сетевого вызова отсюда не происходит: выдача
 * согласия и включение провайдера — разные решения (EGRESS-06).
 */
export const CONSENT_PURPOSES = [
  "client_profile",
  "expert_note",
  "expert_handoff",
  "follow_up",
  "client_messaging",
  "selarti_ai_processing",
] as const;

export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export type ConsentChannel = "web" | "telegram";

const PURPOSES = new Set<string>(CONSENT_PURPOSES);
const DEFAULT_PRESENTATION_TTL_MS = 24 * 60 * 60 * 1_000;
const POLICY_PREFIX: Record<ConsentPurpose, string> = {
  client_profile: "profile",
  client_messaging: "client-messaging",
  expert_note: "note",
  expert_handoff: "handoff",
  follow_up: "follow-up",
  selarti_ai_processing: "selarti-ai",
};

export interface ApprovedDocument {
  readonly id: string;
  readonly documentKey: string;
  readonly version: number;
  readonly textSha256: string;
  readonly title: string;
  readonly body: string;
}

export interface IssuedPresentation {
  readonly presentationId: string;
  readonly token: string;
  readonly expiresAt: string;
  readonly document: ApprovedDocument;
  readonly policyVersion: string;
}

export interface ConsentDecisionReceipt {
  readonly decisionId: string;
  readonly revision: number;
  readonly documentVersionId: string;
  readonly textSha256: string;
}

export class ConsentGrantInvariantError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ConsentGrantInvariantError";
  }
}

const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const digestOf = (token: string): string => `sha256:${sha256(token)}`;

const rows = <T>(result: unknown): T[] =>
  ((result as { rows?: T[] })?.rows ?? []) as T[];

const single = <T>(result: unknown, what: string): T => {
  const found = rows<T>(result);
  if (found.length !== 1)
    throw new ConsentGrantInvariantError(`consent_${what}_missing`);
  return found[0] as T;
};

export class PostgresConsentEvidenceRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly options: {
      consentMutationCapability?: { enabled: boolean };
      presentationTtlMs?: number;
      requiredPolicyVersions?: Partial<Record<ConsentPurpose, string>>;
    } = {},
  ) {}

  private policyVersion(purpose: ConsentPurpose, version: number): string {
    const configured = this.options.requiredPolicyVersions?.[purpose];
    const canonical = `${POLICY_PREFIX[purpose]}-v${version}`;
    if (configured === undefined) return canonical;
    // The legacy messaging gate uses messaging-vN. Bind only this known alias,
    // never an arbitrary configured label or a different document revision.
    if (
      configured === canonical ||
      (purpose === "client_messaging" && configured === `messaging-v${version}`)
    )
      return configured;
    throw new ConsentGrantInvariantError("consent_document_version_missing");
  }

  private assertEnabled(): void {
    if (!this.options.consentMutationCapability?.enabled)
      throw new ConsentGrantInvariantError("consent_mutations_disabled");
  }

  private static assertPurpose(
    purpose: string,
  ): asserts purpose is ConsentPurpose {
    if (!PURPOSES.has(purpose))
      throw new ConsentGrantInvariantError("consent_purpose_unknown");
  }

  /** Версия документа: тело неизменяемо, хеш сверяется самой БД (EVID-01, EVID-02). */
  async approveDocumentVersion(command: {
    documentKey: string;
    title: string;
    body: string;
    approvedBy: string;
  }): Promise<ApprovedDocument> {
    this.assertEnabled();
    const digest = sha256(command.body);
    return single<ApprovedDocument>(
      await this.db.execute(sql`
        insert into consent_document_versions
          (document_key, version, title, body, text_sha256, status, effective_at, approved_at, approved_by)
        select
          ${command.documentKey},
          coalesce(max(version), 0) + 1,
          ${command.title},
          ${command.body},
          ${digest},
          'approved',
          now(),
          now(),
          ${command.approvedBy}
        from consent_document_versions
        where document_key = ${command.documentKey}
        returning id, document_key as "documentKey", version, text_sha256 as "textSha256", title, body
      `),
      "document_version",
    );
  }

  /**
   * Одноразовое предъявление: токен выдаётся наружу только как непрозрачная строка,
   * в БД попадает его дайджест (EVID-04, BOT-03, WEB-05).
   */
  async issuePresentation(command: {
    userId: string;
    purpose: string;
    channel: ConsentChannel;
    documentKey: string;
  }): Promise<IssuedPresentation> {
    this.assertEnabled();
    PostgresConsentEvidenceRepository.assertPurpose(command.purpose);
    if (command.documentKey !== `consent.${command.purpose}`)
      throw new ConsentGrantInvariantError("consent_command_incomplete");
    const ttlMs = this.options.presentationTtlMs ?? DEFAULT_PRESENTATION_TTL_MS;
    const token = randomBytes(32).toString("base64url");
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout='2000ms'`);
      await tx.execute(sql`set local lock_timeout='1000ms'`);
      // Serializes document publication/retirement with presentation issuance.
      await tx.execute(sql`lock table consent_document_versions in share mode`);
      const document = single<ApprovedDocument>(
        await tx.execute(sql`
      select id, document_key as "documentKey", version, title, body, text_sha256 as "textSha256"
      from consent_document_versions
      where document_key=${command.documentKey} and status='approved'
        and effective_at <= clock_timestamp()
      order by version desc limit 1
    `),
        "document_version",
      );
      const stored = single<{
        presentationId: string;
        documentVersionId: string;
        expiresAt: string;
      }>(
        await tx.execute(sql`
        insert into consent_presentations
          (user_id, purpose, document_version_id, token_digest, channel, expires_at)
        select
          ${command.userId}::uuid,
          ${command.purpose},
          ${document.id}::uuid,
          ${digestOf(token)},
          ${command.channel},
          clock_timestamp() + (${ttlMs}::double precision * interval '1 millisecond')
        from users where id=${command.userId}::uuid and active=true
        returning id as "presentationId", document_version_id as "documentVersionId",
                  expires_at as "expiresAt"
      `),
        "presentation",
      );
      return {
        presentationId: stored.presentationId,
        token,
        expiresAt: stored.expiresAt,
        document,
        policyVersion: this.policyVersion(
          command.purpose as ConsentPurpose,
          document.version,
        ),
      };
    });
  }

  /**
   * Погашение предъявления и запись решения — одна транзакция: повторный клик, чужой токен,
   * истёкший токен и отзыв за пределами окна отсекаются здесь, а не в UI (WEB-04, BOT-04/05).
   */
  async recordDecision(command: {
    token: string;
    userId: string;
    purpose: string;
    decision: "granted" | "denied";
    policyVersion: string;
    correlationId: string;
    scopeFields?: Record<string, unknown>;
    recipientId?: string;
    reservationId?: string;
  }): Promise<ConsentDecisionReceipt> {
    this.assertEnabled();
    PostgresConsentEvidenceRepository.assertPurpose(command.purpose);
    if (!command.token || !command.policyVersion)
      throw new ConsentGrantInvariantError("consent_command_incomplete");

    return withSerializableRetry(() =>
      this.db.transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level serializable`);
        await tx.execute(sql`set local statement_timeout='2000ms'`);
        await tx.execute(sql`set local lock_timeout='1000ms'`);
        await tx.execute(
          sql`lock table consent_document_versions in share mode`,
        );
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${command.userId}, 0))`,
        );
        if (command.decision === "denied") {
          const active = single<{ granted: boolean }>(
            await tx.execute(sql`
            select ${currentConsentGrantedSql({ userExpression: sql`${command.userId}::uuid`, purpose: command.purpose })} as granted
          `),
            "state",
          );
          if (active.granted)
            throw new ConsentGrantInvariantError("consent_withdrawal_required");
        }

        const redeemed = rows<{
          presentationId: string;
          documentVersionId: string;
          textSha256: string;
          version: number;
        }>(
          await tx.execute(sql`
            update consent_presentations p
            set consumed_at = clock_timestamp()
            from consent_document_versions d
            where p.document_version_id = d.id
              and p.token_digest = ${digestOf(command.token)}
              and p.user_id = ${command.userId}::uuid
              and p.purpose = ${command.purpose}
              and d.document_key = ${`consent.${command.purpose}`}
              and d.status = 'approved' and d.effective_at <= clock_timestamp()
              and d.version = (select max(current_doc.version) from consent_document_versions current_doc
                where current_doc.document_key=d.document_key and current_doc.status='approved'
                  and current_doc.effective_at <= clock_timestamp())
              and exists (select 1 from users where id=p.user_id and active=true)
              and p.consumed_at is null
              and p.invalidated_at is null
              and p.expires_at > clock_timestamp()
            returning p.id as "presentationId",
                      d.id as "documentVersionId",
                      d.text_sha256 as "textSha256", d.version
          `),
        );
        if (redeemed.length !== 1)
          throw new ConsentGrantInvariantError("consent_presentation_invalid");
        const presentation = redeemed[0] as (typeof redeemed)[number];
        const policyVersion = this.policyVersion(
          command.purpose as ConsentPurpose,
          presentation.version,
        );
        if (command.policyVersion !== policyVersion)
          throw new ConsentGrantInvariantError("consent_presentation_invalid");

        const prior = rows<{ lastDecisionId: string | null }>(
          await tx.execute(sql`
            select last_decision_id as "lastDecisionId" from consent_states
            where user_id = ${command.userId}::uuid and purpose = ${command.purpose}
          `),
        );
        const priorDecisionId = prior[0]?.lastDecisionId ?? null;

        const decision = single<{ id: string }>(
          await tx.execute(sql`
            insert into consents
              (user_id, consent_type, decision, policy_version, channel, scope_fields,
               document_version_id, presentation_id, prior_decision_id, recipient_id,
               reservation_id, text_sha256, basis)
            select
              ${command.userId}::uuid, ${command.purpose}, ${command.decision},
              ${policyVersion},
              (select channel from consent_presentations where id = ${presentation.presentationId}::uuid),
              ${JSON.stringify(command.scopeFields ?? {})}::jsonb,
              ${presentation.documentVersionId}::uuid,
              ${presentation.presentationId}::uuid,
              ${priorDecisionId}::uuid,
              ${command.recipientId ?? null}::uuid,
              ${command.reservationId ?? null}::uuid,
              ${presentation.textSha256},
              'consent'
            returning id
          `),
          "decision",
        );

        const state = single<{ revision: number | string }>(
          await tx.execute(sql`
            insert into consent_states
              (user_id, purpose, decision, document_version_id, last_decision_id, revision)
            values
              (${command.userId}::uuid, ${command.purpose}, ${command.decision},
               ${presentation.documentVersionId}::uuid, ${decision.id}::uuid, 1)
            on conflict (user_id, purpose)
              do update set decision = excluded.decision,
                            document_version_id = excluded.document_version_id,
                            last_decision_id = excluded.last_decision_id,
                            revision = consent_states.revision + 1,
                            updated_at = now()
            returning revision
          `),
          "state",
        );

        await tx.execute(sql`
          insert into audit_events
            (actor_type, actor_id, authenticated_session_id_hash, action, object_type,
             object_id, decision, reason_code, correlation_id, occurred_at, metadata_hash)
          values
            ('client', ${command.userId}::uuid, ${sha256(`actor:${command.userId}`)},
             ${`consent.${command.decision}`}, 'consent_purpose', ${command.userId}::uuid,
             ${command.decision}, 'consent_recorded', ${command.correlationId}, now(),
             ${sha256(
               JSON.stringify({
                 purpose: command.purpose,
                 policyVersion,
                 documentVersionId: presentation.documentVersionId,
                 textSha256: presentation.textSha256,
               }),
             )})
        `);

        return {
          decisionId: decision.id,
          revision: Number(state.revision),
          documentVersionId: presentation.documentVersionId,
          textSha256: presentation.textSha256,
        };
      }),
    );
  }

  /**
   * Отзыв инвалидирует ранее выданные предъявления в затронутой области (EVID-04): свежее
   * согласие требует нового предъявления, старая кнопка не может «возродить» решение.
   */
  async invalidatePresentations(command: {
    userId: string;
    purpose: string;
  }): Promise<number> {
    this.assertEnabled();
    PostgresConsentEvidenceRepository.assertPurpose(command.purpose);
    const updated = rows<{ count: number | string }>(
      await this.db.execute(sql`
        update consent_presentations
        set invalidated_at = now(), revoke_epoch = revoke_epoch + 1
        where user_id = ${command.userId}::uuid
          and purpose = ${command.purpose}
          and consumed_at is null
          and invalidated_at is null
        returning 1 as count
      `),
    );
    return updated.length;
  }

  async currentState(command: {
    userId: string;
    purpose: string;
  }): Promise<{ decision: string; revision: number } | null> {
    const found = rows<{ decision: string; revision: number | string }>(
      await this.db.execute(sql`
        select decision, revision from consent_states
        where user_id = ${command.userId}::uuid and purpose = ${command.purpose}
      `),
    );
    const state = found[0];
    return state
      ? { decision: state.decision, revision: Number(state.revision) }
      : null;
  }
}
