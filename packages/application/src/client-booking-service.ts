import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { ReservationStatus } from "@ii-tonya/domain";

import type { ClientPrincipal } from "./ports.js";

export type ClientBookingPublicState =
  "reserved" | "booked" | "cancelled" | "expired" | "completed" | "no_show";

export type ClientBookingReserveRepositoryResult =
  | Readonly<{
      kind: "reserved" | "replayed";
      bookingHandle: `bk1.${string}`;
      reservationStatus: ReservationStatus;
      reservedUntil: Date;
    }>
  | Readonly<{ kind: "not_found" }>
  | Readonly<{ kind: "conflict" }>
  | Readonly<{ kind: "handle_collision" }>;

export type ClientBookingCancelRepositoryResult = Readonly<{
  kind: "cancelled" | "replayed" | "not_found" | "conflict";
  providerCancellationPending?: boolean;
}>;

export interface ProtectedClientBookingRepository {
  listOwnedActive(input: { userId: string; after?: `bk1.${string}` }): Promise<
    | { kind: "not_found" }
    | {
        kind: "found";
        bookings: readonly {
          bookingHandle: `bk1.${string}`;
          state:
            | "reserved"
            | "booked"
            | "calendar_pending"
            | "cancellation_pending"
            | "confirmation_unverified";
          startsAt: Date;
          reservedUntil: Date;
        }[];
      }
  >;
  reserveProtectedChoice(input: {
    userId: string;
    choiceDigest: `sha256:${string}`;
    idempotencyKey: string;
    bookingHandle: `bk1.${string}`;
    correlationId: string;
    minimumLeadMs: 86_400_000;
    slotFreshnessMs: 900_000;
    confirmationBufferMs: number;
  }): Promise<ClientBookingReserveRepositoryResult>;
  cancelOwnedByHandle(input: {
    userId: string;
    bookingHandle: `bk1.${string}`;
    correlationId: string;
  }): Promise<ClientBookingCancelRepositoryResult>;
  rescheduleOwnedByHandle?(input: {
    userId: string;
    bookingHandle: `bk1.${string}`;
    choiceDigest: `sha256:${string}`;
    idempotencyKey: string;
    correlationId: string;
    confirmationBufferMs: number;
  }): Promise<
    Readonly<{
      kind: "rescheduled" | "replayed" | "not_found" | "conflict";
      reservationStatus?: ReservationStatus;
      reservedUntil?: Date;
    }>
  >;
}

export interface ClientActiveBooking {
  bookingHandle: `bk1.${string}`;
  state:
    | "reserved"
    | "booked"
    | "calendar_pending"
    | "cancellation_pending"
    | "confirmation_unverified";
  startsAt: string;
  reservedUntil: string;
}

export interface ClientBookingPage {
  bookings: ClientActiveBooking[];
  nextCursor: string | null;
}

export interface ClientBookingService {
  list(principal: ClientPrincipal, after?: string): Promise<ClientBookingPage>;
  reserve(
    principal: ClientPrincipal,
    input: { choiceHandle: string },
  ): Promise<{
    created: boolean;
    bookingHandle: `bk1.${string}`;
    state: ClientBookingPublicState;
    reservedUntil: string;
  }>;
  cancel(
    principal: ClientPrincipal,
    bookingHandle: string,
  ): Promise<{
    bookingHandle: `bk1.${string}`;
    state: "cancelled" | "cancellation_pending";
  }>;
  reschedule(
    principal: ClientPrincipal,
    bookingHandle: string,
    input: { choiceHandle: string },
  ): Promise<{
    bookingHandle: `bk1.${string}`;
    state: ClientBookingPublicState;
    reservedUntil: string;
    replayed: boolean;
  }>;
}

export class ClientBookingUnauthorizedError extends Error {
  readonly code = "client_booking_unauthorized";
  constructor() {
    super("client_booking_unauthorized");
    this.name = "ClientBookingUnauthorizedError";
  }
}

export class ClientBookingInvalidRequestError extends Error {
  readonly code = "client_booking_invalid_request";
  constructor() {
    super("client_booking_invalid_request");
    this.name = "ClientBookingInvalidRequestError";
  }
}

export class ClientBookingNotFoundError extends Error {
  readonly code = "client_booking_not_found";
  constructor() {
    super("client_booking_not_found");
    this.name = "ClientBookingNotFoundError";
  }
}

export class ClientBookingConflictError extends Error {
  readonly code = "client_booking_conflict";
  constructor() {
    super("client_booking_conflict");
    this.name = "ClientBookingConflictError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CHOICE_HANDLE_PATTERN = /^ch1\.[A-Za-z0-9_-]{43}$/u;
const BOOKING_HANDLE_PATTERN = /^bk1\.[A-Za-z0-9_-]{43}$/u;

const principalUserId = (principal: ClientPrincipal): string => {
  if (
    principal.authenticated !== true ||
    principal.active !== true ||
    typeof principal.userId !== "string" ||
    !UUID_PATTERN.test(principal.userId)
  ) {
    throw new ClientBookingUnauthorizedError();
  }
  return principal.userId;
};

const publicState = (status: ReservationStatus): ClientBookingPublicState => {
  switch (status) {
    case "reserved":
    case "booked":
    case "expired":
    case "completed":
    case "no_show":
      return status;
    case "cancelled_by_client":
    case "cancelled_by_expert":
      return "cancelled";
  }
};

const publicInstant = (value: Date): string => {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("client_booking_invalid_timestamp");
  }
  return value.toISOString();
};

export function createClientBookingService(deps: {
  repository: ProtectedClientBookingRepository;
  generateBookingHandle?: () => `bk1.${string}`;
  newCorrelationId?: () => string;
  confirmationBufferMs?: number;
}): ClientBookingService {
  const generateBookingHandle =
    deps.generateBookingHandle ??
    (() => `bk1.${randomBytes(32).toString("base64url")}` as const);
  const newCorrelationId = deps.newCorrelationId ?? randomUUID;
  const confirmationBufferMs = deps.confirmationBufferMs ?? 3_600_000;
  if (
    !Number.isSafeInteger(confirmationBufferMs) ||
    confirmationBufferMs < 1 ||
    confirmationBufferMs > 259_200_000
  ) {
    throw new Error("client_booking_confirmation_buffer_invalid");
  }
  const service: ClientBookingService = {
    async list(principal, after) {
      const userId = principalUserId(principal);
      if (
        after !== undefined &&
        (typeof after !== "string" || !BOOKING_HANDLE_PATTERN.test(after))
      ) {
        throw new ClientBookingInvalidRequestError();
      }
      const result = await deps.repository.listOwnedActive({
        userId,
        ...(after === undefined ? {} : { after: after as `bk1.${string}` }),
      });
      if (result.kind === "not_found") throw new ClientBookingNotFoundError();
      const bookings = result.bookings
        .slice(0, 20)
        .map((row): ClientActiveBooking => {
          if (
            !BOOKING_HANDLE_PATTERN.test(row.bookingHandle) ||
            ![
              "reserved",
              "booked",
              "calendar_pending",
              "cancellation_pending",
              "confirmation_unverified",
            ].includes(row.state)
          ) {
            throw new Error("client_booking_invalid_projection");
          }
          return {
            bookingHandle: row.bookingHandle,
            state: row.state,
            startsAt: publicInstant(row.startsAt),
            reservedUntil: publicInstant(row.reservedUntil),
          };
        });
      return {
        bookings,
        nextCursor:
          result.bookings.length > 20 ? bookings[19]!.bookingHandle : null,
      };
    },
    async reserve(principal, input) {
      const userId = principalUserId(principal);
      if (
        typeof input !== "object" ||
        input === null ||
        Object.keys(input).length !== 1 ||
        typeof input.choiceHandle !== "string" ||
        !CHOICE_HANDLE_PATTERN.test(input.choiceHandle)
      ) {
        throw new ClientBookingInvalidRequestError();
      }
      const choiceDigest = `sha256:${createHash("sha256")
        .update(input.choiceHandle)
        .digest("hex")}` as const;
      const idempotencyKey = createHash("sha256")
        .update(`client-booking-reserve-v1\0${userId}\0${choiceDigest}`)
        .digest("hex");
      const correlationId = newCorrelationId();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const bookingHandle = generateBookingHandle();
        if (!BOOKING_HANDLE_PATTERN.test(bookingHandle)) {
          throw new ClientBookingInvalidRequestError();
        }
        const result = await deps.repository.reserveProtectedChoice({
          userId,
          choiceDigest,
          idempotencyKey,
          bookingHandle,
          correlationId,
          minimumLeadMs: 86_400_000,
          slotFreshnessMs: 900_000,
          confirmationBufferMs,
        });
        if (result.kind === "handle_collision") continue;
        if (result.kind === "not_found") throw new ClientBookingNotFoundError();
        if (result.kind === "conflict") throw new ClientBookingConflictError();
        return {
          created: result.kind === "reserved",
          bookingHandle: result.bookingHandle,
          state: publicState(result.reservationStatus),
          reservedUntil: publicInstant(result.reservedUntil),
        };
      }
      throw new Error("client_booking_handle_collision_exhausted");
    },
    async cancel(principal, bookingHandle) {
      const userId = principalUserId(principal);
      if (
        typeof bookingHandle !== "string" ||
        !BOOKING_HANDLE_PATTERN.test(bookingHandle)
      ) {
        throw new ClientBookingInvalidRequestError();
      }
      const canonicalBookingHandle = bookingHandle as `bk1.${string}`;
      const result = await deps.repository.cancelOwnedByHandle({
        userId,
        bookingHandle: canonicalBookingHandle,
        correlationId: newCorrelationId(),
      });
      if (result.kind === "not_found") throw new ClientBookingNotFoundError();
      if (result.kind === "conflict") throw new ClientBookingConflictError();
      return {
        bookingHandle: canonicalBookingHandle,
        state: result.providerCancellationPending
          ? "cancellation_pending"
          : "cancelled",
      };
    },
    async reschedule(principal, bookingHandle, input) {
      const userId = principalUserId(principal);
      if (
        !BOOKING_HANDLE_PATTERN.test(bookingHandle) ||
        typeof input !== "object" ||
        input === null ||
        Object.keys(input).length !== 1 ||
        !CHOICE_HANDLE_PATTERN.test(input.choiceHandle) ||
        deps.repository.rescheduleOwnedByHandle === undefined
      ) {
        throw new ClientBookingInvalidRequestError();
      }
      const canonicalBookingHandle = bookingHandle as `bk1.${string}`;
      const choiceDigest = `sha256:${createHash("sha256")
        .update(input.choiceHandle)
        .digest("hex")}` as const;
      const result = await deps.repository.rescheduleOwnedByHandle({
        userId,
        bookingHandle: canonicalBookingHandle,
        choiceDigest,
        idempotencyKey: createHash("sha256")
          .update(
            `client-booking-reschedule-v1\0${userId}\0${canonicalBookingHandle}\0${choiceDigest}`,
          )
          .digest("hex"),
        correlationId: newCorrelationId(),
        confirmationBufferMs,
      });
      if (result.kind === "not_found") throw new ClientBookingNotFoundError();
      if (result.kind === "conflict") throw new ClientBookingConflictError();
      if (
        result.reservationStatus === undefined ||
        result.reservedUntil === undefined
      ) {
        throw new Error("client_booking_reschedule_result_invalid");
      }
      return {
        bookingHandle: canonicalBookingHandle,
        state: publicState(result.reservationStatus),
        reservedUntil: publicInstant(result.reservedUntil),
        replayed: result.kind === "replayed",
      };
    },
  };
  return Object.freeze(service);
}
