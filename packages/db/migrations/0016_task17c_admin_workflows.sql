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
ALTER TABLE "message_ledger_entries" ADD COLUMN "legacy_admin_fact" boolean;--> statement-breakpoint
ALTER TABLE "message_packages" ADD COLUMN "admin_approval_id" uuid;--> statement-breakpoint
ALTER TABLE "message_packages" ADD COLUMN "admin_requester_session_id_hash" text;--> statement-breakpoint
ALTER TABLE "message_packages" ADD COLUMN "legacy_admin_grant" boolean;--> statement-breakpoint
ALTER TABLE "message_packages" DISABLE TRIGGER "message_packages_append_only";--> statement-breakpoint
UPDATE "message_packages"
SET "legacy_admin_grant" = ("kind" in ('admin', 'intro'));--> statement-breakpoint
ALTER TABLE "message_packages" ENABLE TRIGGER "message_packages_append_only";--> statement-breakpoint
ALTER TABLE "message_ledger_entries" DISABLE TRIGGER "message_ledger_entries_append_only";--> statement-breakpoint
UPDATE "message_ledger_entries" l
SET "legacy_admin_fact" = true
FROM "message_packages" p
WHERE p."id" = l."package_id"
  AND p."legacy_admin_grant" = true
  AND l."entry_kind" = 'grant';--> statement-breakpoint
UPDATE "message_ledger_entries"
SET "legacy_admin_fact" = false
WHERE "legacy_admin_fact" IS NULL;--> statement-breakpoint
ALTER TABLE "message_ledger_entries" ENABLE TRIGGER "message_ledger_entries_append_only";--> statement-breakpoint
ALTER TABLE "message_packages" ALTER COLUMN "legacy_admin_grant" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "message_packages" ALTER COLUMN "legacy_admin_grant" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "message_ledger_entries" ALTER COLUMN "legacy_admin_fact" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "message_ledger_entries" ALTER COLUMN "legacy_admin_fact" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_case_actions" ADD CONSTRAINT "admin_case_actions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_case_actions" ADD CONSTRAINT "admin_case_actions_approval_id_admin_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."admin_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_ledger_entries" ADD CONSTRAINT "message_ledger_entries_admin_approval_id_admin_approvals_id_fk" FOREIGN KEY ("admin_approval_id") REFERENCES "public"."admin_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_ledger_entries" ADD CONSTRAINT "message_ledger_entries_admin_requester_session_id_hash_admin_sessions_session_id_hash_fk" FOREIGN KEY ("admin_requester_session_id_hash") REFERENCES "public"."admin_sessions"("session_id_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_packages" ADD CONSTRAINT "message_packages_admin_approval_id_admin_approvals_id_fk" FOREIGN KEY ("admin_approval_id") REFERENCES "public"."admin_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_packages" ADD CONSTRAINT "message_packages_admin_requester_session_id_hash_admin_sessions_session_id_hash_fk" FOREIGN KEY ("admin_requester_session_id_hash") REFERENCES "public"."admin_sessions"("session_id_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_ledger_entries" ADD CONSTRAINT "message_ledger_admin_binding_complete" CHECK (
      ("message_ledger_entries"."admin_approval_id" is null and "message_ledger_entries"."admin_requester_session_id_hash" is null)
      or ("message_ledger_entries"."admin_approval_id" is not null and "message_ledger_entries"."admin_requester_session_id_hash" is not null)
    );--> statement-breakpoint
ALTER TABLE "message_packages" ADD CONSTRAINT "message_packages_admin_binding_complete" CHECK (
      ("message_packages"."admin_approval_id" is null and "message_packages"."admin_requester_session_id_hash" is null)
      or ("message_packages"."admin_approval_id" is not null and "message_packages"."admin_requester_session_id_hash" is not null)
    );--> statement-breakpoint
ALTER TABLE "message_packages" ADD CONSTRAINT "message_packages_admin_contract" CHECK (
      ("message_packages"."kind" = 'paid' and "message_packages"."legacy_admin_grant" = false and "message_packages"."admin_approval_id" is null and "message_packages"."admin_requester_session_id_hash" is null)
      or ("message_packages"."kind" in ('admin', 'intro') and "message_packages"."legacy_admin_grant" = true and "message_packages"."admin_approval_id" is null and "message_packages"."admin_requester_session_id_hash" is null)
      or ("message_packages"."kind" = 'admin' and "message_packages"."legacy_admin_grant" = false and "message_packages"."admin_approval_id" is not null and "message_packages"."admin_requester_session_id_hash" is not null and "message_packages"."granted_messages" in (500, 1000, 1500, 2000) and "message_packages"."expires_at" is not null)
      or ("message_packages"."kind" = 'intro' and "message_packages"."legacy_admin_grant" = false and "message_packages"."admin_approval_id" is not null and "message_packages"."admin_requester_session_id_hash" is not null and "message_packages"."granted_messages" = 100 and "message_packages"."expires_at" is null)
    );--> statement-breakpoint
DROP TRIGGER IF EXISTS "human_escalations_append_only" ON "human_escalations";--> statement-breakpoint
CREATE FUNCTION enforce_human_escalation_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  transition_now timestamptz := clock_timestamp();
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'human escalation deletion is forbidden' USING ERRCODE = '55000';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.incident_id IS DISTINCT FROM OLD.incident_id
    OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
    OR NEW.acknowledgement_deadline IS DISTINCT FROM OLD.acknowledgement_deadline
    OR NEW.escalation_reason IS DISTINCT FROM OLD.escalation_reason
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'human escalation immutable fields cannot change' USING ERRCODE = '55000';
  END IF;

  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'human escalation version must increment by one' USING ERRCODE = '40001';
  END IF;
  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'human escalation updated_at cannot move backward' USING ERRCODE = '22007';
  END IF;
  IF NEW.updated_at > transition_now
    OR NEW.acknowledged_at > transition_now
    OR NEW.resolved_at > transition_now
  THEN
    RAISE EXCEPTION 'human escalation transition timestamp is in the future' USING ERRCODE = '22007';
  END IF;

  IF OLD.status = 'opened' AND NEW.status = 'assigned' THEN
    IF NEW.owner_id IS NULL
      OR (OLD.owner_id IS NOT NULL AND NEW.owner_id IS DISTINCT FROM OLD.owner_id)
      OR NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at
      OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
    THEN
      RAISE EXCEPTION 'invalid opened to assigned human escalation transition' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.status = 'assigned' AND NEW.status = 'acknowledged' THEN
    IF NEW.owner_id IS NULL
      OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
      OR OLD.acknowledged_at IS NOT NULL
      OR NEW.acknowledged_at IS NULL
      OR NEW.acknowledged_at < OLD.updated_at
      OR NEW.updated_at < NEW.acknowledged_at
      OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
    THEN
      RAISE EXCEPTION 'invalid assigned to acknowledged human escalation transition' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.status = 'assigned' AND NEW.status = 'escalated' THEN
    IF NEW.owner_id IS NULL
      OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
      OR NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at
      OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
      OR transition_now < OLD.acknowledgement_deadline
      OR NEW.updated_at < OLD.acknowledgement_deadline
    THEN
      RAISE EXCEPTION 'invalid assigned to escalated human escalation transition' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.status IN ('acknowledged', 'escalated') AND NEW.status = 'resolved' THEN
    IF NEW.owner_id IS NULL
      OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
      OR NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at
      OR OLD.resolved_at IS NOT NULL
      OR NEW.resolved_at IS NULL
      OR NEW.resolved_at < COALESCE(OLD.acknowledged_at, OLD.updated_at)
      OR NEW.updated_at < NEW.resolved_at
    THEN
      RAISE EXCEPTION 'invalid resolved human escalation transition' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'human escalation status transition is not allowed' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "human_escalations_transition_integrity"
BEFORE UPDATE OR DELETE ON "human_escalations"
FOR EACH ROW EXECUTE FUNCTION enforce_human_escalation_transition();--> statement-breakpoint
CREATE TRIGGER "admin_case_actions_append_only"
BEFORE UPDATE OR DELETE ON "admin_case_actions"
FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();--> statement-breakpoint
CREATE FUNCTION enforce_admin_package_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  expected_action text;
  expected_payload_hash text;
BEGIN
  IF NEW.legacy_admin_grant THEN
    RAISE EXCEPTION 'legacy admin package marker is migration-only' USING ERRCODE = '23514';
  END IF;
  IF NEW.kind = 'paid' THEN
    RETURN NEW;
  END IF;
  expected_action := CASE WHEN NEW.kind = 'admin' THEN 'package.grant' ELSE 'package.intro_grant' END;
  expected_payload_hash := 'sha256:' || encode(digest(convert_to(
    '{"idempotencyKey":' || to_json(NEW.grant_idempotency_key)::text ||
    ',"units":' || NEW.granted_messages::text ||
    ',"userId":' || to_json(NEW.user_id::text)::text || '}',
    'UTF8'
  ), 'sha256'), 'hex');
  IF NOT EXISTS (
    SELECT 1
    FROM "admin_approvals" a
    WHERE a."id" = NEW."admin_approval_id"
      AND a."requester_session_id_hash" = NEW."admin_requester_session_id_hash"
      AND a."action" = expected_action
      AND a."object_type" = 'user'
      AND a."object_id" = NEW."user_id"
      AND a."required_role" = 'entitlement_admin'
      AND a."payload_hash" = expected_payload_hash
      AND a."consumed_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'admin package approval provenance is invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "message_packages_legacy_marker_migration_only"
BEFORE INSERT ON "message_packages"
FOR EACH ROW EXECUTE FUNCTION enforce_admin_package_provenance();--> statement-breakpoint
CREATE FUNCTION enforce_admin_ledger_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  package_row "message_packages"%ROWTYPE;
  original_grant "message_ledger_entries"%ROWTYPE;
BEGIN
  IF NEW.legacy_admin_fact THEN
    RAISE EXCEPTION 'legacy admin ledger marker is migration-only' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO package_row
  FROM "message_packages"
  WHERE "id" = NEW."package_id";
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF package_row."kind" = 'paid' THEN
    IF NEW."admin_approval_id" IS NOT NULL OR NEW."admin_requester_session_id_hash" IS NOT NULL THEN
      RAISE EXCEPTION 'paid ledger facts cannot carry admin approval provenance' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF package_row."legacy_admin_grant" THEN
    IF NEW."entry_kind" IN ('grant', 'revocation') THEN
      RAISE EXCEPTION 'legacy admin entitlements cannot receive new admin grant or revocation facts' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."entry_kind" = 'grant' AND (
    NEW."admin_approval_id" IS DISTINCT FROM package_row."admin_approval_id"
    OR NEW."admin_requester_session_id_hash" IS DISTINCT FROM package_row."admin_requester_session_id_hash"
  ) THEN
    RAISE EXCEPTION 'admin grant provenance must match package provenance' USING ERRCODE = '23514';
  END IF;
  IF NEW."entry_kind" = 'revocation' THEN
    IF NEW."admin_approval_id" IS NULL OR NEW."admin_requester_session_id_hash" IS NULL THEN
      RAISE EXCEPTION 'admin revocation provenance is required' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO original_grant
    FROM "message_ledger_entries"
    WHERE "id" = NEW."original_entry_id"
      AND "package_id" = NEW."package_id"
      AND "entry_kind" = 'grant';
    IF NOT FOUND
      OR original_grant."admin_approval_id" IS DISTINCT FROM package_row."admin_approval_id"
      OR original_grant."admin_requester_session_id_hash" IS DISTINCT FROM package_row."admin_requester_session_id_hash"
    THEN
      RAISE EXCEPTION 'admin revocation original grant provenance is invalid' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM "admin_approvals" a
      WHERE a."id" = NEW."admin_approval_id"
        AND a."requester_session_id_hash" = NEW."admin_requester_session_id_hash"
        AND a."action" = 'package.revoke'
        AND a."object_type" = 'user'
        AND a."object_id" = package_row."user_id"
        AND a."required_role" = 'entitlement_admin'
        AND a."payload_hash" = 'sha256:' || encode(digest(convert_to(
          '{"idempotencyKey":' || to_json(NEW."idempotency_key")::text ||
          ',"packageId":' || to_json(NEW."package_id"::text)::text ||
          ',"userId":' || to_json(package_row."user_id"::text)::text || '}',
          'UTF8'
        ), 'sha256'), 'hex')
        AND a."consumed_at" IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'admin revocation approval provenance is invalid' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "message_ledger_admin_provenance"
BEFORE INSERT ON "message_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION enforce_admin_ledger_provenance();
