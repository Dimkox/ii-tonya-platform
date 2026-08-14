CREATE TABLE "expert_telegram_residency_callbacks" (
	"token_hash" char(64) PRIMARY KEY NOT NULL,
	"expert_id" uuid NOT NULL,
	"telegram_user_id" varchar(20) NOT NULL,
	"tariff_version_id" uuid NOT NULL,
	"action" text DEFAULT 'start_residency_checkout' NOT NULL,
	"idempotency_key" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expert_telegram_residency_callbacks_idempotency_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "expert_telegram_residency_callbacks_action_check" CHECK ("action" = 'start_residency_checkout'),
	CONSTRAINT "expert_telegram_residency_callbacks_token_hash_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "expert_telegram_residency_callbacks_telegram_id_check" CHECK ("telegram_user_id" ~ '^[1-9][0-9]{0,19}$'),
	CONSTRAINT "expert_telegram_residency_callbacks_expiry_check" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
ALTER TABLE "expert_telegram_residency_callbacks" ADD CONSTRAINT "expert_telegram_residency_callbacks_expert_id_experts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "experts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expert_telegram_residency_callbacks" ADD CONSTRAINT "expert_telegram_residency_callbacks_tariff_version_id_expert_residency_tariff_versions_id_fk" FOREIGN KEY ("tariff_version_id") REFERENCES "expert_residency_tariff_versions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "expert_telegram_residency_callbacks_expiry_idx" ON "expert_telegram_residency_callbacks" USING btree ("expires_at") WHERE "consumed_at" IS NULL;
