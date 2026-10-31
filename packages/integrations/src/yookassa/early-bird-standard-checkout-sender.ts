import { createHash } from "node:crypto";
import { formatRubMinor, type YooKassaClient } from "./client.js";
import {
  scanEarlyBirdUnknown,
  type EarlyBirdRecoveryFingerprint,
  type EarlyBirdListRecoveryClient,
} from "./early-bird-list-recovery.js";
import {
  YooKassaEarlyBirdVerifier,
  type EarlyBirdPaymentBinding,
} from "./early-bird-verifier.js";
import { openEarlyBirdStandardRequest } from "./early-bird-standard-sealed-request.js";
import type { buildEarlyBirdStandardRequest } from "./early-bird-request.js";
import {
  YooKassaEarlyBirdCandidateVerifier,
  type VerifiedEarlyBirdCandidate,
} from "./early-bird-candidate-verifier.js";

type Source = Parameters<typeof buildEarlyBirdStandardRequest>[0];
type Snapshot = {
  intent: Source["intent"];
  sealed: { ciphertext: string; keyReference: string; digest: string };
};
type Admission =
  | { kind: "unavailable" }
  | { kind: "reconcile"; operationId: string }
  | {
      kind: "initial_send_admitted";
      userId: string;
      operationId: string;
      invoiceId: string;
      receiptContactId: string;
      idempotencyKey: string;
      digest: string;
      totalMinor: string;
      body: string;
    };
type Input = {
  userId: string;
  operationId: string;
  receiptContactId: string;
  source: Omit<Source, "intent">;
};
export type EarlyBirdStandardSenderDiagnostic = Readonly<{
  operationId: string;
  stage: "gateway" | "verification" | "binding" | "confirmation" | "recovery";
  outcome: "failed" | "unknown" | "cancelled";
}>;
export type EarlyBirdStandardCheckoutResult =
  | { kind: "unavailable" }
  | { kind: "reconcile"; operationId: string }
  | { kind: "bound"; operationId: string; paymentId: string }
  | {
      kind: "ready";
      operationId: string;
      paymentId: string;
      confirmationUrl: string;
      totalMinor: string;
      onboardingMinor: string;
      subscriptionMinor: string;
    };

/** Trusted, default-off sender composition. The admission port must be the real
 * PostgreSQL repository with mandatory triggers. The process and gateway keys are
 * privileged: no webhook may choose a replacement admission/verifier/client.
 * This class does not attest to network exclusivity or strict deletion fencing.
 */
export class EarlyBirdStandardCheckoutSender {
  readonly strictFirstSendCancellation = false as const;
  constructor(
    private readonly options: {
      enabled?: boolean;
      onDiagnostic?(event: EarlyBirdStandardSenderDiagnostic): void;
      admission: {
        admit(
          input: {
            userId: string;
            operationId: string;
            receiptContactId: string;
          },
          authenticate: (snapshot: Snapshot) => string,
        ): Promise<Admission>;
      };
      gateway: {
        dispatch(
          userId: string,
          attempt: string,
          request: Uint8Array,
          context: {
            userId: string;
            intentId: string;
            contactId: string;
            idempotencyKey: string;
          },
        ): Promise<
          | { kind: "unknown" | "cancelled" }
          | {
              kind: "response";
              paymentId: string;
              paymentStatus: string;
              confirmationUrl?: string;
            }
        >;
      };
      verifier: YooKassaEarlyBirdCandidateVerifier;
      binding: { bind(proof: VerifiedEarlyBirdCandidate): Promise<void> };
      client: Pick<YooKassaClient, "getPayment">;
      knownBindings?: {
        findBindingByOperation(
          operationId: string,
        ): Promise<EarlyBirdPaymentBinding | null>;
      };
      recovery?: {
        fingerprints: {
          read(
            operationId: string,
          ): Promise<EarlyBirdRecoveryFingerprint | null>;
        };
        client: EarlyBirdListRecoveryClient;
      };
      resolveRequestKey(keyReference: string): Buffer | undefined;
    },
  ) {}
  /** Called only after the outer Telegram scope resolver authenticates the user.
   * Recovery does not read a contact, decrypt a body or acquire POST permission. */
  async recoverExisting(
    userId: string,
    operationId: string,
  ): Promise<EarlyBirdStandardCheckoutResult> {
    if (this.options.enabled !== true) return { kind: "unavailable" };
    const uuid =
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
    if (!uuid.test(userId) || !uuid.test(operationId))
      return { kind: "unavailable" };
    return this.recover(userId, operationId);
  }
  async createOrRecover(
    input: Input,
  ): Promise<EarlyBirdStandardCheckoutResult> {
    if (this.options.enabled !== true) return { kind: "unavailable" };
    const admitted = await this.options.admission.admit(input, (snapshot) => {
      const key = this.options.resolveRequestKey(snapshot.sealed.keyReference);
      if (!key) throw new Error("early_bird_sender_key_unavailable");
      return openEarlyBirdStandardRequest(
        { ...input.source, intent: snapshot.intent },
        snapshot.sealed,
        key,
      ).body;
    });
    if (admitted.kind === "reconcile")
      return this.recover(input.userId, admitted.operationId);
    if (admitted.kind !== "initial_send_admitted") return admitted;
    // All values come from the committed DB admission and authenticated body.
    // A stable id is essential: a fresh random id could bypass gateway dedup.
    const attempt = createHash("sha256")
      .update(Buffer.from(admitted.idempotencyKey.replaceAll("-", ""), "hex"))
      .digest("hex");
    const bytes = Buffer.from(admitted.body, "utf8");
    const request = Buffer.concat([
      Buffer.from(
        `POST /v3/payments HTTP/1.1\r\nHost: api.yookassa.ru\r\nIdempotence-Key: ${admitted.idempotencyKey}\r\nContent-Type: application/json\r\nContent-Length: ${bytes.length}\r\nConnection: close\r\n\r\n`,
        "ascii",
      ),
      bytes,
    ]);
    let gatewayAcknowledged = false;
    try {
      const result = await this.options.gateway.dispatch(
        admitted.receiptContactId,
        attempt,
        request,
        {
          userId: admitted.userId,
          intentId: admitted.operationId,
          contactId: admitted.receiptContactId,
          idempotencyKey: admitted.idempotencyKey,
        },
      );
      if (result.kind !== "response") {
        this.report({
          operationId: admitted.operationId,
          stage: "gateway",
          outcome: result.kind,
        });
        return { kind: "reconcile", operationId: admitted.operationId };
      }
      gatewayAcknowledged = true;
      return await this.verifyBindAndExpose(
        admitted.operationId,
        admitted.userId,
        admitted.invoiceId,
        result.paymentId,
        admitted.totalMinor,
      );
    } catch {
      if (!gatewayAcknowledged)
        this.report({
          operationId: admitted.operationId,
          stage: "gateway",
          outcome: "unknown",
        });
      // Never retry POST or release the operation on ambiguous dispatch/binding.
      return { kind: "reconcile", operationId: admitted.operationId };
    }
  }
  private async verifyBindAndExpose(
    operationId: string,
    userId: string,
    invoiceId: string,
    providerObjectId: string,
    expectedTotal: string,
  ): Promise<EarlyBirdStandardCheckoutResult> {
    // The IPC response is merely a candidate. Only a fresh provider GET with
    // exact durable identity/amount/mode and a committed binding unlocks a URL.
    let stage: EarlyBirdStandardSenderDiagnostic["stage"] = "verification";
    try {
      const proof = await this.options.verifier.verify(
        operationId,
        providerObjectId,
      );
      if (
        proof.userId !== userId ||
        proof.invoiceId !== invoiceId ||
        proof.pricingPolicy !== "wave1_standard_v1" ||
        proof.totalMinor !== expectedTotal
      )
        throw new Error("early_bird_sender_binding_mismatch");
      stage = "binding";
      await this.options.binding.bind(proof);
      stage = "confirmation";
      return await this.confirmationFromProvider(
        operationId,
        userId,
        invoiceId,
        providerObjectId,
        expectedTotal,
        proof.onboardingMinor,
        proof.subscriptionMinor,
      );
    } catch {
      this.report({ operationId, stage, outcome: "failed" });
      throw new Error("early_bird_sender_verification_unavailable");
    }
  }

  private async confirmationFromProvider(
    operationId: string,
    userId: string,
    invoiceId: string,
    providerObjectId: string,
    expectedTotal: string,
    onboardingMinor: string,
    subscriptionMinor: string,
  ): Promise<EarlyBirdStandardCheckoutResult> {
    const observed = await this.options.client.getPayment(providerObjectId);
    if (
      observed.id !== providerObjectId ||
      observed.metadata?.operation_id !== operationId ||
      observed.metadata?.order_id !== invoiceId ||
      observed.metadata?.user_id !== userId ||
      observed.test !== false ||
      observed.amount.currency !== "RUB" ||
      !/^[1-9][0-9]{0,11}$/u.test(expectedTotal) ||
      observed.amount.value !== formatRubMinor(BigInt(expectedTotal))
    )
      throw new Error("early_bird_sender_confirmation_mismatch");
    if (observed.status !== "pending" || !observed.confirmation)
      return {
        kind: "bound",
        operationId: operationId,
        paymentId: providerObjectId,
      };
    const url = new URL(observed.confirmation.url);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "yoomoney.ru" ||
      url.port !== "" ||
      url.username ||
      url.password ||
      url.hash ||
      url.href.length > 2048
    )
      throw new Error("early_bird_sender_confirmation_invalid");
    return {
      kind: "ready",
      operationId: operationId,
      paymentId: providerObjectId,
      confirmationUrl: url.href,
      totalMinor: expectedTotal,
      onboardingMinor,
      subscriptionMinor,
    };
  }
  private report(event: EarlyBirdStandardSenderDiagnostic): void {
    try {
      this.options.onDiagnostic?.(Object.freeze(event));
    } catch {
      /* diagnostics cannot change payment state */
    }
  }
  private async recover(
    userId: string,
    operationId: string,
  ): Promise<EarlyBirdStandardCheckoutResult> {
    const unresolved = { kind: "reconcile" as const, operationId };
    try {
      if (this.options.knownBindings) {
        const binding =
          await this.options.knownBindings.findBindingByOperation(operationId);
        if (binding) {
          if (
            binding.operationId !== operationId ||
            binding.userId !== userId ||
            binding.pricingPolicy !== "wave1_standard_v1" ||
            !/^[1-9][0-9]{0,11}$/u.test(binding.totalMinor) ||
            binding.mode !== "live"
          )
            return unresolved;
          // The stored binding is not itself provider proof. Recheck the complete
          // binding with the existing authoritative GET verifier, including pending.
          const verifier = new YooKassaEarlyBirdVerifier(this.options.client, {
            findEarlyBirdBinding: async (invoice) =>
              invoice === binding.invoiceId ? binding : null,
          });
          await verifier.verify(binding.invoiceId);
          return await this.confirmationFromProvider(
            operationId,
            userId,
            binding.invoiceId,
            binding.providerObjectId,
            binding.totalMinor,
            binding.onboardingMinor,
            binding.subscriptionMinor,
          );
        }
      }
      if (!this.options.recovery) return unresolved;
      const fingerprint =
        await this.options.recovery.fingerprints.read(operationId);
      if (
        !fingerprint ||
        fingerprint.operationId !== operationId ||
        fingerprint.userIdSha256 !==
          createHash("sha256").update(userId, "utf8").digest("hex") ||
        fingerprint.pricingPolicy !== "wave1_standard_v1" ||
        !/^[1-9][0-9]{0,11}$/u.test(fingerprint.totalMinor)
      )
        return unresolved;
      // Existing scanner caps pagination at three pages and rejects ambiguous,
      // incomplete, inconsistent or unavailable provider results. It never POSTs.
      const candidate = await scanEarlyBirdUnknown(
        this.options.recovery.client,
        fingerprint,
      );
      if (candidate.kind !== "candidate") return unresolved;
      return await this.verifyBindAndExpose(
        operationId,
        userId,
        fingerprint.invoiceId,
        candidate.providerObjectId,
        fingerprint.totalMinor,
      );
    } catch {
      this.report({ operationId, stage: "recovery", outcome: "failed" });
      return unresolved;
    }
  }
}
