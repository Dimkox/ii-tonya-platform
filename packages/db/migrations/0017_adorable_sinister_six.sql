CREATE TABLE "webhook_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"external_event_id" text NOT NULL,
	"status" text NOT NULL,
	"claim_id" uuid NOT NULL,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_inbox_provider_event_unique" UNIQUE("provider","external_event_id"),
	CONSTRAINT "webhook_inbox_status_allowed" CHECK ("webhook_inbox"."status" in ('processing', 'complete', 'failed'))
);
--> statement-breakpoint
CREATE INDEX "webhook_inbox_lease" ON "webhook_inbox" USING btree ("status","lease_until");