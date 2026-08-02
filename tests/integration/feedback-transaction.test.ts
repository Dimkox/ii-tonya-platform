import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PostgresFeedbackRepository } from "../../packages/db/src/index.js";
import { startTestPostgres, type TestDatabase } from "../../packages/db/src/testkit/postgres.js";
import { expectPostgresErrorCause } from "../support/postgres-error.js";

let testDb: TestDatabase;
beforeAll(async () => { testDb = await startTestPostgres(); await testDb.migrate(); }, 120_000);
afterAll(async () => testDb?.stop(), 60_000);

const rejected = async (operation: Promise<unknown>): Promise<unknown> =>
  operation.then(
    () => { throw new Error("Expected injected PostgreSQL failure"); },
    (error: unknown) => error,
  );

const dropOutboxFailureInjection = async (): Promise<void> => {
  try {
    await testDb.db.execute(sql`drop trigger if exists fail_feedback_outbox on integration_outbox`);
  } finally {
    await testDb.db.execute(sql`drop function if exists fail_feedback_outbox()`);
  }
};

const dropAuditFailureInjection = async (): Promise<void> => {
  try {
    await testDb.db.execute(sql`drop trigger if exists fail_feedback_audit on audit_events`);
  } finally {
    await testDb.db.execute(sql`drop function if exists fail_feedback_audit()`);
  }
};

describe("feedback transaction gate", () => {
  it("deduplicates a concurrent negative source event into one feedback, free outbox, and immutable audit", async () => {
    const userId = await testDb.createUser();
    const repository = new PostgresFeedbackRepository(testDb.db);
    const command = { userId, score: 1 as const, text: "private negative feedback", sourceEventId: "feedback-concurrent", correlationId: "feedback-first" };
    const results = await Promise.all([repository.submitFeedbackTransaction(command), repository.submitFeedbackTransaction(command)]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ escalated: true });
    const facts = await testDb.db.execute<{ feedback: string; outbox: string; audit: string; rawText: string; auditMetadata: string }>(sql`
      select
        (select count(*)::text from feedback where source_event_id = 'feedback-concurrent') as feedback,
        (select count(*)::text from integration_outbox where idempotency_key like 'feedback:%:negative') as outbox,
        (select count(*)::text from audit_events where action = 'feedback.escalated') as audit,
        (select coalesce(string_agg(payload::text, ''), '') from integration_outbox where idempotency_key like 'feedback:%:negative') as "rawText",
        (select coalesce(string_agg(metadata_hash, ''), '') from audit_events where action = 'feedback.escalated') as "auditMetadata"
    `);
    expect(facts.rows[0]).toEqual({ feedback: "1", outbox: "1", audit: "1", rawText: expect.not.stringContaining("private negative feedback"), auditMetadata: expect.not.stringContaining("private negative feedback") });
    const effects = await testDb.db.execute<{ ledger: string }>(sql`
      select count(*)::text as ledger from message_ledger_entries
    `);
    expect(effects.rows[0]).toEqual({ ledger: "0" });
    await expect(testDb.db.execute(sql`update audit_events set reason_code = 'tampered' where action = 'feedback.escalated'`)).rejects.toThrow();
    await expect(testDb.db.execute(sql`delete from audit_events where action = 'feedback.escalated'`)).rejects.toThrow();
  });

  it("rolls back the whole effect when outbox or audit append fails and permits a later retry", async () => {
    const userId = await testDb.createUser();
    const repository = new PostgresFeedbackRepository(testDb.db);
    const command = { userId, score: 2 as const, text: "private rollback feedback", sourceEventId: "feedback-rollback", correlationId: "feedback-rollback" };
    await testDb.db.execute(sql`create function fail_feedback_outbox() returns trigger language plpgsql as $$ begin raise exception 'forced outbox failure'; end; $$`);
    await testDb.db.execute(sql`create trigger fail_feedback_outbox before insert on integration_outbox for each row when (new.topic = 'admin.negative_feedback') execute function fail_feedback_outbox()`);
    try {
      expectPostgresErrorCause(await rejected(repository.submitFeedbackTransaction(command)), "P0001", "forced outbox failure");
    } finally {
      await dropOutboxFailureInjection();
    }
    await expect(repository.submitFeedbackTransaction(command)).resolves.toMatchObject({ escalated: true });
    const facts = await testDb.db.execute<{ feedback: string; outbox: string; audit: string }>(sql`
      select
        (select count(*)::text from feedback where source_event_id = 'feedback-rollback') as feedback,
        (select count(*)::text from integration_outbox where correlation_id = 'feedback-rollback') as outbox,
        (select count(*)::text from audit_events where correlation_id = 'feedback-rollback') as audit
    `);
    expect(facts.rows[0]).toEqual({ feedback: "1", outbox: "1", audit: "1" });
  });

  it("rolls back the whole effect when audit append fails", async () => {
    const userId = await testDb.createUser();
    const repository = new PostgresFeedbackRepository(testDb.db);
    const command = { userId, score: 3 as const, text: "private audit failure", sourceEventId: "feedback-audit-failure", correlationId: "feedback-audit-failure" };
    await testDb.db.execute(sql`create function fail_feedback_audit() returns trigger language plpgsql as $$ begin raise exception 'forced audit failure'; end; $$`);
    await testDb.db.execute(sql`create trigger fail_feedback_audit before insert on audit_events for each row when (new.action = 'feedback.escalated') execute function fail_feedback_audit()`);
    try {
      expectPostgresErrorCause(await rejected(repository.submitFeedbackTransaction(command)), "P0001", "forced audit failure");
      const facts = await testDb.db.execute<{ feedback: string; outbox: string }>(sql`
        select
          (select count(*)::text from feedback where source_event_id = 'feedback-audit-failure') as feedback,
          (select count(*)::text from integration_outbox where correlation_id = 'feedback-audit-failure') as outbox
      `);
      expect(facts.rows[0]).toEqual({ feedback: "0", outbox: "0" });
    } finally {
      await dropAuditFailureInjection();
    }
    await expect(repository.submitFeedbackTransaction(command)).resolves.toMatchObject({ escalated: true });
  });

  it.each([[4, "neutral"], [5, "neutral"], [4, "явно негативный опыт"]] as const)("escalates only low scores or explicit-negative policy for score %s", async (score, text) => {
    const userId = await testDb.createUser();
    const repository = new PostgresFeedbackRepository(testDb.db);
    const result = await repository.submitFeedbackTransaction({ userId, score, text, sourceEventId: `feedback-score-${score}-${text}`, correlationId: `feedback-score-${score}-${text}` });
    expect(result.escalated).toBe(score <= 3 || text === "явно негативный опыт");
    const effects = await testDb.db.execute<{ outbox: string; audit: string }>(sql`
      select
        (select count(*)::text from integration_outbox where correlation_id = ${`feedback-score-${score}-${text}`}) as outbox,
        (select count(*)::text from audit_events where correlation_id = ${`feedback-score-${score}-${text}`}) as audit
    `);
    if (score >= 4 && text === "neutral") {
      expect(effects.rows[0]).toEqual({ outbox: "0", audit: "0" });
    } else {
      expect(effects.rows[0]).toEqual({ outbox: "1", audit: "1" });
    }
  });

  it.each([
    ["user", (command: { userId: string; reservationId?: string; score: 1 | 2 | 3 | 4 | 5; text?: string; sourceEventId: string; correlationId: string }, otherUserId: string) => ({ ...command, userId: otherUserId })],
    ["reservation", (command: { userId: string; reservationId?: string; score: 1 | 2 | 3 | 4 | 5; text?: string; sourceEventId: string; correlationId: string }) => ({ ...command, reservationId: "00000000-0000-0000-0000-000000000001" })],
    ["score", (command: { userId: string; reservationId?: string; score: 1 | 2 | 3 | 4 | 5; text?: string; sourceEventId: string; correlationId: string }) => ({ ...command, score: 3 as const })],
    ["text", (command: { userId: string; reservationId?: string; score: 1 | 2 | 3 | 4 | 5; text?: string; sourceEventId: string; correlationId: string }) => ({ ...command, text: "changed private feedback" })],
  ] as const)("rejects changed %s replays without creating new effects", async (_field, mutate) => {
    const userId = await testDb.createUser();
    const otherUserId = await testDb.createUser();
    const repository = new PostgresFeedbackRepository(testDb.db);
    const command = { userId, score: 1 as const, text: "original private feedback", sourceEventId: `feedback-conflict-${_field}`, correlationId: `feedback-conflict-${_field}` };
    await repository.submitFeedbackTransaction(command);
    await expect(repository.submitFeedbackTransaction(mutate(command, otherUserId))).rejects.toThrow("Feedback source event conflicts with its original request");
    const effects = await testDb.db.execute<{ feedback: string; outbox: string; audit: string }>(sql`
      select
        (select count(*)::text from feedback where source_event_id = ${command.sourceEventId}) as feedback,
        (select count(*)::text from integration_outbox where correlation_id = ${command.correlationId}) as outbox,
        (select count(*)::text from audit_events where correlation_id = ${command.correlationId}) as audit
    `);
    expect(effects.rows[0]).toEqual({ feedback: "1", outbox: "1", audit: "1" });
  });

  it("rejects a changed stored policy replay without creating new effects", async () => {
    const userId = await testDb.createUser();
    const repository = new PostgresFeedbackRepository(testDb.db);
    const command = { userId, score: 1 as const, text: "policy private feedback", sourceEventId: "feedback-conflict-policy", correlationId: "feedback-conflict-policy" };
    await repository.submitFeedbackTransaction(command);
    await testDb.db.execute(sql`update feedback set negative_policy_version = 'negative-v0' where source_event_id = ${command.sourceEventId}`);
    await expect(repository.submitFeedbackTransaction(command)).rejects.toThrow("Feedback source event conflicts with its original request");
    const effects = await testDb.db.execute<{ feedback: string; outbox: string; audit: string }>(sql`
      select
        (select count(*)::text from feedback where source_event_id = ${command.sourceEventId}) as feedback,
        (select count(*)::text from integration_outbox where correlation_id = ${command.correlationId}) as outbox,
        (select count(*)::text from audit_events where correlation_id = ${command.correlationId}) as audit
    `);
    expect(effects.rows[0]).toEqual({ feedback: "1", outbox: "1", audit: "1" });
  });
});
