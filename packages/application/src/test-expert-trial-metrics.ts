export const TEST_EXPERT_TRIAL_METRICS = [
  "redemption_created",
  "deterministic_message",
  "units_reserved",
  "units_consumed",
  "units_released",
  "unknown_outcome",
  "cap_rejected",
  "duplicate_request",
  "provider_outcome",
  "reconciliation_age",
  "conversion",
  "cost_per_trial",
  "deterministic_offload",
] as const;
export type TestExpertTrialMetric = (typeof TEST_EXPERT_TRIAL_METRICS)[number];
export type TestExpertTrialMetricEvent = {
  readonly name: TestExpertTrialMetric;
  readonly value: number;
  readonly labels?: Readonly<Record<string, string>>;
};
export const recordTestExpertTrialMetric = (
  event: TestExpertTrialMetricEvent,
): TestExpertTrialMetricEvent => ({
  ...event,
  ...(event.labels === undefined ? {} : { labels: { ...event.labels } }),
});
