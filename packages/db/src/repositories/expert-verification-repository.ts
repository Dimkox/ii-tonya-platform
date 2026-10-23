import { enqueueApplicationMaterials } from "./expert-application-materials.js";
import {
  lockExpertManagerAuthority,
  ExpertManagerAuthorityError,
} from "./expert-manager-authority.js";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  assertVerifiedOnboardingPayment,
  type OnboardingPaymentBinding,
  type VerifiedOnboardingPayment,
} from "@ii-tonya/integrations";
import type { DrizzleDb } from "../client.js";
import {
  captureClientConsentAuthority,
  lockClientConsentSubject,
} from "./client-consent-authority.js";
import { originalClientConsentSql } from "./consent-current.js";
import type { ExpertPromoScope } from "./expert-promo-repository.js";

type Tx = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export class ExpertVerificationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ExpertVerificationError";
  }
}
const fail = (code: string): never => {
  throw new ExpertVerificationError(code);
};
export interface OnboardingInvoice {
  id: string;
  applicationId: string;
  userId: string;
  purpose: "onboarding";
  amountMinor: "300000";
  currency: "RUB";
  mode: "test" | "live";
  status: "pending" | "settled" | "cancelled";
  operationId: string;
  operationStatus?:
    "created" | "pending" | "unknown_outcome" | "succeeded" | "cancelled";
  providerObjectId?: string | null;
}
export interface ExpertVerificationDecisionCommand {
  sessionHash: string;
  applicationId: string;
  decision: "approved" | "rejected";
  reasonCode: string;
  idempotencyKey: string;
}
export class PostgresExpertVerificationRepository {
  private readonly policy: Readonly<{
    providerMode: "test" | "live";
    messagingConsentPolicyVersion: string;
  }>;
  constructor(
    private readonly db: DrizzleDb,
    policy: {
      providerMode: "test" | "live";
      messagingConsentPolicyVersion: string;
    },
  ) {
    if (
      (policy.providerMode !== "test" && policy.providerMode !== "live") ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(
        policy.messagingConsentPolicyVersion,
      )
    )
      fail("verification_configuration_invalid");
    this.policy = Object.freeze({ ...policy });
  }
  private async transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout='2000ms'`);
        await tx.execute(sql`set local lock_timeout='1000ms'`);
        return work(tx);
      });
    } catch (error) {
      if (error instanceof ExpertVerificationError) throw error;
      throw new ExpertVerificationError("verification_storage_unavailable");
    }
  }
  private async manager(tx: Tx, sessionHash: string): Promise<string> {
    try {
      return await lockExpertManagerAuthority(tx, sessionHash);
    } catch (error) {
      if (error instanceof ExpertManagerAuthorityError)
        throw new ExpertVerificationError("verification_forbidden");
      throw error;
    }
  }

  private async owner(tx: Tx, scope: ExpertPromoScope): Promise<string | null> {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(scope.botKey) ||
      !/^\d{1,20}$/u.test(scope.botId) ||
      !/^[1-9]\d{0,19}$/u.test(scope.telegramUserId) ||
      scope.chatId !== scope.telegramUserId
    )
      return null;
    const identities = (
      await tx.execute<{ userId: string }>(
        sql`select ci.user_id as "userId" from channel_identities ci join users u on u.id=ci.user_id and u.active=true where ci.provider='telegram' and ci.bot_key=${scope.botKey} and ci.external_id=${scope.telegramUserId} and ci.external_chat_id=${scope.chatId} and ci.status='active' order by ci.id limit 2`,
      )
    ).rows;
    if (identities.length !== 1) return null;
    const userId = identities[0]!.userId;
    await lockClientConsentSubject(tx, userId);
    return (await captureClientConsentAuthority(tx, {
      subjectId: userId,
      botKey: scope.botKey,
      chatId: scope.chatId,
      externalUserId: scope.telegramUserId,
      messagingPolicyVersion: this.policy.messagingConsentPolicyVersion,
    }))
      ? userId
      : null;
  }
  private async currentConsent(tx: Tx, userId: string) {
    const rows = (
      await tx.execute<{ policyVersion: string }>(
        originalClientConsentSql(userId, "client_messaging"),
      )
    ).rows;
    return (
      rows.length === 1 &&
      rows[0]!.policyVersion === this.policy.messagingConsentPolicyVersion
    );
  }
  async listQueue(sessionHash: string, limit = 50) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      fail("verification_invalid_request");
    return this.transaction(async (tx) => {
      await this.manager(tx, sessionHash);
      return (
        await tx.execute<{
          applicationId: string;
          status: "pending";
          maskedContact: string;
          quoteId: string;
          termMonths: 1 | 3;
          priceMinor: string;
          currency: "RUB";
        }>(
          sql`select a.id as "applicationId",a.verification_status as status,'telegram:***'::text as "maskedContact",q.id as "quoteId",q.term_months as "termMonths",q.price_minor::text as "priceMinor",q.currency from expert_onboarding_applications a join users u on u.id=a.user_id and u.active=true join expert_campaign_quotes q on q.id=a.campaign_quote_id and q.user_id=a.user_id where a.verification_status='pending' or (a.verification_status='approved' and exists(select 1 from expert_offer_profiles p where p.user_id=a.user_id and p.revision=(select max(revision) from expert_offer_profiles where user_id=a.user_id) and not exists(select 1 from expert_offer_profile_verifications pv where pv.user_id=p.user_id and pv.profile_revision=p.revision))) order by a.created_at,a.id limit ${limit}`,
        )
      ).rows;
    });
  }
  async applicationDetail(sessionHash: string, applicationId: string) {
    if (!uuid.test(applicationId)) fail("verification_invalid_request");
    return this.transaction(async (tx) => {
      await this.manager(tx, sessionHash);
      const initial = (
        await tx.execute<{ userId: string }>(
          sql`select user_id as "userId" from expert_onboarding_applications where id=${applicationId}::uuid`,
        )
      ).rows[0];
      if (!initial) return null;
      await lockClientConsentSubject(tx, initial.userId);
      const row = (
        await tx.execute<{
          applicationId: string;
          userId: string;
          status: "pending" | "approved" | "rejected";
          quoteId: string;
          termMonths: 1 | 3;
          priceMinor: string;
          currency: "RUB";
        }>(
          sql`select a.id as "applicationId",a.user_id as "userId",a.verification_status as status,q.id as "quoteId",q.term_months as "termMonths",q.price_minor::text as "priceMinor",q.currency from expert_onboarding_applications a join users u on u.id=a.user_id and u.active=true join expert_campaign_quotes q on q.id=a.campaign_quote_id and q.user_id=a.user_id where a.id=${applicationId}::uuid`,
        )
      ).rows[0];
      if (!row || !(await this.currentConsent(tx, row.userId))) return null;
      await this.manager(tx, sessionHash);
      const contact = (
        await tx.execute<{ provider: "telegram"; externalId: string }>(
          sql`select provider,external_id as "externalId" from channel_identities where user_id=${row.userId}::uuid and provider='telegram' and status='active' order by id limit 5`,
        )
      ).rows;
      const profile = (
        await tx.execute<{
          revision: number;
          cityCode: string;
          millionCity: boolean;
          serviceFormat: "online_only" | "offline" | "hybrid";
          ticketMinor: string;
          verified: boolean;
        }>(
          sql`select p.revision,p.city_code as "cityCode",p.million_city as "millionCity",p.service_format as "serviceFormat",p.ticket_minor::text as "ticketMinor",exists(select 1 from expert_offer_profile_verifications v where v.user_id=p.user_id and v.profile_revision=p.revision) as verified from expert_offer_profiles p where p.user_id=${row.userId}::uuid order by p.revision desc limit 1`,
        )
      ).rows[0];
      return {
        ...row,
        contact,
        profile: profile ?? null,
        questionnaire: {
          status: "waiting_content" as const,
          contentSlot: "TODO: Wait for Content Spec" as const,
        },
      };
    });
  }
  async decide(raw: ExpertVerificationDecisionCommand) {
    const input = { ...raw };
    if (
      !uuid.test(input.applicationId) ||
      (input.decision !== "approved" && input.decision !== "rejected") ||
      !/^[a-z][a-z0-9_]{0,63}$/u.test(input.reasonCode) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(input.idempotencyKey)
    )
      fail("verification_invalid_request");
    return this.transaction(async (tx) => {
      const managerId = await this.manager(tx, input.sessionHash);
      // Manager-key lock closes reuse across two applications as well as duplicate decisions.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`verification-manager:${managerId}:${input.idempotencyKey}`},0))`,
      );
      const initial = (
        await tx.execute<{ userId: string }>(
          sql`select user_id as "userId" from expert_onboarding_applications where id=${input.applicationId}::uuid`,
        )
      ).rows[0];
      if (!initial) fail("verification_application_unavailable");
      await lockClientConsentSubject(tx, initial!.userId);
      const application = (
        await tx.execute<{ userId: string; status: string }>(
          sql`select a.user_id as "userId",a.verification_status as status from expert_onboarding_applications a join users u on u.id=a.user_id and u.active=true where a.id=${input.applicationId}::uuid for update of a`,
        )
      ).rows[0];
      if (!application || !(await this.currentConsent(tx, initial!.userId)))
        fail("verification_application_unavailable");
      await this.manager(tx, input.sessionHash);
      const previous = (
        await tx.execute<{
          applicationId: string;
          decision: string;
          reasonCode: string;
          managerId: string;
          idempotencyKey: string;
          invoiceId: string | null;
        }>(
          sql`select d.application_audit_id as "applicationId",d.decision,d.reason_code as "reasonCode",d.manager_id as "managerId",d.idempotency_key as "idempotencyKey",i.id as "invoiceId" from expert_verification_decisions d left join expert_onboarding_invoices i on i.decision_id=d.id where d.application_audit_id=${input.applicationId}::uuid or (d.manager_id=${managerId}::uuid and d.idempotency_key=${input.idempotencyKey}) order by d.id`,
        )
      ).rows;
      if (previous.length) {
        const prior = previous[0]!;
        if (
          previous.length !== 1 ||
          prior.applicationId !== input.applicationId ||
          prior.decision !== input.decision ||
          prior.reasonCode !== input.reasonCode ||
          prior.managerId !== managerId ||
          prior.idempotencyKey !== input.idempotencyKey
        )
          fail("verification_idempotency_conflict");
        return {
          applicationId: input.applicationId,
          decision: input.decision,
          invoiceId: prior.invoiceId,
          replay: true,
        };
      }
      if (application!.status !== "pending")
        fail("verification_application_unavailable");
      const decision = (
        await tx.execute<{ id: string }>(
          sql`insert into expert_verification_decisions(application_id,application_audit_id,user_id,manager_id,manager_session_hash,decision,reason_code,idempotency_key) values(${input.applicationId}::uuid,${input.applicationId}::uuid,${application!.userId}::uuid,${managerId}::uuid,${input.sessionHash},${input.decision},${input.reasonCode},${input.idempotencyKey}) returning id`,
        )
      ).rows[0]!;
      let invoiceId: string | null = null;
      if (input.decision === "approved") {
        const invoice = (
          await tx.execute<{ id: string }>(
            sql`insert into expert_onboarding_invoices(application_id,application_audit_id,user_id,decision_id,provider_mode) values(${input.applicationId}::uuid,${input.applicationId}::uuid,${application!.userId}::uuid,${decision.id}::uuid,${this.policy.providerMode}) returning id`,
          )
        ).rows[0]!;
        invoiceId = invoice.id;
        await tx.execute(
          sql`insert into expert_onboarding_payment_operations(invoice_id,application_audit_id,user_id,provider_mode) values(${invoice.id}::uuid,${input.applicationId}::uuid,${application!.userId}::uuid,${this.policy.providerMode})`,
        );
      }
      await tx.execute(
        sql`update expert_onboarding_applications set verification_status=${input.decision},updated_at=clock_timestamp() where id=${input.applicationId}::uuid`,
      );
      await tx.execute(
        sql`update expert_promo_manager_work set status='completed' where application_id=${input.applicationId}::uuid`,
      );
      await tx.execute(
        sql`insert into expert_verification_work(application_id,user_id,kind,reason_code) values(${input.applicationId}::uuid,${application!.userId}::uuid,${input.decision === "approved" ? "onboarding_invoice" : "verification_rejected"},${input.reasonCode})`,
      );
      await this.audit(tx, {
        actorId: managerId,
        sessionHash: input.sessionHash,
        action: `expert_verification.${input.decision}`,
        objectId: input.applicationId,
        reasonCode: input.reasonCode,
        metadata: `${decision.id}:${invoiceId ?? "none"}`,
      });
      return {
        applicationId: input.applicationId,
        decision: input.decision,
        invoiceId,
        replay: false,
      };
    });
  }
  private async audit(
    tx: Tx,
    input: {
      actorId: string;
      sessionHash: string;
      action: string;
      objectId: string;
      reasonCode: string;
      metadata: string;
    },
  ) {
    await tx.execute(
      sql`insert into audit_events(actor_type,actor_id,authenticated_session_id_hash,action,object_type,object_id,decision,reason_code,correlation_id,occurred_at,metadata_hash) values('admin',${input.actorId}::uuid,${input.sessionHash},${input.action},'expert_onboarding_application',${input.objectId}::uuid,'applied',${input.reasonCode},${`verification:${digest(input.metadata)}`},clock_timestamp(),${digest(input.metadata)})`,
    );
  }
  async invoiceForOwner(
    scope: ExpertPromoScope,
    invoiceId: string,
  ): Promise<OnboardingInvoice | null> {
    if (!uuid.test(invoiceId)) return null;
    const input = { ...scope };
    return this.transaction(async (tx) => {
      const userId = await this.owner(tx, input);
      if (!userId) return null;
      return (
        (
          await tx.execute<OnboardingInvoice & Record<string, unknown>>(
            sql`select i.id,i.application_audit_id as "applicationId",i.user_id as "userId",i.purpose,i.amount_minor::text as "amountMinor",i.currency,i.provider_mode as mode,i.status,o.id as "operationId",o.status as "operationStatus",o.provider_object_id as "providerObjectId" from expert_onboarding_invoices i join expert_onboarding_payment_operations o on o.invoice_id=i.id join expert_onboarding_applications a on a.id=i.application_id and a.user_id=i.user_id where i.id=${invoiceId}::uuid and i.user_id=${userId}::uuid and a.verification_status='approved'`,
          )
        ).rows[0] ?? null
      );
    });
  }
  async invoiceForManager(
    sessionHash: string,
    invoiceId: string,
  ): Promise<OnboardingInvoice | null> {
    if (!uuid.test(invoiceId)) return null;
    return this.transaction(async (tx) => {
      await this.manager(tx, sessionHash);
      const initial = (
        await tx.execute<{ userId: string }>(
          sql`select user_id as "userId" from expert_onboarding_invoices where id=${invoiceId}::uuid`,
        )
      ).rows[0];
      if (!initial) return null;
      await lockClientConsentSubject(tx, initial.userId);
      await this.manager(tx, sessionHash);
      if (!(await this.currentConsent(tx, initial.userId))) return null;
      return (
        (
          await tx.execute<OnboardingInvoice & Record<string, unknown>>(
            sql`select i.id,i.application_audit_id as "applicationId",i.user_id as "userId",i.purpose,i.amount_minor::text as "amountMinor",i.currency,i.provider_mode as mode,i.status,o.id as "operationId",o.status as "operationStatus",o.provider_object_id as "providerObjectId" from expert_onboarding_invoices i join expert_onboarding_payment_operations o on o.invoice_id=i.id join expert_onboarding_applications a on a.id=i.application_id and a.user_id=i.user_id join users u on u.id=i.user_id and u.active=true where i.id=${invoiceId}::uuid and a.verification_status='approved'`,
          )
        ).rows[0] ?? null
      );
    });
  }
  async bindPayment(
    invoiceId: string,
    raw: {
      id: string;
      providerObjectId: string;
      userId: string;
      purpose: "onboarding";
      amountMinor: "300000";
      currency: "RUB";
      mode: "test" | "live";
    },
  ) {
    const operation = { ...raw };
    if (
      !uuid.test(invoiceId) ||
      !uuid.test(operation.id) ||
      !uuid.test(operation.userId) ||
      !/^[A-Za-z0-9_-]{1,64}$/u.test(operation.providerObjectId)
    )
      fail("verification_payment_binding_mismatch");
    return this.transaction(async (tx) => {
      const initial = (
        await tx.execute<{ userId: string }>(
          sql`select user_id as "userId" from expert_onboarding_invoices where id=${invoiceId}::uuid`,
        )
      ).rows[0];
      if (!initial) fail("verification_payment_binding_mismatch");
      await lockClientConsentSubject(tx, initial!.userId);
      const stored = (
        await tx.execute<{
          userId: string;
          purpose: string;
          amountMinor: string;
          currency: string;
          mode: string;
          status: string;
          operationId: string;
          providerObjectId: string | null;
        }>(
          sql`select i.user_id as "userId",i.purpose,i.amount_minor::text as "amountMinor",i.currency,i.provider_mode as mode,i.status,o.id as "operationId",o.provider_object_id as "providerObjectId" from expert_onboarding_invoices i join expert_onboarding_payment_operations o on o.invoice_id=i.id where i.id=${invoiceId}::uuid for update of i,o`,
        )
      ).rows[0];
      if (
        !stored ||
        stored.operationId !== operation.id ||
        stored.userId !== operation.userId ||
        stored.purpose !== operation.purpose ||
        stored.amountMinor !== operation.amountMinor ||
        stored.currency !== operation.currency ||
        stored.mode !== operation.mode ||
        (stored.providerObjectId !== null &&
          stored.providerObjectId !== operation.providerObjectId)
      )
        fail("verification_payment_binding_mismatch");
      await tx.execute(
        sql`update expert_onboarding_payment_operations set provider_object_id=${operation.providerObjectId},status=case when status in ('cancelled','succeeded') then status else 'pending' end where id=${operation.id}::uuid`,
      );
      return { invoiceId, operationId: operation.id };
    });
  }
  async markPaymentUnknown(invoiceId: string, operationId: string) {
    if (!uuid.test(invoiceId) || !uuid.test(operationId))
      fail("verification_invalid_request");
    await this.transaction(async (tx) => {
      await tx.execute(
        sql`update expert_onboarding_payment_operations set status='unknown_outcome' where id=${operationId}::uuid and invoice_id=${invoiceId}::uuid and status in ('created','pending','unknown_outcome')`,
      );
    });
  }
  async findOnboardingPaymentBinding(
    invoiceId: string,
  ): Promise<OnboardingPaymentBinding | null> {
    if (!uuid.test(invoiceId)) return null;
    return this.transaction(
      async (tx) =>
        (
          await tx.execute<OnboardingPaymentBinding & Record<string, unknown>>(
            sql`select i.id as "invoiceId",i.application_audit_id as "applicationId",i.user_id as "userId",i.purpose,o.id as "operationId",o.provider_object_id as "providerObjectId",i.amount_minor::text as "amountMinor",i.currency,i.provider_mode as mode from expert_onboarding_invoices i join expert_onboarding_payment_operations o on o.invoice_id=i.id where i.id=${invoiceId}::uuid and o.provider_object_id is not null`,
          )
        ).rows[0] ?? null,
    );
  }
  async findOnboardingInvoiceByProviderObjectId(
    paymentId: string,
  ): Promise<string | null> {
    if (
      typeof paymentId !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/u.test(paymentId)
    )
      return null;
    return this.transaction(
      async (tx) =>
        (
          await tx.execute<{ id: string }>(
            sql`select invoice_id as id from expert_onboarding_payment_operations where provider_object_id=${paymentId}`,
          )
        ).rows[0]?.id ?? null,
    );
  }
  async settleVerified(value: VerifiedOnboardingPayment) {
    assertVerifiedOnboardingPayment(value);
    const proof = { ...value };
    return this.transaction(async (tx) => {
      await lockClientConsentSubject(tx, proof.userId);
      const stored = (
        await tx.execute<{
          applicationId: string | null;
          applicationAuditId: string;
          userId: string;
          purpose: string;
          amountMinor: string;
          currency: string;
          mode: string;
          operationId: string;
          providerObjectId: string | null;
        }>(
          sql`select i.application_id as "applicationId",i.application_audit_id as "applicationAuditId",i.user_id as "userId",i.purpose,i.amount_minor::text as "amountMinor",i.currency,i.provider_mode as mode,o.id as "operationId",o.provider_object_id as "providerObjectId" from expert_onboarding_invoices i join expert_onboarding_payment_operations o on o.invoice_id=i.id where i.id=${proof.invoiceId}::uuid for update of i,o`,
        )
      ).rows[0];
      if (!stored) return fail("verification_payment_binding_mismatch");
      if (
        stored.applicationAuditId !== proof.applicationId ||
        stored.userId !== proof.userId ||
        stored.purpose !== proof.purpose ||
        stored.amountMinor !== proof.amountMinor ||
        stored.currency !== proof.currency ||
        stored.mode !== proof.mode ||
        stored.operationId !== proof.operationId ||
        stored.providerObjectId !== proof.providerObjectId
      )
        fail("verification_payment_binding_mismatch");
      const validCapture = (
        await tx.execute<{ captureValid: boolean }>(
          sql`select isfinite(${proof.capturedAt}::timestamptz) and ${proof.capturedAt}::timestamptz>=created_at and ${proof.capturedAt}::timestamptz<=clock_timestamp() as "captureValid" from expert_onboarding_invoices where id=${proof.invoiceId}::uuid`,
        )
      ).rows[0]?.captureValid;
      if (validCapture !== true) fail("verification_payment_binding_mismatch");
      const paid = (
        await tx.execute<{ eventId: string; evidenceDigest: string }>(
          sql`select event_id as "eventId",evidence_digest as "evidenceDigest" from expert_onboarding_payment_facts where invoice_id=${proof.invoiceId}::uuid`,
        )
      ).rows[0];
      if (
        paid &&
        (paid.eventId !== proof.eventId ||
          paid.evidenceDigest !== proof.evidenceDigest)
      )
        fail("verification_payment_binding_mismatch");
      const user = (
        await tx.execute<{ active: boolean }>(
          sql`select active from users where id=${proof.userId}::uuid for share`,
        )
      ).rows[0];
      const app = stored.applicationId
        ? (
            await tx.execute<{ status: string; stage: string | null }>(
              sql`select verification_status as status,onboarding_stage as stage from expert_onboarding_applications where id=${stored.applicationId}::uuid and user_id=${proof.userId}::uuid for update`,
            )
          ).rows[0]
        : undefined;
      let reason:
        | "payment_verified"
        | "application_erased"
        | "owner_inactive"
        | "consent_unavailable"
        | "application_unavailable" = "payment_verified";
      if (!stored.applicationId) reason = "application_erased";
      else if (!user?.active) reason = "owner_inactive";
      else if (!app || app.status !== "approved")
        reason = "application_unavailable";
      else if (!(await this.currentConsent(tx, proof.userId)))
        reason = "consent_unavailable";
      if (!paid) {
        await tx.execute(
          sql`insert into expert_onboarding_payment_facts(invoice_id,operation_id,user_id,purpose,amount_minor,currency,provider_mode,provider_object_id,event_id,evidence_digest,captured_at,admission,reason_code) values(${proof.invoiceId}::uuid,${proof.operationId}::uuid,${proof.userId}::uuid,${proof.purpose},${proof.amountMinor}::bigint,${proof.currency},${proof.mode},${proof.providerObjectId},${proof.eventId},${proof.evidenceDigest},${proof.capturedAt}::timestamptz,${reason === "payment_verified" ? "interview" : "blocked"},${reason})`,
        );
        await tx.execute(
          sql`update expert_onboarding_invoices set status='settled' where id=${proof.invoiceId}::uuid`,
        );
        await tx.execute(
          sql`update expert_onboarding_payment_operations set status='succeeded' where id=${proof.operationId}::uuid`,
        );
        if (reason === "payment_verified") {
          if (!stored.applicationId)
            return fail("verification_application_unavailable");
          await enqueueApplicationMaterials(
            tx,
            stored.applicationId,
            proof.userId,
          );
          await tx.execute(
            sql`update expert_onboarding_applications set onboarding_stage='interview',updated_at=clock_timestamp() where id=${stored.applicationId}::uuid`,
          );
          await tx.execute(
            sql`insert into expert_verification_work(application_id,user_id,kind) values(${stored.applicationId}::uuid,${proof.userId}::uuid,'interview_ready') on conflict(application_id,kind) do nothing`,
          );
        }
        await tx.execute(
          sql`insert into audit_events(actor_type,actor_id,authenticated_session_id_hash,action,object_type,object_id,decision,reason_code,correlation_id,occurred_at,metadata_hash) values('system',${proof.userId}::uuid,${digest(proof.eventId)},'expert_onboarding.payment_verified','expert_onboarding_invoice',${proof.invoiceId}::uuid,'applied',${reason},${`onboarding:${digest(proof.eventId)}`},clock_timestamp(),${digest(proof.evidenceDigest)})`,
        );
      }
      return {
        invoiceId: proof.invoiceId,
        applicationId: proof.applicationId,
        settled: true as const,
        stage:
          reason === "payment_verified" && (!paid || app?.stage === "interview")
            ? ("interview" as const)
            : null,
        replay: !!paid,
      };
    });
  }
}
