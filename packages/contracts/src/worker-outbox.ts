export const LOCAL_OPERATOR_CASE_OUTBOX_TOPICS = Object.freeze([
  "safety.operator_escalation",
  "admin.negative_feedback",
] as const);

export type LocalOperatorCaseOutboxTopic =
  (typeof LOCAL_OPERATOR_CASE_OUTBOX_TOPICS)[number];
