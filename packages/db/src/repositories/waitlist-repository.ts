import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import type { DrizzleDb } from "../client.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const KEY = /^[0-9a-f]{64}$/u;
const CHOICE = /^sha256:[0-9a-f]{64}$/u;
const HANDLE = /^wl1\.[A-Za-z0-9_-]{43}$/u;
const HOLD_MS = 72 * 60 * 60 * 1_000;

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
  constructor(private readonly db: DrizzleDb) {}

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
        const replay = (
          await tx.execute<{
            waitlistHandle: `wl1.${string}`;
            position: number | string;
          }>(sql`
            select e.waitlist_handle as "waitlistHandle",
              (select count(*) from booking_waitlist_entries q
                where q.slot_id=e.slot_id and q.status='waiting'
                  and (q.created_at<e.created_at or (q.created_at=e.created_at and q.id<=e.id))) as position
            from booking_waitlist_entries e
            where e.join_idempotency_key=${command.idempotencyKey}
              and e.user_id=${command.userId}::uuid
          `)
        ).rows[0];
        if (replay)
          return {
            kind: "replayed" as const,
            waitlistHandle: replay.waitlistHandle,
            position: position(replay.position),
          };
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
              and c.expires_at>clock_timestamp() and cr.expires_at>clock_timestamp()
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
            ${hash(`${command.userId}\0${command.choiceDigest}`)},${inserted.id}::uuid,
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
        update booking_waitlist_entries
        set status='cancelled',cancellation_reason='client_left',updated_at=clock_timestamp()
        where id=${entry.id}::uuid and status='waiting'
      `);
      await tx.execute(sql`
        insert into booking_waitlist_command_receipts(
          command_type,idempotency_key,actor_user_id,request_hash,waitlist_entry_id,result
        ) values(
          'leave',${command.idempotencyKey},${command.userId}::uuid,
          ${hash(`${command.userId}\0${command.waitlistHandle}`)},${entry.id}::uuid,
          '{"kind":"left"}'::jsonb
        ) on conflict(command_type,idempotency_key) do nothing
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
    return this.db.transaction(async (tx) => {
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
            and s.starts_at>${command.now}::timestamptz+interval '72 hours'
            and s.observed_at>=${command.now}::timestamptz-interval '15 minutes'
            and s.observed_at<=${command.now}::timestamptz
          for update of s
        `)
      ).rows[0];
      if (!slot) return { kind: "stale_slot" };
      const occupancy = Number(
        (
          await tx.execute<{ count: string }>(sql`
        select count(*)::text count from reservations
        where slot_id=${command.slotId}::uuid
          and (status='booked' or (status='reserved' and reserved_until>${command.now}))
      `)
        ).rows[0]!.count,
      );
      if (occupancy >= slot.capacity) return { kind: "slot_full" };
      const entry = (
        await tx.execute<{ id: string; userId: string }>(sql`
          select w.id,w.user_id as "userId" from booking_waitlist_entries w
          join users u on u.id=w.user_id and u.active=true
          where w.slot_id=${command.slotId}::uuid and w.status='waiting'
          order by w.created_at,w.id
          for update of w skip locked limit 1
        `)
      ).rows[0];
      if (!entry) return { kind: "none_available" };
      const reservedUntil = new Date(command.now.getTime() + HOLD_MS);
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
    });
  }
}
