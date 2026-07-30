import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PostgresFeedbackRepository } from "../../packages/db/src/index.js";
import { startTestPostgres, type TestDatabase } from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase;
beforeAll(async () => { testDb = await startTestPostgres(); await testDb.migrate(); }, 120_000);
afterAll(async () => testDb?.stop(), 60_000);

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
  });

  it("rolls back the whole effect when outbox or audit append fails and permits a later retry", async () => {
    const userId = await testDb.createUser();
    const repository = new PostgresFeedbackRepository(testDb.db);
    const command = { userId, score: 2 as const, text: "private rollback feedback", sourceEventId: "feedback-rollback", correlationId: "feedback-rollback" };
    await testDb.db.execute(sql`create function fail_feedback_outbox() returns trigger language plpgsql as $$ begin raise exception 'forced outbox failure'; end; $$`);
    await testDb.db.execute(sql`create trigger fail_feedback_outbox before insert on integration_outbox for each row when (new.topic = 'admin.negative_feedback') execute function fail_feedback_outbox()`);
    await expect(repository.submitFeedbackTransaction(command)).rejects.toThrow("forced outbox failure");
    await testDb.db.execute(sql`drop trigger fail_feedback_outbox on integration_outbox; drop function fail_feedback_outbox()`);
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
    await expect(repository.submitFeedbackTransaction(command)).rejects.toThrow("forced audit failure");
    const facts = await testDb.db.execute<{ feedback: string; outbox: string }>(sql`
      select
        (select count(*)::text from feedback where source_event_id = 'feedback-audit-failure') as feedback,
        (select count(*)::text from integration_outbox where correlation_id = 'feedback-audit-failure') as outbox
    `);
    expect(facts.rows[0]).toEqual({ feedback: "0", outbox: "0" });
    await testDb.db.execute(sql`drop trigger fail_feedback_audit on audit_events; drop function fail_feedback_audit()`);
    await expect(repository.submitFeedbackTransaction(command)).resolves.toMatchObject({ escalated: true });
  });

  it.each([[4, "neutral"], [5, "neutral"], [4, "явно негативный опыт"]] as const)("escalates only low scores or explicit-negative policy for score %s", async (score, text) => {
    const userId = await testDb.createUser();
    const repository = new PostgresFeedbackRepository(testDb.db);
    const result = await repository.submitFeedbackTransaction({ userId, score, text, sourceEventId: `feedback-score-${score}-${text}`, correlationId: `feedback-score-${score}-${text}` });
    expect(result.escalated).toBe(score <= 3 || text === "явно негативный опыт");
  });
});
