import {
  admitExternalSlot,
  lockExternalSlotAuthority,
} from "./external-slot-admission.js";
import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { computeReservedUntil } from "@ii-tonya/domain";

import type { DrizzleDb } from "../client.js";
import { currentExpertResidencyVisibleSql } from "./catalog-repository.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const KEY = /^[0-9a-f]{64}$/u;
const CHOICE = /^sha256:[0-9a-f]{64}$/u;
const HANDLE = /^wl1\.[A-Za-z0-9_-]{43}$/u;
const HOLD_MS = 72 * 60 * 60 * 1_000;
type DbTransaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];

export type WaitlistJoinResult =
  | {
      kind: "joined" | "replayed";
      waitlistHandle: `wl1.${string}`;
      position: number;
    }
  | { kind: "not_found" | "conflict" | "handle_collision" };

export type WaitlistLeaveResult = {
  kind: "left" | "replayed" | "not_found" | "conflict";
};

export type WaitlistPromotionResult =
  | {
      kind: "promoted";
      entryId: string;
      reservationId: string;
      reservedUntil: Date;
    }
  | { kind: "none_available" | "slot_full" | "stale_slot" };

function hasConstraint(error: unknown, expected: string): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (
    typeof current === "object" &&
    current !== null &&
    !seen.has(current)
  ) {
    seen.add(current);
    if ((current as { constraint?: unknown }).constraint === expected)
      return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function hash(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function position(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error("waitlist_invalid_position");
  return parsed;
}

export class PostgresWaitlistRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly confirmationBufferMs = 60 * 60 * 1_000,
  ) {
    if (
      !Number.isSafeInteger(confirmationBufferMs) ||
      confirmationBufferMs < 1 ||
      confirmationBufferMs > HOLD_MS
    ) {
      throw new Error("waitlist_invalid_confirmation_buffer");
    }
  }

  async join(command: {
    userId: string;
    choiceDigest: `sha256:${string}`;
    idempotencyKey: string;
    waitlistHandle: `wl1.${string}`;
    correlationId: string;
    holdDurationMs: number;
  }): Promise<WaitlistJoinResult> {
    if (
      !UUID.test(command.userId) ||
      !CHOICE.test(command.choiceDigest) ||
      !KEY.test(command.idempotencyKey) ||
      !HANDLE.test(command.waitlistHandle) ||
      command.correlationId.length < 1 ||
      command.holdDurationMs !== HOLD_MS
    )
      return { kind: "conflict" };
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`waitlist:${command.idempotencyKey}`},0))`,
        );
        const requestHash = hash(`${command.userId}\0${command.choiceDigest}`);
        const replay = (
          await tx.execute<{
            actorUserId: string;
            requestHash: string;
            waitlistHandle: `wl1.${string}`;
            position: number | string;
          }>(sql`
            select actor_user_id as "actorUserId",request_hash as "requestHash",
              result->>'waitlistHandle' as "waitlistHandle",
              result->>'position' as position
            from booking_waitlist_command_receipts
            where command_type='join' and idempotency_key=${command.idempotencyKey}
            for update
          `)
        ).rows[0];
        if (replay) {
          if (
            replay.actorUserId !== command.userId ||
            replay.requestHash !== requestHash
          ) {
            return { kind: "conflict" as const };
          }
          return {
            kind: "replayed" as const,
            waitlistHandle: replay.waitlistHandle,
            position: position(replay.position),
          };
        }
        const choice = (
          await tx.execute<{ slotId: string }>(sql`
            select c.slot_id as "slotId"
            from client_catalog_choices c
            join client_catalog_requests cr on cr.id=c.request_id
            join users u on u.id=cr.user_id and u.active=true
            join slots s on s.id=c.slot_id
            join expert_services es on es.id=s.expert_service_id and es.active=true
            join experts e on e.id=es.expert_id and e.active=true and e.verified=true
            where c.choice_digest=${command.choiceDigest}
              and cr.user_id=${command.userId}::uuid and cr.state='ready'
              and (${currentExpertResidencyVisibleSql(sql`e.user_id`)})
              and c.expires_at>clock_timestamp() and cr.expires_at>clock_timestamp()
              and s.provider<>'resident_native'
              and s.starts_at>clock_timestamp()+interval '24 hours'
              and s.observed_at>=clock_timestamp()-interval '15 minutes'
              and s.observed_at<=clock_timestamp()
              and (select count(*) from reservations r where r.slot_id=s.id
                and (r.status='booked' or (r.status='reserved' and r.reserved_until>clock_timestamp())))>=s.capacity
            for update of c,cr,s
          `)
        ).rows[0];
        if (!choice) return { kind: "not_found" as const };
        const inserted = (
          await tx.execute<{ id: string; createdAt: Date | string }>(sql`
            insert into booking_waitlist_entries(
              user_id,slot_id,waitlist_handle,choice_digest,join_idempotency_key
            ) values(
              ${command.userId}::uuid,${choice.slotId}::uuid,${command.waitlistHandle},
              ${command.choiceDigest},${command.idempotencyKey}
            ) returning id,created_at as "createdAt"
          `)
        ).rows[0]!;
        const count = (
          await tx.execute<{ position: number | string }>(sql`
            select count(*) as position from booking_waitlist_entries
            where slot_id=${choice.slotId}::uuid and status='waiting'
              and (created_at<${inserted.createdAt} or (created_at=${inserted.createdAt} and id<=${inserted.id}::uuid))
          `)
        ).rows[0]!.position;
        const result = {
          kind: "joined" as const,
          waitlistHandle: command.waitlistHandle,
          position: position(count),
        };
        await tx.execute(sql`
          insert into booking_waitlist_command_receipts(
            command_type,idempotency_key,actor_user_id,request_hash,waitlist_entry_id,result
          ) values(
            'join',${command.idempotencyKey},${command.userId}::uuid,
            ${requestHash},${inserted.id}::uuid,
            ${JSON.stringify(result)}::jsonb
          )
        `);
        return result;
      });
    } catch (error) {
      if (hasConstraint(error, "booking_waitlist_handle_unique"))
        return { kind: "handle_collision" };
      if (hasConstraint(error, "booking_waitlist_one_active_client_slot"))
        return { kind: "conflict" };
      throw error;
    }
  }

  async leave(command: {
    userId: string;
    waitlistHandle: `wl1.${string}`;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<WaitlistLeaveResult> {
    if (
      !UUID.test(command.userId) ||
      !HANDLE.test(command.waitlistHandle) ||
      !KEY.test(command.idempotencyKey)
    ) {
      return { kind: "not_found" };
    }
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`waitlist:leave:${command.idempotencyKey}`},0))`,
      );
      const requestHash = hash(`${command.userId}\0${command.waitlistHandle}`);
      const receipt = (
        await tx.execute<{ actorUserId: string; requestHash: string }>(sql`
          select actor_user_id as "actorUserId",request_hash as "requestHash"
          from booking_waitlist_command_receipts
          where command_type='leave' and idempotency_key=${command.idempotencyKey}
          for update
        `)
      ).rows[0];
      if (receipt !== undefined) {
        return receipt.actorUserId === command.userId &&
          receipt.requestHash === requestHash
          ? { kind: "replayed" as const }
          : { kind: "conflict" as const };
      }
      const entry = (
        await tx.execute<{ id: string; status: string }>(sql`
          select id,status from booking_waitlist_entries
          where user_id=${command.userId}::uuid and waitlist_handle=${command.waitlistHandle}
          for update
        `)
      ).rows[0];
      if (!entry) return { kind: "not_found" };
      if (entry.status === "cancelled") return { kind: "replayed" };
      if (entry.status !== "waiting") return { kind: "conflict" };
      await tx.execute(sql`
        insert into booking_waitlist_command_receipts(
          command_type,idempotency_key,actor_user_id,request_hash,waitlist_entry_id,result
        ) values(
          'leave',${command.idempotencyKey},${command.userId}::uuid,
          ${requestHash},${entry.id}::uuid,
          '{"kind":"left"}'::jsonb
        )
      `);
      await tx.execute(sql`
        update booking_waitlist_entries
        set status='cancelled',cancellation_reason='client_left',updated_at=clock_timestamp()
        where id=${entry.id}::uuid and status='waiting'
      `);
      return { kind: "left" };
    });
  }

  async promoteNext(command: {
    slotId: string;
    now: Date;
    holdDurationMs: number;
  }): Promise<WaitlistPromotionResult> {
    if (
      !UUID.test(command.slotId) ||
      !Number.isFinite(command.now.getTime()) ||
      command.holdDurationMs !== HOLD_MS
    ) {
      return { kind: "stale_slot" };
    }
    return this.db.transaction((tx) =>
      this.promoteNextInTransaction(tx, command),
    );
  }

  async processPromotionCommandsBatch(batchSize: number): Promise<{
    examined: number;
    promoted: number;
    completed: number;
  }> {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500)
      throw new Error("waitlist_invalid_promotion_batch_size");
    return this.db.transaction(async (tx) => {
      const databaseNow = (
        await tx.execute<{ now: Date | string }>(sql`
          select clock_timestamp() as now
        `)
      ).rows[0]!.now;
      const now =
        databaseNow instanceof Date ? databaseNow : new Date(databaseNow);
      if (!Number.isFinite(now.getTime()))
        throw new Error("waitlist_invalid_database_clock");
      const commands = (
        await tx.execute<{ id: string; slotId: string | null }>(sql`
          select id,payload->>'slotId' as "slotId"
          from integration_outbox
          where topic='waitlist.promote.v1'
            and (status='pending' or (status='retry_wait'
              and (next_attempt_at is null or next_attempt_at<=${now})))
          order by created_at,id
          for update skip locked
          limit ${batchSize}
        `)
      ).rows;
      let promoted = 0;
      let completed = 0;
      for (const command of commands) {
        if (command.slotId === null || !UUID.test(command.slotId)) {
          await tx.execute(sql`
            update integration_outbox
            set status='dead_letter',last_normalized_reason='waitlist_promotion_payload_invalid',
              dispatch_owner_id=null,dispatch_claim_token=null,lease_until=null,
              next_attempt_at=null,updated_at=${now}
            where id=${command.id}::uuid
          `);
          completed += 1;
          continue;
        }
        const result = await this.promoteNextInTransaction(tx, {
          slotId: command.slotId,
          now,
          holdDurationMs: HOLD_MS,
        });
        if (result.kind === "promoted") promoted += 1;
        await tx.execute(sql`
          update integration_outbox
          set status='succeeded',last_normalized_reason=${`waitlist_${result.kind}`},
            dispatch_owner_id=null,dispatch_claim_token=null,lease_until=null,
            next_attempt_at=null,updated_at=${now}
          where id=${command.id}::uuid
        `);
        completed += 1;
      }
      return { examined: commands.length, promoted, completed };
    });
  }

  private async promoteNextInTransaction(
    tx: DbTransaction,
    command: { slotId: string; now: Date; holdDurationMs: number },
  ): Promise<WaitlistPromotionResult> {
    const slot = (
      await tx.execute<{
        expertId: string;
        serviceId: string;
        capacity: number;
        startsAt: Date | string;
      }>(sql`
          select e.id as "expertId",es.id as "serviceId",s.capacity,s.starts_at as "startsAt"
          from slots s join expert_services es on es.id=s.expert_service_id
          join experts e on e.id=es.expert_id
          where s.id=${command.slotId}::uuid and es.active and e.active and e.verified
            and (${currentExpertResidencyVisibleSql(sql`e.user_id`)})
            and s.provider<>'resident_native'
            and s.starts_at>${command.now}::timestamptz+interval '24 hours'
            and s.observed_at>=${command.now}::timestamptz-interval '15 minutes'
            and s.observed_at<=${command.now}::timestamptz

        `)
    ).rows[0];
    if (!slot) return { kind: "stale_slot" };
    const entry = (
      await tx.execute<{
        id: string;
        userId: string;
        choiceDigest: `sha256:${string}`;
      }>(sql`
          select w.id,w.user_id as "userId",w.choice_digest as "choiceDigest"
          from booking_waitlist_entries w
          join users u on u.id=w.user_id and u.active=true
          where w.slot_id=${command.slotId}::uuid and w.status='waiting'
          order by w.created_at,w.id
          limit 1
        `)
    ).rows[0];
    if (!entry) return { kind: "none_available" };
    await lockExternalSlotAuthority(tx, entry.userId, [command.slotId]);
    const waiting = (
      await tx.execute(
        sql`select id from booking_waitlist_entries where id=${entry.id}::uuid and status='waiting' for update`,
      )
    ).rows[0];
    if (!waiting) return { kind: "none_available" };
    const admitted = await admitExternalSlot(tx, {
      slotId: command.slotId,
      userId: entry.userId,
    });
    if (!admitted) return { kind: "stale_slot" };
    if (admitted === "full") return { kind: "slot_full" };
    command = { ...command, now: admitted.now };
    let reservedUntil: Date;
    try {
      reservedUntil = computeReservedUntil(
        admitted.now,
        admitted.startsAt,
        this.confirmationBufferMs,
      );
    } catch {
      return { kind: "stale_slot" };
    }
    const bookingHandle = `bk1.${createHash("sha256")
      .update(`waitlist-booking:${entry.id}`)
      .digest("base64url")}`;
    const reservation = (
      await tx.execute<{ id: string }>(sql`
          insert into reservations(
            user_id,slot_id,expert_id,expert_service_id,status,idempotency_key,reserved_until
          ) values(
            ${entry.userId}::uuid,${command.slotId}::uuid,${slot.expertId}::uuid,
            ${slot.serviceId}::uuid,'reserved',${`waitlist-promotion:${entry.id}`},${reservedUntil}
          ) returning id
        `)
    ).rows[0]!;
    await tx.execute(sql`
        insert into client_booking_receipts(
          user_id,choice_digest,booking_handle,reservation_id
        ) values(
          ${entry.userId}::uuid,${entry.choiceDigest},${bookingHandle},${reservation.id}::uuid
        )
      `);
    await tx.execute(sql`
        update booking_waitlist_entries
        set status='promoted',promoted_reservation_id=${reservation.id}::uuid,
          promotion_hold_until=${reservedUntil},updated_at=${command.now}
        where id=${entry.id}::uuid and status='waiting'
      `);
    return {
      kind: "promoted",
      entryId: entry.id,
      reservationId: reservation.id,
      reservedUntil,
    };
  }
}
