import type {
  ClientCatalogCard,
  ClientCatalogRequestRepository,
} from "@ii-tonya/db";
import type {
  LocalDispatchResult,
  LocalOperatorCaseOutboxRegistry,
  LocalReconciliationResult,
} from "@ii-tonya/worker";
import { CLIENT_CATALOG_OUTBOX_TOPICS } from "@ii-tonya/worker";

export { CLIENT_CATALOG_OUTBOX_TOPICS };

type OutboxInput = Readonly<{
  id: string;
  topic: string;
  payload: unknown;
}>;

type PublicService = Readonly<{
  sourceKey: string;
  displayName: string;
  serviceCode: string;
  language: string;
}>;

export interface ClientCatalogPublicSource {
  listPublicServices(input: {
    serviceCode?: string;
    language?: string;
    limit: number;
  }): Promise<readonly PublicService[]>;
}

type AvailabilitySlot = Readonly<{
  sourceOrder: string;
  startsAt: Date;
  observedAt: Date;
  remainingCapacity: number | null;
}>;

export interface ClientCatalogAvailabilityReader {
  read(input: {
    sourceKey: string;
    databaseNow: Date;
  }): Promise<
    | Readonly<{ kind: "complete"; slots: readonly AvailabilitySlot[] }>
    | Readonly<{ kind: "partial" | "unavailable" }>
  >;
}

export interface ClientCatalogSourceReader {
  list(input: {
    serviceCode?: string;
    language?: string;
    databaseNow: Date;
  }): Promise<readonly ClientCatalogCard[]>;
}

export interface ClientCatalogOutboxRegistry {
  readonly topics: typeof CLIENT_CATALOG_OUTBOX_TOPICS;
  dispatch(message: OutboxInput): Promise<LocalDispatchResult>;
  reconcile(message: OutboxInput): Promise<LocalReconciliationResult>;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;
const MAX_SERVICES = 20;
const MAX_AVAILABILITY_ROWS = 500;
const SLOT_FRESHNESS_MS = 15 * 60 * 1_000;
const SLOT_LEAD_MS = 24 * 60 * 60 * 1_000;

class InvalidCatalogPayloadError extends Error {}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidCatalogPayloadError();
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InvalidCatalogPayloadError();
  }
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => !keys.includes(key))
  ) {
    throw new InvalidCatalogPayloadError();
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value !== value.trim() ||
    CONTROL_PATTERN.test(value)
  ) {
    throw new InvalidCatalogPayloadError();
  }
  return value;
}

type CatalogPayload =
  | Readonly<{ kind: "request"; catalogRequestId: string }>
  | Readonly<{ kind: "legacy" }>;

function decodeCatalogPayload(value: unknown): CatalogPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidCatalogPayloadError();
  }
  const keys = Object.keys(value);
  if (keys.includes("v") || keys.includes("catalogRequestId")) {
    const record = exactRecord(value, ["v", "catalogRequestId"]);
    if (
      record.v !== 1 ||
      typeof record.catalogRequestId !== "string" ||
      !UUID_PATTERN.test(record.catalogRequestId)
    ) {
      throw new InvalidCatalogPayloadError();
    }
    return { kind: "request", catalogRequestId: record.catalogRequestId };
  }

  const expected = keys.includes("serviceCode")
    ? ["serviceCode", "allowedServiceCodes"]
    : ["allowedServiceCodes"];
  const record = exactRecord(value, expected);
  if (record.serviceCode !== undefined) boundedString(record.serviceCode, 64);
  if (
    !Array.isArray(record.allowedServiceCodes) ||
    record.allowedServiceCodes.length > MAX_SERVICES
  ) {
    throw new InvalidCatalogPayloadError();
  }
  for (const serviceCode of record.allowedServiceCodes) {
    boundedString(serviceCode, 64);
  }
  return { kind: "legacy" };
}

const finiteDate = (value: unknown): value is Date =>
  value instanceof Date && Number.isFinite(value.getTime());

function catalogOnly(service: PublicService): ClientCatalogCard {
  return {
    displayName: service.displayName,
    serviceCode: service.serviceCode,
    language: service.language,
    availability: "catalog_only",
    slots: [],
  };
}

function publicService(value: PublicService): PublicService {
  return {
    sourceKey: boundedString(value.sourceKey, 128),
    displayName: boundedString(value.displayName, 120),
    serviceCode: boundedString(value.serviceCode, 64),
    language: boundedString(value.language, 32),
  };
}

function freshSlots(
  result: Awaited<ReturnType<ClientCatalogAvailabilityReader["read"]>>,
  databaseNow: Date,
): readonly { startsAt: string }[] | null {
  if (
    result.kind !== "complete" ||
    !Array.isArray(result.slots) ||
    result.slots.length > MAX_AVAILABILITY_ROWS
  ) {
    return null;
  }
  const earliestObserved = databaseNow.getTime() - SLOT_FRESHNESS_MS;
  const earliestStart = databaseNow.getTime() + SLOT_LEAD_MS;
  const normalized: { sourceOrder: string; startsAt: Date }[] = [];
  for (const slot of result.slots) {
    if (
      typeof slot !== "object" ||
      slot === null ||
      !finiteDate(slot.observedAt) ||
      !finiteDate(slot.startsAt) ||
      typeof slot.sourceOrder !== "string" ||
      slot.sourceOrder.length < 1 ||
      slot.observedAt.getTime() < earliestObserved ||
      slot.observedAt.getTime() > databaseNow.getTime() ||
      slot.startsAt.getTime() < earliestStart ||
      !Number.isSafeInteger(slot.remainingCapacity) ||
      (slot.remainingCapacity as number) < 1
    ) {
      return null;
    }
    normalized.push({ sourceOrder: slot.sourceOrder, startsAt: slot.startsAt });
  }
  if (normalized.length === 0) return null;
  return normalized
    .sort(
      (left, right) =>
        left.startsAt.getTime() - right.startsAt.getTime() ||
        left.sourceOrder.localeCompare(right.sourceOrder),
    )
    .slice(0, 3)
    .map(({ startsAt }) => ({ startsAt: startsAt.toISOString() }));
}

export function createClientCatalogSourceReader(
  source: ClientCatalogPublicSource,
  availability?: ClientCatalogAvailabilityReader,
): ClientCatalogSourceReader {
  if (typeof source.listPublicServices !== "function") {
    throw new Error("client_catalog_source_capability_unavailable");
  }
  if (availability !== undefined && typeof availability.read !== "function") {
    throw new Error("client_catalog_availability_capability_unavailable");
  }
  return {
    async list(input) {
      if (!finiteDate(input.databaseNow)) {
        throw new Error("client_catalog_database_clock_invalid");
      }
      const services = (
        await source.listPublicServices({
          ...(input.serviceCode === undefined
            ? {}
            : { serviceCode: input.serviceCode }),
          ...(input.language === undefined ? {} : { language: input.language }),
          limit: MAX_SERVICES,
        })
      )
        .map(publicService)
        .sort(
          (left, right) =>
            left.serviceCode.localeCompare(right.serviceCode) ||
            left.language.localeCompare(right.language) ||
            left.displayName.localeCompare(right.displayName) ||
            left.sourceKey.localeCompare(right.sourceKey),
        )
        .slice(0, MAX_SERVICES);

      return Promise.all(
        services.map(async (service): Promise<ClientCatalogCard> => {
          if (availability === undefined) return catalogOnly(service);
          const slots = freshSlots(
            await availability.read({
              sourceKey: service.sourceKey,
              databaseNow: input.databaseNow,
            }),
            input.databaseNow,
          );
          return slots === null
            ? catalogOnly(service)
            : {
                displayName: service.displayName,
                serviceCode: service.serviceCode,
                language: service.language,
                availability: "fresh_slots",
                slots,
              };
        }),
      );
    },
  };
}

export function createClientCatalogOutboxRegistry(input: {
  local: LocalOperatorCaseOutboxRegistry;
  requests: ClientCatalogRequestRepository;
  source: ClientCatalogSourceReader;
}): ClientCatalogOutboxRegistry {
  if (
    input.local.topics.length !== 2 ||
    typeof input.local.dispatch !== "function" ||
    typeof input.local.reconcile !== "function" ||
    typeof input.requests.loadPending !== "function" ||
    typeof input.requests.materialize !== "function" ||
    typeof input.source.list !== "function"
  ) {
    throw new Error("client_catalog_outbox_capability_unavailable");
  }

  const handle = async (message: OutboxInput): Promise<LocalDispatchResult> => {
    let payload: CatalogPayload;
    try {
      payload = decodeCatalogPayload(message.payload);
    } catch (error) {
      if (error instanceof InvalidCatalogPayloadError) {
        return { kind: "terminal", reasonCode: "invalid_payload" };
      }
      throw error;
    }
    if (payload.kind === "legacy") return { kind: "applied" };
    const request = await input.requests.loadPending(payload.catalogRequestId);
    if (request === null || request === "replayed") return { kind: "applied" };
    const cards = await input.source.list({
      ...(request.serviceCode === undefined
        ? {}
        : { serviceCode: request.serviceCode }),
      ...(request.language === undefined ? {} : { language: request.language }),
      databaseNow: request.databaseNow,
    });
    await input.requests.materialize({
      catalogRequestId: payload.catalogRequestId,
      cards,
    });
    return { kind: "applied" };
  };

  return Object.freeze({
    topics: CLIENT_CATALOG_OUTBOX_TOPICS,
    async dispatch(message: OutboxInput): Promise<LocalDispatchResult> {
      return message.topic === "catalog.show"
        ? handle(message)
        : input.local.dispatch(message);
    },
    async reconcile(
      message: OutboxInput,
    ): Promise<LocalReconciliationResult> {
      if (message.topic !== "catalog.show") {
        return input.local.reconcile(message);
      }
      const result = await handle(message);
      if (result.kind === "terminal") return result;
      return result.kind === "applied" ? { kind: "applied" } : { kind: "not_applied" };
    },
  });
}
