import type { ParticipantSegment } from "./test-expert-segmentation.js";
import type { TestExpertTrialMetricEvent } from "./test-expert-trial-metrics.js";

type TrialPort = {
  resolveActiveCampaign(code: string): Promise<{
    id: string;
    code: string;
    promptVersion: string;
  } | null>;
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
    providerRequestId?: string;
    replay: boolean;
  }>;
  recordOutcome(input: {
    reservationId: string;
    outcome: "applied" | "not_applied" | "unknown";
    providerRequestId?: string;
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
      readonly providerRequestId?: string;
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
      provider:
        | null
        | ((text: string) => Promise<{
            outcome: "applied" | "not_applied" | "unknown";
            providerRequestId?: string;
          }>);
      metrics?: { record(event: TestExpertTrialMetricEvent): void };
    },
  ) {}
  async handleResidual(input: {
    userId: string;
    requestKey: string;
    requestDigest: string;
    text: string;
  }): Promise<TrialRouteResult> {
    if (
      !input.requestKey ||
      !/^[0-9a-f]{64}$/u.test(input.requestDigest) ||
      !input.text
    )
      throw new Error("residual_request_invalid");
    const campaign = await this.deps.trial.resolveActiveCampaign("test-expert");
    if (campaign === null || this.deps.provider === null)
      return {
        kind: "unavailable",
        reason: "authoritative_pricing_policy_unavailable",
        trialUnits: 0,
      };
    const redemption = await this.deps.trial.createOrGetRedemption({
      campaignVersionId: campaign.id,
      userId: input.userId,
      idempotencyKey: `test-expert:${campaign.id}:${input.userId}`,
    });
    const reservation = await this.deps.trial.reserveAiTurn({
      redemptionId: redemption.id,
      requestKey: input.requestKey,
      requestDigest: input.requestDigest,
    });
    if (reservation.replay && reservation.status === "reserved") {
      this.metric("duplicate_request", { outcome: "pending" });
      return {
        kind: "unavailable",
        reason: "authoritative_pricing_policy_unavailable",
        trialUnits: 0,
      };
    }
    if (reservation.status !== "reserved") {
      this.metric("duplicate_request", { outcome: reservation.status });
      return {
        kind: "provider",
        outcome: reservation.status,
        units: 2,
        ...(reservation.providerRequestId === undefined
          ? {}
          : { providerRequestId: reservation.providerRequestId }),
      };
    }
    this.metric("units_reserved");
    const providerOutcome = await this.deps.provider(input.text);
    if (
      (providerOutcome.outcome === "applied" ||
        providerOutcome.outcome === "unknown") &&
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(
        providerOutcome.providerRequestId ?? "",
      )
    )
      throw new Error("provider_request_id_required");
    await this.deps.trial.recordOutcome({
      reservationId: reservation.reservationId,
      outcome: providerOutcome.outcome,
      ...(providerOutcome.providerRequestId === undefined
        ? {}
        : { providerRequestId: providerOutcome.providerRequestId }),
    });
    this.metric("provider_outcome", { outcome: providerOutcome.outcome });
    this.metric(
      providerOutcome.outcome === "applied"
        ? "units_consumed"
        : providerOutcome.outcome === "unknown"
          ? "unknown_outcome"
          : "units_released",
    );
    return {
      kind: "provider",
      outcome: providerOutcome.outcome,
      units: 2,
      ...(providerOutcome.providerRequestId === undefined
        ? {}
        : { providerRequestId: providerOutcome.providerRequestId }),
    };
  }
  async handle(input: {
    kind: "quote";
    segment: ParticipantSegment;
    redemptionId: string;
    input: Record<string, unknown>;
  }): Promise<TrialRouteResult> {
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
    const quote = await policy.quote(input.input);
    return { kind: "quote", priceMinor: quote.priceMinor, trialUnits: 0 };
  }

  private metric(
    name: TestExpertTrialMetricEvent["name"],
    labels?: Readonly<Record<string, string>>,
  ): void {
    this.deps.metrics?.record({
      name,
      value: 1,
      ...(labels ? { labels } : {}),
    });
  }
}
