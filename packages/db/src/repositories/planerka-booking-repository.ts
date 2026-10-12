import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

import { lockBookingNotificationReservation } from "./booking-notification-authority.js";
import {
  deferBookingNotificationCapture,
  flushBookingNotificationCapture,
} from "./booking-notification-repository.js";

type Executor = Pick<DrizzleDb, "execute">;
export interface PlanerkaOperation {
  id: string;
  reservationId: string;
  accountId: number;
  eventTypeId: number;
  request: {
    eventTypeId: number;
    start: string;
    lengthInMinutes: number;
    attendee: { name: string; timeZone: string };
  };
  requestFingerprint: string;
  state: string;
  providerUid: string | null;
  leaseToken: string;
  cancelRequested: boolean;
}
const projection = sql`id,reservation_id as "reservationId",account_id as "accountId",event_type_id as "eventTypeId",request,request_fingerprint as "requestFingerprint",state,provider_uid as "providerUid",lease_token as "leaseToken",cancel_requested as "cancelRequested"`;
export const planerkaRequestFingerprint = (
  request: PlanerkaOperation["request"],
): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        eventTypeId: request.eventTypeId,
        start: request.start,
        lengthInMinutes: request.lengthInMinutes,
        attendee: {
          name: request.attendee.name,
          timeZone: request.attendee.timeZone,
        },
      }),
    )
    .digest("hex");

/** Called inside the expert-decision transaction, after its ownership/version checks. */
export async function enqueuePlanerkaBooking(
  tx: Executor,
  reservationId: string,
): Promise<void> {
  const row = (
    await tx.execute<{
      accountId: number;
      eventTypeId: number;
      duration: number;
      timeZone: string;
      startsAt: Date | string;
      endsAt: Date | string;
    }>(sql`
    select m.account_id as "accountId",m.event_type_id as "eventTypeId",m.duration_minutes as duration,m.time_zone as "timeZone",s.starts_at as "startsAt",s.ends_at as "endsAt"
    from reservations r join slots s on s.id=r.slot_id
    join expert_services es on es.id=r.expert_service_id
    join planerka_service_mappings m on m.expert_service_id=es.id
    where r.id=${reservationId}::uuid and m.enabled and s.provider='planerka'
      and es.expert_id=r.expert_id and m.duration_minutes=es.duration_minutes
      and extract(epoch from (s.ends_at-s.starts_at))=m.duration_minutes*60
      and s.capacity=1 and m.verified_at<=clock_timestamp()
    for share of m
  `)
  ).rows[0];
  if (!row) throw new Error("planerka_mapping_unavailable");
  new Intl.DateTimeFormat("en", { timeZone: row.timeZone });
  const request = {
    eventTypeId: row.eventTypeId,
    start: new Date(row.startsAt).toISOString(),
    lengthInMinutes: row.duration,
    attendee: { name: "Клиент", timeZone: row.timeZone },
  };
  // A unique reservation key rejects a second approval even with a fresh version.
  await tx.execute(sql`insert into planerka_booking_operations(reservation_id,account_id,event_type_id,request,request_fingerprint,starts_at,ends_at)
    values(${reservationId}::uuid,${row.accountId},${row.eventTypeId},${JSON.stringify(request)}::jsonb,${planerkaRequestFingerprint(request)},${new Date(row.startsAt)},${new Date(row.endsAt)})`);
}

export class PostgresPlanerkaBookingRepository {
  constructor(private readonly db: DrizzleDb) {}

  async mappings(accountId: number) {
    return (
      await this.db.execute<{
        eventTypeId: number;
        durationMinutes: number;
        timeZone: string;
      }>(sql`
      select m.event_type_id as "eventTypeId",m.duration_minutes as "durationMinutes",m.time_zone as "timeZone"
      from planerka_service_mappings m join expert_services es on es.id=m.expert_service_id join experts e on e.id=es.expert_id
      where m.account_id=${accountId} and m.enabled and es.active and e.active and e.verified
        and es.duration_minutes=m.duration_minutes
    `)
    ).rows;
  }

  /** One durable account-wide admission every 2s, shared by every workflow worker. */
  async admitRequest(accountId: number): Promise<boolean> {
    await this.db.execute(
      sql`insert into planerka_account_requests(account_id) values(${accountId}) on conflict do nothing`,
    );
    return (
      (
        await this.db.execute(
          sql`update planerka_account_requests set next_request_at=clock_timestamp()+interval '2 seconds' where account_id=${accountId} and next_request_at<=clock_timestamp() returning account_id`,
        )
      ).rows.length === 1
    );
  }

  async claim(
    accountId: number,
    createEnabled: boolean,
  ): Promise<PlanerkaOperation | undefined> {
    return this.db.transaction(async (tx) => {
      // Expired send leases are uncertainty, not permission to resend.
      await tx.execute(sql`update planerka_booking_operations set state=case when state='sending' then 'unknown' else 'cancel_unknown' end,lease_token=null,lease_until=null,reason_code='lease_expired',updated_at=clock_timestamp()
        where account_id=${accountId} and state in ('sending','cancelling') and lease_until<=clock_timestamp()`);
      return (
        await tx.execute<PlanerkaOperation & Record<string, unknown>>(sql`
        update planerka_booking_operations set lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp()
        where id=(select id from planerka_booking_operations where account_id=${accountId}
          and (state in ('unknown','cancel_pending','cancel_unknown') or (${createEnabled} and state='pending'))
          and next_attempt_at<=clock_timestamp() and (lease_until is null or lease_until<=clock_timestamp())
          order by next_attempt_at,id for update skip locked limit 1)
        returning ${projection}
      `)
      ).rows[0];
    });
  }

  async admitSend(op: PlanerkaOperation, cancel = false): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      // Reservation first: same lock order as cancellation/expiry triggers.
      const r = (
        await tx.execute<{ status: string; valid: boolean }>(
          sql`select status,(reserved_until>clock_timestamp() and s.starts_at>clock_timestamp()) as valid from reservations r join slots s on s.id=r.slot_id where r.id=${op.reservationId}::uuid for update of r`,
        )
      ).rows[0];
      if (!cancel && (r?.status !== "reserved" || !r.valid)) {
        await tx.execute(
          sql`update planerka_booking_operations set state='cancelled',cancel_requested=true,lease_token=null,lease_until=null where id=${op.id}::uuid and lease_token=${op.leaseToken}::uuid and state='pending'`,
        );
        return false;
      }
      return (
        (
          await tx.execute(sql`update planerka_booking_operations set state=${cancel ? "cancelling" : "sending"},send_admitted_at=coalesce(send_admitted_at,clock_timestamp())
        where id=${op.id}::uuid and lease_token=${op.leaseToken}::uuid and lease_until>clock_timestamp()
          and state=${cancel ? "cancel_pending" : "pending"} and (${cancel} or not cancel_requested)
        returning id`)
        ).rows.length === 1
      );
    });
  }

  async defer(op: PlanerkaOperation, reason: string): Promise<void> {
    await this.db.execute(
      sql`update planerka_booking_operations set lease_token=null,lease_until=null,next_attempt_at=clock_timestamp()+interval '5 seconds',reason_code=${reason} where id=${op.id}::uuid and lease_token=${op.leaseToken}::uuid`,
    );
  }

  async unknown(op: PlanerkaOperation): Promise<void> {
    await this.db.execute(
      sql`update planerka_booking_operations set state=case when provider_uid is null then 'unknown' else 'cancel_unknown' end,lease_token=null,lease_until=null,next_attempt_at=clock_timestamp()+interval '30 seconds',reason_code='provider_uncertain' where id=${op.id}::uuid and lease_token=${op.leaseToken}::uuid`,
    );
  }

  async needsOperator(op: PlanerkaOperation): Promise<void> {
    await this.db.execute(sql`update planerka_booking_operations set
      state=case when provider_uid is distinct from ${op.providerUid}::text then state else 'manual' end,
      lease_token=null,lease_until=null,reason_code='operator_resolution_required'
      where id=${op.id}::uuid and lease_token=${op.leaseToken}::uuid and lease_until>clock_timestamp()`);
  }

  async reject(op: PlanerkaOperation): Promise<void> {
    await this.db.transaction(async (tx) => {
      await lockBookingNotificationReservation(tx, op.reservationId);
      await tx.execute(
        sql`select id from reservations where id=${op.reservationId}::uuid for update`,
      );
      const changed = await tx.execute(
        sql`update planerka_booking_operations set state='rejected',lease_token=null,lease_until=null,reason_code='provider_definite_rejection' where id=${op.id}::uuid and lease_token=${op.leaseToken}::uuid and state in ('pending','sending') and provider_uid is null returning id`,
      );
      if (!changed.rows.length) return;
      const expired = await tx.execute<{ version: number }>(
        sql`update reservations set status='expired',version=version+1,updated_at=clock_timestamp() where id=${op.reservationId}::uuid and status='reserved' returning version`,
      );
      await this.publish(tx, op, "client.reservation_expired");
      if (expired.rows[0])
        await this.publish(
          tx,
          op,
          "expert.reservation_expired",
          expired.rows[0].version,
        );
      await flushBookingNotificationCapture(tx);
    });
  }

  async complete(
    op: PlanerkaOperation,
    booking: {
      uid: string;
      eventTypeId: number;
      start: string;
      end: string;
      status: string;
      hosts: readonly { id: number }[];
      attendees: readonly { name: string; timeZone: string }[];
    },
  ): Promise<boolean> {
    if (
      !/^[A-Za-z0-9_-]{1,256}$/u.test(booking.uid) ||
      booking.status !== "accepted" ||
      booking.eventTypeId !== op.eventTypeId ||
      Date.parse(booking.start) !== Date.parse(op.request.start) ||
      Date.parse(booking.end) - Date.parse(booking.start) !==
        op.request.lengthInMinutes * 60000 ||
      !booking.hosts.some((h) => h.id === op.accountId) ||
      booking.attendees.length !== 1 ||
      booking.attendees[0]?.name !== op.request.attendee.name ||
      booking.attendees[0]?.timeZone !== op.request.attendee.timeZone ||
      planerkaRequestFingerprint(op.request) !== op.requestFingerprint
    )
      throw new Error("planerka_binding_mismatch");
    return this.db.transaction(async (tx) => {
      await lockBookingNotificationReservation(tx, op.reservationId);
      const r = (
        await tx.execute<{ status: string; valid: boolean }>(
          sql`select status,reserved_until>clock_timestamp() as valid from reservations where id=${op.reservationId}::uuid for update`,
        )
      ).rows[0];
      const stored = (
        await tx.execute<{
          cancel: boolean;
          requestFingerprint: string;
          validLease: boolean;
          uid: string | null;
        }>(
          sql`select cancel_requested as cancel,request_fingerprint as "requestFingerprint",(lease_token=${op.leaseToken}::uuid and lease_until>clock_timestamp() and state in ('sending','unknown')) as "validLease",provider_uid as uid from planerka_booking_operations where id=${op.id}::uuid and reservation_id=${op.reservationId}::uuid and account_id=${op.accountId} and event_type_id=${op.eventTypeId} for update`,
        )
      ).rows[0];
      if (
        !stored ||
        stored.requestFingerprint !== op.requestFingerprint ||
        (stored.uid !== null && stored.uid !== booking.uid)
      )
        throw new Error("planerka_binding_mismatch");
      if (!stored.validLease) {
        // A late response cannot complete a stale lease, but its verified UID must
        // survive. The next recovery claim can authenticate it with GET by UID.
        await tx.execute(
          sql`update planerka_booking_operations set provider_uid=${booking.uid},state='unknown',next_attempt_at=clock_timestamp() where id=${op.id}::uuid and provider_uid is null and state in ('sending','unknown','manual')`,
        );
        return false;
      }
      const cancelled = stored.cancel || r?.status !== "reserved" || !r.valid;
      await tx.execute(
        sql`update planerka_booking_operations set provider_uid=${booking.uid},state=${cancelled ? "cancel_pending" : "booked"},cancel_requested=${cancelled},lease_token=null,lease_until=null,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() where id=${op.id}::uuid`,
      );
      if (!cancelled) {
        await tx.execute(
          sql`update reservations set status='booked',version=version+1,updated_at=clock_timestamp() where id=${op.reservationId}::uuid`,
        );
        await this.publish(tx, op, "client.booking_confirmed");
      }
      await flushBookingNotificationCapture(tx);
      return true;
    });
  }

  async cancelled(op: PlanerkaOperation): Promise<void> {
    await this.db.execute(
      sql`update planerka_booking_operations set state='cancelled',lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=${op.id}::uuid and lease_token=${op.leaseToken}::uuid and lease_until>clock_timestamp() and provider_uid=${op.providerUid} and state in ('cancelling','cancel_unknown')`,
    );
  }

  async retryCancellation(op: PlanerkaOperation): Promise<void> {
    await this.db.execute(
      sql`update planerka_booking_operations set state=case when recovery_count>=4 then 'manual' else 'cancel_pending' end,recovery_count=least(5,recovery_count+1),lease_token=null,lease_until=null,next_attempt_at=clock_timestamp()+interval '1 minute',reason_code='cancel_reconciliation' where id=${op.id}::uuid and lease_token=${op.leaseToken}::uuid`,
    );
  }

  private async publish(
    tx: Executor,
    op: PlanerkaOperation,
    topic: string,
    version?: number,
  ) {
    const payload = JSON.stringify({
      reservationId: op.reservationId,
      charge: 0,
      ...(version === undefined ? {} : { version }),
    });
    const source = await tx.execute<{ id: string }>(
      sql`insert into integration_outbox(idempotency_key,topic,payload,correlation_id,reconciliation_key,payload_hash) values(${version === undefined ? `${op.id}:${topic}` : `${op.reservationId}:${version}:${topic}`},${topic},${payload}::jsonb,${`planerka:${op.id}`},${`planerka:${op.id}`},${createHash("sha256").update(payload).digest("hex")}) on conflict(idempotency_key) do nothing returning id`,
    );
    if (source.rows[0]) deferBookingNotificationCapture(tx, source.rows[0].id);
  }
}
