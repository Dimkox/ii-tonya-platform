import type {
  ExpertResidencyCheckoutCommand,
  ExpertResidencyCheckoutOutcome,
} from "@ii-tonya/contracts";
import type {
  ExpertResidencyPaymentPort,
  VerifiedExpertResidencyPaymentEvent,
} from "@ii-tonya/integrations";
import type { PostgresSandboxPaymentRepository } from "./repository.js";
import type { SandboxEventVerifier } from "./verifier.js";

type SandboxAdapterRepository = Pick<
  PostgresSandboxPaymentRepository,
  "createCheckout" | "nextPendingEvent"
>;

export class SandboxExpertResidencyPaymentAdapter implements ExpertResidencyPaymentPort {
  constructor(
    private readonly repository: SandboxAdapterRepository,
    private readonly verifier: SandboxEventVerifier,
  ) {}

  async createCheckout(
    command: ExpertResidencyCheckoutCommand,
  ): Promise<ExpertResidencyCheckoutOutcome> {
    const checkout = await this.repository.createCheckout(command);
    return {
      kind: checkout.kind,
      paymentId: checkout.paymentId,
      checkoutUrl: checkout.checkoutUrl,
    };
  }

  async reconcile(
    paymentId: string,
  ): Promise<VerifiedExpertResidencyPaymentEvent | null> {
    const event = await this.repository.nextPendingEvent(paymentId);
    return event === null ? null : this.verifier.verify(event);
  }
}
