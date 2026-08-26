import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  computeReservedUntil,
  transitionReservation,
  type ReservationAction,
  type ReservationStatus,
} from "@ii-tonya/domain";
import type {
  ConversationBookingRepository,
  ConversationBookingResult,
} from "../../../application/src/client-booking-service.js";
import type { ClientConversationOperationClaimDetails } from "../../../application/src/client-conversation-authority.js";
import { frameClientConversationOperation } from "../../../application/src/client-conversation-operation-crypto.js";
import type { DrizzleDb } from "../client.js";

export interface ReserveSlotCommand {
  idempotencyKey: string;
  userId: string;
  slotId: string;
  now: Date;
  minimumLeadMs: number;
  confirmationBufferMs: number;
  correlationId: string;
}

export type ReserveSlotResult =
  | {
      kind: "reserved";
      reservationId: string;
      reservedUntil: Date;
      version: number;
    }
  | {
      kind: "duplicate";
      reservationId: string;
      reservedUntil: Date;
      version: number;
    }
  | {
      kind: "unavailable";
      reason:
        | "lead_time"
        | "capacity"
        | "deadline"
        | "stale_slot"
        | "expert_ineligible"
        | "client_active_overlap"
        | "expert_active_overlap";
    };

export interface TransitionReservationCommand {
  reservationId: string;
  expectedVersion: number;
  action: ReservationAction;
  actor: { type: "expert" | "client" | "system"; id: string };
  now: Date;
  correlationId: string;
}

export interface TransitionReservationResult {
  reservationId: string;
  status: ReservationStatus;
  version: number;
}

export interface TransitionTelegramCallbackCommand {
  tokenHash: string;
  reservationId: string;
  expertId: string;
  action: "confirm" | "cancel";
  version: number;
  now: Date;
  correlationId: string;
}

export interface BookingSlotView {
  slotId: string;
  expertId: string;
  startsAt: string;
  endsAt: string;
}

export interface BookingExpertScheduleRecord {
  reservationId: string;
  expertId: string;
  status: ReservationStatus;
  startsAt: Date;
  clientDisplayName: string;
  expertNote?: string;
  expertNoteConsent: boolean;
  meetingUrl?: string;
}

export interface BookingRepositoryOptions {
  maxSerializationAttempts?: number;
  retryDelayMs?: (attempt: number) => number;
  onSerializationExhausted?: (code: "booking_serialization_exhausted") => void;
  beforeCallbackTransition?: () => Promise<void>;
  afterProtectedChoicePrelock?: () => Promise<void>;
  conversationBookingEnabled?: boolean;
}

export type ProtectedClientBookingReserveResult =
  | {
      kind: "reserved" | "replayed";
      bookingHandle: `bk1.${string}`;
      reservationStatus: ReservationStatus;
      reservedUntil: Date;
    }
  | { kind: "not_found" | "conflict" | "handle_collision" };

export type ProtectedClientBookingCancelResult = {
  kind: "cancelled" | "replayed" | "not_found" | "conflict";
};

export interface ReserveProtectedChoiceCommand {
  userId: string;
  choiceDigest: `sha256:${string}`;
  idempotencyKey: string;
  bookingHandle: `bk1.${string}`;
  correlationId: string;
  minimumLeadMs: number;
  slotFreshnessMs: number;
  confirmationBufferMs: number;
}

export interface CancelOwnedBookingCommand {
  userId: string;
  bookingHandle: `bk1.${string}`;
  correlationId: string;
}

export interface CancelBookingForErasureCommand {
  userId: string;
  reservationId: string;
  correlationId: string;
}

type Transaction = Parameters<DrizzleDb["transaction"]>[0] extends (
  transaction: infer T,
) => unknown
  ? T
  : never;

type SlotRow = {
  slotId: string;
  expertId: string;
  expertServiceId: string;
  startsAt: Date;
  endsAt: Date;
  observedAt: Date | null;
  capacity: number;
  expertActive: boolean;
  expertVerified: boolean;
  serviceActive: boolean;
};

type RawSlotRow = Omit<SlotRow, "startsAt" | "endsAt" | "observedAt"> & {
  startsAt: Date | string;
  endsAt: Date | string;
  observedAt: Date | string | null;
};

type ReservationRow = SlotRow & {
  reservationId: string;
  userId: string;
  status: ReservationStatus;
  idempotencyKey: string;
  reservedUntil: Date;
  version: number;
};

type RawReservationRow = Omit<
  ReservationRow,
  "startsAt" | "endsAt" | "observedAt" | "reservedUntil"
> & {
  startsAt: Date | string;
  endsAt: Date | string;
  observedAt: Date | string | null;
  reservedUntil: Date | string;
};

type ReservationResultRow = {
  reservationId: string;
  userId: string;
  slotId: string | null;
  reservedUntil: Date;
  version: number;
};

type RawReservationResultRow = Omit<ReservationResultRow, "reservedUntil"> & {
  reservedUntil: Date | string;
};

type ConversationBookingCandidate = Readonly<{
  bindingId: string;
  userId: string;
}>;

type ConversationBookingMapping = ConversationBookingCandidate &
  Readonly<{
    provider: string;
    tenantToken: string | null;
    subjectToken: string;
    tokenVersion: number | null;
  }>;

type BookingAuditAction =
  | "reservation.reserve"
  | "reservation.expert_confirm"
  | "reservation.client_cancel"
  | "reservation.expert_cancel"
  | "reservation.expire"
  | "reservation.complete"
  | "reservation.mark_no_show";

const outboxTopicsFor = (action: BookingAuditAction): readonly string[] => {
  switch (action) {
    case "reservation.reserve":
      return ["planerka.reserve", "telegram.reservation_request"];
    case "reservation.expert_confirm":
      return ["planerka.confirm", "client.booking_confirmed"];
    case "reservation.client_cancel":
      return ["planerka.cancel", "telegram.booking_cancelled"];
    case "reservation.expert_cancel":
      return ["planerka.cancel", "client.booking_cancelled"];
    case "reservation.expire":
      return [
        "planerka.cancel",
        "client.reservation_expired",
        "expert.reservation_expired",
      ];
    case "reservation.complete":
      return ["client.booking_completed"];
    case "reservation.mark_no_show":
      return ["client.booking_no_show"];
  }
};

const SLOT_FRESHNESS_MS = 15 * 60 * 1_000;
const MINIMUM_LEAD_MS = 24 * 60 * 60 * 1_000;
const CONVERSATION_TOKEN_PATTERN = /^hmac-sha256:v1:[0-9a-f]{64}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/u;
const MAXIMUM_HOLD_MS = 72 * 60 * 60 * 1_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class BookingSerializationExhaustedError extends Error {
  readonly code = "booking_serialization_exhausted";

  constructor(override readonly cause: unknown) {
    super("Booking serialization retry limit exhausted", { cause });
    this.name = "BookingSerializationExhaustedError";
  }
}

export class BookingIdempotencyConflictError extends Error {
  readonly code = "booking_idempotency_conflict";

  constructor(readonly idempotencyKey: string) {
    super("Booking idempotency key belongs to another selection");
    this.name = "BookingIdempotencyConflictError";
  }
}

export class BookingDataIntegrityError extends Error {
  readonly code = "booking_invalid_timestamp";

  constructor(readonly field: string) {
    super(`Invalid database timestamp: ${field}`);
    this.name = "BookingDataIntegrityError";
  }
}

export function normalizeBookingTimestamp(
  value: Date | string,
  field: string,
): Date {
  const normalized =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(normalized.getTime())) {
    throw new BookingDataIntegrityError(field);
  }
  return normalized;
}

export function normalizeNullableBookingTimestamp(
  value: Date | string | null,
  field: string,
): Date | null {
  return value === null ? null : normalizeBookingTimestamp(value, field);
}

function normalizeSlotRow(row: RawSlotRow): SlotRow {
  return {
    ...row,
    startsAt: normalizeBookingTimestamp(row.startsAt, "slots.starts_at"),
    endsAt: normalizeBookingTimestamp(row.endsAt, "slots.ends_at"),
    observedAt: normalizeNullableBookingTimestamp(
      row.observedAt,
      "slots.observed_at",
    ),
  };
}

function normalizeReservationRow(row: RawReservationRow): ReservationRow {
  return {
    ...normalizeSlotRow(row),
    reservationId: row.reservationId,
    userId: row.userId,
    status: row.status,
    idempotencyKey: row.idempotencyKey,
    reservedUntil: normalizeBookingTimestamp(
      row.reservedUntil,
      "reservations.reserved_until",
    ),
    version: row.version,
  };
}

function normalizeReservationResultRow(
  row: RawReservationResultRow,
): ReservationResultRow {
  return {
    ...row,
    reservedUntil: normalizeBookingTimestamp(
      row.reservedUntil,
      "reservations.reserved_until",
    ),
  };
}

function hash(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function hasSqlState(error: unknown, code: string): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (
    typeof current === "object" &&
    current !== null &&
    !seen.has(current)
  ) {
    seen.add(current);
    if ((current as { code?: unknown }).code === code) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function sqlState(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current = error;
  while (
    typeof current === "object" &&
    current !== null &&
    !seen.has(current)
  ) {
    seen.add(current);
    const evidence = current as { code?: unknown; cause?: unknown };
    if (typeof evidence.code === "string") return evidence.code;
    current = evidence.cause;
  }
  return undefined;
}

const lp = (value: string): Buffer => {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
};

const conversationBookingHandle = (
  operationId: string,
  choiceDigest: string,
): `bk1.${string}` =>
  `bk1.${createHash("sha256")
    .update("ii-tonya/client-conversation-booking-handle/v1\0", "utf8")
    .update(lp(operationId))
    .update(lp(choiceDigest))
    .digest("base64url")}`;

const conversationBookingReceipt = (bookingHandle: string): string =>
  createHash("sha256")
    .update("ii-tonya/client-conversation-booking-receipt/v1\0", "utf8")
    .update(lp(bookingHandle))
    .digest("hex");

export class ConversationBookingRetryableError extends Error {
  constructor() {
    super("client_conversation_booking_retryable");
    this.name = "ConversationBookingRetryableError";
  }
}

function findSqlStateError(error: unknown, code: string): unknown {
  const seen = new Set<unknown>();
  let current = error;
  while (
    typeof current === "object" &&
    current !== null &&
    !seen.has(current)
  ) {
    seen.add(current);
    if ((current as { code?: unknown }).code === code) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return error;
}

function one<T>(rows: T[], description: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`Expected ${description}`);
  return row;
}

function finiteDate(date: Date): boolean {
  return Number.isFinite(date.getTime());
}

function isFresh(observedAt: Date | null, now: Date): boolean {
  return (
    observedAt !== null &&
    observedAt.getTime() <= now.getTime() &&
    observedAt.getTime() >= now.getTime() - SLOT_FRESHNESS_MS
  );
}

function hasConstraint(error: unknown, constraint: string): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (
    typeof current === "object" &&
    current !== null &&
    !seen.has(current)
  ) {
    seen.add(current);
    if ((current as { constraint?: unknown }).constraint === constraint)
      return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function sleep(milliseconds: number): Promise<void> {
  return milliseconds <= 0
    ? Promise.resolve()
    : new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class PostgresBookingRepository implements ConversationBookingRepository {
  private readonly maxSerializationAttempts: number;
  private readonly retryDelayMs: (attempt: number) => number;
  private readonly onSerializationExhausted: (
    code: "booking_serialization_exhausted",
  ) => void;
  private readonly beforeCallbackTransition: () => Promise<void>;
  private readonly afterProtectedChoicePrelock: () => Promise<void>;
  private readonly conversationBookingEnabled: boolean;

  constructor(
    private readonly db: DrizzleDb,
    options: BookingRepositoryOptions = {},
  ) {
    const configuredAttempts = options.maxSerializationAttempts ?? 3;
    this.maxSerializationAttempts = Number.isFinite(configuredAttempts)
      ? Math.max(1, Math.min(3, Math.floor(configuredAttempts)))
      : 3;
    this.retryDelayMs =
      options.retryDelayMs ??
      ((attempt) =>
        Math.floor(Math.random() * Math.min(250, 25 * 2 ** attempt)));
    this.onSerializationExhausted =
      options.onSerializationExhausted ?? (() => undefined);
    this.beforeCallbackTransition =
      options.beforeCallbackTransition ?? (() => Promise.resolve());
    this.afterProtectedChoicePrelock =
      options.afterProtectedChoicePrelock ?? (() => Promise.resolve());
    this.conversationBookingEnabled =
      options.conversationBookingEnabled !== false;
  }

  async reserve(command: ReserveSlotCommand): Promise<ReserveSlotResult> {
    if (
      !finiteDate(command.now) ||
      !Number.isFinite(command.minimumLeadMs) ||
      command.minimumLeadMs < 0 ||
      !Number.isFinite(command.confirmationBufferMs) ||
      command.confirmationBufferMs < 0
    ) {
      return { kind: "unavailable", reason: "deadline" };
    }
    try {
      return await this.runSerializable((tx) =>
        this.reserveInTransaction(tx, command),
      );
    } catch (error) {
      if (
        !hasSqlState(error, "23505") ||
        !hasConstraint(error, "reservations_idempotency_unique")
      ) {
        throw error;
      }
      return this.resolveReservationIdempotency(command);
    }
  }

  reserveAndPublish(command: ReserveSlotCommand): Promise<ReserveSlotResult> {
    return this.reserve(command);
  }

  transition(
    command: TransitionReservationCommand,
  ): Promise<TransitionReservationResult> {
    if (
      !finiteDate(command.now) ||
      !Number.isInteger(command.expectedVersion)
    ) {
      return Promise.reject(new Error("Invalid reservation transition input"));
    }
    return this.runSerializable((tx) =>
      this.transitionInTransaction(tx, command),
    );
  }

  transitionAndPublish(
    command: TransitionReservationCommand,
  ): Promise<TransitionReservationResult> {
    return this.transition(command);
  }

  async searchSlots(command: {
    serviceCode?: string;
    language?: string;
    from: Date;
    to: Date;
    now: Date;
    minimumLeadMs: number;
  }): Promise<readonly BookingSlotView[]> {
    if (
      !finiteDate(command.from) ||
      !finiteDate(command.to) ||
      !finiteDate(command.now) ||
      command.from.getTime() >= command.to.getTime() ||
      !Number.isFinite(command.minimumLeadMs) ||
      command.minimumLeadMs < 0
    ) {
      throw new Error("Invalid slot search query");
    }
    const earliest = new Date(
      Math.max(
        command.from.getTime(),
        command.now.getTime() + command.minimumLeadMs,
      ),
    );
    const serviceCode = command.serviceCode ?? null;
    const language = command.language ?? null;
    const rows = await this.db.execute<{
      slotId: string;
      expertId: string;
      startsAt: Date | string;
      endsAt: Date | string;
    }>(sql`
      select
        s.id as "slotId",
        e.id as "expertId",
        s.starts_at as "startsAt",
        s.ends_at as "endsAt"
      from slots s
      join expert_services es on es.id = s.expert_service_id
      join experts e on e.id = es.expert_id
      where e.active
        and e.verified
        and es.active
        and es.code is not null
        and es.language is not null
        and (${serviceCode}::text is null or es.code = ${serviceCode})
        and (${language}::text is null or es.language = ${language})
        and s.observed_at >= ${new Date(
          command.now.getTime() - SLOT_FRESHNESS_MS,
        )}
        and s.observed_at <= ${command.now}
        and s.starts_at >= ${earliest}
        and s.starts_at < ${command.to}
        and (
          select count(*)
          from reservations r
          where r.slot_id = s.id
            and (
              r.status = 'booked'
              or (
                r.status = 'reserved'
                and r.reserved_until > ${command.now}
              )
            )
        ) < s.capacity
      order by s.starts_at, s.id
      limit 500
    `);
    return rows.rows.map((row) => {
      const startsAt =
        row.startsAt instanceof Date ? row.startsAt : new Date(row.startsAt);
      const endsAt =
        row.endsAt instanceof Date ? row.endsAt : new Date(row.endsAt);
      if (!finiteDate(startsAt) || !finiteDate(endsAt)) {
        throw new BookingDataIntegrityError(
          "Slot search returned an invalid timestamp",
        );
      }
      return {
        slotId: row.slotId,
        expertId: row.expertId,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      };
    });
  }

  async listAuthorizedExpertSchedule(command: {
    expertId: string;
    telegramUserId: string;
    from: Date;
    to: Date;
  }): Promise<readonly BookingExpertScheduleRecord[] | null> {
    if (
      !UUID_PATTERN.test(command.expertId) ||
      !/^[1-9]\d{0,19}$/.test(command.telegramUserId) ||
      !finiteDate(command.from) ||
      !finiteDate(command.to) ||
      command.from.getTime() >= command.to.getTime()
    ) {
      return null;
    }
    const result = await this.db.execute<{
      reservationId: string;
      expertId: string;
      status: ReservationStatus;
      startsAt: Date | string;
      clientDisplayName: string;
      expertNote: string | null;
      expertNoteConsent: boolean;
      meetingUrl: string | null;
    }>(sql`
      select
        r.id as "reservationId",
        r.expert_id as "expertId",
        r.status,
        s.starts_at as "startsAt",
        coalesce(nullif(cp.display_name, ''), 'Клиент') as "clientDisplayName",
        case
          when note_consent.granted then cp.expert_note
          else null
        end as "expertNote",
        note_consent.granted as "expertNoteConsent",
        case
          when r.status = 'booked' then r.meeting_url
          else null
        end as "meetingUrl"
      from experts e
      join users expert_user on expert_user.id = e.user_id and expert_user.active
      join channel_identities ci
        on ci.user_id = e.user_id
        and ci.provider = 'telegram'
        and ci.external_id = ${command.telegramUserId}
      join reservations r on r.expert_id = e.id
      join slots s on s.id = r.slot_id
      left join client_profiles cp on cp.user_id = r.user_id
      left join lateral (
        select coalesce(
          bool_and(latest.decision = 'granted'),
          false
        ) as granted
        from consents latest
        where latest.user_id = r.user_id
          and latest.consent_type = 'expert_note'
          and latest.created_at = (
            select max(candidate.created_at)
            from consents candidate
            where candidate.user_id = r.user_id
              and candidate.consent_type = 'expert_note'
          )
      ) note_consent on true
      where e.id = ${command.expertId}::uuid
        and e.active
        and e.verified
        and r.status in ('reserved', 'booked')
        and (r.status = 'booked' or r.reserved_until > ${command.from})
        and s.starts_at >= ${command.from}
        and s.starts_at < ${command.to}
      order by s.starts_at, r.id
      limit 500
    `);
    if (result.rows.length === 0) {
      const authorized = await this.db.execute<{ authorized: boolean }>(sql`
        select exists (
          select 1
          from experts e
          join users expert_user on expert_user.id = e.user_id and expert_user.active
          join channel_identities ci on ci.user_id = e.user_id
          where e.id = ${command.expertId}::uuid
            and e.active
            and e.verified
            and ci.provider = 'telegram'
            and ci.external_id = ${command.telegramUserId}
        ) as authorized
      `);
      if (authorized.rows[0]?.authorized !== true) return null;
    }
    return result.rows.map((row) => {
      const startsAt =
        row.startsAt instanceof Date ? row.startsAt : new Date(row.startsAt);
      if (!finiteDate(startsAt)) {
        throw new BookingDataIntegrityError(
          "Expert schedule returned an invalid timestamp",
        );
      }
      return {
        reservationId: row.reservationId,
        expertId: row.expertId,
        status: row.status,
        startsAt,
        clientDisplayName: row.clientDisplayName,
        ...(row.expertNoteConsent && row.expertNote !== null
          ? { expertNote: row.expertNote }
          : {}),
        expertNoteConsent: row.expertNoteConsent,
        ...(row.status === "booked" && row.meetingUrl !== null
          ? { meetingUrl: row.meetingUrl }
          : {}),
      };
    });
  }

  transitionFromTelegramCallback(
    command: TransitionTelegramCallbackCommand,
  ): Promise<TransitionReservationResult | null> {
    if (
      !finiteDate(command.now) ||
      !/^[a-f0-9]{64}$/.test(command.tokenHash) ||
      !UUID_PATTERN.test(command.reservationId) ||
      !UUID_PATTERN.test(command.expertId) ||
      !Number.isInteger(command.version) ||
      command.version <= 0
    ) {
      return Promise.resolve(null);
    }
    return this.runSerializable(async (tx) => {
      const consumed = (
        await tx.execute<{ reservationId: string }>(sql`
          update notifications n
          set callback_consumed_at = ${command.now},
              updated_at = ${command.now}
          from reservations r
          join experts e on e.id = r.expert_id
          join slots s
            on s.id = r.slot_id
            and s.expert_service_id = r.expert_service_id
          join expert_services es
            on es.id = r.expert_service_id
            and es.expert_id = r.expert_id
          where n.callback_token_hash = ${command.tokenHash}
            and n.reservation_id = r.id
            and r.id = ${command.reservationId}::uuid
            and n.callback_consumed_at is null
            and n.callback_expires_at > ${command.now}
            and r.expert_id = ${command.expertId}::uuid
            and n.callback_expert_id = r.expert_id
            and e.active
            and e.verified
            and n.callback_action = ${command.action}
            and n.callback_version = ${command.version}
            and r.version = ${command.version}
            and (
              (
                ${command.action} = 'confirm'
                and r.status = 'reserved'
                and r.reserved_until > ${command.now}
                and s.starts_at > ${command.now}
                and s.observed_at >= ${new Date(
                  command.now.getTime() - SLOT_FRESHNESS_MS,
                )}
                and s.observed_at <= ${command.now}
                and es.active
              )
              or (
                ${command.action} = 'cancel'
                and r.status in ('reserved', 'booked')
              )
            )
            and n.callback_claims::jsonb @> jsonb_build_object(
              'reservationId', r.id::text,
              'expertId', r.expert_id::text,
              'action', ${command.action}::text,
              'version', ${command.version}::integer
            )
          returning r.id as "reservationId"
        `)
      ).rows[0];
      if (consumed === undefined) return null;
      await this.beforeCallbackTransition();
      return this.transitionInTransaction(tx, {
        reservationId: consumed.reservationId,
        expectedVersion: command.version,
        action:
          command.action === "confirm" ? "expert_confirm" : "expert_cancel",
        actor: { type: "expert", id: command.expertId },
        now: command.now,
        correlationId: command.correlationId,
      });
    });
  }

  async reserveProtectedChoice(
    command: ReserveProtectedChoiceCommand,
  ): Promise<ProtectedClientBookingReserveResult> {
    if (
      !UUID_PATTERN.test(command.userId) ||
      !/^sha256:[0-9a-f]{64}$/u.test(command.choiceDigest) ||
      !/^[0-9a-f]{64}$/u.test(command.idempotencyKey) ||
      !/^bk1\.[A-Za-z0-9_-]{43}$/u.test(command.bookingHandle) ||
      command.correlationId.length < 1 ||
      command.minimumLeadMs !== MINIMUM_LEAD_MS ||
      command.slotFreshnessMs !== SLOT_FRESHNESS_MS ||
      !Number.isSafeInteger(command.confirmationBufferMs) ||
      command.confirmationBufferMs < 1 ||
      command.confirmationBufferMs > MAXIMUM_HOLD_MS
    ) {
      return { kind: "conflict" };
    }
    try {
      return await this.runSerializable(async (tx) => {
        await this.lockProtectedChoicePrelock(tx, command.choiceDigest);
        return this.reserveProtectedChoiceInTransaction(tx, command);
      });
    } catch (error) {
      if (
        hasSqlState(error, "23505") &&
        hasConstraint(error, "client_booking_receipts_booking_handle_unique")
      ) {
        return { kind: "handle_collision" };
      }
      throw error;
    }
  }

  async reserveConversation(
    claim: ClientConversationOperationClaimDetails,
  ): Promise<ConversationBookingResult> {
    if (!this.conversationBookingEnabled) {
      return { kind: "rejected", code: "feature_disabled" };
    }
    if (
      claim.toolKind !== "start_booking" ||
      claim.requiredScope !== "client_booking:write" ||
      !("choiceHandle" in claim.frozenInput) ||
      !/^ch1\.[A-Za-z0-9_-]{43}$/u.test(claim.frozenInput.choiceHandle) ||
      !UUID_PATTERN.test(claim.operationId)
    ) {
      return { kind: "rejected", code: "conflict" };
    }
    const choiceHandle = claim.frozenInput.choiceHandle;
    const choiceDigest = `sha256:${createHash("sha256")
      .update(choiceHandle)
      .digest("hex")}` as const;
    const candidate = (
      await this.db.execute<ConversationBookingCandidate>(sql`
        select m.id as "bindingId",m.user_id as "userId"
        from client_conversation_operations o
        join provider_subject_mappings m on m.id=o.binding_id
        where o.id=${claim.operationId}::uuid
      `)
    ).rows[0];
    if (candidate === undefined) return { kind: "rejected", code: "not_found" };

    try {
      return await this.runSerializable(async (tx) => {
        await this.lockProtectedChoicePrelock(tx, choiceDigest);
        try {
          await tx.execute(sql`set local statement_timeout='2s'`);
          await tx.execute(sql`set local lock_timeout='2s'`);
          await tx.execute(
            sql`set local idle_in_transaction_session_timeout='2s'`,
          );
          const user = (
            await tx.execute<{ active: boolean }>(sql`
              select active from users
              where id=${candidate.userId}::uuid
              for update
            `)
          ).rows[0];
          if (user?.active !== true) {
            return { kind: "rejected", code: "not_found" } as const;
          }
          const mapping = (
            await tx.execute<ConversationBookingMapping>(sql`
              select id as "bindingId",user_id as "userId",provider,
                tenant_token as "tenantToken",subject_token as "subjectToken",
                token_version as "tokenVersion"
              from provider_subject_mappings
              where id=${candidate.bindingId}::uuid
              for update
            `)
          ).rows[0];
          if (
            mapping === undefined ||
            mapping.userId !== candidate.userId ||
            mapping.provider !== "selarti.client-thread.v1" ||
            mapping.tenantToken === null ||
            !CONVERSATION_TOKEN_PATTERN.test(mapping.tenantToken) ||
            !CONVERSATION_TOKEN_PATTERN.test(mapping.subjectToken) ||
            Number(mapping.tokenVersion) !== 1
          ) {
            return { kind: "rejected", code: "not_found" } as const;
          }
          const grant = (
            await tx.execute<{
              expiresAt: Date | string;
              revokedAt: Date | string | null;
              databaseNow: Date | string;
            }>(sql`
              select expires_at as "expiresAt",revoked_at as "revokedAt",
                clock_timestamp() as "databaseNow"
              from client_conversation_grants
              where provider_subject_mapping_id=${candidate.bindingId}::uuid
                and scope='client_booking:write'
              for update
            `)
          ).rows[0];
          const grantNow =
            grant === undefined ? null : new Date(grant.databaseNow);
          const lockedGrantExpiresAt =
            grant === undefined ? null : new Date(grant.expiresAt);
          if (
            grant === undefined ||
            grant.revokedAt !== null ||
            grantNow === null ||
            lockedGrantExpiresAt === null ||
            !Number.isFinite(grantNow.getTime()) ||
            !Number.isFinite(lockedGrantExpiresAt.getTime()) ||
            lockedGrantExpiresAt.getTime() <= grantNow.getTime()
          ) {
            return { kind: "rejected", code: "not_found" } as const;
          }
          const operation = (
            await tx.execute<{
              messageEventId: string;
              bindingId: string | null;
              requiredScope: string;
              toolKind: string;
              proposalDigest: string;
              payloadKeyId: string | null;
              payloadExpiresAt: Date | string;
              status: string;
              claimOwnerId: string | null;
              claimToken: string | null;
              claimFence: number | string;
              leaseUntil: Date | string | null;
              databaseNow: Date | string;
            }>(sql`
              select message_event_id as "messageEventId",binding_id as "bindingId",
                required_scope as "requiredScope",tool_kind as "toolKind",
                proposal_digest as "proposalDigest",payload_key_id as "payloadKeyId",
                payload_expires_at as "payloadExpiresAt",status,
                claim_owner_id as "claimOwnerId",claim_token as "claimToken",
                claim_fence as "claimFence",lease_until as "leaseUntil",
                clock_timestamp() as "databaseNow"
              from client_conversation_operations
              where id=${claim.operationId}::uuid
              for update
            `)
          ).rows[0];
          const databaseNow =
            operation === undefined ? null : new Date(operation.databaseNow);
          const grantExpiresAt = new Date(grant.expiresAt);
          const leaseUntil =
            operation?.leaseUntil === null || operation === undefined
              ? null
              : new Date(operation.leaseUntil);
          const payloadExpiresAt =
            operation === undefined
              ? null
              : new Date(operation.payloadExpiresAt);
          if (
            operation === undefined ||
            databaseNow === null ||
            leaseUntil === null ||
            payloadExpiresAt === null ||
            !Number.isFinite(databaseNow.getTime()) ||
            !Number.isFinite(grantExpiresAt.getTime()) ||
            !Number.isFinite(leaseUntil.getTime()) ||
            !Number.isFinite(payloadExpiresAt.getTime()) ||
            !UUID_PATTERN.test(operation.messageEventId) ||
            operation.status !== "processing" ||
            operation.bindingId !== candidate.bindingId ||
            operation.toolKind !== "start_booking" ||
            operation.requiredScope !== "client_booking:write" ||
            operation.claimOwnerId !== claim.claimOwnerId ||
            operation.claimToken !== claim.claimToken ||
            !Number.isSafeInteger(Number(operation.claimFence)) ||
            Number(operation.claimFence) !== claim.claimFence ||
            grantExpiresAt.getTime() <= databaseNow.getTime() ||
            leaseUntil.getTime() <= databaseNow.getTime() ||
            payloadExpiresAt.getTime() <= databaseNow.getTime() ||
            operation.payloadKeyId === null ||
            !KEY_ID_PATTERN.test(operation.payloadKeyId) ||
            !HASH_PATTERN.test(operation.proposalDigest)
          ) {
            return { kind: "rejected", code: "conflict" } as const;
          }
          let proposalDigest: string;
          try {
            proposalDigest = frameClientConversationOperation({
              operationId: claim.operationId,
              messageEventId: operation.messageEventId,
              bindingId: candidate.bindingId,
              keyId: operation.payloadKeyId,
              payloadExpiresAt: payloadExpiresAt.toISOString(),
              proposal: { kind: "start_booking", choiceHandle },
            }).proposalDigest;
          } catch {
            return { kind: "rejected", code: "conflict" } as const;
          }
          if (proposalDigest !== operation.proposalDigest) {
            return { kind: "rejected", code: "conflict" } as const;
          }
        } catch (error) {
          if (["55P03", "57014"].includes(sqlState(error) ?? "")) {
            throw new ConversationBookingRetryableError();
          }
          throw error;
        }

        const result = await this.reserveProtectedChoiceInTransaction(tx, {
          userId: candidate.userId,
          choiceDigest,
          idempotencyKey: createHash("sha256")
            .update(
              `client-booking-reserve-v1\0${candidate.userId}\0${choiceDigest}`,
            )
            .digest("hex"),
          bookingHandle: conversationBookingHandle(
            claim.operationId,
            choiceDigest,
          ),
          correlationId: `client-conversation:${claim.operationId}`,
          minimumLeadMs: MINIMUM_LEAD_MS,
          slotFreshnessMs: SLOT_FRESHNESS_MS,
          confirmationBufferMs: 3_600_000,
        });
        if (result.kind === "reserved" || result.kind === "replayed") {
          return {
            kind: "applied",
            downstreamReceiptDigest: conversationBookingReceipt(
              result.bookingHandle,
            ),
          } as const;
        }
        return {
          kind: "rejected",
          code: result.kind === "not_found" ? "not_found" : "conflict",
        } as const;
      });
    } catch (error) {
      if (
        hasSqlState(error, "23505") &&
        hasConstraint(error, "client_booking_receipts_booking_handle_unique")
      ) {
        return { kind: "rejected", code: "conflict" };
      }
      throw error;
    }
  }

  private async lockProtectedChoicePrelock(
    tx: Transaction,
    choiceDigest: `sha256:${string}`,
  ): Promise<void> {
    await tx.execute(sql`
      select pg_advisory_xact_lock(
        hashtextextended('choice:' || ${choiceDigest},0)
      )
    `);
    await this.afterProtectedChoicePrelock();
  }

  private async reserveProtectedChoiceInTransaction(
    tx: Transaction,
    command: ReserveProtectedChoiceCommand,
  ): Promise<ProtectedClientBookingReserveResult> {
    const now = normalizeBookingTimestamp(
      one(
        (
          await tx.execute<{ databaseNow: Date | string }>(sql`
            select clock_timestamp() as "databaseNow"
          `)
        ).rows,
        "the database clock",
      ).databaseNow,
      "clock_timestamp",
    );
    const replay = (
      await tx.execute<{
        bookingHandle: `bk1.${string}`;
        reservationStatus: ReservationStatus;
        reservedUntil: Date | string;
      }>(sql`
        select b.booking_handle as "bookingHandle",
          r.status as "reservationStatus",r.reserved_until as "reservedUntil"
        from client_booking_receipts b
        join reservations r on r.id=b.reservation_id
        join users u on u.id=b.user_id
        where b.user_id=${command.userId}::uuid
          and b.choice_digest=${command.choiceDigest}
          and u.active
      `)
    ).rows[0];
    if (replay !== undefined) {
      return {
        kind: "replayed",
        bookingHandle: replay.bookingHandle,
        reservationStatus: replay.reservationStatus,
        reservedUntil: normalizeBookingTimestamp(
          replay.reservedUntil,
          "reservations.reserved_until",
        ),
      };
    }
    const choice = (
      await tx.execute<{ slotId: string }>(sql`
        select c.slot_id as "slotId"
        from client_catalog_choices c
        join client_catalog_requests cr on cr.id=c.request_id
        join users u on u.id=cr.user_id
        where c.choice_digest=${command.choiceDigest}
          and cr.user_id=${command.userId}::uuid
          and u.active
          and cr.state='ready'
          and c.expires_at>${now}
          and cr.expires_at>${now}
        for update of c,cr,u
      `)
    ).rows[0];
    if (choice === undefined) return { kind: "not_found" };
    const reservation = await this.reserveInTransaction(tx, {
      idempotencyKey: command.idempotencyKey,
      userId: command.userId,
      slotId: choice.slotId,
      now,
      minimumLeadMs: command.minimumLeadMs,
      confirmationBufferMs: command.confirmationBufferMs,
      correlationId: command.correlationId,
    });
    if (reservation.kind === "unavailable") return { kind: "conflict" };
    if (reservation.reservedUntil.getTime() - now.getTime() > MAXIMUM_HOLD_MS) {
      throw new Error("client_booking_hold_policy_invalid");
    }
    await tx.execute(sql`
      insert into client_booking_receipts (
        user_id,choice_digest,booking_handle,reservation_id
      ) values (
        ${command.userId}::uuid,${command.choiceDigest},
        ${command.bookingHandle},${reservation.reservationId}::uuid
      )
    `);
    return {
      kind: "reserved",
      bookingHandle: command.bookingHandle,
      reservationStatus: "reserved",
      reservedUntil: reservation.reservedUntil,
    };
  }

  cancelOwnedByHandle(
    command: CancelOwnedBookingCommand,
  ): Promise<ProtectedClientBookingCancelResult> {
    if (
      !UUID_PATTERN.test(command.userId) ||
      !/^bk1\.[A-Za-z0-9_-]{43}$/u.test(command.bookingHandle) ||
      command.correlationId.length < 1
    ) {
      return Promise.resolve({ kind: "not_found" });
    }
    return this.runSerializable(async (tx) => {
      const now = normalizeBookingTimestamp(
        one(
          (
            await tx.execute<{ databaseNow: Date | string }>(sql`
              select clock_timestamp() as "databaseNow"
            `)
          ).rows,
          "the database clock",
        ).databaseNow,
        "clock_timestamp",
      );
      const owned = (
        await tx.execute<{
          reservationId: string;
          status: ReservationStatus;
          version: number;
        }>(sql`
          select r.id as "reservationId",r.status,r.version
          from client_booking_receipts b
          join reservations r on r.id=b.reservation_id
          join users u on u.id=b.user_id
          where b.user_id=${command.userId}::uuid
            and b.booking_handle=${command.bookingHandle}
            and u.active
        `)
      ).rows[0];
      if (owned === undefined) return { kind: "not_found" };
      if (
        owned.status === "cancelled_by_client" ||
        owned.status === "cancelled_by_expert"
      ) {
        return { kind: "replayed" };
      }
      if (owned.status !== "reserved" && owned.status !== "booked") {
        return { kind: "conflict" };
      }
      const result = await this.transitionInTransaction(tx, {
        reservationId: owned.reservationId,
        expectedVersion: owned.version,
        action: "client_cancel",
        actor: { type: "client", id: command.userId },
        now,
        correlationId: command.correlationId,
      });
      return result.status === "cancelled_by_client"
        ? { kind: "cancelled" }
        : { kind: "conflict" };
    });
  }

  cancelBookingForErasure(
    command: CancelBookingForErasureCommand,
  ): Promise<ProtectedClientBookingCancelResult> {
    if (
      !UUID_PATTERN.test(command.userId) ||
      !UUID_PATTERN.test(command.reservationId) ||
      command.correlationId.length < 1
    ) {
      return Promise.resolve({ kind: "not_found" });
    }
    return this.runSerializable(async (tx) => {
      const owned = (
        await tx.execute<{ status: ReservationStatus; version: number }>(sql`
          select status,version from reservations
          where id=${command.reservationId}::uuid
            and user_id=${command.userId}::uuid
        `)
      ).rows[0];
      if (owned === undefined) return { kind: "not_found" };
      if (
        owned.status === "cancelled_by_client" ||
        owned.status === "cancelled_by_expert"
      ) {
        return { kind: "replayed" };
      }
      if (owned.status !== "reserved" && owned.status !== "booked") {
        return { kind: "conflict" };
      }
      const clock = one(
        (
          await tx.execute<{ databaseNow: Date | string }>(sql`
            select clock_timestamp() as "databaseNow"
          `)
        ).rows,
        "the database clock",
      );
      await this.transitionInTransaction(tx, {
        reservationId: command.reservationId,
        expectedVersion: owned.version,
        action: "client_cancel",
        actor: { type: "client", id: command.userId },
        now: normalizeBookingTimestamp(clock.databaseNow, "clock_timestamp"),
        correlationId: command.correlationId,
      });
      return { kind: "cancelled" };
    });
  }

  private async runSerializable<T>(
    operation: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    let finalSerializationError: unknown;
    for (
      let attempt = 1;
      attempt <= this.maxSerializationAttempts;
      attempt += 1
    ) {
      try {
        return await this.db.transaction(async (tx) => {
          await tx.execute(sql`set transaction isolation level serializable`);
          return operation(tx);
        });
      } catch (error) {
        if (!hasSqlState(error, "40001")) throw error;
        finalSerializationError = findSqlStateError(error, "40001");
        if (attempt < this.maxSerializationAttempts) {
          const configuredDelay = this.retryDelayMs(attempt);
          await sleep(
            Number.isFinite(configuredDelay)
              ? Math.min(250, Math.max(0, configuredDelay))
              : 0,
          );
        }
      }
    }
    this.onSerializationExhausted("booking_serialization_exhausted");
    throw new BookingSerializationExhaustedError(finalSerializationError);
  }

  private async reserveInTransaction(
    tx: Transaction,
    command: ReserveSlotCommand,
  ): Promise<ReserveSlotResult> {
    await tx.execute(sql`
      select pg_advisory_xact_lock(hashtextextended(lock_key, 0))
      from (
        select lock_key
        from (
          values
            (${`slot:${command.slotId}`}),
            (${`client:${command.userId}`}),
            (
              'expert:' || coalesce((
                select e.id::text
                from slots s
                join expert_services es on es.id = s.expert_service_id
                join experts e on e.id = es.expert_id
                where s.id = ${command.slotId}::uuid
              ), ${command.slotId})
            )
        ) as lock_keys(lock_key)
        order by lock_key
      ) ordered_locks
    `);

    const rawSlot = (
      await tx.execute<RawSlotRow>(sql`
      select
        s.id as "slotId",
        e.id as "expertId",
        es.id as "expertServiceId",
        s.starts_at as "startsAt",
        s.ends_at as "endsAt",
        s.observed_at as "observedAt",
        s.capacity,
        e.active as "expertActive",
        e.verified as "expertVerified",
        es.active as "serviceActive"
      from slots s
      join expert_services es on es.id = s.expert_service_id
      join experts e on e.id = es.expert_id
      where s.id = ${command.slotId}::uuid
      for update of s, es, e
    `)
    ).rows[0];
    if (rawSlot === undefined) {
      return { kind: "unavailable", reason: "stale_slot" };
    }
    const slot = normalizeSlotRow(rawSlot);

    const rawDuplicate = (
      await tx.execute<RawReservationResultRow>(sql`
      select
        id as "reservationId",
        user_id as "userId",
        slot_id as "slotId",
        reserved_until as "reservedUntil",
        version
      from reservations
      where idempotency_key = ${command.idempotencyKey}
    `)
    ).rows[0];
    if (rawDuplicate !== undefined) {
      return this.classifyDuplicate(
        command,
        normalizeReservationResultRow(rawDuplicate),
      );
    }

    if (!isFresh(slot.observedAt, command.now)) {
      return { kind: "unavailable", reason: "stale_slot" };
    }
    if (!slot.expertActive || !slot.expertVerified || !slot.serviceActive) {
      return { kind: "unavailable", reason: "expert_ineligible" };
    }
    if (
      slot.startsAt.getTime() <
      command.now.getTime() + command.minimumLeadMs
    ) {
      return { kind: "unavailable", reason: "lead_time" };
    }

    let reservedUntil: Date;
    try {
      reservedUntil = computeReservedUntil(
        command.now,
        slot.startsAt,
        command.confirmationBufferMs,
      );
    } catch {
      return { kind: "unavailable", reason: "deadline" };
    }

    const capacity = one(
      (
        await tx.execute<{ count: number }>(sql`
      select count(*)::integer as count
      from reservations
      where slot_id = ${slot.slotId}::uuid
        and status in ('reserved', 'booked')
    `)
      ).rows,
      "a slot capacity count",
    );
    if (Number(capacity.count) >= slot.capacity) {
      return { kind: "unavailable", reason: "capacity" };
    }

    if (await this.hasOverlap(tx, "client", command.userId, slot)) {
      return { kind: "unavailable", reason: "client_active_overlap" };
    }
    if (await this.hasOverlap(tx, "expert", slot.expertId, slot)) {
      return { kind: "unavailable", reason: "expert_active_overlap" };
    }

    const rawInserted = one(
      (
        await tx.execute<RawReservationResultRow>(sql`
      insert into reservations (
        user_id, slot_id, expert_id, expert_service_id, status, idempotency_key,
        reserved_until, version, created_at, updated_at
      ) values (
        ${command.userId}::uuid, ${slot.slotId}::uuid, ${slot.expertId}::uuid,
        ${slot.expertServiceId}::uuid, 'reserved', ${command.idempotencyKey},
        ${reservedUntil}, 1, ${command.now}, ${command.now}
      )
      returning
        id as "reservationId",
        user_id as "userId",
        slot_id as "slotId",
        reserved_until as "reservedUntil",
        version
    `)
      ).rows,
      "an inserted reservation",
    );
    const inserted = normalizeReservationResultRow(rawInserted);

    await this.auditAndOutbox(tx, {
      actorType: "client",
      actorId: command.userId,
      action: "reservation.reserve",
      reservationId: inserted.reservationId,
      decision: "reserved",
      reasonCode: "slot_selected",
      correlationId: command.correlationId,
      occurredAt: command.now,
      version: inserted.version,
    });
    return {
      kind: "reserved",
      reservationId: inserted.reservationId,
      reservedUntil: inserted.reservedUntil,
      version: inserted.version,
    };
  }

  private classifyDuplicate(
    command: ReserveSlotCommand,
    stored: ReservationResultRow,
  ): ReserveSlotResult {
    if (stored.userId !== command.userId || stored.slotId !== command.slotId) {
      throw new BookingIdempotencyConflictError(command.idempotencyKey);
    }
    return {
      kind: "duplicate",
      reservationId: stored.reservationId,
      reservedUntil: stored.reservedUntil,
      version: stored.version,
    };
  }

  private async resolveReservationIdempotency(
    command: ReserveSlotCommand,
  ): Promise<ReserveSlotResult> {
    const rawStored = (
      await this.db.execute<RawReservationResultRow>(sql`
      select
        id as "reservationId",
        user_id as "userId",
        slot_id as "slotId",
        reserved_until as "reservedUntil",
        version
      from reservations
      where idempotency_key = ${command.idempotencyKey}
    `)
    ).rows[0];
    if (rawStored === undefined) {
      throw new BookingIdempotencyConflictError(command.idempotencyKey);
    }
    return this.classifyDuplicate(
      command,
      normalizeReservationResultRow(rawStored),
    );
  }

  private async transitionInTransaction(
    tx: Transaction,
    command: TransitionReservationCommand,
  ): Promise<TransitionReservationResult> {
    await tx.execute(sql`
      select pg_advisory_xact_lock(hashtextextended(lock_key, 0))
      from (
        select lock_key
        from (
          select ${`reservation:${command.reservationId}`} as lock_key
          union all
          select 'slot:' || r.slot_id::text from reservations r
            where r.id = ${command.reservationId}::uuid
          union all
          select 'client:' || r.user_id::text from reservations r
            where r.id = ${command.reservationId}::uuid
          union all
          select 'expert:' || r.expert_id::text from reservations r
            where r.id = ${command.reservationId}::uuid
        ) lock_keys
        order by lock_key
      ) ordered_locks
    `);
    const rawReservation = (
      await tx.execute<RawReservationRow>(sql`
      select
        r.id as "reservationId",
        r.user_id as "userId",
        r.slot_id as "slotId",
        r.expert_id as "expertId",
        r.expert_service_id as "expertServiceId",
        r.status,
        r.idempotency_key as "idempotencyKey",
        r.reserved_until as "reservedUntil",
        r.version,
        s.starts_at as "startsAt",
        s.ends_at as "endsAt",
        s.observed_at as "observedAt",
        s.capacity,
        e.active as "expertActive",
        e.verified as "expertVerified",
        es.active as "serviceActive"
      from reservations r
      join slots s on s.id = r.slot_id
      join experts e on e.id = r.expert_id
      join expert_services es on es.id = r.expert_service_id
      where r.id = ${command.reservationId}::uuid
      for update of r, s, e, es
    `)
    ).rows[0];
    if (rawReservation === undefined) throw new Error("Reservation not found");
    const reservation = normalizeReservationRow(rawReservation);
    if (reservation.version !== command.expectedVersion) {
      throw new Error("Stale reservation version");
    }

    await this.assertTransitionEligibility(tx, reservation, command);
    const nextStatus = transitionReservation(
      reservation.status,
      command.action,
    );
    const updated =
      command.action === "expert_confirm"
        ? (
            await tx.execute<{
              reservationId: string;
              status: ReservationStatus;
              version: number;
            }>(sql`
          update reservations as r
          set status = ${nextStatus}::reservation_status,
              version = r.version + 1,
              updated_at = ${command.now}
          from slots s, experts e, expert_services es
          where r.id = ${command.reservationId}::uuid
            and r.version = ${command.expectedVersion}
            and r.status = 'reserved'
            and s.id = r.slot_id
            and e.id = r.expert_id
            and es.id = r.expert_service_id
            and r.reserved_until > ${command.now}
            and s.starts_at > ${command.now}
            and s.observed_at >= ${new Date(command.now.getTime() - SLOT_FRESHNESS_MS)}
            and s.observed_at <= ${command.now}
            and e.active = true
            and e.verified = true
            and es.active = true
          returning r.id as "reservationId", r.status, r.version
        `)
          ).rows[0]
        : (
            await tx.execute<{
              reservationId: string;
              status: ReservationStatus;
              version: number;
            }>(sql`
          update reservations
          set status = ${nextStatus}::reservation_status,
              version = version + 1,
              updated_at = ${command.now}
          where id = ${command.reservationId}::uuid
            and version = ${command.expectedVersion}
            and status = ${reservation.status}::reservation_status
          returning id as "reservationId", status, version
        `)
          ).rows[0];
    if (updated === undefined)
      throw new Error("Reservation transition predicate failed");

    await this.auditAndOutbox(tx, {
      actorType: command.actor.type,
      actorId: command.actor.id,
      action: `reservation.${command.action}`,
      reservationId: updated.reservationId,
      decision: updated.status,
      reasonCode: command.action,
      correlationId: command.correlationId,
      occurredAt: command.now,
      version: updated.version,
    });
    return updated;
  }

  private async assertTransitionEligibility(
    tx: Transaction,
    reservation: ReservationRow,
    command: TransitionReservationCommand,
  ): Promise<void> {
    switch (command.action) {
      case "expert_confirm":
        if (
          command.actor.type !== "expert" ||
          command.actor.id !== reservation.expertId
        ) {
          throw new Error("Expert does not own reservation");
        }
        if (
          !reservation.expertActive ||
          !reservation.expertVerified ||
          !reservation.serviceActive
        ) {
          throw new Error("Expert is not eligible");
        }
        if (reservation.reservedUntil.getTime() <= command.now.getTime()) {
          throw new Error("Reservation hold has expired");
        }
        if (reservation.startsAt.getTime() <= command.now.getTime()) {
          throw new Error("Slot is no longer confirmable");
        }
        if (!isFresh(reservation.observedAt, command.now)) {
          throw new Error("Slot observation is stale");
        }
        if (
          await this.hasOverlap(
            tx,
            "client",
            reservation.userId,
            reservation,
            reservation.reservationId,
          )
        ) {
          throw new Error("Client has an active overlapping reservation");
        }
        if (
          await this.hasOverlap(
            tx,
            "expert",
            reservation.expertId,
            reservation,
            reservation.reservationId,
          )
        ) {
          throw new Error("Expert has an active overlapping reservation");
        }
        return;
      case "client_cancel":
        if (
          command.actor.type !== "client" ||
          command.actor.id !== reservation.userId
        ) {
          throw new Error("Client does not own reservation");
        }
        return;
      case "expert_cancel":
      case "mark_no_show":
        if (
          command.actor.type !== "expert" ||
          command.actor.id !== reservation.expertId
        ) {
          throw new Error("Expert does not own reservation");
        }
        return;
      case "expire":
        if (command.actor.type !== "system") {
          throw new Error("System actor is required");
        }
        if (reservation.reservedUntil.getTime() > command.now.getTime()) {
          throw new Error("Reservation hold has not expired");
        }
        return;
      case "complete":
        if (command.actor.type !== "system") {
          throw new Error("System actor is required");
        }
        return;
      default: {
        const unsupportedAction: never = command.action;
        throw new Error(
          `Unsupported reservation action: ${String(unsupportedAction)}`,
        );
      }
    }
  }

  private async hasOverlap(
    tx: Transaction,
    actor: "client" | "expert",
    actorId: string,
    slot: Pick<SlotRow, "startsAt" | "endsAt">,
    excludedReservationId?: string,
  ): Promise<boolean> {
    const excluded =
      excludedReservationId === undefined
        ? sql`true`
        : sql`r.id <> ${excludedReservationId}::uuid`;
    const actorPredicate =
      actor === "client"
        ? sql`r.user_id = ${actorId}::uuid`
        : sql`r.expert_id = ${actorId}::uuid`;
    const result = await tx.execute<{ exists: boolean }>(sql`
      select exists (
        select 1
        from reservations r
        join slots occupied on occupied.id = r.slot_id
        where ${actorPredicate}
          and r.status in ('reserved', 'booked')
          and ${excluded}
          and occupied.starts_at < ${slot.endsAt}
          and occupied.ends_at > ${slot.startsAt}
      ) as exists
    `);
    return result.rows[0]?.exists ?? false;
  }

  private async auditAndOutbox(
    tx: Transaction,
    event: {
      actorType: string;
      actorId: string;
      action: BookingAuditAction;
      reservationId: string;
      decision: string;
      reasonCode: string;
      correlationId: string;
      occurredAt: Date;
      version: number;
    },
  ): Promise<void> {
    const metadataHash = hash({
      reservationId: event.reservationId,
      action: event.action,
      version: event.version,
    });
    await tx.execute(sql`
      insert into audit_events (
        actor_type, actor_id, authenticated_session_id_hash, action, object_type,
        object_id, decision, reason_code, correlation_id, occurred_at, metadata_hash
      ) values (
        ${event.actorType}, ${event.actorId}::uuid, ${hash({
          actorType: event.actorType,
          actorId: event.actorId,
        })}, ${event.action}, 'reservation', ${event.reservationId}::uuid,
        ${event.decision}, ${event.reasonCode}, ${event.correlationId},
        ${event.occurredAt}, ${metadataHash}
      )
    `);
    for (const topic of outboxTopicsFor(event.action)) {
      const payload = {
        reservationId: event.reservationId,
        action: event.action.replace(/^reservation\./, ""),
        decision: event.decision,
        version: event.version,
        charge: 0,
      };
      await tx.execute(sql`
        insert into integration_outbox (
          idempotency_key, topic, payload, correlation_id,
          reconciliation_key, payload_hash
        ) values (
          ${`${event.reservationId}:${event.version}:${topic}`},
          ${topic},
          ${JSON.stringify(payload)}::jsonb,
          ${event.correlationId},
          ${`booking:${event.correlationId}`},
          ${hash(payload)}
        )
      `);
    }
  }
}

export type { ReservationAction };
