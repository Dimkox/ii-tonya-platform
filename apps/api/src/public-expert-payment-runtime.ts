import {
  createPublicExpertPaymentRuntime,
  type DrizzleDb,
  type PublicExpertRuntimeConfiguration,
} from "@ii-tonya/db";
/** No sessions or caller-selected financial facts are introduced here. Manager,
 * card and renewal services retain their authenticated ownership checks. */
export function createPublicExpertApiRuntime(
  db: DrizzleDb,
  config: PublicExpertRuntimeConfiguration,
) {
  const runtime = createPublicExpertPaymentRuntime(db, config);
  return {
    runtime,
    options: {
      publicExpertRuntime: runtime,
      expertVerificationPayments: {
        providerMode: config.mode,
        publicHeldCheckout: runtime.held,
      },
      expertCard: { mainCheckout: runtime.main },
      expertResidencyLifecycle: { mainCheckout: runtime.main },
    },
  };
}
