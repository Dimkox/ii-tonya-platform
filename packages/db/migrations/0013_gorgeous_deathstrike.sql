ALTER TABLE "admin_approvals" ALTER COLUMN "approver_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_approvals" ADD COLUMN "requester_session_id_hash" text DEFAULT 'legacy-unbound' NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_approvals" ADD COLUMN "approver_session_id_hash" text;--> statement-breakpoint
ALTER TABLE "admin_approvals" ADD COLUMN "payload_hash" text DEFAULT 'legacy-unbound' NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_approvals" ADD COLUMN "required_role" text DEFAULT 'support' NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_approvals" ADD COLUMN "requester_mfa_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_approvals" ADD COLUMN "approver_mfa_verified_at" timestamp with time zone;