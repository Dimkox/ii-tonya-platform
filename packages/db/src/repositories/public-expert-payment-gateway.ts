import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  assertPublicExpertFreshObservation,
  publicExpertPaymentSourceSchema,
  publicExpertPaymentSnapshotSchema,
  publicExpertPrepareDescriptorSchema,
  publicExpertApplyActionSchema,
  type PublicExpertPaymentSourceData,
  type PublicExpertPaymentSnapshot,
  type PublicExpertPrepareDescriptor,
  type PublicExpertFreshObservation,
  type PublicExpertGatewayTransport,
  type PublicExpertRecovery,
  type PublicExpertRecoveryResult,
  type PayerReceiptVault,
  type YooKassaReplayProtector,
  type YooKassaReplayDecryptor,
  type YooKassaVatCode,
} from "@ii-tonya/integrations";
import type { DrizzleDb } from "../client.js";
import type { PostgresExpertResidencyProviderInboxRepository } from "./expert-residency-provider-inbox-repository.js";
import type { PostgresExpertVerificationRepository } from "./expert-verification-repository.js";
type Connection = Pick<DrizzleDb, "execute">;
type Product = "onboarding" | "main" | "refund";
const digest = (s: string) =>
  `sha256:${createHash("sha256").update(s).digest("hex")}`;
async function call(
  connection: Connection,
  name: string,
  args: ReturnType<typeof sql>[],
) {
  const result = await connection.execute<{ value: unknown }>(
    sql`select ${sql.identifier("early_bird_private")}.${sql.identifier(name)}(${sql.join(args, sql`,`)}) value`,
  );
  return result.rows[0]?.value ?? null;
}
const snap = (value: unknown) =>
  value === null ? null : publicExpertPaymentSnapshotSchema.parse(value);
/** Each connection is the dedicated product LOGIN; no table reads or provider fact grants. */
export class PostgresPublicExpertPaymentSource {
  constructor(
    private readonly connections: Readonly<Record<Product, Connection>>,
  ) {}
  async source(
    product: Product,
    userId: string,
    sourceId: string,
  ): Promise<PublicExpertPaymentSourceData | null> {
    const value = await call(
      this.connections[product],
      `public_${product}_source`,
      [sql`${userId}::uuid`, sql`${sourceId}::uuid`],
    );
    return value === null ? null : publicExpertPaymentSourceSchema.parse(value);
  }
  async invoice(
    invoiceId: string,
  ): Promise<PublicExpertPaymentSourceData | null> {
    const value = await call(
      this.connections.onboarding,
      "public_onboarding_invoice",
      [sql`${invoiceId}::uuid`],
    );
    return value === null ? null : publicExpertPaymentSourceSchema.parse(value);
  }
  async pending(
    limit: number,
    after: string | null,
  ): Promise<readonly string[]> {
    const value = await call(
      this.connections.onboarding,
      "public_onboarding_pending",
      [sql`${Math.min(50, Math.max(1, limit))}::integer`, sql`${after}::uuid`],
    );
    if (!Array.isArray(value) || !value.every((id) => typeof id === "string"))
      throw Error("public_source_invalid");
    return value as string[];
  }
  async prepare(
    product: Product,
    userId: string,
    sourceId: string,
    contactId: string | null,
    descriptor: PublicExpertPrepareDescriptor,
  ) {
    const d = publicExpertPrepareDescriptorSchema.parse(descriptor);
    return snap(
      await call(this.connections[product], `public_${product}_prepare`, [
        sql`${userId}::uuid`,
        sql`${sourceId}::uuid`,
        sql`${contactId}::uuid`,
        sql`${JSON.stringify(d)}::jsonb`,
      ]),
    );
  }
  async admit(s: PublicExpertPaymentSnapshot) {
    return snap(
      await call(this.connections[s.product], `public_${s.product}_admit`, [
        sql`${s.userId}::uuid`,
        sql`${s.requestId}::uuid`,
        sql`${s.requestDigest}`,
      ]),
    );
  }
}
/** Isolated binder connection. Only the fresh-GET verifier can supply binding facts. */
export class PostgresPublicExpertPaymentBinder {
  constructor(private readonly db: Connection) {}
  async candidate(requestId: string) {
    return snap(
      await call(this.db, "public_payment_candidate", [
        sql`${requestId}::uuid`,
      ]),
    );
  }
  async bound(requestId: string) {
    return snap(
      await call(this.db, "public_payment_bound", [sql`${requestId}::uuid`]),
    );
  }
  async bind(requestId: string, fact: PublicExpertFreshObservation) {
    assertPublicExpertFreshObservation(fact);
    if (fact.requestId !== requestId) throw Error("public_binding_mismatch");
    return snap(
      await call(this.db, "public_payment_bind", [
        sql`${requestId}::uuid`,
        sql`${fact.providerObjectId}`,
        sql`${JSON.stringify({ version: 1, complete: true, exactCandidates: 1, observation: fact })}::jsonb`,
      ]),
    );
  }
}
/** Isolated fact writer; it cannot dispatch or post the canonical ledger. */
export class PostgresPublicExpertPaymentObservations {
  constructor(private readonly db: Connection) {}
  async observe(fact: PublicExpertFreshObservation): Promise<string | null> {
    assertPublicExpertFreshObservation(fact);
    const id = await call(this.db, "public_payment_observe", [
      sql`${fact.requestId}::uuid`,
      sql`${fact.providerObjectId}`,
      sql`${JSON.stringify(fact)}::jsonb`,
    ]);
    if (id !== null && typeof id !== "string")
      throw Error("public_observation_invalid");
    return id;
  }
  private async action(name: string, requestId: string, id: string) {
    const value = await call(this.db, name, [
      sql`${requestId}::uuid`,
      sql`${id}::uuid`,
    ]);
    return value === null ? null : publicExpertApplyActionSchema.parse(value);
  }
  resolve(requestId: string, observationId: string) {
    return this.action("public_payment_resolve", requestId, observationId);
  }
  expire(requestId: string, observationId: string) {
    return this.action("public_payment_expire", requestId, observationId);
  }
  complete(requestId: string, applyAttemptId: string) {
    return this.action("public_payment_complete", requestId, applyAttemptId);
  }
}
/** Trusted internal runner. Stored identifiers are the only canonical posting inputs.
 * Completion uses a separate committed transaction and repairs a lost acknowledgement. */
export class PostgresPublicExpertPaymentPosting {
  constructor(
    private readonly observations: PostgresPublicExpertPaymentObservations,
    private readonly residency: Pick<
      PostgresExpertResidencyProviderInboxRepository,
      "applyPublic"
    >,
    private readonly onboarding: Pick<
      PostgresExpertVerificationRepository,
      "applyPublic"
    >,
  ) {}
  async apply(requestId: string, observationId: string) {
    const action = await this.observations.resolve(requestId, observationId);
    if (
      !action ||
      action.kind !== "ready_to_apply" ||
      !action.applyAttemptId ||
      !action.evidence
    )
      return action;
    // A prior posting may have committed before completion, including one with
    // reservation release entries. Inspect actual facts before retrying any posting.
    const repaired = await this.observations.complete(
      requestId,
      action.applyAttemptId,
    );
    if (
      repaired?.kind === "already_applied" ||
      repaired?.kind === "manual_reconciliation"
    )
      return repaired;
    const poster =
      action.evidence.snapshot.product === "onboarding"
        ? this.onboarding
        : this.residency;
    await poster.applyPublic(requestId, observationId, action.applyAttemptId);
    return this.observations.complete(requestId, action.applyAttemptId);
  }
}
export interface PublicExpertCheckoutDependencies {
  readonly enabled: boolean;
  readonly mode: "test" | "live";
  readonly source: PostgresPublicExpertPaymentSource;
  readonly vault: PayerReceiptVault;
  readonly protector: YooKassaReplayProtector;
  readonly decryptor: YooKassaReplayDecryptor;
  readonly transport: Pick<PublicExpertGatewayTransport, "dispatch">;
  readonly recovery: Pick<PublicExpertRecovery, "recover">;
  readonly returnUrl: string;
  readonly vatCode: YooKassaVatCode;
}
const replayData = (
  s: Pick<
    PublicExpertPaymentSnapshot,
    "requestId" | "product" | "idempotencyKey" | "requestDigest"
  >,
) => ({
  operationId: s.requestId,
  operationKind:
    s.product === "refund"
      ? ("create_refund" as const)
      : ("create_payment" as const),
  idempotencyKey: s.idempotencyKey,
  requestDigest: s.requestDigest,
  bodyVersion: 1,
});
export function buildPublicExpertPaymentRequest(
  s: PublicExpertPaymentSourceData,
  kind: PublicExpertPrepareDescriptor["kind"],
  operationId: string,
  email: string | undefined,
  returnUrl: string,
  vatCode: YooKassaVatCode,
) {
  const amount = {
    value: `${BigInt(s.amountMinor) / 100n}.${(BigInt(s.amountMinor) % 100n).toString().padStart(2, "0")}`,
    currency: s.currency,
  };
  if (kind === "onboarding_capture") return JSON.stringify({ amount });
  if (kind === "onboarding_cancel") return "{}";
  const description =
    s.product === "onboarding" ? "Онбординг резидента" : "Резидентство";
  const identity = {
    purpose:
      s.product === "onboarding"
        ? "onboarding"
        : s.product === "main"
          ? "main_residency"
          : "public_main_refund",
    operation_id: operationId,
    order_id: s.sourceId,
    user_id: s.userId,
  };
  const receipt = {
    customer: { email },
    items: [
      {
        description,
        quantity: "1.00",
        amount,
        vat_code: vatCode,
        payment_subject: "service",
        payment_mode: "full_payment",
      },
    ],
  };
  return JSON.stringify(
    s.product === "refund"
      ? { payment_id: s.parentPaymentId, amount, metadata: identity, receipt }
      : {
          amount,
          capture: s.product !== "onboarding",
          ...(s.product === "onboarding"
            ? { payment_method_data: { type: "bank_card" } }
            : {}),
          confirmation: { type: "redirect", return_url: returnUrl },
          description,
          metadata: identity,
          receipt,
        },
  );
}
class PublicCheckoutExecution {
  constructor(protected readonly deps: PublicExpertCheckoutDependencies) {
    const url = new URL(deps.returnUrl);
    if (url.protocol !== "https:" || url.username || url.password)
      throw Error("public_return_url_invalid");
  }
  protected async execute(
    s: PublicExpertPaymentSourceData,
    kind: PublicExpertPrepareDescriptor["kind"],
  ): Promise<PublicExpertRecoveryResult> {
    if (!this.deps.enabled || s.mode !== this.deps.mode)
      return { kind: "unavailable" };
    let existing = s.requests.find((r) => r.kind === kind);
    let exactBody: string | undefined;
    if (!existing) {
      const contactFree =
        kind === "onboarding_capture" || kind === "onboarding_cancel";
      if (!contactFree && !s.contact) return { kind: "unavailable" };
      const requestId = randomUUID(),
        idempotencyKey =
          s.product === "refund" ? s.idempotencyKey! : randomUUID(),
        operationId = s.product === "main" ? randomUUID() : s.operationId!;
      const email = contactFree
        ? undefined
        : this.deps.vault.open(
            { keyId: s.contact!.keyId, ciphertext: s.contact!.ciphertext },
            s.contact!.binding,
          );
      exactBody = buildPublicExpertPaymentRequest(
        s,
        kind,
        operationId,
        email,
        this.deps.returnUrl,
        this.deps.vatCode,
      );
      const requestDigest = digest(exactBody);
      // A refund consumes the exact pre-authorized command; it never rewrites its request identity.
      if (s.product === "refund" && requestDigest !== s.requestDigest)
        return { kind: "unavailable" };
      const protectedBody = contactFree
        ? null
        : await this.deps.protector.protect({
            body: exactBody,
            bodyVersion: 1,
            associatedData: replayData({
              requestId,
              product: s.product,
              idempotencyKey,
              requestDigest,
            }),
          });
      if (protectedBody && protectedBody.bodyVersion !== 1)
        throw Error("public_envelope_invalid");
      try {
        existing =
          (await this.deps.source.prepare(
            s.product,
            s.userId,
            s.product === "refund" ? s.operationId! : s.sourceId,
            contactFree ? null : s.contact!.binding.id,
            {
              requestId,
              idempotencyKey,
              kind,
              legacyDeliveryOperationId:
                s.product === "main" ? operationId : null,
              requestDigest,
              bodyVersion: 1,
              ciphertext: protectedBody?.ciphertext ?? null,
              keyReference: protectedBody?.keyReference ?? null,
              bodyExpiresAt: protectedBody?.expiresAt ?? null,
            },
          )) ?? undefined;
      } catch {
        // A concurrent winner may have prepared this same canonical source. Never send this loser's bytes.
        existing = undefined;
      }
      if (!existing) {
        const current = await this.deps.source.source(
          s.product,
          s.userId,
          s.product === "refund" ? s.operationId! : s.sourceId,
        );
        existing = current?.requests.find((r) => r.kind === kind);
        exactBody = undefined;
      }
    }
    if (!existing) return { kind: "unavailable" };
    if (existing.state === "prepared") {
      if (!exactBody) {
        if (kind === "onboarding_capture" || kind === "onboarding_cancel")
          exactBody = buildPublicExpertPaymentRequest(
            s,
            kind,
            existing.legacyOperationId,
            undefined,
            this.deps.returnUrl,
            this.deps.vatCode,
          );
        else {
          if (!existing.envelope) return { kind: "pending" };
          const opened = await this.deps.decryptor.decrypt({
            encryptedBody: existing.envelope.ciphertext,
            keyReference: existing.envelope.keyReference,
            associatedData: replayData(existing),
          });
          if (opened.bodyVersion !== 1) return { kind: "pending" };
          exactBody = opened.body;
        }
      }
      if (digest(exactBody) !== existing.requestDigest)
        return { kind: "pending" };
      // This function call commits before IPC. No source/invoice/consent lock spans the gateway claim.
      const admitted = await this.deps.source.admit(existing);
      if (admitted) {
        try {
          await this.deps.transport.dispatch(admitted, Buffer.from(exactBody));
        } catch {
          /* Uncertain; only recovery may run now. */
        }
      }
    }
    // Even a successful POST result is not financial evidence or discovery completeness.
    return this.deps.recovery.recover(existing.requestId);
  }
}
/** Owns the gateway fence; the legacy unfenced instance remains explicitly non-strict. */
export class PublicHeldOnboardingCheckout extends PublicCheckoutExecution {
  readonly strictFirstSendCancellation = true as const;
  private cursor: string | null = null;
  async recoverCheckout(input: { invoiceId: string; operationId: string }) {
    if (!this.deps.enabled) return { kind: "unavailable" as const };
    const s = await this.deps.source.invoice(input.invoiceId);
    if (!s || s.operationId !== input.operationId)
      return { kind: "unavailable" as const };
    const result = await this.execute(s, "onboarding_create");
    return result.kind === "observed" && result.confirmationUrl
      ? {
          kind: "ready" as const,
          url: result.confirmationUrl,
          paymentId: result.observation.providerObjectId,
        }
      : {
          kind:
            result.kind === "unavailable"
              ? ("unavailable" as const)
              : ("pending" as const),
        };
  }
  async createCheckout(input: { invoiceId: string }) {
    const s = this.deps.enabled
      ? await this.deps.source.invoice(input.invoiceId)
      : null;
    if (!s?.operationId) throw Error("held_checkout_unavailable");
    const result = await this.recoverCheckout({
      invoiceId: input.invoiceId,
      operationId: s.operationId,
    });
    if (result.kind !== "ready") throw Error("held_checkout_unavailable");
    return { url: result.url, paymentId: result.paymentId };
  }
  async reconcile(invoiceId: string) {
    if (!this.deps.enabled) return { kind: "unavailable" as const };
    let s = await this.deps.source.invoice(invoiceId);
    if (!s) return { kind: "unavailable" as const };
    // Observe every known parent mutation before considering any new operation.
    let result: PublicExpertRecoveryResult = { kind: "pending" };
    for (const request of s.requests.filter(
      (r) => r.state !== "prepared" && r.state !== "abandoned",
    )) {
      result = await this.deps.recovery.recover(request.requestId);
      if (
        result.kind === "observed" &&
        ["succeeded", "canceled"].includes(result.observation.status)
      )
        return { kind: "observed" as const, status: result.observation.status };
    }
    if (result.kind !== "observed") return { kind: "pending" as const };
    if (result.observation.status === "waiting_for_capture") {
      s = await this.deps.source.invoice(invoiceId);
      if (!s) return { kind: "pending" as const };
      const kind = s.current ? "onboarding_capture" : "onboarding_cancel";
      // Any parent mutation admitted/uncertain must be recovered via GET, never replaced by another POST.
      if (
        s.requests.some(
          (r) =>
            (r.kind === "onboarding_capture" ||
              r.kind === "onboarding_cancel") &&
            ["admitted", "uncertain", "bound", "resolved"].includes(r.state),
        )
      )
        return { kind: "pending" as const };
      await this.execute(s, kind);
    }
    return { kind: "observed" as const, status: result.observation.status };
  }
  async reconcileKnown(limit = 20) {
    if (!this.deps.enabled) return { examined: 0 };
    const ids = await this.deps.source.pending(limit, this.cursor);
    this.cursor = ids.at(-1) ?? null;
    for (const id of ids) {
      try {
        await this.reconcile(id);
      } catch {
        /* retain unresolved source */
      }
    }
    return { examined: ids.length };
  }
}
export interface PublicMainCheckoutBinding {
  readonly orderId: string;
  readonly userId: string;
  readonly expertId: string;
  readonly amountMinor: string;
  readonly currency: "RUB";
  readonly providerMode: "test" | "live";
  readonly purpose: "main_residency";
  readonly paymentDeadline: string;
  readonly idempotencyKey: string;
}
export class PublicMainResidencyCheckout extends PublicCheckoutExecution {
  readonly strictFirstSendCancellation = true as const;
  async createOrRecover(binding: PublicMainCheckoutBinding) {
    if (!this.deps.enabled) return { kind: "unavailable" as const };
    const s = await this.deps.source.source(
      "main",
      binding.userId,
      binding.orderId,
    );
    if (
      !s ||
      s.expertId !== binding.expertId ||
      s.amountMinor !== binding.amountMinor ||
      s.currency !== binding.currency ||
      s.mode !== binding.providerMode ||
      binding.purpose !== "main_residency" ||
      s.paymentDeadline !== binding.paymentDeadline
    )
      return { kind: "unavailable" as const };
    const result = await this.execute(s, "main_create");
    return result.kind === "observed" && result.confirmationUrl
      ? {
          kind: "ready" as const,
          orderId: s.sourceId,
          paymentId: result.observation.providerObjectId,
          url: result.confirmationUrl,
        }
      : {
          kind:
            result.kind === "unavailable"
              ? ("unavailable" as const)
              : ("pending" as const),
        };
  }
  async createOrRecoverRefund(input: { userId: string; operationId: string }) {
    if (!this.deps.enabled) return { kind: "unavailable" as const };
    const s = await this.deps.source.source(
      "refund",
      input.userId,
      input.operationId,
    );
    return s
      ? this.execute(s, "main_refund")
      : { kind: "unavailable" as const };
  }
}
