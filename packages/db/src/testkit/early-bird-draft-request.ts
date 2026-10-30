import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
/** Synthetic sealed-request row for isolated tests of the unshipped 0078 draft. */
export async function seedEarlyBirdDraftRequest(
  db: Pick<DrizzleDb, "execute">,
  input: {
    intentId: string;
    userId: string;
    idempotencyKey: string;
    digest: string;
  },
): Promise<void> {
  await db.execute(
    sql`insert into early_bird_composite_requests(intent_id,user_id,idempotency_key,request_digest,body_version,ciphertext,key_reference,expires_at) values(${input.intentId}::uuid,${input.userId}::uuid,${input.idempotencyKey}::uuid,${input.digest},1,'synthetic-ciphertext','vault:fixture',clock_timestamp()+interval '1 hour')`,
  );
}
