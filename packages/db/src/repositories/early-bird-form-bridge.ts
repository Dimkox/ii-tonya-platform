import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
type Tx = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];
/** Draft integration; never creates payment or entitlement. Caller holds subject lock. */
export async function bridgeEarlyBirdForm(
  tx: Tx,
  userId: string,
  formId: string,
  revision: number,
): Promise<string | null> {
  const existing = (
    await tx.execute<{ id: string }>(
      sql`select application_id as id from early_bird_form_bridges where form_id=${formId}::uuid and user_id=${userId}::uuid`,
    )
  ).rows[0];
  if (existing) return existing.id;
  const choice = (
    await tx.execute<{ id: string }>(
      sql`select c.id from early_bird_form_enrollments en join early_bird_choices c on c.id=en.choice_id and c.user_id=en.user_id where en.form_id=${formId}::uuid and en.user_id=${userId}::uuid`,
    )
  ).rows[0];
  if (!choice) return null;
  const application = (
    await tx.execute<{ id: string }>(
      sql`insert into expert_onboarding_applications(user_id) values(${userId}::uuid) returning id`,
    )
  ).rows[0]!;
  const inserted = await tx.execute(
    sql`insert into early_bird_form_bridges(application_id,form_id,user_id,choice_id,submitted_revision,submitted_digest) select ${application.id}::uuid,f.id,f.user_id,${choice.id}::uuid,f.submitted_revision,encode(digest(f.submitted_draft::text,'sha256'),'hex') from residents_applications f where f.id=${formId}::uuid and f.user_id=${userId}::uuid and f.submitted_revision=${revision} returning application_id`,
  );
  if (inserted.rows.length !== 1)
    throw new Error("early_bird_form_bridge_source");
  await tx.execute(
    sql`insert into expert_promo_manager_work(application_id,user_id) values(${application.id}::uuid,${userId}::uuid)`,
  );
  return application.id;
}
