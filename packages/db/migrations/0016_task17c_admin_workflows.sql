CREATE TABLE "admin_case_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_case_actions_object_action_unique" UNIQUE("object_type","object_id","action"),
	CONSTRAINT "admin_case_actions_approval_unique" UNIQUE("approval_id"),
	CONSTRAINT "admin_case_actions_object_type_allowed" CHECK ("admin_case_actions"."object_type" in ('safety_alert', 'negative_feedback')),
	CONSTRAINT "admin_case_actions_action_allowed" CHECK ("admin_case_actions"."action" in ('acknowledge', 'resolve'))
);
--> statement-breakpoint
CREATE TABLE "integration_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"reason_code" text NOT NULL,
	"metadata_hash" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_errors_status_allowed" CHECK ("integration_errors"."status" in ('open', 'resolved'))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "message_ledger_entries" ADD COLUMN "admin_approval_id" uuid;--> statement-breakpoint
ALTER TABLE "message_ledger_entries" ADD COLUMN "admin_requester_session_id_hash" text;--> statement-breakpoint
ALTER TABLE "message_packages" ADD COLUMN "admin_approval_id" uuid;--> statement-breakpoint
ALTER TABLE "message_packages" ADD COLUMN "admin_requester_session_id_hash" text;--> statement-breakpoint
ALTER TABLE "admin_case_actions" ADD CONSTRAINT "admin_case_actions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_case_actions" ADD CONSTRAINT "admin_case_actions_approval_id_admin_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."admin_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_ledger_entries" ADD CONSTRAINT "message_ledger_admin_binding_complete" CHECK (
      ("message_ledger_entries"."admin_approval_id" is null and "message_ledger_entries"."admin_requester_session_id_hash" is null)
      or ("message_ledger_entries"."admin_approval_id" is not null and "message_ledger_entries"."admin_requester_session_id_hash" is not null)
    );--> statement-breakpoint
ALTER TABLE "message_packages" ADD CONSTRAINT "message_packages_admin_binding_complete" CHECK (
      ("message_packages"."admin_approval_id" is null and "message_packages"."admin_requester_session_id_hash" is null)
      or ("message_packages"."admin_approval_id" is not null and "message_packages"."admin_requester_session_id_hash" is not null)
    );--> statement-breakpoint
ALTER TABLE "message_packages" ADD CONSTRAINT "message_packages_admin_contract" CHECK (
      ("message_packages"."kind" = 'admin' and "message_packages"."granted_messages" in (500, 1000, 1500, 2000) and "message_packages"."expires_at" is not null)
      or ("message_packages"."kind" = 'intro' and "message_packages"."granted_messages" = 100 and "message_packages"."expires_at" is null)
      or ("message_packages"."kind" = 'paid')
    );--> statement-breakpoint
CREATE TRIGGER "admin_case_actions_append_only"
BEFORE UPDATE OR DELETE ON "admin_case_actions"
FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
