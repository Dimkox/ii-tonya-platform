import {
  expertCampaignCheckoutRequestSchema,
  expertCampaignQuoteRequestSchema,
  type ExpertCampaignCheckoutRequest,
  type ExpertCampaignQuoteRequest,
} from "@ii-tonya/contracts";
import type { ExpertPrincipal } from "./expert-referral-service.js";
import type {
  ResidencyCheckoutProvider,
  ResidencyTariff,
} from "./expert-residency-service.js";
export {
  expertCampaignCheckoutRequestSchema,
  expertCampaignQuoteRequestSchema,
} from "@ii-tonya/contracts";

export interface SavedExpertCampaignQuote {
  id: string;
  userId: string;
  tariffVersionId: string;
  ruleVersion: "expert_energy_start_v1";
  calculationTimestamp: string;
  quotedAt: string;
  expiresAt: string;
  termMonths: 1 | 3;
  durationSeconds: number;
  baseMonthlyMinor: string;
  discountedMonthlyMinor: string;
  monthlyPriceMinor: string;
  priceMinor: string;
  currency: "RUB";
  energyDiscountBps: number;
  startDiscountBps: number;
  floorApplied: boolean;
  displayName: string;
  creditCapBps: number;
  individualServicesEnabled: boolean;
  groupEventLimit: number;
  statisticsLevel: "basic" | "expanded";
  supportPriority: "standard" | "priority";
}
export interface CampaignCheckoutOrder {
  id: string;
  cashMinor: string;
  currency: "RUB";
  status:
    | "quoted"
    | "payment_pending"
    | "settled"
    | "failed"
    | "expired"
    | "refunded"
    | "charged_back";
}
export interface ExpertCampaignPorts {
  environmentEnabled: boolean;
  ownerUserId(expertId: string): Promise<string | undefined>;
  listActiveTariffs(input: {
    expertId: string;
    limit: 20;
  }): Promise<readonly ResidencyTariff[]>;
  createQuote(
    input: ExpertCampaignQuoteRequest & { userId: string },
  ): Promise<SavedExpertCampaignQuote>;
  createCheckoutOrder(
    input: ExpertCampaignCheckoutRequest & { userId: string; expertId: string },
  ): Promise<CampaignCheckoutOrder>;
  checkoutProvider?: ResidencyCheckoutProvider;
}
type Failure = {
  kind:
    | "forbidden"
    | "disabled"
    | "invalid_request"
    | "command_rejected"
    | "payment_unavailable"
    | "service_unavailable";
};
function safeError(error: unknown): Failure {
  const code =
    error instanceof Error && "code" in error ? error.code : undefined;
  if (
    code === "EXPERT_CAMPAIGN_OWNER_INELIGIBLE" ||
    code === "EXPERT_CAMPAIGN_USER_INACTIVE"
  )
    return { kind: "forbidden" };
  if (code === "EXPERT_CAMPAIGN_DISABLED") return { kind: "disabled" };
  if (code === "EXPERT_CAMPAIGN_INVALID_INPUT")
    return { kind: "invalid_request" };
  if (
    typeof code === "string" &&
    [
      "EXPERT_CAMPAIGN_IDEMPOTENCY_CONFLICT",
      "QUOTE_ALREADY_USED",
      "EXPERT_CAMPAIGN_QUOTE_UNAVAILABLE",
      "EXPERT_CAMPAIGN_QUOTE_EXPIRED",
      "EXPERT_CAMPAIGN_TARIFF_INACTIVE",
      "EXPERT_CAMPAIGN_TERM_UNAVAILABLE",
      "EXPERT_CAMPAIGN_EXPIRY_BOUNDARY",
    ].includes(code)
  )
    return { kind: "command_rejected" };
  return { kind: "service_unavailable" };
}
export function createExpertCampaignService(deps: ExpertCampaignPorts) {
  async function authorize(
    principal: ExpertPrincipal,
  ): Promise<Failure | undefined> {
    if (
      !principal.authenticated ||
      (await deps.ownerUserId(principal.expertId)) !== principal.userId
    )
      return { kind: "forbidden" };
    if (!deps.environmentEnabled) return { kind: "disabled" };
    return undefined;
  }
  return {
    kind: "campaign" as const,
    async listActiveTariffs(principal: ExpertPrincipal) {
      try {
        const denied = await authorize(principal);
        if (denied) return denied;
        const tariffs = await deps.listActiveTariffs({
          expertId: principal.expertId,
          limit: 20,
        });
        return tariffs.map(({ priceMinor, ...tariff }) => ({
          ...tariff,
          baseMonthlyMinor: priceMinor,
          priceKind: "base" as const,
        }));
      } catch (error) {
        return safeError(error);
      }
    },
    async quote(
      principal: ExpertPrincipal,
      request: ExpertCampaignQuoteRequest,
    ) {
      const parsed = expertCampaignQuoteRequestSchema.safeParse(request);
      if (!parsed.success) return { kind: "invalid_request" } as Failure;
      try {
        const denied = await authorize(principal);
        if (denied) return denied;
        return await deps.createQuote({
          userId: principal.userId,
          ...parsed.data,
        });
      } catch (error) {
        return safeError(error);
      }
    },
    async checkout(
      principal: ExpertPrincipal,
      request: ExpertCampaignCheckoutRequest,
    ) {
      const parsed = expertCampaignCheckoutRequestSchema.safeParse(request);
      if (!parsed.success) return { kind: "invalid_request" } as Failure;
      try {
        const denied = await authorize(principal);
        if (denied) return denied;
        if (!deps.checkoutProvider)
          return { kind: "payment_unavailable" } as Failure;
        const order = await deps.createCheckoutOrder({
          userId: principal.userId,
          expertId: principal.expertId,
          ...parsed.data,
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
          return { kind: "payment_unavailable" } as Failure;
        }
      } catch (error) {
        return safeError(error);
      }
    },
  };
}
export type ExpertCampaignService = ReturnType<
  typeof createExpertCampaignService
>;
