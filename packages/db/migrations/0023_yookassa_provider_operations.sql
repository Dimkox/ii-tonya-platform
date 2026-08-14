CREATE TABLE "expert_residency_provider_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "command_id" uuid NOT NULL,
  "order_id" uuid NOT NULL,
  "payment_attempt_id" uuid NOT NULL,
  "operation_kind" text NOT NULL,
  "provider" text DEFAULT 'yookassa' NOT NULL,
  "environment_mode" text NOT NULL,
  "provider_object_id" text,
  "parent_payment_id" text,
  "amount_minor" bigint NOT NULL,
  "currency" text DEFAULT 'RUB' NOT NULL,
  "request_digest" text NOT NULL,
  "claim_digest" text NOT NULL,
  "idempotency_key" uuid DEFAULT gen_random_uuid() NOT NULL,
  "status" text DEFAULT 'claimed' NOT NULL,
  "reconciliation_claimed_at" timestamp with time zone,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT transaction_timestamp() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT transaction_timestamp() NOT NULL,
  CONSTRAINT "expert_provider_operations_provider" CHECK ("provider" = 'yookassa'),
  CONSTRAINT "expert_provider_operations_kind" CHECK ("operation_kind" in ('create_payment','create_refund')),
  CONSTRAINT "expert_provider_operations_mode" CHECK ("environment_mode" in ('test','live')),
  CONSTRAINT "expert_provider_operations_amount" CHECK ("amount_minor" > 0 and "amount_minor" <= 999999999999),
  CONSTRAINT "expert_provider_operations_currency" CHECK ("currency" = 'RUB'),
  CONSTRAINT "expert_provider_operations_request_digest" CHECK ("request_digest" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "expert_provider_operations_claim_digest" CHECK ("claim_digest" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "expert_provider_operations_provider_id" CHECK ("provider_object_id" is null or "provider_object_id" ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT "expert_provider_operations_parent" CHECK (("operation_kind" = 'create_payment' and "parent_payment_id" is null) or ("operation_kind" = 'create_refund' and "parent_payment_id" ~ '^[A-Za-z0-9_-]{1,64}$')),
  CONSTRAINT "expert_provider_operations_status" CHECK ("status" in ('claimed','pending','unknown_outcome','succeeded','canceled','failed')),
  CONSTRAINT "expert_provider_operations_resolution" CHECK (("status" in ('claimed','pending','unknown_outcome') and "resolved_at" is null) or ("status" in ('succeeded','canceled','failed') and "resolved_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "expert_residency_provider_operations" ADD CONSTRAINT "expert_provider_operations_order_fk" FOREIGN KEY ("order_id") REFERENCES "expert_residency_orders"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expert_residency_provider_operations" ADD CONSTRAINT "expert_provider_operations_attempt_order_fk" FOREIGN KEY ("payment_attempt_id","order_id") REFERENCES "expert_residency_payment_attempts"("id","order_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "expert_provider_operations_command_unique" ON "expert_residency_provider_operations" ("provider","command_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "expert_provider_operations_idempotency_unique" ON "expert_residency_provider_operations" ("idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "expert_provider_operations_object_unique" ON "expert_residency_provider_operations" ("provider","provider_object_id") WHERE "provider_object_id" is not null;
--> statement-breakpoint
CREATE INDEX "expert_provider_operations_reconcile_idx" ON "expert_residency_provider_operations" ("status","reconciliation_claimed_at","created_at","id");
--> statement-breakpoint
CREATE INDEX "expert_provider_operations_order_kind_idx" ON "expert_residency_provider_operations" ("order_id","operation_kind","created_at");
