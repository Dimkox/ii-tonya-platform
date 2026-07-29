import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  computeReservedUntil,
  transitionReservation,
  type ReservationAction,
  type ReservationStatus,
} from "@ii-tonya/domain";
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

export interface BookingRepositoryOptions {
  maxSerializationAttempts?: number;
  retryDelayMs?: (attempt: number) => number;
  onSerializationExhausted?: (code: "booking_serialization_exhausted") => void;
}

type Transaction = Parameters<DrizzleDb["transaction"]>[0] extends
  (transaction: infer T) => unknown ? T : never;

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

type ReservationRow = SlotRow & {
  reservationId: string;
  userId: string;
  status: ReservationStatus;
  idempotencyKey: string;
  reservedUntil: Date;
  version: number;
};

type ReservationResultRow = {
  reservationId: string;
  userId: string;
  slotId: string | null;
  reservedUntil: Date;
  version: number;
};

const SLOT_FRESHNESS_MS = 15 * 60 * 1_000;

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

function hash(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function hasSqlState(error: unknown, code: string): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    if ((current as { code?: unknown }).code === code) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function findSqlStateError(error: unknown, code: string): unknown {
  const seen = new Set<unknown>();
  let current = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
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
  return observedAt !== null
    && observedAt.getTime() <= now.getTime()
    && observedAt.getTime() >= now.getTime() - SLOT_FRESHNESS_MS;
}

function hasConstraint(error: unknown, constraint: string): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    if ((current as { constraint?: unknown }).constraint === constraint) return true;
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

  constructor(
    private readonly db: DrizzleDb,
    options: BookingRepositoryOptions = {},
  ) {
    const configuredAttempts = options.maxSerializationAttempts ?? 3;
    this.maxSerializationAttempts = Number.isFinite(configuredAttempts)
      ? Math.max(1, Math.min(3, Math.floor(configuredAttempts)))
      : 3;
    this.retryDelayMs = options.retryDelayMs
      ?? ((attempt) => Math.floor(Math.random() * Math.min(250, 25 * 2 ** attempt)));
    this.onSerializationExhausted = options.onSerializationExhausted ?? (() => undefined);
  }

  async reserve(command: ReserveSlotCommand): Promise<ReserveSlotResult> {
    if (
      !finiteDate(command.now)
      || !Number.isFinite(command.minimumLeadMs)
      || command.minimumLeadMs < 0
      || !Number.isFinite(command.confirmationBufferMs)
      || command.confirmationBufferMs < 0
    ) {
      return { kind: "unavailable", reason: "deadline" };
    }
    try {
      return await this.runSerializable((tx) => this.reserveInTransaction(tx, command));
    } catch (error) {
      if (!hasSqlState(error, "23505")
        || !hasConstraint(error, "reservations_idempotency_unique")) {
        throw error;
      }
      return this.resolveReservationIdempotency(command);
    }
  }

  transition(
    command: TransitionReservationCommand,
  ): Promise<TransitionReservationResult> {
    if (!finiteDate(command.now) || !Number.isInteger(command.expectedVersion)) {
      return Promise.reject(new Error("Invalid reservation transition input"));
    }
    return this.runSerializable((tx) => this.transitionInTransaction(tx, command));
  }

  private async runSerializable<T>(
    operation: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    let finalSerializationError: unknown;
    for (let attempt = 1; attempt <= this.maxSerializationAttempts; attempt += 1) {
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
          await sleep(Number.isFinite(configuredDelay)
            ? Math.min(250, Math.max(0, configuredDelay))
            : 0);
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

    const slot = (await tx.execute<SlotRow>(sql`
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
    `)).rows[0];
    if (slot === undefined) {
      return { kind: "unavailable", reason: "stale_slot" };
    }

    const duplicate = (await tx.execute<ReservationResultRow>(sql`
      select
        id as "reservationId",
        user_id as "userId",
        slot_id as "slotId",
        reserved_until as "reservedUntil",
        version
      from reservations
      where idempotency_key = ${command.idempotencyKey}
    `)).rows[0];
    if (duplicate !== undefined) {
      return this.classifyDuplicate(command, duplicate);
    }

    if (!isFresh(slot.observedAt, command.now)) {
      return { kind: "unavailable", reason: "stale_slot" };
    }
    if (!slot.expertActive || !slot.expertVerified || !slot.serviceActive) {
      return { kind: "unavailable", reason: "expert_ineligible" };
    }
    if (slot.startsAt.getTime() < command.now.getTime() + command.minimumLeadMs) {
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

    const capacity = one((await tx.execute<{ count: number }>(sql`
      select count(*)::integer as count
      from reservations
      where slot_id = ${slot.slotId}::uuid
        and status in ('reserved', 'booked')
    `)).rows, "a slot capacity count");
    if (Number(capacity.count) >= slot.capacity) {
      return { kind: "unavailable", reason: "capacity" };
    }

    if (await this.hasOverlap(tx, "client", command.userId, slot)) {
      return { kind: "unavailable", reason: "client_active_overlap" };
    }
    if (await this.hasOverlap(tx, "expert", slot.expertId, slot)) {
      return { kind: "unavailable", reason: "expert_active_overlap" };
    }

    const inserted = one((await tx.execute<ReservationResultRow>(sql`
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
    `)).rows, "an inserted reservation");

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
    const stored = (await this.db.execute<ReservationResultRow>(sql`
      select
        id as "reservationId",
        user_id as "userId",
        slot_id as "slotId",
        reserved_until as "reservedUntil",
        version
      from reservations
      where idempotency_key = ${command.idempotencyKey}
    `)).rows[0];
    if (stored === undefined) {
      throw new BookingIdempotencyConflictError(command.idempotencyKey);
    }
    return this.classifyDuplicate(command, stored);
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
    const reservation = (await tx.execute<ReservationRow>(sql`
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
    `)).rows[0];
    if (reservation === undefined) throw new Error("Reservation not found");
    if (reservation.version !== command.expectedVersion) {
      throw new Error("Stale reservation version");
    }

    await this.assertTransitionEligibility(tx, reservation, command);
    const nextStatus = transitionReservation(reservation.status, command.action);
    const updated = command.action === "expert_confirm"
      ? (await tx.execute<{ reservationId: string; status: ReservationStatus; version: number }>(sql`
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
        `)).rows[0]
      : (await tx.execute<{ reservationId: string; status: ReservationStatus; version: number }>(sql`
          update reservations
          set status = ${nextStatus}::reservation_status,
              version = version + 1,
              updated_at = ${command.now}
          where id = ${command.reservationId}::uuid
            and version = ${command.expectedVersion}
            and status = ${reservation.status}::reservation_status
          returning id as "reservationId", status, version
        `)).rows[0];
    if (updated === undefined) throw new Error("Reservation transition predicate failed");

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
        if (command.actor.type !== "expert" || command.actor.id !== reservation.expertId) {
          throw new Error("Expert does not own reservation");
        }
        if (!reservation.expertActive || !reservation.expertVerified || !reservation.serviceActive) {
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
        if (await this.hasOverlap(
          tx,
          "client",
          reservation.userId,
          reservation,
          reservation.reservationId,
        )) {
          throw new Error("Client has an active overlapping reservation");
        }
        if (await this.hasOverlap(
          tx,
          "expert",
          reservation.expertId,
          reservation,
          reservation.reservationId,
        )) {
          throw new Error("Expert has an active overlapping reservation");
        }
        return;
      case "client_cancel":
        if (command.actor.type !== "client" || command.actor.id !== reservation.userId) {
          throw new Error("Client does not own reservation");
        }
        return;
      case "expert_cancel":
      case "mark_no_show":
        if (command.actor.type !== "expert" || command.actor.id !== reservation.expertId) {
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
        throw new Error(`Unsupported reservation action: ${String(unsupportedAction)}`);
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
    const excluded = excludedReservationId === undefined
      ? sql`true`
      : sql`r.id <> ${excludedReservationId}::uuid`;
    const actorPredicate = actor === "client"
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
      action: string;
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
    await tx.execute(sql`
      insert into integration_outbox (
        idempotency_key, reconciliation_key, payload_hash
      ) values (
        ${`booking:${event.action}:${event.reservationId}:v${event.version}`},
        ${`booking:${event.correlationId}`},
        ${metadataHash}
      )
    `);
  }
}

export type { ReservationAction };
