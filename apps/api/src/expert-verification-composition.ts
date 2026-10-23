import {
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
  type DrizzleDb,
} from "@ii-tonya/db";
type ServiceDependencies = Parameters<
  typeof createExpertVerificationService
>[0];
export interface ExpertVerificationPaymentCapabilities {
  providerMode: "test" | "live";
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
    settings.checkoutEnabled &&
    (payment?.checkout?.strictFirstSendCancellation !== true ||
      typeof payment.checkout.createCheckout !== "function" ||
      typeof payment.checkout.recoverCheckout !== "function")
  )
    throw new Error("expert_verification_payment_capability_required");
  // Reconciliation of existing invoices remains available with manager/new-checkout off.
  if (
    settings.paymentVerificationEnabled &&
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
): ExpertVerificationCapability | undefined {
  assertExpertVerificationPayments(config, payment);
  const settings = config.expertVerification;
  if (
    !settings ||
    (config.features.expertVerification !== true &&
      !settings.paymentVerificationEnabled)
  )
    return undefined;
  const repository = new PostgresExpertVerificationRepository(db, {
    providerMode: settings.paymentMode,
    messagingConsentPolicyVersion: settings.messagingConsentPolicyVersion,
  });
  const onboardingWebhook =
    settings.paymentVerificationEnabled && payment?.paymentVerification
      ? new YooKassaOnboardingWebhookCapability(
          repository,
          new YooKassaOnboardingPaymentVerifier(
            payment.paymentVerification.client,
            repository,
          ),
          repository,
        )
      : undefined;
  return {
    paymentMode: settings.paymentMode,
    checkoutEnabled: settings.checkoutEnabled,
    paymentVerificationEnabled: settings.paymentVerificationEnabled,
    ...(onboardingWebhook ? { onboardingWebhook } : {}),
    service: createExpertVerificationService({
      enabled: config.features.expertVerification === true,
      repository,
      ...(settings.checkoutEnabled && payment?.checkout
        ? { checkout: payment.checkout }
        : {}),
    }),
  };
}
