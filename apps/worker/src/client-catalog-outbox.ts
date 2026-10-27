import { createHash, randomBytes } from "node:crypto";

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
  serviceTitle?: string;
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
  localSlotId?: string;
  sourceOrder: string;
  startsAt: Date;
  observedAt: Date | null;
  nativeValidUntil?: Date;
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
  listBookingAware?(input: {
    serviceCode?: string;
    language?: string;
    databaseNow: Date;
    requestExpiresAt: Date;
  }): Promise<{
    readonly cards: readonly ClientCatalogCard[];
    readonly choices: readonly {
      choiceDigest: `sha256:${string}`;
      localSlotId: string;
      expiresAt: Date;
    }[];
  }>;
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
  | Readonly<{
      kind: "request";
      catalogRequestId: string;
      version: 1 | 2;
    }>
  | Readonly<{ kind: "legacy" }>;

function decodeCatalogPayload(value: unknown): CatalogPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidCatalogPayloadError();
  }
  const keys = Object.keys(value);
  if (keys.includes("v") || keys.includes("catalogRequestId")) {
    const record = exactRecord(value, ["v", "catalogRequestId"]);
    if (
      (record.v !== 1 && record.v !== 2) ||
      typeof record.catalogRequestId !== "string" ||
      !UUID_PATTERN.test(record.catalogRequestId)
    ) {
      throw new InvalidCatalogPayloadError();
    }
    return {
      kind: "request",
      catalogRequestId: record.catalogRequestId,
      version: record.v,
    };
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
    ...(service.serviceTitle ? { serviceTitle: service.serviceTitle } : {}),
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
    ...(value.serviceTitle === undefined
      ? {}
      : { serviceTitle: boundedString(value.serviceTitle, 160) }),
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
      (slot.nativeValidUntil === undefined
        ? !slot.observedAt || !finiteDate(slot.observedAt)
        : !finiteDate(slot.nativeValidUntil) ||
          slot.nativeValidUntil.getTime() <= databaseNow.getTime() ||
          slot.startsAt.getTime() >= slot.nativeValidUntil.getTime()) ||
      !finiteDate(slot.startsAt) ||
      typeof slot.sourceOrder !== "string" ||
      slot.sourceOrder.length < 1 ||
      (slot.nativeValidUntil === undefined &&
        (!slot.observedAt ||
          slot.observedAt.getTime() < earliestObserved ||
          slot.observedAt.getTime() > databaseNow.getTime())) ||
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
  booking?: {
    generateChoiceHandle?: () => `ch1.${string}`;
    digestChoiceHandle?: (handle: `ch1.${string}`) => `sha256:${string}`;
  },
): ClientCatalogSourceReader {
  if (typeof source.listPublicServices !== "function") {
    throw new Error("client_catalog_source_capability_unavailable");
  }
  if (availability !== undefined && typeof availability.read !== "function") {
    throw new Error("client_catalog_availability_capability_unavailable");
  }
  const listServices = async (input: {
    serviceCode?: string;
    language?: string;
    databaseNow: Date;
  }): Promise<readonly PublicService[]> => {
    if (!finiteDate(input.databaseNow)) {
      throw new Error("client_catalog_database_clock_invalid");
    }
    return (
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
  };

  const reader: ClientCatalogSourceReader = {
    async list(input) {
      const services = await listServices(input);
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
                ...(service.serviceTitle
                  ? { serviceTitle: service.serviceTitle }
                  : {}),
                language: service.language,
                availability: "fresh_slots",
                slots,
              };
        }),
      );
    },
  };
  if (booking === undefined) return reader;
  if (availability === undefined) {
    throw new Error("client_catalog_booking_capability_unavailable");
  }
  const generateChoiceHandle =
    booking.generateChoiceHandle ??
    (() => `ch1.${randomBytes(32).toString("base64url")}` as const);
  const digestChoiceHandle =
    booking.digestChoiceHandle ??
    ((handle: `ch1.${string}`) =>
      `sha256:${createHash("sha256").update(handle).digest("hex")}` as const);
  return {
    ...reader,
    async listBookingAware(input) {
      if (!finiteDate(input.requestExpiresAt)) {
        throw new Error("client_catalog_database_clock_invalid");
      }
      const services = await listServices(input);
      const choices: {
        choiceDigest: `sha256:${string}`;
        localSlotId: string;
        expiresAt: Date;
      }[] = [];
      const cards = await Promise.all(
        services.map(async (service): Promise<ClientCatalogCard> => {
          const result = await availability.read({
            sourceKey: service.sourceKey,
            databaseNow: input.databaseNow,
          });
          const publicSlots = freshSlots(result, input.databaseNow);
          if (result.kind !== "complete" || publicSlots === null) {
            return catalogOnly(service);
          }
          const selected = [...result.slots]
            .sort(
              (left, right) =>
                left.startsAt.getTime() - right.startsAt.getTime() ||
                left.sourceOrder.localeCompare(right.sourceOrder),
            )
            .slice(0, 3);
          const slots = publicSlots.map(({ startsAt }, index) => {
            const sourceSlot = selected[index];
            if (
              sourceSlot === undefined ||
              typeof sourceSlot.localSlotId !== "string" ||
              !UUID_PATTERN.test(sourceSlot.localSlotId)
            ) {
              throw new Error("client_catalog_booking_slot_invalid");
            }
            const handle = generateChoiceHandle();
            if (!/^ch1\.[A-Za-z0-9_-]{43}$/u.test(handle)) {
              throw new Error("client_catalog_choice_handle_invalid");
            }
            const expiresAt = new Date(
              Math.min(
                input.requestExpiresAt.getTime(),
                sourceSlot.nativeValidUntil?.getTime() ??
                  sourceSlot.observedAt!.getTime() + SLOT_FRESHNESS_MS,
                sourceSlot.startsAt.getTime() - SLOT_LEAD_MS,
              ),
            );
            choices.push({
              choiceDigest: digestChoiceHandle(handle),
              localSlotId: sourceSlot.localSlotId,
              expiresAt,
            });
            return { startsAt, choiceHandle: handle };
          });
          return {
            displayName: service.displayName,
            serviceCode: service.serviceCode,
            ...(service.serviceTitle
              ? { serviceTitle: service.serviceTitle }
              : {}),
            language: service.language,
            availability: "fresh_slots",
            slots,
          };
        }),
      );
      return { cards, choices };
    },
  };
}

export function createClientCatalogOutboxRegistry(input: {
  local: LocalOperatorCaseOutboxRegistry;
  requests: Pick<
    ClientCatalogRequestRepository,
    "loadPending" | "materialize"
  > &
    Partial<Pick<ClientCatalogRequestRepository, "materializeBookingAware">>;
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
    if (payload.version === 2) {
      if (
        typeof input.source.listBookingAware !== "function" ||
        typeof input.requests.materializeBookingAware !== "function"
      ) {
        throw new Error("client_catalog_booking_capability_unavailable");
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const result = await input.source.listBookingAware({
          ...(request.serviceCode === undefined
            ? {}
            : { serviceCode: request.serviceCode }),
          ...(request.language === undefined
            ? {}
            : { language: request.language }),
          databaseNow: request.databaseNow,
          requestExpiresAt: request.expiresAt,
        });
        const outcome = await input.requests.materializeBookingAware({
          catalogRequestId: payload.catalogRequestId,
          cards: result.cards,
          choices: result.choices,
        });
        if (outcome !== "collision") return { kind: "applied" };
      }
      throw new Error("client_catalog_choice_handle_collision_exhausted");
    }
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
    async reconcile(message: OutboxInput): Promise<LocalReconciliationResult> {
      if (message.topic !== "catalog.show") {
        return input.local.reconcile(message);
      }
      const result = await handle(message);
      if (result.kind === "terminal") return result;
      return result.kind === "applied"
        ? { kind: "applied" }
        : { kind: "not_applied" };
    },
  });
}
