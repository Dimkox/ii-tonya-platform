export type ProjectionTopic =
  | "reservation_projection.v1"
  | "package_balance_projection.v1"
  | "feedback_projection.v1"
  | "integration_health_projection.v1";

export interface ProjectionEvent {
  eventId: string;
  topic: ProjectionTopic;
  occurredAt: string;
  correlationId: string;
  schemaVersion: 1;
  data: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ProjectionSink {
  publish(event: ProjectionEvent): Promise<void>;
}
