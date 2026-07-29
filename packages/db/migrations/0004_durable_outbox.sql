CREATE TABLE "outbox_operator_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outbox_id" uuid NOT NULL,
	"reason_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_operator_alerts_outbox_reason_unique" UNIQUE("outbox_id","reason_code")
);
--> statement-breakpoint
ALTER TABLE "delivery_attempts" ADD COLUMN "attempt_id" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_attempts" ADD COLUMN "reconciliation_key" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_outbox" ADD COLUMN "topic" text DEFAULT 'legacy.unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_outbox" ADD COLUMN "payload" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_outbox" ADD COLUMN "correlation_id" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_outbox" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integration_outbox" ADD COLUMN "next_reconciliation_at" timestamp with time zone;--> statement-breakpoint
UPDATE "integration_outbox"
SET
	"topic" = split_part("idempotency_key", ':', 1) || '.legacy',
	"correlation_id" = "reconciliation_key"
WHERE "topic" = 'legacy.unknown' AND "correlation_id" = 'legacy';--> statement-breakpoint
UPDATE "delivery_attempts" AS attempts
SET
	"attempt_id" = 'legacy:' || attempts."id"::text,
	"reconciliation_key" = outbox."reconciliation_key"
FROM "integration_outbox" AS outbox
WHERE attempts."outbox_id" = outbox."id";--> statement-breakpoint
ALTER TABLE "outbox_operator_alerts" ADD CONSTRAINT "outbox_operator_alerts_outbox_id_integration_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."integration_outbox"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dead_letters" ADD CONSTRAINT "dead_letters_outbox_unique" UNIQUE("outbox_id");
