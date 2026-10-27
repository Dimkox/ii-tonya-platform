import {
  payerReceiptCheckoutRequestSchema,
  type PayerReceiptCheckoutRequest,
} from "@ii-tonya/contracts";
import {
  createExpertCampaignService,
  type ExpertCampaignPorts,
} from "./expert-campaign-service.js";
import type { ExpertPrincipal } from "./expert-referral-service.js";

export function createPayerReceiptRequiredCampaignService(
  deps: Omit<ExpertCampaignPorts, "createCheckoutOrder"> & {
    createCheckoutOrderWithReceipt(
      input: PayerReceiptCheckoutRequest & { userId: string; expertId: string },
    ): ReturnType<ExpertCampaignPorts["createCheckoutOrder"]>;
  },
) {
  // Reuse quote/read authorization, but never expose its legacy checkout closure.
  const { checkout: _legacyCheckout, ...reads } = createExpertCampaignService({
    ...deps,
    createCheckoutOrder: async () => {
      throw new Error("receipt_required");
    },
  });
  void _legacyCheckout;
  return {
    ...reads,
    receiptRequired: true as const,
    async checkout(principal: ExpertPrincipal, request: unknown) {
      const parsed = payerReceiptCheckoutRequestSchema.safeParse(request);
      if (!parsed.success) return { kind: "invalid_request" as const };
      try {
        if (
          !principal.authenticated ||
          (await deps.ownerUserId(principal.expertId)) !== principal.userId
        )
          return { kind: "forbidden" as const };
        if (!deps.environmentEnabled) return { kind: "disabled" as const };
        if (!deps.checkoutProvider)
          return { kind: "payment_unavailable" as const };
        const order = await deps.createCheckoutOrderWithReceipt({
          ...parsed.data,
          userId: principal.userId,
          expertId: principal.expertId,
        });
        if (order.status !== "payment_pending")
          return { id: order.id, status: order.status };
        try {
          const payment = await deps.checkoutProvider.createCheckout({
            orderId: order.id,
            amountMinor: order.cashMinor,
            currency: order.currency,
            idempotencyKey: parsed.data.idempotencyKey,
          });
          return { id: order.id, status: order.status, payment };
        } catch {
          return { kind: "payment_unavailable" as const };
        }
      } catch (e) {
        const code = e instanceof Error && "code" in e ? e.code : "";
        return {
          kind:
            code === "EXPERT_CAMPAIGN_OWNER_INELIGIBLE"
              ? ("forbidden" as const)
              : code === "EXPERT_CAMPAIGN_DISABLED"
                ? ("disabled" as const)
                : typeof code === "string" &&
                    [
                      "EXPERT_CAMPAIGN_QUOTE_UNAVAILABLE",
                      "EXPERT_CAMPAIGN_QUOTE_EXPIRED",
                      "EXPERT_CAMPAIGN_IDEMPOTENCY_CONFLICT",
                      "QUOTE_ALREADY_USED",
                      "EXPERT_CAMPAIGN_TARIFF_INACTIVE",
                    ].includes(code)
                  ? ("command_rejected" as const)
                  : ("service_unavailable" as const),
        };
      }
    },
  };
}
export type PayerReceiptRequiredCampaignService = ReturnType<
  typeof createPayerReceiptRequiredCampaignService
>;
