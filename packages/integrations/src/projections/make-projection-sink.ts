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

const valueType = (value: unknown): ProjectionValueType | undefined => {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return undefined;
};

const isRetryableStatus = (status: number): boolean =>
  status === 408 ||
  status === 425 ||
  status === 429 ||
  (status >= 500 && status <= 599);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  Object.getPrototypeOf(value) === Object.prototype;

const invalidProjection = (reasonCode: string): never => {
  throw new MakeProjectionPermanentFailure(reasonCode);
};

const validatedEvent = (input: ProjectionEvent): ProjectionEvent => {
  if (!isPlainObject(input)) {
    return invalidProjection("invalid_projection_envelope");
  }
  const event = input as Record<string, unknown>;
  if (
    typeof event.topic !== "string" ||
    !Object.hasOwn(topicDataTypes, event.topic)
  ) {
    throw new MakeProjectionPermanentFailure("invalid_projection_topic");
  }
  if (event.schemaVersion !== 1) {
    throw new MakeProjectionPermanentFailure("invalid_projection_schema_version");
  }
  if (
    [event.eventId, event.occurredAt, event.correlationId].some(
      (value) => typeof value !== "string" || value.trim().length === 0,
    )
  ) {
    throw new MakeProjectionPermanentFailure("invalid_projection_envelope");
  }

  if (!isPlainObject(event.data)) {
    return invalidProjection("invalid_projection_data");
  }

  const allowed = topicDataTypes[event.topic as ProjectionTopic];
  const data: Record<string, string | number | boolean | null> = {};
  for (const field of Object.keys(event.data)) {
    const value = event.data[field];
    const expectedTypes = allowed[field];
    const actualType = valueType(value);
    if (
      value === undefined ||
      actualType === undefined ||
      !expectedTypes ||
      !expectedTypes.includes(actualType) ||
      (typeof value === "number" && !Number.isFinite(value))
    ) {
      throw new MakeProjectionPermanentFailure("invalid_projection_data");
    }
    data[field] = value as string | number | boolean | null;
  }

  return {
    eventId: event.eventId as string,
    topic: event.topic as ProjectionTopic,
    occurredAt: event.occurredAt as string,
    correlationId: event.correlationId as string,
    schemaVersion: 1,
    data,
  };
};

const responseStatus = (response: unknown): number | undefined => {
  if (!isPlainObject(response) || !Object.hasOwn(response, "status")) {
    return undefined;
  }
  return typeof response.status === "number" && Number.isSafeInteger(response.status)
    ? response.status
    : undefined;
};

export class MakeProjectionSink implements ProjectionSink {
  private readonly endpoint: Readonly<URL>;

  constructor(private readonly deps: MakeProjectionSinkDeps) {
    const endpoint = new URL(deps.endpoint.href);
    if (endpoint.protocol !== "https:") {
      throw new Error("make_projection_https_required");
    }
    this.endpoint = Object.freeze(endpoint);
  }

  async publish(event: ProjectionEvent): Promise<void> {
    const projection = validatedEvent(event);
    let authorization: unknown;
    try {
      authorization = this.deps.authorization();
    } catch {
      throw new MakeProjectionPermanentFailure("invalid_projection_authorization");
    }
    if (typeof authorization !== "string" || authorization.trim().length === 0) {
      throw new MakeProjectionPermanentFailure("invalid_projection_authorization");
    }
    const headerAuthorization = authorization;

    let response: unknown;
    try {
      response = await this.deps.post({
        endpoint: new URL(this.endpoint.href),
        method: "POST",
        headers: {
          Authorization: headerAuthorization,
          "Content-Type": "application/json",
          "Idempotency-Key": projection.eventId,
        },
        body: projection,
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new MakeProjectionRetryableFailure("transport_failure");
    }

    const status = responseStatus(response);
    if (status === undefined) {
      throw new MakeProjectionPermanentFailure("invalid_transport_response");
    }
    if (status >= 200 && status <= 299) return;
    if (isRetryableStatus(status)) {
      throw new MakeProjectionRetryableFailure(`http_${status}`);
    }
    throw new MakeProjectionPermanentFailure(`http_${status}`);
  }
}
