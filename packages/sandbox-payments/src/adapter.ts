import type {
  ExpertResidencyCheckoutCommand,
  ExpertResidencyCheckoutOutcome,
} from "@ii-tonya/contracts";
import type {
  ExpertResidencyPaymentPort,
  VerifiedExpertResidencyPaymentEvent,
} from "@ii-tonya/integrations";
import type { PostgresExpertResidencyProviderInboxRepository } from "@ii-tonya/db";
import type { PostgresSandboxPaymentRepository } from "./repository.js";
import type { SandboxEventVerifier } from "./verifier.js";

type SandboxAdapterRepository = Pick<
  PostgresSandboxPaymentRepository,
  "assertSandboxDatabase" | "createCheckout" | "nextPendingEvent"
>;

export class SandboxExpertResidencyPaymentAdapter implements ExpertResidencyPaymentPort {
  constructor(
    private readonly repository: SandboxAdapterRepository,
    private readonly verifier: SandboxEventVerifier,
  ) {}

  async assertSandboxDatabase(): Promise<void> {
    await this.repository.assertSandboxDatabase();
  }

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

  async refund(): Promise<never> {
    throw new Error("sandbox_refund_requires_approved_transition");
  }
}

type CanonicalProviderInbox = Pick<
  PostgresExpertResidencyProviderInboxRepository,
  "settle" | "reverse"
>;

export async function deliverSandboxPaymentEvent(input: {
  paymentId: string;
  adapter: SandboxExpertResidencyPaymentAdapter;
  inbox: CanonicalProviderInbox;
  acknowledge(eventId: string): Promise<void>;
}): Promise<"none" | "settled" | "refunded"> {
  const event = await input.adapter.reconcile(input.paymentId);
  if (event === null) return "none";

  if (event.kind === "settled") {
    await input.inbox.settle(event);
  } else if (event.kind === "refunded") {
    await input.inbox.reverse(event);
  } else {
    throw new Error("sandbox_event_kind_invalid");
  }

  await input.acknowledge(event.eventId);
  return event.kind;
}
