import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { PostgresLifecycleSchedulerRepository } from "../../packages/db/src/repositories/lifecycle-scheduler-repository.js";
import type { TestDatabase } from "../../packages/db/src/testkit/postgres.js";

export interface LifecycleFixture {
  readonly userId: string;
  readonly reservationId: string;
  readonly slotId: string;
  readonly dialogueId: string;
  readonly startsAt: Date;
  readonly databaseNow: Date;
  readonly repository: PostgresLifecycleSchedulerRepository;
}

export async function seedLifecycleFixture(
  database: TestDatabase,
): Promise<LifecycleFixture> {
  const userId = await database.createUser();
  const expertUserId = await database.createUser();
  const expertId = (
    await database.db.execute<{ id: string }>(sql`
      insert into experts(user_id,public_display_name,active,verified)
      values(${expertUserId}::uuid,'Lifecycle expert',true,true)
      returning id
    `)
  ).rows[0]!.id;
  const serviceId = (
    await database.db.execute<{ id: string }>(sql`
      insert into expert_services(expert_id,name,code,language,active,duration_minutes)
      values(${expertId}::uuid,'Lifecycle service','lifecycle','ru',true,60)
      returning id
    `)
  ).rows[0]!.id;
  const clock = (
    await database.db.execute<{ now: Date | string }>(
      sql`select clock_timestamp() as now`,
    )
  ).rows[0]!.now;
  const databaseNow = new Date(clock);
  const startsAt = new Date(databaseNow.getTime() + 72 * 60 * 60 * 1_000);
  const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1_000);
  const slotId = (
    await database.db.execute<{ id: string }>(sql`
      insert into slots(
        expert_service_id,provider,external_slot_id,starts_at,ends_at,observed_at,capacity
      ) values(
        ${serviceId}::uuid,'local',${`lifecycle-${randomUUID()}`},
        ${startsAt},${endsAt},${databaseNow},1
      ) returning id
    `)
  ).rows[0]!.id;
  const reservationId = (
    await database.db.execute<{ id: string }>(sql`
      insert into reservations(
        user_id,slot_id,expert_id,expert_service_id,status,idempotency_key,
        reserved_until,meeting_url
      ) values(
        ${userId}::uuid,${slotId}::uuid,${expertId}::uuid,${serviceId}::uuid,
        'booked',${`lifecycle-${randomUUID()}`},
        ${new Date(databaseNow.getTime() + 60 * 60 * 1_000)},
        'https://meet.example.test/lifecycle'
      ) returning id
    `)
  ).rows[0]!.id;
  await database.db.execute(sql`
    insert into client_profiles(user_id,display_name,timezone)
    values(${userId}::uuid,'Lifecycle client','Europe/Moscow')
  `);
  await database.db.execute(sql`
    insert into consents(user_id,consent_type,decision,policy_version)
    values(${userId}::uuid,'client_messaging','granted','client-messaging-v1')
  `);
  const dialogueId = (
    await database.db.execute<{ id: string }>(sql`
      insert into dialogues(tenant_key,user_id,provider,bot_key,external_chat_id)
      values('client-test',${userId}::uuid,'telegram','client-test','801234567')
      returning id
    `)
  ).rows[0]!.id;
  return {
    userId,
    reservationId,
    slotId,
    dialogueId,
    startsAt,
    databaseNow,
    repository: new PostgresLifecycleSchedulerRepository(
      database.db,
      "client-messaging-v1",
      "client-test",
    ),
  };
}
