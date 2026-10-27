import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { decodeTelegramSendTextPayload } from "../../packages/worker/src/telegram-send-text-dispatcher.js";
import { PostgresOrderedTelegramOutboxRepository } from "../../packages/db/src/repositories/outbox-repository.js";
import { createClientDispatchAdmissionGate } from "../../packages/db/src/repositories/client-consent-authority.js";
import { seedClientConsent } from "../../packages/db/src/testkit/client-consent.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import {
  seedLifecycleFixture,
  type LifecycleFixture,
} from "./lifecycle-scheduler.fixture.js";

describe("lifecycle scheduler PostgreSQL authority", () => {
  let database: TestDatabase;
  let fixture: LifecycleFixture;

  beforeAll(async () => {
    database = await startTestPostgres();
    await database.migrate();
    fixture = await seedLifecycleFixture(database);
  }, 120_000);

  afterAll(async () => database.stop(), 120_000);

  it("schedules three reminders idempotently and materializes one ordered delivery", async () => {
    await expect(
      fixture.repository.scheduleReservationLifecycle(fixture.reservationId),
    ).resolves.toBe(3);
    await expect(
      fixture.repository.scheduleReservationLifecycle(fixture.reservationId),
    ).resolves.toBe(0);

    const firstDue = new Date(
      fixture.databaseNow.getTime() + 25 * 60 * 60 * 1_000,
    );
    await expect(
      fixture.repository.processDueLifecycleBatch({
        now: firstDue,
        batchSize: 10,
      }),
    ).resolves.toEqual({ examined: 1, materialized: 1, cancelled: 0 });
    await expect(
      fixture.repository.processDueLifecycleBatch({
        now: firstDue,
        batchSize: 10,
      }),
    ).resolves.toEqual({ examined: 0, materialized: 0, cancelled: 0 });

    const result = await database.db.execute<{
      jobs: string;
      succeeded: string;
      outbox: string;
      deliveries: string;
      sequence: string;
      topic: string;
      text: string;
    }>(sql`
      select
        (select count(*)::text from lifecycle_jobs
          where subject_id=${fixture.reservationId}::uuid) jobs,
        (select count(*)::text from lifecycle_jobs
          where subject_id=${fixture.reservationId}::uuid and status='succeeded') succeeded,
        (select count(*)::text from integration_outbox
          where correlation_id like 'lifecycle:%') outbox,
        (select count(*)::text from dialogue_deliveries
          where source='deterministic') deliveries,
        d.next_delivery_sequence::text sequence,
        o.topic,
        o.payload->>'text' text
      from dialogues d
      join integration_outbox o on o.dialogue_id=d.id
      where d.id=${fixture.dialogueId}::uuid
    `);
    expect(result.rows[0]).toMatchObject({
      jobs: "3",
      succeeded: "1",
      outbox: "1",
      deliveries: "1",
      sequence: "1",
      topic: "telegram.send_text.v1",
    });
    expect(result.rows[0]!.text).toContain("Europe/Moscow");
    expect(result.rows[0]!.text).toContain("через 2 дня");
    const queue = new PostgresOrderedTelegramOutboxRepository(database.db, {
      enabled: true,
    });
    const message = (await queue.claim(1, "lifecycle-worker", 60_000, 3))[0];
    expect(message).toBeDefined();
    if (!message) throw new Error("lifecycle_reminder_not_claimable");
    const payload = decodeTelegramSendTextPayload(
      message.payload,
      "client-test",
    );
    expect(payload.consentAuthority.subjectId).toBe(fixture.userId);
    const admission = await queue.recordAttemptStarted(
      message.id,
      "lifecycle-worker",
      message.dispatchClaimToken!,
      randomUUID(),
      message.reconciliationKey,
      new Date(),
      message.attempt,
    );
    expect(admission?.kind).toBe("admitted");
    if (admission?.kind !== "admitted")
      throw new Error("lifecycle_admission_missing");
    expect(
      await createClientDispatchAdmissionGate(database.db).consume(
        message,
        admission,
      ),
    ).toBe(true);
  });

  it("includes the HTTPS meeting link in the one-day reminder", async () => {
    const secondDue = new Date(
      fixture.databaseNow.getTime() + 49 * 60 * 60 * 1_000,
    );
    await expect(
      fixture.repository.processDueLifecycleBatch({
        now: secondDue,
        batchSize: 10,
      }),
    ).resolves.toEqual({ examined: 1, materialized: 1, cancelled: 0 });
    const result = await database.db.execute<{ text: string }>(sql`
      select payload->>'text' text
      from integration_outbox
      where correlation_id like 'lifecycle:%'
      order by dialogue_sequence desc
      limit 1
    `);
    expect(result.rows[0]!.text).toContain("через 1 день");
    expect(result.rows[0]!.text).toContain(
      "https://meet.example.test/lifecycle",
    );
  });

  it("rechecks consent and cancels a due reminder without delivery", async () => {
    await database.db.execute(sql`
      insert into consents(user_id,consent_type,decision,policy_version)
      values(${fixture.userId}::uuid,'client_messaging','denied','client-messaging-v1')
    `);
    const finalDue = new Date(
      fixture.databaseNow.getTime() + 72 * 60 * 60 * 1_000 - 30 * 60 * 1_000,
    );
    await expect(
      fixture.repository.processDueLifecycleBatch({
        now: finalDue,
        batchSize: 10,
      }),
    ).resolves.toEqual({ examined: 1, materialized: 0, cancelled: 1 });
    const counts = await database.db.execute<{
      cancelled: string;
      outbox: string;
    }>(sql`
      select
        (select count(*)::text from lifecycle_jobs
          where subject_id=${fixture.reservationId}::uuid and status='cancelled') cancelled,
        (select count(*)::text from integration_outbox
          where correlation_id like 'lifecycle:%') outbox
    `);
    expect(counts.rows[0]).toEqual({ cancelled: "1", outbox: "2" });
    await seedClientConsent(database.db, fixture.userId, "client_messaging");
    const queue = new PostgresOrderedTelegramOutboxRepository(database.db, {
      enabled: true,
    });
    // A fresh grant cannot revive the earlier unstarted one-day reminder.
    expect(await queue.claim(10, "lifecycle-worker", 60_000, 3)).toHaveLength(
      0,
    );
  });
});
