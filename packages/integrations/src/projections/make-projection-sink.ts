import type {
  ProjectionEvent,
  ProjectionSink,
  ProjectionTopic,
} from "./projection-port.js";

type ProjectionValueType = "string" | "number" | "boolean" | "null";

const topicDataTypes: Readonly<
  Record<ProjectionTopic, Readonly<Record<string, readonly ProjectionValueType[]>>>
> = {
  "reservation_projection.v1": {
    reservationId: ["string"],
    status: ["string"],
    expertId: ["string"],
    slotStartsAt: ["string"],
    updatedAt: ["string"],
  },
  "package_balance_projection.v1": {
    userId: ["string"],
    packageId: ["string"],
    ledgerDerivedBalance: ["number"],
    expiresAt: ["string", "null"],
    updatedAt: ["string"],
  },
  "feedback_projection.v1": {
    feedbackId: ["string"],
    score: ["number"],
    escalated: ["boolean"],
    createdAt: ["string"],
  },
  "integration_health_projection.v1": {
    provider: ["string"],
    state: ["string"],
    lagSeconds: ["number"],
    checkedAt: ["string"],
  },
};

export interface MakeProjectionRequest {
  endpoint: URL;
  method: "POST";
  headers: Readonly<Record<string, string>>;
  body: ProjectionEvent;
  signal: AbortSignal;
}

export interface MakeProjectionResponse {
  status: number;
}

export interface MakeProjectionSinkDeps {
  endpoint: URL;
  authorization: () => string;
  post: (request: MakeProjectionRequest) => Promise<MakeProjectionResponse>;
}

export class MakeProjectionRetryableFailure extends Error {
  constructor(readonly reasonCode: string) {
    super(reasonCode);
    this.name = "MakeProjectionRetryableFailure";
  }
}

export class MakeProjectionPermanentFailure extends Error {
  constructor(readonly reasonCode: string) {
    super(reasonCode);
    this.name = "MakeProjectionPermanentFailure";
  }
}

const valueType = (value: string | number | boolean | null): ProjectionValueType => {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  return "boolean";
};

const isRetryableStatus = (status: number): boolean =>
  status === 408 ||
  status === 425 ||
  status === 429 ||
  (status >= 500 && status <= 599);

const validateEvent = (event: ProjectionEvent): void => {
  if (!(event.topic in topicDataTypes)) {
    throw new MakeProjectionPermanentFailure("invalid_projection_topic");
  }
  if (event.schemaVersion !== 1) {
    throw new MakeProjectionPermanentFailure("invalid_projection_schema_version");
  }
  if (
    [event.eventId, event.occurredAt, event.correlationId].some(
      (value) => value.length === 0,
    )
  ) {
    throw new MakeProjectionPermanentFailure("invalid_projection_envelope");
  }

  const allowed = topicDataTypes[event.topic];
  for (const [field, value] of Object.entries(event.data)) {
    const expectedTypes = allowed[field];
    if (!expectedTypes || !expectedTypes.includes(valueType(value))) {
      throw new MakeProjectionPermanentFailure("invalid_projection_data");
    }
  }
};

const sanitizedEvent = (event: ProjectionEvent): ProjectionEvent => ({
  eventId: event.eventId,
  topic: event.topic,
  occurredAt: event.occurredAt,
  correlationId: event.correlationId,
  schemaVersion: 1,
  data: { ...event.data },
});

export class MakeProjectionSink implements ProjectionSink {
  constructor(private readonly deps: MakeProjectionSinkDeps) {
    if (deps.endpoint.protocol !== "https:") {
      throw new Error("make_projection_https_required");
    }
  }

  async publish(event: ProjectionEvent): Promise<void> {
    validateEvent(event);

    let response: MakeProjectionResponse;
    try {
      response = await this.deps.post({
        endpoint: this.deps.endpoint,
        method: "POST",
        headers: {
          Authorization: this.deps.authorization(),
          "Content-Type": "application/json",
          "Idempotency-Key": event.eventId,
        },
        body: sanitizedEvent(event),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new MakeProjectionRetryableFailure("transport_failure");
    }

    if (!Number.isSafeInteger(response.status)) {
      throw new MakeProjectionPermanentFailure("invalid_transport_response");
    }
    if (response.status >= 200 && response.status <= 299) return;
    if (isRetryableStatus(response.status)) {
      throw new MakeProjectionRetryableFailure(`http_${response.status}`);
    }
    throw new MakeProjectionPermanentFailure(`http_${response.status}`);
  }
}
