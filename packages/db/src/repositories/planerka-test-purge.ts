/**
 * SCRUM-525: delete Planerka rows only for an inactive, unverified expert
 * whose reservations are already cancelled or expired. Real bookings stay
 * behind planerka_operation_retained. The session marker is the only exception.
 */
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type PlanerkaTestPurgeResult = {
  readonly operations: number;
  readonly reservations: number;
  readonly slots: number;
  readonly services: number;
  readonly expert: "removed" | "retained";
  readonly user: "removed" | "retained";
};

const count = (value: number | string | undefined): number =>
  Number(value ?? 0);

export class PostgresPlanerkaTestPurge {
  constructor(private readonly db: DrizzleDb) {}

  async purgeInactiveTestExpert(
    expertId: string,
  ): Promise<PlanerkaTestPurgeResult> {
    if (!UUID.test(expertId)) throw new Error("planerka_test_purge_refused");
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout='5s'`);
      const expert = (
        await tx.execute<{
          userId: string;
          active: boolean;
          verified: boolean;
        }>(
          sql`select user_id as "userId",active,verified from experts where id=${expertId}::uuid for update`,
        )
      ).rows[0];
      if (!expert || expert.active || expert.verified)
        throw new Error("planerka_test_purge_refused");
      const open = (
        await tx.execute<{ n: number }>(
          sql`select count(*)::int as n from reservations where expert_id=${expertId}::uuid and status in ('reserved','booked','completed','no_show')`,
        )
      ).rows[0];
      if (count(open?.n) > 0) throw new Error("planerka_test_purge_refused");
      const orders = (
        await tx.execute<{ n: number }>(
          sql`select count(*)::int as n from expert_residency_orders where expert_id=${expertId}::uuid`,
        )
      ).rows[0];
      if (count(orders?.n) > 0) throw new Error("planerka_test_purge_refused");
      const blocked = (
        await tx.execute<{ n: number }>(
          sql`select (
            (select count(*) from booking_notification_contexts c join reservations r on r.id=c.reservation_id where r.expert_id=${expertId}::uuid)
            + (select count(*) from booking_notification_deliveries d join reservations r on r.id=d.reservation_id where r.expert_id=${expertId}::uuid)
            + (select count(*) from booking_reschedule_facts f join reservations r on r.id=f.reservation_id where r.expert_id=${expertId}::uuid)
          )::int as n`,
        )
      ).rows[0];
      if (count(blocked?.n) > 0) throw new Error("planerka_test_purge_blocked");
      await tx.execute(
        sql`select set_config('ii_tonya.planerka_test_purge', ${`expert:${expertId}`}, true)`,
      );
      const operations = count(
        (
          await tx.execute<{ n: number }>(
            sql`with deleted as (
              delete from planerka_booking_operations o using reservations r
              where r.id=o.reservation_id and r.expert_id=${expertId}::uuid
              returning o.id
            ) select count(*)::int as n from deleted`,
          )
        ).rows[0]?.n,
      );
      await tx.execute(
        sql`delete from planerka_legacy_booking_reviews l using reservations r where r.id=l.reservation_id and r.expert_id=${expertId}::uuid`,
      );
      await tx.execute(
        sql`delete from notifications n using reservations r where r.id=n.reservation_id and r.expert_id=${expertId}::uuid`,
      );
      await tx.execute(
        sql`delete from feedback f using reservations r where r.id=f.reservation_id and r.expert_id=${expertId}::uuid`,
      );
      await tx.execute(
        sql`delete from booking_waitlist_entries w where w.promoted_reservation_id in (select id from reservations where expert_id=${expertId}::uuid) or w.slot_id in (select s.id from slots s join expert_services es on es.id=s.expert_service_id where es.expert_id=${expertId}::uuid)`,
      );
      const reservations = count(
        (
          await tx.execute<{ n: number }>(
            sql`with deleted as (delete from reservations where expert_id=${expertId}::uuid returning id) select count(*)::int as n from deleted`,
          )
        ).rows[0]?.n,
      );
      await tx.execute(
        sql`delete from planerka_service_mappings m using expert_services es where es.id=m.expert_service_id and es.expert_id=${expertId}::uuid`,
      );
      await tx.execute(
        sql`delete from planerka_availability_refreshes a using expert_services es where es.id=a.expert_service_id and es.expert_id=${expertId}::uuid`,
      );
      const slots = count(
        (
          await tx.execute<{ n: number }>(
            sql`with deleted as (
              delete from slots s using expert_services es
              where es.id=s.expert_service_id and es.expert_id=${expertId}::uuid
                and not exists(select 1 from reservations r where r.slot_id=s.id)
              returning s.id
            ) select count(*)::int as n from deleted`,
          )
        ).rows[0]?.n,
      );
      const services = count(
        (
          await tx.execute<{ n: number }>(
            sql`with deleted as (
              delete from expert_services es
              where es.expert_id=${expertId}::uuid
                and not exists(select 1 from slots s where s.expert_service_id=es.id)
                and not exists(select 1 from reservations r where r.expert_service_id=es.id)
              returning es.id
            ) select count(*)::int as n from deleted`,
          )
        ).rows[0]?.n,
      );
      let expertRemoved: PlanerkaTestPurgeResult["expert"] = "retained";
      let userRemoved: PlanerkaTestPurgeResult["user"] = "retained";
      await tx.execute(sql`savepoint planerka_purge_expert`);
      try {
        const removed = (
          await tx.execute<{ id: string }>(
            sql`delete from experts where id=${expertId}::uuid and active=false and verified=false and not exists(select 1 from expert_services where expert_id=${expertId}::uuid) returning id`,
          )
        ).rows.length;
        await tx.execute(sql`release savepoint planerka_purge_expert`);
        if (removed === 1) expertRemoved = "removed";
      } catch {
        await tx.execute(sql`rollback to savepoint planerka_purge_expert`);
      }
      if (expertRemoved === "removed") {
        await tx.execute(sql`savepoint planerka_purge_user`);
        try {
          const removed = (
            await tx.execute<{ id: string }>(
              sql`delete from users where id=${expert.userId}::uuid and not exists(select 1 from experts where user_id=${expert.userId}::uuid) returning id`,
            )
          ).rows.length;
          await tx.execute(sql`release savepoint planerka_purge_user`);
          if (removed === 1) userRemoved = "removed";
        } catch {
          await tx.execute(sql`rollback to savepoint planerka_purge_user`);
        }
      }
      const summary = JSON.stringify({
        operations,
        reservations,
        slots,
        services,
        expert: expertRemoved,
        user: userRemoved,
      });
      await tx.execute(sql`insert into audit_events(actor_type,actor_id,authenticated_session_id_hash,action,object_type,object_id,decision,reason_code,correlation_id,occurred_at,metadata_hash)
        values('system',${expert.userId}::uuid,${createHash("sha256").update(`planerka-test-purge:${expertId}`).digest("hex")},'planerka.test_purge','expert',${expertId}::uuid,'purged','inactive_unverified_test_expert',${randomUUID()},clock_timestamp(),${createHash("sha256").update(summary).digest("hex")})`);
      return {
        operations,
        reservations,
        slots,
        services,
        expert: expertRemoved,
        user: userRemoved,
      };
    });
  }
}
