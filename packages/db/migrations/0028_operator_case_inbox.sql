ALTER TABLE "outbox_operator_alerts" ADD COLUMN "case_type" text DEFAULT 'delivery_failure' NOT NULL;
--> statement-breakpoint
ALTER TABLE "outbox_operator_alerts" ADD COLUMN "status" text DEFAULT 'open' NOT NULL;
--> statement-breakpoint
ALTER TABLE "outbox_operator_alerts" ADD COLUMN "rating" integer;
--> statement-breakpoint
ALTER TABLE "outbox_operator_alerts" ADD COLUMN "content_hash" text;
--> statement-breakpoint
ALTER TABLE "outbox_operator_alerts" ADD COLUMN "policy_version" text;
--> statement-breakpoint
ALTER TABLE "outbox_operator_alerts" ADD COLUMN "acknowledged_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "outbox_operator_alerts" ADD COLUMN "resolved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "outbox_operator_alerts" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
UPDATE "outbox_operator_alerts" AS alerts
SET "case_type" = 'safety', "updated_at" = alerts."created_at"
FROM "integration_outbox" AS source
WHERE source."id" = alerts."outbox_id"
  AND source."topic" = 'safety.operator_escalation'
  AND alerts."reason_code" = 'safety_operator_escalation';
--> statement-breakpoint
ALTER TABLE "outbox_operator_alerts" ADD CONSTRAINT "outbox_operator_alerts_case_type_check" CHECK ("case_type" IN ('safety','negative_feedback','delivery_failure'));
--> statement-breakpoint
ALTER TABLE "outbox_operator_alerts" ADD CONSTRAINT "outbox_operator_alerts_status_check" CHECK ("status" IN ('open','acknowledged','resolved'));
--> statement-breakpoint
ALTER TABLE "outbox_operator_alerts" ADD CONSTRAINT "outbox_operator_alerts_reason_check" CHECK ("reason_code" ~ '^[a-z0-9][a-z0-9._:-]{0,127}$');
--> statement-breakpoint
ALTER TABLE "outbox_operator_alerts" ADD CONSTRAINT "outbox_operator_alerts_payload_check" CHECK (("case_type" = 'safety' AND "reason_code" = 'safety_operator_escalation' AND "rating" IS NULL AND "content_hash" IS NULL AND "policy_version" IS NULL) OR ("case_type" = 'negative_feedback' AND "reason_code" = 'negative_feedback_policy' AND "rating" BETWEEN 1 AND 5 AND "content_hash" ~ '^[0-9a-f]{64}$' AND "policy_version" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$') OR ("case_type" = 'delivery_failure' AND "rating" IS NULL AND "content_hash" IS NULL AND "policy_version" IS NULL));
--> statement-breakpoint
ALTER TABLE "outbox_operator_alerts" ADD CONSTRAINT "outbox_operator_alerts_lifecycle_check" CHECK ((("status" = 'open' AND "acknowledged_at" IS NULL AND "resolved_at" IS NULL) OR ("status" = 'acknowledged' AND "acknowledged_at" IS NOT NULL AND "resolved_at" IS NULL) OR ("status" = 'resolved' AND "resolved_at" IS NOT NULL)) AND "updated_at" >= "created_at" AND ("acknowledged_at" IS NULL OR "acknowledged_at" >= "created_at") AND ("resolved_at" IS NULL OR "resolved_at" >= "created_at"));
--> statement-breakpoint
CREATE INDEX "outbox_operator_alerts_unresolved_cursor_idx" ON "outbox_operator_alerts" ("case_type","status","created_at" DESC,"id" DESC) WHERE "status" IN ('open','acknowledged');
