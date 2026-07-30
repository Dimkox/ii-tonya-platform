import type { DrizzleDb } from "../client.js";

export interface GrantAdminPackageCommand { readonly userId: string; readonly units: 100 | 500 | 1000 | 1500 | 2000; readonly kind: "admin" | "intro"; readonly expiresAt: Date | null; readonly idempotencyKey: string; }
export interface RevokeAdminPackageCommand { readonly packageId: string; readonly idempotencyKey: string; }
export interface AdminPackageRepository { grantPackage(command: GrantAdminPackageCommand): Promise<{ packageId: string }>; revokePackage(command: RevokeAdminPackageCommand): Promise<{ delta: number; originalEntryId: string }>; }
export interface ExecuteApprovedGrantCommand extends GrantAdminPackageCommand { readonly approvalId: string; readonly requesterId: string; readonly requesterSessionIdHash: string; readonly payloadHash: string; readonly action: "package.grant" | "package.intro_grant"; readonly correlationId: string; readonly occurredAt: Date; }

export class UnregisteredAdminWorkflowError extends Error {
  constructor() {
    super("Admin workflows are not registered");
    this.name = "UnregisteredAdminWorkflowError";
  }
}

// These are deliberately retained only as migration-safe type placeholders.
// No admin database workflow is registered until its approval, domain mutation,
// assignment checks, and audit are one concrete transaction.
export class PostgresAdminRepository implements AdminPackageRepository {
  constructor(db: DrizzleDb) { void db; }

  async grantPackage(command: GrantAdminPackageCommand): Promise<{ packageId: string }> {
    void command;
    throw new UnregisteredAdminWorkflowError();
  }

  async revokePackage(command: RevokeAdminPackageCommand): Promise<{ delta: number; originalEntryId: string }> {
    void command;
    throw new UnregisteredAdminWorkflowError();
  }

  async executeApprovedGrant(command: ExecuteApprovedGrantCommand): Promise<{ allowed: true; packageId: string } | { allowed: false }> {
    void command;
    throw new UnregisteredAdminWorkflowError();
  }
}
