import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  computeReservedUntil,
  transitionReservation,
  type ReservationAction,
  type ReservationStatus,
} from "@ii-tonya/domain";
import type { DrizzleDb } from "../client.js";
import { currentConsentSatisfiedSql } from "./consent-current.js";
import {
  captureBookingNotificationContext,
  lockBookingNotificationReservation,
  lockBookingNotificationSlot,
  type BookingNotificationOrigin,
} from "./booking-notification-authority.js";
import {
  deferBookingNotificationCapture,
  flushBookingNotificationCapture,
} from "./booking-notification-repository.js";
import { enqueuePlanerkaBooking } from "./planerka-booking-repository.js";
import {
  lockBookingCallbackAuthority,
  loadBookingApprovalAuthority,
  hasCurrentBookingExpert,
  lockApprovalLinks,
  validApprovalLink,
  approvalClock,
  validTelegramBookingContext,
  type TelegramBookingCallbackContext,
} from "./booking-notification-callback-repository.js";

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

/** Internal transaction-local timing result, never external send authority. */
interface ProtectedReservationTiming {
  choiceDigest: `sha256:${string}`;
  databaseNow: Date;
  choiceExpired: boolean;
}

export interface TransitionReservationCommand {
  reservationId: string;
  expectedVersion: number;
  action: ReservationAction;
  actor: { type: "expert" | "client" | "system"; id: string };
  now: Date;
  correlationId: string;
}

export interface TransitionReservationResult {
  replayed?: true;
  reservationId: string;
  status: ReservationStatus;
  version: number;
}

export interface TransitionTelegramCallbackCommand {
  telegramContext?: TelegramBookingCallbackContext;
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
  expertHandoffConsent: boolean;
  meetingUrl?: string;
}

export interface BookingRepositoryOptions {
  notificationOrigin?: BookingNotificationOrigin;
  maxSerializationAttempts?: number;
  retryDelayMs?: (attempt: number) => number;
  onSerializationExhausted?: (code: "booking_serialization_exhausted") => void;
  beforeCallbackTransition?: () => Promise<void>;
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
  providerCancellationPending?: boolean;
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
      return ["telegram.reservation_request"];
    case "reservation.expert_confirm":
      return [];
    case "reservation.client_cancel":
      return ["telegram.booking_cancelled"];
    case "reservation.expert_cancel":
      return ["client.booking_cancelled"];
    case "reservation.expire":
      return ["client.reservation_expired", "expert.reservation_expired"];
    case "reservation.complete":
      return ["client.booking_completed"];
    case "reservation.mark_no_show":
      return ["client.booking_no_show"];
  }
};

const SLOT_FRESHNESS_MS = 15 * 60 * 1_000;
const MINIMUM_LEAD_MS = 24 * 60 * 60 * 1_000;
// DEC-PLT-004 §4 (строка Telegram): meeting_url уходит наружу не ранее 30 минут до встречи.
const MEETING_URL_DISCLOSURE_LEAD_MS = 30 * 60 * 1_000;
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

export class PostgresBookingRepository {
  private readonly maxSerializationAttempts: number;
  private readonly retryDelayMs: (attempt: number) => number;
  private readonly onSerializationExhausted: (
    code: "booking_serialization_exhausted",
  ) => void;
  private readonly beforeCallbackTransition: () => Promise<void>;

  constructor(
    private readonly db: DrizzleDb,
    private readonly options: BookingRepositoryOptions = {},
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
      expertHandoffConsent: boolean;
      meetingUrl: string | null;
    }>(sql`
      select
        r.id as "reservationId",
        r.expert_id as "expertId",
        r.status,
        s.starts_at as "startsAt",
        case
          when handoff_consent.granted then coalesce(nullif(cp.display_name, ''), 'Клиент')
          else 'Клиент'
        end as "clientDisplayName",
        case
          when note_consent.granted and handoff_consent.granted then cp.expert_note
          else null
        end as "expertNote",
        note_consent.granted as "expertNoteConsent",
        handoff_consent.granted as "expertHandoffConsent",
        case
          when r.status = 'booked'
            and s.starts_at - ${MEETING_URL_DISCLOSURE_LEAD_MS} * interval '1 millisecond' <= clock_timestamp()
          then r.meeting_url
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
        ${currentConsentSatisfiedSql({
          userExpression: sql`r.user_id`,
          purpose: "expert_note",
        })}
      ) note_consent on true
      left join lateral (
        ${currentConsentSatisfiedSql({
          userExpression: sql`r.user_id`,
          purpose: "expert_handoff",
        })}
      ) handoff_consent on true
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
        expertHandoffConsent: row.expertHandoffConsent,
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
      await lockBookingNotificationReservation(tx, command.reservationId);
      const contextBound =
        (
          await tx.execute(
            sql`select reservation_id from booking_notification_contexts where reservation_id=${command.reservationId}::uuid`,
          )
        ).rows.length > 0;
      const linked =
        (
          await tx.execute(
            sql`select notification_id from booking_notification_callbacks where callback_token_hash=${command.tokenHash}`,
          )
        ).rows.length > 0;
      if (contextBound || linked || command.telegramContext !== undefined)
        return this.transitionBoundTelegramCallback(tx, command);
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

  private async transitionBoundTelegramCallback(
    tx: Transaction,
    command: TransitionTelegramCallbackCommand,
  ): Promise<TransitionReservationResult | null> {
    const context = command.telegramContext;
    if (!context || !validTelegramBookingContext(context)) return null;
    await lockBookingCallbackAuthority(tx, command.reservationId);
    const authority = await loadBookingApprovalAuthority(
      tx,
      context.deliveryId,
    );
    if (
      !authority ||
      authority.reservationId !== command.reservationId ||
      authority.expertId !== command.expertId ||
      authority.botKey !== context.botKey ||
      authority.externalUserId !== context.telegramUserId ||
      authority.chatId !== context.chatId ||
      authority.version !== command.version ||
      !(await hasCurrentBookingExpert(tx, authority))
    )
      return null;
    const links = await lockApprovalLinks(tx, context.deliveryId);
    if (
      links.length !== 2 ||
      links.some((link) => !validApprovalLink(link, authority))
    )
      return null;
    const credential = links.find(
      (link) =>
        link.hash === command.tokenHash && link.action === command.action,
    );
    if (!credential) return null;
    // Only an admitted, possibly delivered request authorizes a click. A receipt
    // binds the actual Telegram message; uncertainty never fabricates one.
    const attempts = (
      await tx.execute<{ id: string; botKey: string; chatId: string }>(
        sql`select id,bot_key as "botKey",chat_id as "chatId" from booking_notification_attempts where delivery_id=${context.deliveryId}::uuid and ordinal=${authority.attemptCount} for update`,
      )
    ).rows;
    const attempt = attempts[0];
    if (
      !attempt ||
      attempt.botKey !== context.botKey ||
      attempt.chatId !== context.chatId ||
      !["sending", "unknown", "manual", "delivered"].includes(authority.state)
    )
      return null;
    const facts = (
      await tx.execute<{
        outcome: string;
        messageId: string | null;
        botKey: string | null;
        chatId: string | null;
      }>(
        sql`select outcome,telegram_message_id::text as "messageId",bot_key as "botKey",response_chat_id as "chatId" from booking_notification_attempt_facts where attempt_id=${attempt.id}::uuid for share`,
      )
    ).rows;
    if (
      facts.some((f) => f.outcome === "not_applied" || f.outcome === "failed")
    )
      return null;
    const receipt = facts.find((f) => f.outcome === "applied");
    if (
      receipt &&
      (receipt.messageId !== String(context.messageId) ||
        receipt.botKey !== context.botKey ||
        receipt.chatId !== context.chatId)
    )
      return null;
    if (authority.state === "delivered" && !receipt) return null;
    if (credential.consumedAt) {
      const action =
        command.action === "confirm" ? "expert_confirm" : "expert_cancel";
      const version = command.version + 1;
      const status =
        command.action === "confirm" ? "reserved" : "cancelled_by_expert";
      const audit = (
        await tx.execute(sql`select a.id from audit_events a join notifications n on n.id=${credential.id}::uuid
        where a.object_type='reservation' and a.object_id=${command.reservationId}::uuid and a.actor_type='expert' and a.actor_id=${command.expertId}::uuid
        and a.action=${`reservation.${action}`} and a.reason_code=${action} and a.decision=${status}
        and a.occurred_at=n.callback_consumed_at and a.metadata_hash=${hash({ reservationId: command.reservationId, action: `reservation.${action}`, version })}`)
      ).rows;
      return audit.length === 1
        ? {
            reservationId: command.reservationId,
            status,
            version,
            replayed: true,
          }
        : null;
    }
    await this.beforeCallbackTransition();
    // All authority/domain/provider/delivery/credential/attempt locks precede this
    // single database instant. Legacy caller timestamps are not new-flow authority.
    const clock = await approvalClock(tx, command.reservationId);
    if (
      !clock ||
      !clock.eligible ||
      clock.version !== command.version ||
      Number(credential.expires) > Number(clock.expires) ||
      links.some((link) => Number(link.expires) !== Number(credential.expires))
    )
      return null;
    const now = new Date(clock.now);
    if (Number(credential.expires) * 1000 <= now.getTime()) return null;
    await tx.execute(
      sql`update notifications set callback_consumed_at=${now},updated_at=${now} where id=${credential.id}::uuid and callback_consumed_at is null`,
    );
    const result = await this.transitionInTransaction(tx, {
      reservationId: command.reservationId,
      expectedVersion: command.version,
      action: command.action === "confirm" ? "expert_confirm" : "expert_cancel",
      actor: { type: "expert", id: command.expertId },
      now,
      correlationId: command.correlationId,
    });
    await tx.execute(
      sql`update booking_notification_callbacks set callback_token_ciphertext=null,encryption_key_id=null where delivery_id=${context.deliveryId}::uuid`,
    );
    return result;
  }

  async listOwnedActive(command: {
    userId: string;
    after?: `bk1.${string}`;
  }): Promise<
    | { kind: "not_found" }
    | {
        kind: "found";
        bookings: {
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
  > {
    return readOwnedActiveBookingsInTransaction(this.db, command);
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
    command = { ...command };
    try {
      return await this.runSerializable(async (tx) => {
        const notificationChoice = (
          await tx.execute<{ slotId: string }>(
            sql`select slot_id as "slotId" from client_catalog_choices where choice_digest=${command.choiceDigest}`,
          )
        ).rows[0];
        if (notificationChoice)
          await lockBookingNotificationSlot(
            tx,
            command.userId,
            notificationChoice.slotId,
          );
        await tx.execute(sql`
          select pg_advisory_xact_lock(
            hashtextextended(${`choice:${command.choiceDigest}`}, 0)
          )
        `);
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
            kind: "replayed" as const,
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
        if (choice === undefined) return { kind: "not_found" as const };
        const timing: ProtectedReservationTiming = {
          choiceDigest: command.choiceDigest,
          databaseNow: now,
          choiceExpired: false,
        };
        const reservation = await this.reserveInTransaction(
          tx,
          {
            idempotencyKey: command.idempotencyKey,
            userId: command.userId,
            slotId: choice.slotId,
            now,
            minimumLeadMs: command.minimumLeadMs,
            confirmationBufferMs: command.confirmationBufferMs,
            correlationId: command.correlationId,
          },
          timing,
        );
        if (timing.choiceExpired) return { kind: "not_found" as const };
        if (reservation.kind === "unavailable") {
          return { kind: "conflict" as const };
        }
        if (
          reservation.reservedUntil.getTime() - timing.databaseNow.getTime() >
          MAXIMUM_HOLD_MS
        ) {
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
          kind: "reserved" as const,
          bookingHandle: command.bookingHandle,
          reservationStatus: "reserved" as const,
          reservedUntil: reservation.reservedUntil,
        };
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
        const pending = await tx.execute<{ pending: boolean }>(
          sql`select (exists(select 1 from planerka_booking_operations where reservation_id=${owned.reservationId}::uuid and state not in ('cancelled','rejected','finished')) or exists(select 1 from planerka_legacy_booking_reviews where reservation_id=${owned.reservationId}::uuid and resolved_at is null)) as pending`,
        );
        return {
          kind: "replayed",
          providerCancellationPending: pending.rows[0]?.pending === true,
        };
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
      const pending = await tx.execute<{ pending: boolean }>(
        sql`select (exists(select 1 from planerka_booking_operations where reservation_id=${owned.reservationId}::uuid and state not in ('cancelled','rejected','finished')) or exists(select 1 from planerka_legacy_booking_reviews where reservation_id=${owned.reservationId}::uuid and resolved_at is null)) as pending`,
      );
      return result.status === "cancelled_by_client"
        ? {
            kind: "cancelled",
            providerCancellationPending: pending.rows[0]?.pending === true,
          }
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
          const result = await operation(tx);
          await flushBookingNotificationCapture(tx);
          return result;
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
    protectedTiming?: ProtectedReservationTiming,
  ): Promise<ReserveSlotResult> {
    await lockBookingNotificationSlot(tx, command.userId, command.slotId);
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

    if (protectedTiming) {
      // Choice/request/user and slot/service/expert rows, and all advisory locks,
      // are now held. A pure row-lock wait does not require an SSI retry: acquire
      // fresh database time here and compare source timestamps at full precision.
      const timing = one(
        (
          await tx.execute<{
            databaseNow: Date | string;
            choiceValid: boolean;
            slotFresh: boolean;
            leadValid: boolean;
            deadlineValid: boolean;
          }>(sql`
        with current_clock as materialized (select clock_timestamp() as at)
        select current_clock.at as "databaseNow",
          exists(select 1 from client_catalog_choices c
            join client_catalog_requests cr on cr.id=c.request_id
            join users u on u.id=cr.user_id
            where c.choice_digest=${protectedTiming.choiceDigest}
              and c.slot_id=${command.slotId}::uuid
              and cr.user_id=${command.userId}::uuid and u.active and cr.state='ready'
              and c.expires_at>current_clock.at and cr.expires_at>current_clock.at) as "choiceValid",
          (s.observed_at between current_clock.at-interval '15 minutes' and current_clock.at) as "slotFresh",
          (s.starts_at>=current_clock.at+${command.minimumLeadMs}::bigint*interval '1 millisecond') as "leadValid",
          (s.starts_at-${command.confirmationBufferMs}::bigint*interval '1 millisecond'>current_clock.at) as "deadlineValid"
        from slots s cross join current_clock where s.id=${command.slotId}::uuid
      `)
        ).rows,
        "the protected reservation clock",
      );
      protectedTiming.databaseNow = normalizeBookingTimestamp(
        timing.databaseNow,
        "clock_timestamp",
      );
      if (timing.choiceValid !== true) {
        protectedTiming.choiceExpired = true;
        return { kind: "unavailable", reason: "deadline" };
      }
      if (timing.slotFresh !== true)
        return { kind: "unavailable", reason: "stale_slot" };
      if (timing.leadValid !== true)
        return { kind: "unavailable", reason: "lead_time" };
      if (timing.deadlineValid !== true)
        return { kind: "unavailable", reason: "deadline" };
      command = { ...command, now: protectedTiming.databaseNow };
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
    if (this.options.notificationOrigin)
      await captureBookingNotificationContext(
        tx,
        inserted.reservationId,
        this.options.notificationOrigin,
      );

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
    await lockBookingNotificationReservation(tx, command.reservationId);
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
    if (command.action === "expert_confirm") {
      await enqueuePlanerkaBooking(tx, reservation.reservationId);
    }
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
      const source = await tx.execute<{ id: string }>(sql`
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
      returning id
      `);
      deferBookingNotificationCapture(tx, source.rows[0]!.id);
    }
  }
}

export type { ReservationAction };

export async function readOwnedActiveBookingsInTransaction(
  tx: Pick<DrizzleDb, "execute">,
  command: {
    userId: string;
    after?: `bk1.${string}`;
  },
): Promise<
  | { kind: "not_found" }
  | {
      kind: "found";
      bookings: {
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
> {
  if (
    !UUID_PATTERN.test(command.userId) ||
    (command.after !== undefined &&
      !/^bk1\.[A-Za-z0-9_-]{43}$/u.test(command.after))
  ) {
    return { kind: "not_found" };
  }
  // Resolve the anchor and the page in one snapshot. Keep microsecond cursor
  // comparisons in PostgreSQL; cancelled receipts remain valid anchors.
  const rows = (
    await tx.execute<{
      anchorFound: boolean;
      bookingHandle: `bk1.${string}` | null;
      state:
        | "reserved"
        | "booked"
        | "calendar_pending"
        | "cancellation_pending"
        | "confirmation_unverified";
      startsAt: Date | string;
      reservedUntil: Date | string;
    }>(sql`
      with anchor as (
        select b.created_at,b.booking_handle
        from client_booking_receipts b
        join users u on u.id=b.user_id and u.active
        where b.user_id=${command.userId}::uuid and b.booking_handle=${command.after ?? null}
      ), authority as (
        select (${command.after === undefined} or exists(select 1 from anchor)) as valid
      )
      select authority.valid as "anchorFound", page.booking_handle as "bookingHandle",
        page.status as state, page.starts_at as "startsAt", page.reserved_until as "reservedUntil"
      from authority
      left join lateral (
        select b.booking_handle,b.created_at,
          case when o.cancel_requested and o.state not in ('cancelled','rejected') then 'cancellation_pending'
            when l.reservation_id is not null and l.resolved_at is null and r.status in ('cancelled_by_client','cancelled_by_expert','expired') then 'cancellation_pending'
            when r.status='booked' and o.provider_uid is null then 'confirmation_unverified'
            when r.status='reserved' and o.id is not null then 'calendar_pending'
            else r.status::text end as status,s.starts_at,r.reserved_until
        from client_booking_receipts b
        join reservations r on r.id=b.reservation_id and r.user_id=b.user_id
        left join planerka_booking_operations o on o.reservation_id=r.id
        left join planerka_legacy_booking_reviews l on l.reservation_id=r.id
        join slots s on s.id=r.slot_id
        join users u on u.id=b.user_id and u.active
        where authority.valid and b.user_id=${command.userId}::uuid
          and (r.status in ('reserved','booked') or (
            r.status in ('cancelled_by_client','cancelled_by_expert','expired')
            and ((o.cancel_requested and o.state not in ('cancelled','rejected')) or (l.reservation_id is not null and l.resolved_at is null))
          ))
          and (${command.after === undefined} or (b.created_at,b.booking_handle) > (select created_at,booking_handle from anchor))
        order by b.created_at,b.booking_handle
        limit 21
      ) page on true
      order by page.created_at,page.booking_handle
    `)
  ).rows;
  if (rows[0]?.anchorFound !== true) return { kind: "not_found" };
  return {
    kind: "found",
    bookings: rows.flatMap((row) =>
      row.bookingHandle === null
        ? []
        : [
            {
              bookingHandle: row.bookingHandle,
              state: row.state,
              startsAt: normalizeBookingTimestamp(
                row.startsAt,
                "slots.starts_at",
              ),
              reservedUntil: normalizeBookingTimestamp(
                row.reservedUntil,
                "reservations.reserved_until",
              ),
            },
          ],
    ),
  };
}
