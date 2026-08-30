import type { ParticipantSegment } from "./test-expert-segmentation.js";

type TrialPort = {
  createOrGetRedemption(input: {
    campaignVersionId: string;
    userId: string;
    idempotencyKey: string;
  }): Promise<{ id: string }>;
  reserveAiTurn(input: {
    redemptionId: string;
    requestKey: string;
    requestDigest: string;
  }): Promise<{
    reservationId: string;
    units: 2;
    status: "reserved" | "unknown" | "applied" | "not_applied";
  }>;
  recordOutcome(input: {
    reservationId: string;
    outcome: "applied" | "not_applied" | "unknown";
  }): Promise<unknown>;
};
type Quote = {
  readonly priceMinor: number;
  readonly currency: "RUB";
  readonly policyVersionId: string;
};
type QuotePolicy = { quote(input: Record<string, unknown>): Promise<Quote> };
export type TrialRouteResult =
  | {
      readonly kind: "quote";
      readonly priceMinor: number;
      readonly trialUnits: 0;
    }
  | {
      readonly kind: "provider";
      readonly outcome: "applied" | "not_applied" | "unknown";
      readonly units: 2;
    }
  | {
      readonly kind: "unavailable";
      readonly reason: "authoritative_pricing_policy_unavailable";
      readonly trialUnits: 0;
    };

export class TestExpertTrialService {
  constructor(
    private readonly deps: {
      trial: TrialPort;
      expertPolicy: QuotePolicy | null;
      partnerPolicy: QuotePolicy | null;
      provider: (
        text: string,
      ) => Promise<"applied" | "not_applied" | "unknown">;
    },
  ) {}
  async handle(input: {
    kind: "quote";
    segment: ParticipantSegment;
    redemptionId: string;
    input: Record<string, unknown>;
  }): Promise<TrialRouteResult>;
  async handle(input: {
    kind: "residual";
    redemptionId: string;
    requestKey: string;
    requestDigest: string;
    text: string;
  }): Promise<TrialRouteResult>;
  async handle(input: {
    kind: "quote" | "residual";
    segment?: ParticipantSegment;
    redemptionId: string;
    input?: Record<string, unknown>;
    requestKey?: string;
    requestDigest?: string;
    text?: string;
  }): Promise<TrialRouteResult> {
    if (input.kind === "quote") {
      const policy =
        input.segment === "EXPERT"
          ? this.deps.expertPolicy
          : this.deps.partnerPolicy;
      if (policy === null)
        return {
          kind: "unavailable",
          reason: "authoritative_pricing_policy_unavailable",
          trialUnits: 0,
        };
      const quote = await policy.quote(input.input ?? {});
      return { kind: "quote", priceMinor: quote.priceMinor, trialUnits: 0 };
    }
    if (!input.requestKey || !input.requestDigest || !input.text)
      throw new Error("residual_request_invalid");
    const reservation = await this.deps.trial.reserveAiTurn({
      redemptionId: input.redemptionId,
      requestKey: input.requestKey,
      requestDigest: input.requestDigest,
    });
    if (reservation.status !== "reserved")
      return { kind: "provider", outcome: reservation.status, units: 2 };
    const outcome = await this.deps.provider(input.text);
    await this.deps.trial.recordOutcome({
      reservationId: reservation.reservationId,
      outcome,
    });
    return { kind: "provider", outcome, units: 2 };
  }
}
