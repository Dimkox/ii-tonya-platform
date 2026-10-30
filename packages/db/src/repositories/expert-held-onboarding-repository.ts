import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  YooKassaOnboardingPaymentVerifier,
  assertHeldPaymentObservation,
  type HeldOnboardingClient,
  type HeldPaymentObservation,
  type PayerReceiptBinding,
  type PayerReceiptVault,
  type YooKassaReplayProtector,
  type YooKassaReplayDecryptor,
  type YooKassaVatCode,
} from "@ii-tonya/integrations";
import type { DrizzleDb } from "../client.js";
import { lockExpertManagerAuthority } from "./expert-manager-authority.js";
import { lockClientConsentSubject } from "./client-consent-authority.js";
import { PostgresExpertVerificationRepository } from "./expert-verification-repository.js";
const hash = (v: string) =>
  `sha256:${createHash("sha256").update(v).digest("hex")}`;
type Tx = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];
type RequestRow = {
  id: string;
  kind: "create" | "capture" | "cancel";
  key: string;
  body: string | null;
  encrypted: string | null;
  keyReference: string | null;
  digest: string;
  status: string;
  paymentId: string | null;
  contactId: string | null;
};
/** Durable onboarding-specific custody. A dispatched operation is never blindly POSTed again. */
export class PostgresHeldOnboardingCheckout {
  // A Node callback can outlive its database transaction after connection loss.
  // Do not claim strict cancellation until transport and erasure share a proven fence.
  readonly strictFirstSendCancellation = false as const;
  private reconciliationCursor: string | null = null;
  constructor(
    private readonly db: DrizzleDb,
    private readonly deps: {
      enabled: boolean;
      client: HeldOnboardingClient;
      vault: PayerReceiptVault;
      protector: YooKassaReplayProtector;
      decryptor: YooKassaReplayDecryptor;
      repository: PostgresExpertVerificationRepository;
      returnUrl: string;
      vatCode: YooKassaVatCode;
      mode: "test" | "live";
    },
  ) {}
  private async frame(tx: Tx, invoiceId: string) {
    const initial = (
      await tx.execute<{ userId: string }>(
        sql`select user_id as "userId" from expert_onboarding_invoices where id=${invoiceId}::uuid and not exists(select 1 from public_expert_payment_requests public_request where public_request.invoice_id=expert_onboarding_invoices.id)`,
      )
    ).rows[0];
    if (!initial) throw new Error("held_invoice_unavailable");
    await lockClientConsentSubject(tx, initial.userId);
    return (
      await tx.execute<{
        userId: string;
        operationId: string;
        paymentId: string | null;
        quoteId: string;
        current: boolean;
        mode: string;
      }>(
        sql`select i.user_id as "userId",o.id as "operationId",o.provider_object_id as "paymentId",b.quote_id as "quoteId",i.provider_mode mode,(i.status='pending' and a.expires_at>clock_timestamp() and u.active and app.verification_status='approved' and expert_sales_form_valid(i.application_id,i.user_id) and expert_card_current_messaging_authority(i.user_id,base.consent_version) and not exists(select 1 from expert_sales_paid_locks where user_id=i.user_id)) as current from expert_onboarding_invoices i join expert_sales_fee_attempts a on a.invoice_id=i.id join expert_onboarding_payment_operations o on o.invoice_id=i.id left join expert_sales_form_bridges b on b.application_id=i.application_id left join expert_onboarding_applications app on app.id=i.application_id join expert_sales_selections s on s.id=a.selection_id join expert_sales_bases base on base.id=s.base_id join users u on u.id=i.user_id where i.id=${invoiceId}::uuid for update of i,o`,
      )
    ).rows[0];
  }
  private async request(
    invoiceId: string,
    kind: RequestRow["kind"],
  ): Promise<RequestRow | undefined> {
    return (
      await this.db.execute<RequestRow>(
        sql`select id,kind,idempotency_key::text key,request_body body,encrypted_body encrypted,key_reference as "keyReference",request_digest digest,status,provider_object_id as "paymentId",contact_id as "contactId" from expert_sales_provider_requests where invoice_id=${invoiceId}::uuid and kind=${kind}`,
      )
    ).rows[0];
  }
  private async prepare(invoiceId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const frame = await this.frame(tx, invoiceId);
      if (!frame?.current || frame.mode !== this.deps.mode)
        throw new Error("held_invoice_unavailable");
      if (
        (
          await tx.execute(
            sql`select 1 from expert_sales_provider_requests where invoice_id=${invoiceId}::uuid and kind='create'`,
          )
        ).rows.length
      )
        return;
      const contact = (
        await tx.execute<
          PayerReceiptBinding & { keyId: string; ciphertext: string }
        >(
          sql`select id,quote_id as "quoteId",user_id as "userId",kind,basis,captured_at as "capturedAt",expires_at as "expiresAt",key_id as "keyId",ciphertext from payer_receipt_contacts where user_id=${frame.userId}::uuid and quote_id=${frame.quoteId}::uuid and redacted_at is null and expires_at>clock_timestamp() order by captured_at desc limit 1 for share`,
        )
      ).rows[0];
      if (!contact) throw new Error("held_receipt_required");
      const binding: PayerReceiptBinding = {
        id: contact.id,
        quoteId: contact.quoteId,
        userId: contact.userId,
        kind: contact.kind,
        basis: contact.basis,
        capturedAt: new Date(contact.capturedAt).toISOString(),
        expiresAt: new Date(contact.expiresAt).toISOString(),
      };
      const email = this.deps.vault.open(
        { keyId: contact.keyId, ciphertext: contact.ciphertext },
        binding,
      );
      const body = JSON.stringify({
        amount: { value: "3000.00", currency: "RUB" },
        capture: false,
        payment_method_data: { type: "bank_card" },
        confirmation: { type: "redirect", return_url: this.deps.returnUrl },
        description: "Онбординг резидента",
        metadata: {
          order_id: invoiceId,
          operation_id: frame.operationId,
          user_id: frame.userId,
          purpose: "onboarding",
        },
        receipt: {
          customer: { email },
          items: [
            {
              description: "Онбординг резидента",
              quantity: "1.00",
              amount: { value: "3000.00", currency: "RUB" },
              vat_code: this.deps.vatCode,
              payment_subject: "service",
              payment_mode: "full_payment",
            },
          ],
        },
      });
      const id = randomUUID(),
        digest = hash(body);
      const protectedBody = await this.deps.protector.protect({
        body,
        bodyVersion: 1,
        associatedData: {
          operationId: id,
          operationKind: "create_payment",
          idempotencyKey: id,
          requestDigest: digest,
          bodyVersion: 1,
        },
      });
      if (
        protectedBody.bodyVersion !== 1 ||
        !protectedBody.ciphertext ||
        !protectedBody.keyReference ||
        !Number.isFinite(Date.parse(protectedBody.expiresAt)) ||
        Date.parse(protectedBody.expiresAt) <= Date.now()
      )
        throw new Error("held_body_unavailable");
      await tx.execute(
        sql`insert into expert_sales_provider_requests(id,invoice_id,kind,idempotency_key,encrypted_body,key_reference,request_digest,contact_id,body_expires_at) values(${id}::uuid,${invoiceId}::uuid,'create',${id}::uuid,${protectedBody.ciphertext},${protectedBody.keyReference},${digest},${contact.id}::uuid,${protectedBody.expiresAt}::timestamptz)`,
      );
    });
  }
  private async dispatch(invoiceId: string, operation: RequestRow) {
    // Preserve GET reconciliation and capture/cancel of existing payments, but
    // never disclose a new receipt contact without the cancellation fence.
    if (operation.kind === "create") return null;
    // Commit the uncertainty marker BEFORE a possible network send. A crash requires GET recovery.
    const claimed =
      (
        await this.db.execute(
          sql`update expert_sales_provider_requests set status='dispatched',dispatched_at=clock_timestamp() where id=${operation.id}::uuid and status='prepared' returning id`,
        )
      ).rows.length === 1;
    if (!claimed) return null;
    const body = operation.body;
    if (body === null || hash(body) !== operation.digest)
      throw new Error("held_body_unavailable");
    const observation = await this.deps.client.inspect(operation.paymentId!);
    const exactBody = body;
    return this.db.transaction(async (tx) => {
      const frame = await this.frame(tx, invoiceId);
      if (
        !frame ||
        (operation.kind !== "cancel" && !frame.current) ||
        frame.mode !== this.deps.mode
      ) {
        await tx.execute(
          sql`update expert_sales_provider_requests set status='cancelled',encrypted_body=null,key_reference=null where id=${operation.id}::uuid`,
        );
        return null;
      }
      if (observation) {
        this.binding(observation, invoiceId, frame.operationId, frame.userId);
        if (observation.status !== "waiting_for_capture") return null;
      }
      if (
        operation.kind !== "cancel" &&
        !(await this.frame(tx, invoiceId))?.current
      )
        return null;
      // No asynchronous preparation remains between the final authority check and
      // actual transport invocation. The lock covers only the begun bounded send.
      const response = await this.deps.client.postExact({
        kind: operation.kind,
        idempotencyKey: operation.key,
        body: exactBody,
        ...(operation.paymentId ? { paymentId: operation.paymentId } : {}),
      });
      await tx.execute(
        sql`update expert_sales_provider_requests set provider_object_id=${response.id},status='observed' where id=${operation.id}::uuid`,
      );
      await tx.execute(
        sql`update expert_onboarding_payment_operations set provider_object_id=${response.id},status=case when status='succeeded' then status else 'pending' end where id=${frame.operationId}::uuid`,
      );
      return response;
    });
  }

  private binding(
    observation: HeldPaymentObservation,
    invoiceId: string,
    operationId: string,
    userId: string,
  ) {
    assertHeldPaymentObservation(observation);
    if (
      observation.metadata.order_id !== invoiceId ||
      observation.metadata.operation_id !== operationId ||
      observation.metadata.user_id !== userId ||
      observation.metadata.purpose !== "onboarding" ||
      observation.test !== (this.deps.mode === "test")
    )
      throw new Error("held_binding_mismatch");
  }
  async recoverProviderObject(
    sessionHash: string,
    invoiceId: string,
    paymentId: string,
    requestKey: string,
  ) {
    if (
      !this.deps.enabled ||
      !/^[A-Za-z0-9_-]{1,64}$/u.test(paymentId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(requestKey)
    )
      throw Error("held_recovery_invalid");
    const initial = await this.db.transaction(async (tx) => {
      await lockExpertManagerAuthority(tx, sessionHash);
      return this.frame(tx, invoiceId);
    });
    if (!initial) throw Error("held_invoice_unavailable");
    const observation = await this.deps.client.inspect(paymentId);
    this.binding(observation, invoiceId, initial.operationId, initial.userId);
    await this.db.transaction(async (tx) => {
      const manager = await lockExpertManagerAuthority(tx, sessionHash),
        frame = await this.frame(tx, invoiceId);
      if (
        !frame ||
        frame.operationId !== initial.operationId ||
        frame.userId !== initial.userId ||
        (frame.paymentId && frame.paymentId !== paymentId)
      )
        throw Error("held_binding_mismatch");
      const prior = (
        await tx.execute<{ invoice: string; payment: string }>(
          sql`select invoice_id invoice,provider_object_id payment from expert_sales_operator_recoveries where manager_id=${manager}::uuid and request_key=${requestKey}`,
        )
      ).rows[0];
      if (prior) {
        if (prior.invoice !== invoiceId || prior.payment !== paymentId)
          throw Error("held_recovery_conflict");
        return;
      }
      await tx.execute(
        sql`insert into expert_sales_provider_observations(invoice_id,provider_object_id,status,evidence_digest) values(${invoiceId}::uuid,${paymentId},${observation.status},${observation.evidenceDigest})`,
      );
      await tx.execute(
        sql`insert into expert_sales_operator_recoveries(invoice_id,user_id,manager_id,session_hash,request_key,provider_object_id,observed_status,evidence_digest) values(${invoiceId}::uuid,${frame.userId}::uuid,${manager}::uuid,${sessionHash},${requestKey},${paymentId},${observation.status},${observation.evidenceDigest})`,
      );
      await tx.execute(
        sql`update expert_onboarding_payment_operations set provider_object_id=${paymentId} where id=${frame.operationId}::uuid and (provider_object_id is null or provider_object_id=${paymentId})`,
      );
    });
    return this.reconcile(invoiceId);
  }
  async reconcile(invoiceId: string) {
    if (!this.deps.enabled) return { kind: "unavailable" as const };
    const frame = await this.db.transaction((tx) => this.frame(tx, invoiceId));
    if (!frame) return { kind: "unavailable" as const };
    const id = frame.paymentId;
    if (!id) return { kind: "pending" as const };
    const observation = await this.deps.client.inspect(id);
    this.binding(observation, invoiceId, frame.operationId, frame.userId);
    await this.deps.repository.bindPayment(invoiceId, {
      id: frame.operationId,
      providerObjectId: id,
      userId: frame.userId,
      purpose: "onboarding",
      amountMinor: "300000",
      currency: "RUB",
      mode: this.deps.mode,
    });
    await this.db.transaction(async (tx) => {
      const current = await this.frame(tx, invoiceId);
      await tx.execute(
        sql`insert into expert_sales_provider_observations(invoice_id,provider_object_id,status,evidence_digest) values(${invoiceId}::uuid,${id},${observation.status},${observation.evidenceDigest}) on conflict do nothing`,
      );
      await tx.execute(
        sql`update expert_sales_provider_requests set status=case when kind='capture' and ${observation.status}='canceled' then 'cancelled' else 'observed' end,provider_object_id=${id} where invoice_id=${invoiceId}::uuid and status='dispatched' and (kind='create' or (kind='capture' and ${observation.status} in('succeeded','canceled')) or (kind='cancel' and ${observation.status}='canceled'))`,
      );
      if (observation.status === "waiting_for_capture") {
        const kind = current?.current ? "capture" : "cancel",
          key = randomUUID();
        const body =
          kind === "capture"
            ? '{"amount":{"value":"3000.00","currency":"RUB"}}'
            : "{}";
        await tx.execute(
          sql`insert into expert_sales_provider_requests(invoice_id,kind,idempotency_key,request_body,request_digest,provider_object_id) values(${invoiceId}::uuid,${kind},${key}::uuid,${body},${hash(body)},${id}) on conflict(invoice_id,kind) do nothing`,
        );
      }
    });
    if (observation.status === "waiting_for_capture") {
      const current = await this.db.transaction((tx) =>
        this.frame(tx, invoiceId),
      );
      const op = await this.request(
        invoiceId,
        current?.current ? "capture" : "cancel",
      );
      if (op?.status === "prepared") await this.dispatch(invoiceId, op);
    }
    if (observation.status === "succeeded") {
      const verifier = new YooKassaOnboardingPaymentVerifier(
        {
          getPayment: async (requested) => {
            if (requested !== observation.id)
              throw new Error("held_binding_mismatch");
            return observation;
          },
        },
        this.deps.repository,
      );
      const proof = await verifier.verify(invoiceId);
      if (proof) await this.deps.repository.settleVerified(proof);
    }
    if (observation.status === "canceled")
      await this.db.transaction(async (tx) => {
        await this.frame(tx, invoiceId);
        await tx.execute(
          sql`update expert_onboarding_invoices set status='cancelled' where id=${invoiceId}::uuid and status='pending'`,
        );
        await tx.execute(
          sql`update expert_onboarding_payment_operations set status='cancelled' where invoice_id=${invoiceId}::uuid and status not in('succeeded','cancelled')`,
        );
      });
    return { kind: "observed" as const, status: observation.status };
  }
  async reconcileKnown(limit = 20) {
    if (!this.deps.enabled) return { examined: 0 };
    const rows = (
      await this.db.execute<{ id: string }>(
        sql`select i.id from expert_onboarding_invoices i join expert_sales_fee_attempts a on a.invoice_id=i.id join expert_onboarding_payment_operations o on o.invoice_id=i.id where not exists(select 1 from public_expert_payment_requests public_request where public_request.invoice_id=i.id) and o.provider_object_id is not null and not exists(select 1 from expert_onboarding_payment_facts f where f.invoice_id=i.id) and not exists(select 1 from expert_sales_provider_observations observed where observed.invoice_id=i.id and observed.status='canceled') and (${this.reconciliationCursor}::uuid is null or i.id>${this.reconciliationCursor}::uuid) order by i.id limit ${Math.min(50, Math.max(1, limit))}`,
      )
    ).rows;
    this.reconciliationCursor = rows.length ? rows[rows.length - 1]!.id : null;
    for (const row of rows) {
      try {
        await this.reconcile(row.id);
      } catch {
        /* Keep uncertain objects for subsequent authoritative GET. */
      }
    }
    return { examined: rows.length };
  }
  async recoverCheckout(input: {
    invoiceId: string;
    operationId: string;
  }): Promise<
    | { kind: "ready"; url: string; paymentId: string }
    | { kind: "pending" | "unavailable" }
  > {
    if (!this.deps.enabled) return { kind: "unavailable" };
    const frame = await this.db.transaction((tx) =>
      this.frame(tx, input.invoiceId),
    );
    if (
      !frame?.current ||
      frame.mode !== this.deps.mode ||
      frame.operationId !== input.operationId
    )
      return { kind: "unavailable" };
    // Existing provider objects can be recovered through authoritative GET;
    // an unbound invoice must not trigger first disclosure in either mode.
    if (!frame.paymentId) return { kind: "unavailable" };
    const existing = await this.deps.client.inspect(frame.paymentId);
    this.binding(existing, input.invoiceId, frame.operationId, frame.userId);
    if (existing.status !== "pending") {
      await this.reconcile(input.invoiceId);
      return { kind: "pending" };
    }
    return existing.confirmation
      ? {
          kind: "ready",
          url: existing.confirmation.url,
          paymentId: existing.id,
        }
      : { kind: "pending" };
  }

  async createCheckout(input: { invoiceId: string }) {
    const frame = await this.db.transaction((tx) =>
      this.frame(tx, input.invoiceId),
    );
    if (!frame) throw new Error("held_invoice_unavailable");
    const result = await this.recoverCheckout({
      invoiceId: input.invoiceId,
      operationId: frame.operationId,
    });
    if (result.kind !== "ready") throw new Error("held_checkout_unavailable");
    return { url: result.url, paymentId: result.paymentId };
  }
}
