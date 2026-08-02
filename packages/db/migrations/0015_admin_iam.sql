ALTER TABLE "admin_approvals" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_approvals" DROP CONSTRAINT "admin_approvals_scope_nonce_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "admin_approvals_bound_scope_nonce_unique" ON "admin_approvals" USING btree ("action","object_type","object_id","requester_id","nonce") WHERE "admin_approvals"."requester_session_id_hash" <> 'legacy-unbound';--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"session_id_hash" text PRIMARY KEY NOT NULL,
	"admin_id" uuid NOT NULL,
	"mfa_verified_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "admin_role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_role_assignments_admin_role_unique" UNIQUE("admin_id","role"),
	CONSTRAINT "admin_role_assignments_role_allowed" CHECK ("admin_role_assignments"."role" in ('support', 'catalog_admin', 'entitlement_admin', 'security_admin'))
);--> statement-breakpoint
CREATE TABLE "admin_object_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_object_assignments_scope_unique" UNIQUE("admin_id","object_type","object_id"),
	CONSTRAINT "admin_object_assignments_type_allowed" CHECK ("admin_object_assignments"."object_type" in ('safety_case', 'feedback_queue'))
);--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_role_assignments" ADD CONSTRAINT "admin_role_assignments_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_object_assignments" ADD CONSTRAINT "admin_object_assignments_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "admin_approvals" ADD CONSTRAINT "admin_approvals_required_role_allowed" CHECK ("admin_approvals"."required_role" in ('support', 'catalog_admin', 'entitlement_admin', 'security_admin'));--> statement-breakpoint
ALTER TABLE "admin_approvals" ADD CONSTRAINT "admin_approvals_binding_complete" CHECK ("admin_approvals"."requester_session_id_hash" = 'legacy-unbound' or (
	"admin_approvals"."requester_mfa_verified_at" is not null and (
		(
			"admin_approvals"."approver_id" is null and
			"admin_approvals"."approver_session_id_hash" is null and
			"admin_approvals"."approver_mfa_verified_at" is null and
			"admin_approvals"."approved_at" is null
		) or (
			"admin_approvals"."approver_id" is not null and
			"admin_approvals"."approver_session_id_hash" is not null and
			"admin_approvals"."approver_mfa_verified_at" is not null and
			"admin_approvals"."approved_at" is not null
		)
	)
));--> statement-breakpoint
ALTER TABLE "admin_approvals" ADD CONSTRAINT "admin_approvals_lifecycle_order" CHECK ("admin_approvals"."requester_session_id_hash" = 'legacy-unbound' or (
	"admin_approvals"."expires_at" > "admin_approvals"."created_at" and
	"admin_approvals"."requester_mfa_verified_at" <= "admin_approvals"."created_at" and
	("admin_approvals"."approved_at" is null or (
		"admin_approvals"."approved_at" >= "admin_approvals"."created_at" and
		"admin_approvals"."approver_mfa_verified_at" <= "admin_approvals"."approved_at"
	)) and
	("admin_approvals"."consumed_at" is null or (
		"admin_approvals"."approved_at" is not null and
		"admin_approvals"."consumed_at" >= "admin_approvals"."approved_at"
	))
));--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_lifecycle_order" CHECK ("admin_sessions"."mfa_verified_at" <= "admin_sessions"."expires_at" and (
	"admin_sessions"."revoked_at" is null or "admin_sessions"."revoked_at" >= "admin_sessions"."created_at"
));
