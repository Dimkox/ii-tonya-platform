import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** Draft 0081 reader. Each scan rechecks qualification and returns only opaque committed event identities. */
export class PostgresDeferredReviewReconciliationReader {
  constructor(
    private readonly db: DrizzleDb,
    private readonly timeoutMs = 4000,
  ) {
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 100 ||
      timeoutMs > 30000
    )
      throw new Error("early_bird_reconcile_timeout");
  }
  async list(
    after: string | undefined,
    limit: number,
  ): Promise<{ applicationId: string; eventId: string }[]> {
    if (
      (after !== undefined && !uuid.test(after)) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new Error("early_bird_reconcile_invalid");
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('statement_timeout', ${`${this.timeoutMs}ms`}, true)`,
      );
      const result = await tx.execute<{
        applicationId: string;
        eventId: string;
      }>(sql`
      select bridge.application_id as "applicationId",e.id as "eventId"
      from resident_review_events e
      join early_bird_form_bridges bridge on bridge.form_id=e.attempt_id
      join users u on u.id=bridge.user_id and u.active
      join residents_applications f on f.id=bridge.form_id and f.user_id=bridge.user_id and f.is_current and f.status=e.action
      join expert_verification_decisions d on d.application_id=bridge.application_id and d.user_id=bridge.user_id and d.decision='approved' and d.manager_id=e.manager_id and d.manager_session_hash=e.session_hash
      join lateral (select c.id,c.choice from early_bird_choices c join early_bird_choices initial on initial.id=bridge.choice_id and initial.user_id=bridge.user_id where c.user_id=bridge.user_id and c.base_id=initial.base_id order by c.decision_no desc limit 1) current_choice on current_choice.choice='later'
      where e.action in ('APPROVED_BASIC','APPROVED_EXCLUSIVE') and e.submitted_revision=bridge.submitted_revision and e.submitted_digest=bridge.submitted_digest
        and (${after ?? null}::uuid is null or e.id>${after ?? null}::uuid)
        and early_bird_wave_active(early_bird_current_time())
        and early_bird_composite_qualification(bridge.user_id,current_choice.id)
        and not exists(select 1 from early_bird_deferred_accounts i where i.user_id=bridge.user_id)
      order by e.id limit ${limit}`);
      return result.rows;
    });
  }
}
