import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { PostgresAdminApprovalRepository } from "./admin-approval-repository.js";

type Approval = {
  readonly actorId: string;
  readonly sessionIdHash: string;
  readonly nonce: string;
  readonly approvalId: string;
};
/** Atomic two-person authorization and replay-safe issuance. DB trigger rechecks authority. */
export class PostgresOwnerTestPricingWorkflow {
  constructor(
    private readonly db: DrizzleDb,
    private readonly approvals: PostgresAdminApprovalRepository,
  ) {}
  async grant(
    input: Approval & { readonly userId: string },
  ): Promise<{ grantId: string } | null> {
    const binding = {
      action: "owner_test_pricing.grant" as const,
      objectType: "user",
      objectId: input.userId,
      payload: { userId: input.userId },
      nonce: input.nonce,
      sessionIdHash: input.sessionIdHash,
      approvalId: input.approvalId,
    };
    return this.db
      .transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${input.approvalId},0))`,
        );
        const prior = await tx.execute<{ grantId: string }>(
          sql`select id as "grantId" from owner_test_pricing_grants where grant_approval_id=${input.approvalId}::uuid`,
        );
        if (prior.rows[0]) {
          const replay =
            await this.approvals.validateConsumedApprovalReplayInTransaction(
              tx,
              binding,
            );
          return replay?.requesterId === input.actorId ? prior.rows[0] : null;
        }
        const approval = await this.approvals.consumeApprovalInTransaction(
          tx,
          binding,
        );
        if (!approval || approval.requesterId !== input.actorId)
          throw new Error("owner_test_pricing_approval_denied");
        const created = await tx.execute<{ grantId: string }>(
          sql`insert into owner_test_pricing_grants(user_id,granted_by,grant_session_hash,grant_approval_id) values(${input.userId}::uuid,${input.actorId}::uuid,${input.sessionIdHash},${input.approvalId}::uuid) returning id as "grantId"`,
        );
        return created.rows[0] ?? null;
      })
      .catch((error: unknown) => {
        if ((error as Error).message === "owner_test_pricing_approval_denied")
          return null;
        const cause = (
          error as { cause?: { code?: string; constraint?: string } }
        ).cause;
        if (
          cause?.code === "23505" &&
          cause.constraint === "owner_test_pricing_one_active"
        )
          throw new Error("owner_test_pricing_conflict");
        throw error;
      });
  }
  async revoke(
    input: Approval & { readonly grantId: string },
  ): Promise<{ grantId: string } | null> {
    const binding = {
      action: "owner_test_pricing.revoke" as const,
      objectType: "owner_test_pricing_grant",
      objectId: input.grantId,
      payload: { grantId: input.grantId },
      nonce: input.nonce,
      sessionIdHash: input.sessionIdHash,
      approvalId: input.approvalId,
    };
    return this.db
      .transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${input.approvalId},0))`,
        );
        const subject = await tx.execute<{ userId: string }>(
          sql`select user_id as "userId" from owner_test_pricing_grants where id=${input.grantId}::uuid`,
        );
        if (!subject.rows[0])
          throw new Error("owner_test_pricing_approval_denied");
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${subject.rows[0].userId},0))`,
        );
        const prior = await tx.execute<{ grantId: string }>(
          sql`select id as "grantId" from owner_test_pricing_grants where revoke_approval_id=${input.approvalId}::uuid`,
        );
        if (prior.rows[0]) {
          const replay =
            await this.approvals.validateConsumedApprovalReplayInTransaction(
              tx,
              binding,
            );
          return replay?.requesterId === input.actorId ? prior.rows[0] : null;
        }
        const approval = await this.approvals.consumeApprovalInTransaction(
          tx,
          binding,
        );
        if (!approval || approval.requesterId !== input.actorId)
          throw new Error("owner_test_pricing_approval_denied");
        const updated = await tx.execute<{ grantId: string }>(
          sql`update owner_test_pricing_grants set revoked_at=clock_timestamp(),revoked_by=${input.actorId}::uuid,revoke_session_hash=${input.sessionIdHash},revoke_approval_id=${input.approvalId}::uuid where id=${input.grantId}::uuid and revoked_at is null returning id as "grantId"`,
        );
        if (!updated.rows[0])
          throw new Error("owner_test_pricing_approval_denied");
        return updated.rows[0];
      })
      .catch((error: unknown) => {
        if ((error as Error).message === "owner_test_pricing_approval_denied")
          return null;
        throw error;
      });
  }
}
