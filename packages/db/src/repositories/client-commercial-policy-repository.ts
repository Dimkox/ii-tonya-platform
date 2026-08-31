import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { withSerializableRetry } from "./message-repository.js";

export type ClientCommercialPolicy = "legacy_package_v1" | "free_client_v2";
export interface ClientCommercialPolicyPort {
  resolveOrAssign(input: {
    userId: string;
    allowV2Admission: boolean;
  }): Promise<ClientCommercialPolicy>;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export class PostgresClientCommercialPolicyRepository implements ClientCommercialPolicyPort {
  constructor(private readonly db: DrizzleDb) {}

  async resolveOrAssign(input: {
    userId: string;
    allowV2Admission: boolean;
  }): Promise<ClientCommercialPolicy> {
    if (!UUID.test(input.userId))
      throw new Error("CLIENT_COMMERCIAL_POLICY_INVALID_USER_ID");
    return withSerializableRetry(() =>
      this.db.transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level serializable`);
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${input.userId}, 0))`,
        );

        const existing = await tx.execute<{ policy: string }>(sql`
        select policy_version as policy from client_commercial_policy_assignments
        where user_id=${input.userId}::uuid
      `);
        const prior = existing.rows[0]?.policy;
        if (prior === "legacy_package_v1" || prior === "free_client_v2")
          return prior;

        let policy: ClientCommercialPolicy = "legacy_package_v1";
        let controlVersion = 1;
        if (input.allowV2Admission) {
          const control = await tx.execute<{
            policy: string;
            version: number;
          }>(sql`
          select c.admission_policy as policy, c.version
          from client_commercial_policy_controls c
          join expert_referral_admin_execution_results a
            on a.approval_id=c.approval_id
           and a.action='client_commercial_policy.control_v2'
           and a.object_id='00000000-0000-0000-0000-000000000041'::uuid
           and a.safe_result->>'version'=c.version::text
           and a.safe_result->>'admissionPolicy'=c.admission_policy
          where c.control_key='client_access'
          limit 1
        `);
          const row = control.rows[0];
          if (
            row?.policy === "free_client_v2" &&
            Number.isInteger(row.version) &&
            row.version > 0
          ) {
            policy = "free_client_v2";
            controlVersion = row.version;
          }
        }
        const inserted = await tx.execute<{ policy: string }>(sql`
        insert into client_commercial_policy_assignments (user_id, policy_version, control_version)
        values (${input.userId}::uuid, ${policy}, ${controlVersion})
        on conflict (user_id) do nothing
        returning policy_version as policy
      `);
        const assigned = inserted.rows[0]?.policy;
        if (assigned === "legacy_package_v1" || assigned === "free_client_v2")
          return assigned;
        const raced = await tx.execute<{ policy: string }>(
          sql`select policy_version as policy from client_commercial_policy_assignments where user_id=${input.userId}::uuid`,
        );
        const result = raced.rows[0]?.policy;
        if (result !== "legacy_package_v1" && result !== "free_client_v2")
          throw new Error("CLIENT_COMMERCIAL_POLICY_ASSIGNMENT_FAILED");
        return result;
      }),
    );
  }
}
