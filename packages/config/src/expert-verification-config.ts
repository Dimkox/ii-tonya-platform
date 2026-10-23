export interface ExpertVerificationConfig {
  paymentMode: "test" | "live";
  messagingConsentPolicyVersion: string;
  checkoutEnabled: boolean;
  paymentVerificationEnabled: boolean;
}
type VerificationRuntime = {
  features: { expertVerification?: boolean };
  expertVerification?: ExpertVerificationConfig;
  yookassa?: { mode: "test" | "live" };
};
const validPolicy = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.exec(value)?.[0] === value &&
  !/placeholder/iu.test(value);
export function assertExpertVerificationConfig(
  config: VerificationRuntime,
): void {
  if (
    config.features.expertVerification !== true &&
    config.expertVerification?.paymentVerificationEnabled !== true &&
    config.expertVerification?.checkoutEnabled !== true
  )
    return;
  const settings = config.expertVerification;
  if (
    !settings ||
    !["test", "live"].includes(settings.paymentMode) ||
    typeof settings.checkoutEnabled !== "boolean" ||
    typeof settings.paymentVerificationEnabled !== "boolean" ||
    !validPolicy(settings.messagingConsentPolicyVersion)
  )
    throw new Error("expert_verification_configuration_required");
  if (
    settings.checkoutEnabled &&
    (config.features.expertVerification !== true ||
      !settings.paymentVerificationEnabled)
  )
    throw new Error("expert_verification_configuration_required");
  if (config.yookassa && config.yookassa.mode !== settings.paymentMode)
    throw new Error("expert_verification_payment_mode_conflict");
}
export function readExpertVerificationConfig(
  source: NodeJS.ProcessEnv,
): ExpertVerificationConfig | undefined {
  const enabled = source.EXPERT_VERIFICATION_ENABLED || "false";
  const checkout = source.EXPERT_VERIFICATION_CHECKOUT_ENABLED || "false";
  const verification =
    source.EXPERT_VERIFICATION_PAYMENT_VERIFICATION_ENABLED || "false";
  if (
    [enabled, checkout, verification].some(
      (flag) => !["true", "false"].includes(flag),
    )
  )
    throw new Error("expert_verification_configuration_invalid");
  if (checkout === "true" && verification !== "true")
    throw new Error("expert_verification_configuration_required");
  if (enabled !== "true" && checkout === "true")
    throw new Error("expert_verification_configuration_required");
  if (enabled !== "true" && verification !== "true") return undefined;
  const paymentMode = source.EXPERT_VERIFICATION_PAYMENT_MODE;
  const messagingConsentPolicyVersion =
    source.EXPERT_VERIFICATION_MESSAGING_CONSENT_POLICY_VERSION;
  if (!validPolicy(messagingConsentPolicyVersion))
    throw new Error("expert_verification_configuration_required");
  if (paymentMode !== "test" && paymentMode !== "live")
    throw new Error("expert_verification_configuration_required");
  if (source.YOOKASSA_MODE && source.YOOKASSA_MODE !== paymentMode)
    throw new Error("expert_verification_payment_mode_conflict");
  return {
    paymentMode,
    messagingConsentPolicyVersion,
    checkoutEnabled: checkout === "true",
    paymentVerificationEnabled: verification === "true",
  };
}
