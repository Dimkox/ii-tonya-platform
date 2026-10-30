import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { lockClientConsentSubject } from "./client-consent-authority.js";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** Resolve only an approved committed event with a current qualified later choice. */
export class PostgresDeferredReviewSource {
  constructor(private readonly db: DrizzleDb) {}
  async resolve(input: {
    applicationId: string;
    eventId: string;
  }): Promise<{
    userId: string;
    baseId: string;
    choiceId: string;
    configId: string;
  } | null> {
    if (!uuid.test(input.applicationId) || !uuid.test(input.eventId))
      return null;
    return this.db.transaction(
      async (tx) => {
        const candidates = (
          await tx.execute<{ userId: string }>(
            sql`select bridge.user_id as "userId" from resident_review_events e join early_bird_form_bridges bridge on bridge.form_id=e.attempt_id where e.id=${input.eventId}::uuid and bridge.application_id=${input.applicationId}::uuid limit 2`,
          )
        ).rows;
        if (candidates.length !== 1) return null;
        const userId = candidates[0]!.userId;
        await lockClientConsentSubject(tx, userId);
        const rows = (
          await tx.execute<{
            userId: string;
            baseId: string;
            choiceId: string;
            configId: string;
          }>(
            sql`select bridge.user_id as "userId",c.base_id as "baseId",c.id as "choiceId",cfg.id as "configId" from resident_review_events e join early_bird_form_bridges bridge on bridge.form_id=e.attempt_id join users u on u.id=bridge.user_id and u.active join residents_applications f on f.id=bridge.form_id and f.user_id=u.id and f.is_current and f.status=e.action join expert_verification_decisions d on d.application_id=bridge.application_id and d.user_id=u.id and d.decision='approved' and d.manager_id=e.manager_id and d.manager_session_hash=e.session_hash join early_bird_choices initial on initial.id=bridge.choice_id and initial.user_id=u.id join early_bird_choices c on c.base_id=initial.base_id and c.user_id=u.id join expert_sales_bases b on b.id=c.base_id and b.user_id=u.id join early_bird_launch_configs cfg on cfg.active and cfg.phase='WAVE_1_EARLY_BIRD' where e.id=${input.eventId}::uuid and bridge.application_id=${input.applicationId}::uuid and bridge.user_id=${userId}::uuid and e.action in ('APPROVED_BASIC','APPROVED_EXCLUSIVE') and e.submitted_revision=bridge.submitted_revision and e.submitted_digest=bridge.submitted_digest and c.choice='later' and c.id=(select id from early_bird_choices where base_id=b.id order by decision_no desc limit 1) and early_bird_wave_active(early_bird_current_time()) and early_bird_composite_qualification(u.id,c.id) and expert_card_current_messaging_authority(u.id,b.consent_version) limit 2 for share of e,bridge,u,f,d,c,b,cfg`,
          )
        ).rows;
        return rows.length === 1 ? rows[0]! : null;
      },
      { isolationLevel: "serializable" },
    );
  }
}
