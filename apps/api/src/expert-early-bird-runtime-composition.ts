import type {
  ExpertApplicantConfig,
  LaunchPhaseConfig,
} from "@ii-tonya/config";
import { createPostgresEarlyBirdAuthority } from "./expert-early-bird-authority.js";
import {
  PostgresEarlyBirdOwnerSendAdmission,
  PostgresEarlyBirdCandidateIntentReader,
  PostgresEarlyBirdVerifiedBindingRepository,
  PostgresEarlyBirdRecoveryFingerprintRepository,
  PostgresEarlyBirdVerifiedPaymentReader,
  type DrizzleDb,
} from "@ii-tonya/db";
import {
  ExperimentalGatewayIpc,
  EarlyBirdOwnerCheckoutSender,
  YooKassaEarlyBirdCandidateVerifier,
  type YooKassaClient,
  type YooKassaPaymentListClient,
  type EarlyBirdOwnerSenderDiagnostic,
} from "@ii-tonya/integrations";
import {
  createEarlyBirdOwnerCheckoutComposition,
  type EarlyBirdOwnerCheckoutConfiguration,
} from "./expert-early-bird-checkout-composition.js";
import { createEarlyBirdReceiptAuthority } from "./expert-early-bird-receipt-authority.js";
import {
  createExpertEarlyBirdService,
  type WaveInvoice,
} from "./expert-early-bird-service.js";
import { createReceiptContactFence } from "./receipt-disclosure-contact-fence.js";

const initializedWaveServices = new WeakSet<object>();
export function isInitializedEarlyBirdGatewayService(value: unknown): boolean {
  return (
    !!value && typeof value === "object" && initializedWaveServices.has(value)
  );
}
type Scope = Parameters<
  NonNullable<
    ReturnType<typeof createEarlyBirdOwnerCheckoutComposition>
  >["source"]["resolve"]
>[0];
export type EarlyBirdOwnerRuntimeConfiguration = {
  checkout: EarlyBirdOwnerCheckoutConfiguration;
  onDiagnostic?(event: EarlyBirdOwnerSenderDiagnostic): void;
  gatewaySubjectKeyVersion: string;
  gateway: ExperimentalGatewayIpc &
    Pick<YooKassaClient, "getPayment"> &
    YooKassaPaymentListClient;
  sender: { db: DrizzleDb; login: string };
  candidateReader: { db: DrizzleDb; login: string };
  bindingWriter: { db: DrizzleDb; login: string };
  knownBindingReader: { db: DrizzleDb; login: string };
  /** Trusted source for read-only recovery queries; never a sender or settlement capability. */
  recovery?: { db: DrizzleDb };
};

/** Concrete default-off wiring. The exact same authenticated gateway handles
 * checkout dispatch and the returned privacy fence. Backend/network custody is
 * an additional release condition; constructing this object does not attest it.
 */
export function createEarlyBirdOwnerRuntimeComposition(
  db: DrizzleDb,
  configuration?: EarlyBirdOwnerRuntimeConfiguration,
) {
  if (!configuration) return undefined;
  const config = configuration;
  if (!(config.gateway instanceof ExperimentalGatewayIpc))
    throw new Error("early_bird_runtime_gateway_required");
  const checkout = createEarlyBirdOwnerCheckoutComposition(
    db,
    config.checkout,
  )!;
  if (
    typeof config.gateway.getPayment !== "function" ||
    typeof config.gateway.listPayments !== "function"
  )
    throw new Error("early_bird_runtime_provider_reader_required");
  // Merchant credentials stay in the gateway process. Provider GET/list requests
  // use the same authenticated gateway; this API process cannot bypass it.
  const client = config.gateway;
  const candidates = new PostgresEarlyBirdCandidateIntentReader(
    config.candidateReader.db,
    config.candidateReader.login,
  );
  const verifier = new YooKassaEarlyBirdCandidateVerifier(client, candidates);
  const binding = new PostgresEarlyBirdVerifiedBindingRepository(
    config.bindingWriter.db,
    verifier,
    config.bindingWriter.login,
  );
  const admission = new PostgresEarlyBirdOwnerSendAdmission(
    config.sender.db,
    config.sender.login,
  );
  const key = Buffer.from(config.checkout.requestKey);
  const reference = config.checkout.requestKeyReference;
  const requestKeys = new Map(
    [...(config.checkout.retainedRequestKeys ?? [])].map(([ref, value]) => [
      ref,
      Buffer.from(value),
    ]),
  );
  requestKeys.set(reference, key);
  if ([...requestKeys.values()].some((value) => value.length !== 32))
    throw new Error("early_bird_runtime_request_key_invalid");
  const sender = new EarlyBirdOwnerCheckoutSender({
    enabled: true,
    ...(config.onDiagnostic ? { onDiagnostic: config.onDiagnostic } : {}),
    admission,
    gateway: config.gateway,
    verifier,
    binding,
    client,
    knownBindings: new PostgresEarlyBirdVerifiedPaymentReader(
      config.knownBindingReader.db,
      config.knownBindingReader.login,
    ),
    ...(config.recovery
      ? {
          recovery: {
            fingerprints: new PostgresEarlyBirdRecoveryFingerprintRepository(
              config.recovery.db,
            ),
            client,
          },
        }
      : {}),
    resolveRequestKey: (requested) => requestKeys.get(requested),
  });
  async function createOrRecover(scope: Scope) {
    const identity = await checkout.source.resolve(scope);
    if (!identity) return { kind: "unavailable" as const };
    const contact = await checkout.contacts.read(scope);
    if (!contact)
      return sender.recoverExisting(identity.userId, identity.operationId);
    await checkout.prepare.prepare(scope);
    // Only the DB admission below can grant a send. Existing unknown intent
    // identities reach read-only reconciliation rather than another POST.
    return sender.createOrRecover({
      userId: identity.userId,
      operationId: identity.operationId,
      receiptContactId: contact.id,
      source: {
        customer: { email: contact.email },
        returnUrl: config.checkout.returnUrl,
        onboardingFiscal: config.checkout.onboardingFiscal,
        subscriptionFiscal: config.checkout.subscriptionFiscal,
      },
    });
  }
  const prepare = {
    async prepare(
      scope: Scope,
    ): Promise<WaveInvoice | { kind: "unavailable" }> {
      const result = await createOrRecover(scope);
      if (result.kind !== "ready") return { kind: "unavailable" };
      return {
        kind: "invoice",
        purpose: "combined",
        url: result.confirmationUrl,
        totalMinor: "3000",
        onboardingMinor: "1000",
        subscriptionMinor: "2000",
        clientStart: "2027-01-10T21:00:00.000Z",
      };
    },
  };
  return {
    ...checkout,
    prepare,
    receipt: createEarlyBirdReceiptAuthority({
      source: checkout.source,
      contacts: checkout.contacts,
      prepare,
    }),
    sender,
    gateway: config.gateway,
    beforePrivacyReceiptDisclosure: createReceiptContactFence(
      config.gateway,
      config.gatewaySubjectKeyVersion,
    ),
    createOrRecover,
    async initializeWaveAuthority(
      policy: ExpertApplicantConfig,
      phase: LaunchPhaseConfig,
      deferred?: Parameters<typeof createPostgresEarlyBirdAuthority>[6],
      now?: {
        prepare: Parameters<typeof createPostgresEarlyBirdAuthority>[4];
        receipt: Parameters<typeof createPostgresEarlyBirdAuthority>[5];
      },
    ) {
      if (
        policy.botId !== config.checkout.policy.botId ||
        policy.botKey !== config.checkout.policy.botKey ||
        policy.messagingConsentPolicyVersion !==
          config.checkout.policy.messagingConsentPolicyVersion ||
        !["WAVE_1_EARLY_BIRD", "PUBLIC_LAUNCH"].includes(phase.configuredPhase)
      )
        throw new Error("early_bird_runtime_policy_mismatch");
      await config.gateway.barrier();
      const authority = createPostgresEarlyBirdAuthority(
        db,
        policy,
        phase.clientStartMs,
        phase.enrollmentStartMs,
        now?.prepare ?? prepare,
        now?.receipt ??
          createEarlyBirdReceiptAuthority({
            source: checkout.source,
            contacts: checkout.contacts,
            prepare,
          }),
        deferred,
      );
      const wave = createExpertEarlyBirdService(authority, {
        phase: phase.configuredPhase,
        enrollmentStartMs: phase.enrollmentStartMs,
        clientStartMs: phase.clientStartMs,
        now: () => Date.now(),
      });
      initializedWaveServices.add(wave);
      return wave;
    },
  };
}
