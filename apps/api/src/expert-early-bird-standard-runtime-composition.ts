import {
  PostgresEarlyBirdStandardSendAdmission,
  PostgresEarlyBirdCandidateIntentReader,
  PostgresEarlyBirdVerifiedBindingRepository,
  PostgresEarlyBirdRecoveryFingerprintRepository,
  PostgresEarlyBirdVerifiedPaymentReader,
  type DrizzleDb,
} from "@ii-tonya/db";
import {
  ExperimentalGatewayIpc,
  EarlyBirdStandardCheckoutSender,
  YooKassaEarlyBirdCandidateVerifier,
  type YooKassaClient,
  type YooKassaPaymentListClient,
  type EarlyBirdStandardSenderDiagnostic,
} from "@ii-tonya/integrations";
import {
  createEarlyBirdStandardCheckoutComposition,
  type EarlyBirdStandardCheckoutConfiguration,
} from "./expert-early-bird-standard-checkout-composition.js";
import { createEarlyBirdReceiptAuthority } from "./expert-early-bird-receipt-authority.js";
import type { WaveInvoice } from "./expert-early-bird-service.js";
import { createReceiptContactFence } from "./receipt-disclosure-contact-fence.js";

type Scope = Parameters<
  NonNullable<
    ReturnType<typeof createEarlyBirdStandardCheckoutComposition>
  >["source"]["resolve"]
>[0];
export type EarlyBirdStandardRuntimeConfiguration = {
  checkout: EarlyBirdStandardCheckoutConfiguration;
  onDiagnostic?(event: EarlyBirdStandardSenderDiagnostic): void;
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
export function createEarlyBirdStandardRuntimeComposition(
  db: DrizzleDb,
  configuration?: EarlyBirdStandardRuntimeConfiguration,
) {
  if (!configuration) return undefined;
  const config = configuration;
  if (!(config.gateway instanceof ExperimentalGatewayIpc))
    throw new Error("early_bird_runtime_gateway_required");
  const checkout = createEarlyBirdStandardCheckoutComposition(
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
  const admission = new PostgresEarlyBirdStandardSendAdmission(
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
  const sender = new EarlyBirdStandardCheckoutSender({
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
        totalMinor: result.totalMinor,
        onboardingMinor: result.onboardingMinor,
        subscriptionMinor: result.subscriptionMinor,
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
  };
}
