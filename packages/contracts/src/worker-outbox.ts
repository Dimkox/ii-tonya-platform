export const LOCAL_OPERATOR_CASE_OUTBOX_TOPICS = Object.freeze([
  "safety.operator_escalation",
  "admin.negative_feedback",
] as const);

export type LocalOperatorCaseOutboxTopic =
  (typeof LOCAL_OPERATOR_CASE_OUTBOX_TOPICS)[number];

export const CLIENT_CATALOG_OUTBOX_TOPICS = Object.freeze([
  ...LOCAL_OPERATOR_CASE_OUTBOX_TOPICS,
  "catalog.show",
] as const);

export type ClientCatalogOutboxTopic =
  (typeof CLIENT_CATALOG_OUTBOX_TOPICS)[number];
