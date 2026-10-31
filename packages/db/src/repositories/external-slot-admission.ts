import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { lockBookingNotificationSubjects } from "./booking-notification-authority.js";
import { currentExpertResidencyVisibleSql } from "./catalog-repository.js";

type Transaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];

/** Match notification/cancellation/erasure ordering before any mutable booking row.
 * Multiple slots use the union of owner subjects, acquired once in sorted order. */
export async function lockExternalSlotAuthority(
  tx: Transaction,
  userId: string,
  slotIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(slotIds)].sort();
  const slots = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`,`,
  );
  const experts = await tx.execute<{ id: string }>(
    sql`select distinct e.user_id id from slots s join expert_services es on es.id=s.expert_service_id join experts e on e.id=es.expert_id where s.id in (${slots})`,
  );
  await lockBookingNotificationSubjects(tx, [
    userId,
    ...experts.rows.map((row) => row.id),
  ]);
  await tx.execute(
    sql`select e.id from experts e where e.id in (select es.expert_id from slots s join expert_services es on es.id=s.expert_service_id where s.id in (${slots})) order by e.id for share`,
  );
  await tx.execute(
    sql`select es.id from expert_services es where es.id in (select expert_service_id from slots where id in (${slots})) order by es.id for share`,
  );
  await tx.execute(
    sql`select id from slots where id in (${slots}) order by id for share`,
  );
}

/** Shared with normal reservation admission: client/expert/slot locks precede
 * the final database-clock check. Native moves and waitlist targets are deferred. */
export async function admitExternalSlot(
  tx: Transaction,
  input: {
    slotId: string;
    userId: string;
    excludedReservationId?: string;
    choiceDigest?: string;
    waveCoverage?: boolean;
  },
): Promise<
  | { now: Date; startsAt: Date; expertId: string; serviceId: string }
  | "full"
  | undefined
> {
  await lockExternalSlotAuthority(tx, input.userId, [input.slotId]);
  await tx.execute(sql`
    select pg_advisory_xact_lock(hashtextextended(lock_key,0)) from (
      select lock_key from (
        values ('client:'||${input.userId}::text),('slot:'||${input.slotId}::text),
          ('expert:'||coalesce((select es.expert_id::text from slots s join expert_services es on es.id=s.expert_service_id where s.id=${input.slotId}::uuid),${input.slotId}))
      ) keys(lock_key) order by lock_key
    ) ordered_locks
  `);
  await tx.execute(
    sql`select s.id from slots s join expert_services es on es.id=s.expert_service_id join experts e on e.id=es.expert_id where s.id=${input.slotId}::uuid for update of s,es,e`,
  );
  const row = (
    await tx.execute<{
      now: Date | string;
      startsAt: Date | string;
      expertId: string;
      serviceId: string;
      full: boolean;
    }>(sql`
    with current_clock as materialized (select clock_timestamp() at)
    select c.at as now,s.starts_at as "startsAt",e.id as "expertId",es.id as "serviceId",
      (select count(*) from reservations occupied where occupied.slot_id=s.id
        and (${input.excludedReservationId ?? null}::uuid is null or occupied.id<>${input.excludedReservationId ?? null}::uuid)
        and (occupied.status='booked' or (occupied.status='reserved' and occupied.reserved_until>c.at)))>=s.capacity as full
    from slots s join expert_services es on es.id=s.expert_service_id
    join experts e on e.id=es.expert_id cross join current_clock c
    where s.id=${input.slotId}::uuid and s.provider<>'resident_native'
      and s.ends_at>s.starts_at and s.capacity>0 and es.active and e.active and e.verified
      and (${currentExpertResidencyVisibleSql(sql`e.user_id`, input.waveCoverage === true)})
      and exists(select 1 from users u where u.id=${input.userId}::uuid and u.active)
      and resident_slot_fresh(s.id,c.at) and s.starts_at>c.at+interval '24 hours'
      and (s.provider<>'planerka' or exists(select 1 from planerka_service_mappings m
        where m.expert_service_id=es.id and m.enabled and m.verified_at<=c.at
          and m.duration_minutes=es.duration_minutes and s.ends_at-s.starts_at=m.duration_minutes*interval '1 minute' and s.capacity=1))
      and (${input.choiceDigest ?? null}::text is null or exists(select 1 from client_catalog_choices cc
        join client_catalog_requests cr on cr.id=cc.request_id where cc.choice_digest=${input.choiceDigest ?? null}
          and cc.slot_id=s.id and cr.user_id=${input.userId}::uuid and cr.state='ready'
          and cc.expires_at>c.at and cr.expires_at>c.at))
      and not exists(select 1 from resident_schedule_busy busy where busy.expert_id=e.id and busy.starts_at<s.ends_at and busy.ends_at>s.starts_at)
      and not exists(select 1 from reservations occupied join slots os on os.id=occupied.slot_id
        left join resident_native_slots ns on ns.slot_id=os.id
        where (occupied.status='booked' or (occupied.status='reserved' and occupied.reserved_until>c.at))
          and (${input.excludedReservationId ?? null}::uuid is null or occupied.id<>${input.excludedReservationId ?? null}::uuid)
          and ((occupied.expert_id=e.id and occupied.slot_id<>s.id and os.starts_at<s.ends_at and coalesce(ns.occupied_until,os.ends_at)>s.starts_at)
            or (occupied.user_id=${input.userId}::uuid and os.starts_at<s.ends_at and os.ends_at>s.starts_at)))
  `)
  ).rows[0];
  if (!row) return undefined;
  if (row.full) return "full";
  return {
    now: new Date(row.now),
    startsAt: new Date(row.startsAt),
    expertId: row.expertId,
    serviceId: row.serviceId,
  };
}
