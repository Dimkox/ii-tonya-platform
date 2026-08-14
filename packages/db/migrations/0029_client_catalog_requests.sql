CREATE TABLE "client_catalog_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "request_digest" char(64) NOT NULL,
  "service_code" text,
  "language" text,
  "state" text DEFAULT 'pending' NOT NULL,
  "expires_at" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "client_catalog_requests_user_digest_unique" UNIQUE("user_id","request_digest"),
  CONSTRAINT "client_catalog_requests_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE,
  CONSTRAINT "client_catalog_requests_digest_check" CHECK ("request_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "client_catalog_requests_state_check" CHECK ("state" IN ('pending','ready')),
  CONSTRAINT "client_catalog_requests_filters_check" CHECK (("service_code" IS NULL OR (char_length("service_code") BETWEEN 1 AND 64 AND "service_code" !~ '[[:cntrl:]]')) AND ("language" IS NULL OR (char_length("language") BETWEEN 1 AND 32 AND "language" !~ '[[:cntrl:]]'))),
  CONSTRAINT "client_catalog_requests_time_check" CHECK ("expires_at" >= "created_at" AND "updated_at" >= "created_at")
);
--> statement-breakpoint
CREATE INDEX "client_catalog_requests_expiry_idx" ON "client_catalog_requests" ("expires_at","id") WHERE "state" IN ('pending','ready');
--> statement-breakpoint
CREATE TABLE "client_catalog_snapshots" (
  "request_id" uuid PRIMARY KEY NOT NULL,
  "cards" jsonb NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "client_catalog_snapshots_request_fk" FOREIGN KEY ("request_id") REFERENCES "public"."client_catalog_requests"("id") ON DELETE CASCADE,
  CONSTRAINT "client_catalog_snapshots_cards_check" CHECK (jsonb_typeof("cards") = 'array' AND jsonb_array_length("cards") <= 20),
  CONSTRAINT "client_catalog_snapshots_expiry_check" CHECK ("expires_at" >= "created_at")
);
--> statement-breakpoint
CREATE TABLE "client_catalog_tombstones" (
  "request_id" uuid PRIMARY KEY NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "state" text DEFAULT 'expired' NOT NULL,
  CONSTRAINT "client_catalog_tombstones_state_check" CHECK ("state" = 'expired')
);
--> statement-breakpoint
CREATE TABLE "client_catalog_erasure_index" (
  "request_id" uuid PRIMARY KEY NOT NULL,
  "subject_key" char(64) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "client_catalog_erasure_index_subject_check" CHECK ("subject_key" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX "client_catalog_erasure_index_subject_idx" ON "client_catalog_erasure_index" ("subject_key","request_id");
