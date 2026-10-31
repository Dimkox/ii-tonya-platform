import {
  wrapEarlyBirdReview,
  type EarlyBirdReviewPreparation,
} from "./early-bird-review-prepare.js";
import {
  createPrivateObjectStore,
  YooKassaOnboardingPaymentVerifier,
  YooKassaOnboardingWebhookCapability,
  type YooKassaClient,
} from "@ii-tonya/integrations";
import {
  createExpertVerificationService,
  type ExpertVerificationService,
} from "@ii-tonya/application";
import {
  assertExpertVerificationConfig,
  type RuntimeConfig,
} from "@ii-tonya/config";
import {
  PostgresExpertVerificationRepository,
  PostgresResidentReviewRepository,
  PostgresResidentPrivateJobsRepository,
  PostgresHeldOnboardingCheckout,
  PostgresExpertCampaignQuoteRepository,
  type DrizzleDb,
} from "@ii-tonya/db";
type ServiceDependencies = Parameters<
  typeof createExpertVerificationService
>[0];
export interface ExpertVerificationPaymentCapabilities {
  providerMode: "test" | "live";
  publicHeldCheckout?: NonNullable<ServiceDependencies["heldCheckout"]> & {
    readonly strictFirstSendCancellation: true;
    reconcile(invoiceId: string): Promise<unknown>;
    reconcileKnown(limit?: number): Promise<unknown>;
  };
  heldOnboarding?: Omit<
    ConstructorParameters<typeof PostgresHeldOnboardingCheckout>[1],
    "enabled" | "repository" | "mode"
  >;
  checkout?: NonNullable<ServiceDependencies["checkout"]> & {
    readonly strictFirstSendCancellation: true;
  };
  paymentVerification?: {
    readonly authoritativeGet: true;
    client: Pick<YooKassaClient, "getPayment">;
  };
}
export interface ExpertVerificationCapability {
  service: ExpertVerificationService;
  paymentMode: "test" | "live";
  checkoutEnabled: boolean;
  paymentVerificationEnabled: boolean;
  onboardingWebhook?: YooKassaOnboardingWebhookCapability;
  heldCheckout?:
    | PostgresHeldOnboardingCheckout
    | ExpertVerificationPaymentCapabilities["publicHeldCheckout"];
}
export function assertExpertVerificationPayments(
  config: RuntimeConfig,
  payment: ExpertVerificationPaymentCapabilities | undefined,
): void {
  assertExpertVerificationConfig(config);
  const settings = config.expertVerification;
  if (!settings) return;
  if (payment && payment.providerMode !== settings.paymentMode)
    throw new Error("expert_verification_payment_mode_conflict");
  if (
    payment?.publicHeldCheckout &&
    (payment.publicHeldCheckout.strictFirstSendCancellation !== true ||
      typeof payment.publicHeldCheckout.createCheckout !== "function" ||
      typeof payment.publicHeldCheckout.recoverCheckout !== "function" ||
      typeof payment.publicHeldCheckout.reconcileKnown !== "function")
  )
    throw Error("held_onboarding_capability_required");
  if (
    settings.checkoutEnabled &&
    config.features.expertHeldOnboarding !== true &&
    (payment?.checkout?.strictFirstSendCancellation !== true ||
      typeof payment.checkout.createCheckout !== "function" ||
      typeof payment.checkout.recoverCheckout !== "function")
  )
    throw new Error("expert_verification_payment_capability_required");
  // Reconciliation of existing invoices remains available with manager/new-checkout off.
  if (
    settings.paymentVerificationEnabled &&
    !payment?.publicHeldCheckout &&
    (payment?.paymentVerification?.authoritativeGet !== true ||
      typeof payment.paymentVerification.client?.getPayment !== "function")
  )
    throw new Error("expert_verification_payment_capability_required");
}
export function assertExpertVerificationCapability(
  config: RuntimeConfig,
  capability: ExpertVerificationCapability | undefined,
): void {
  assertExpertVerificationConfig(config);
  if (config.features.expertVerification !== true) return;
  const settings = config.expertVerification!;
  if (
    !capability ||
    capability.paymentMode !== settings.paymentMode ||
    capability.checkoutEnabled !== settings.checkoutEnabled ||
    capability.paymentVerificationEnabled !==
      settings.paymentVerificationEnabled ||
    typeof capability.service?.list !== "function" ||
    typeof capability.service.detail !== "function" ||
    typeof capability.service.decide !== "function" ||
    typeof capability.service.checkout !== "function"
  )
    throw new Error("expert_verification_capability_required");
}
export function createExpertVerificationComposition(
  db: DrizzleDb,
  config: RuntimeConfig,
  payment?: ExpertVerificationPaymentCapabilities,
  earlyBirdPreparation?: EarlyBirdReviewPreparation,
): ExpertVerificationCapability | undefined {
  assertExpertVerificationPayments(config, payment);
  const settings = config.expertVerification;
  if (
    !settings ||
    (config.features.expertVerification !== true &&
      !settings.paymentVerificationEnabled)
  )
    return undefined;
  const privateRepository = config.features.residentPrivateJobs
    ? new PostgresResidentPrivateJobsRepository(db, settings)
    : undefined;
  const privateStore =
    privateRepository && config.privateVerification
      ? createPrivateObjectStore(config.privateVerification)
      : undefined;
  if (privateRepository && !privateStore)
    throw Error("resident_private_capability_required");
  const repository = new PostgresExpertVerificationRepository(db, {
    providerMode: settings.paymentMode,
    messagingConsentPolicyVersion: settings.messagingConsentPolicyVersion,
  });
  const heldCheckout =
    config.features.expertHeldOnboarding === true && payment?.publicHeldCheckout
      ? payment.publicHeldCheckout
      : config.features.expertHeldOnboarding === true && payment?.heldOnboarding
        ? new PostgresHeldOnboardingCheckout(db, {
            ...payment.heldOnboarding,
            enabled: true,
            repository,
            mode: settings.paymentMode,
          })
        : undefined;
  if (config.features.expertHeldOnboarding === true && !heldCheckout)
    throw new Error("held_onboarding_capability_required");
  const onboardingWebhook =
    settings.paymentVerificationEnabled && payment?.paymentVerification
      ? new YooKassaOnboardingWebhookCapability(
          repository,
          new YooKassaOnboardingPaymentVerifier(
            payment.paymentVerification.client,
            repository,
          ),
          repository,
          heldCheckout instanceof PostgresHeldOnboardingCheckout
            ? heldCheckout
            : undefined,
        )
      : undefined;
  return {
    paymentMode: settings.paymentMode,
    checkoutEnabled: settings.checkoutEnabled,
    paymentVerificationEnabled: settings.paymentVerificationEnabled,
    ...(onboardingWebhook ? { onboardingWebhook } : {}),
    ...(heldCheckout ? { heldCheckout } : {}),
    service: createExpertVerificationService({
      ...(privateRepository && privateStore
        ? {
            privateEvidence: {
              async detail(
                session: string,
                applicationId: string,
                after?: string,
              ) {
                return {
                  documents: await privateRepository.managerObjects(
                    session,
                    applicationId,
                    after,
                  ),
                  evidence: await privateRepository.managerEvidence(
                    session,
                    applicationId,
                  ),
                };
              },
              link: (session: string, applicationId: string, id: string) =>
                privateRepository.managerLink(session, applicationId, id, (p) =>
                  privateStore.presign(p),
                ),
              recoveryList: (session: string, after?: string) =>
                privateRepository.recoveryList(session, after),
              requestRecovery: (session: string, id: string) =>
                privateRepository.requestRecovery(session, id),
            },
          }
        : {}),
      review: wrapEarlyBirdReview(
        new PostgresResidentReviewRepository(db, {
          providerMode: settings.paymentMode,
          messagingConsentPolicyVersion: settings.messagingConsentPolicyVersion,
          earlyBirdReview: earlyBirdPreparation !== undefined,
        }),
        earlyBirdPreparation,
      ),
      enabled: config.features.expertVerification === true,
      repository,
      ...(heldCheckout ? { heldCheckout } : {}),
      verifyProfile: (input) =>
        new PostgresExpertCampaignQuoteRepository(db).verifyProfile(input),
      ...(settings.checkoutEnabled && payment?.checkout
        ? { checkout: payment.checkout }
        : {}),
    }),
  };
}
