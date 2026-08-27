CREATE TABLE "client_sessions" (
  "token_digest" char(71) PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "scope" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "client_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE,
  CONSTRAINT "client_sessions_token_digest_check" CHECK ("token_digest" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "client_sessions_scope_check" CHECK ("scope" = 'client_catalog:read'),
  CONSTRAINT "client_sessions_lifecycle_check" CHECK ("expires_at" > "created_at" AND ("revoked_at" IS NULL OR "revoked_at" >= "created_at"))
);
--> statement-breakpoint
CREATE INDEX "client_sessions_expiry_idx" ON "client_sessions" ("expires_at");
--> statement-breakpoint
CREATE TABLE "client_identity_proof_receipts" (
  "replay_digest" text PRIMARY KEY NOT NULL,
  "session_token_digest" char(71),
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "client_identity_proof_receipts_session_digest_unique" UNIQUE("session_token_digest"),
  CONSTRAINT "client_identity_proof_receipts_session_token_digest_client_sessions_token_digest_fk" FOREIGN KEY ("session_token_digest") REFERENCES "public"."client_sessions"("token_digest") ON DELETE SET NULL,
  CONSTRAINT "client_identity_proof_receipts_replay_digest_check" CHECK ("replay_digest" ~ '^hmac-sha256:v[1-9][0-9]*:[0-9a-f]{64}$'),
  CONSTRAINT "client_identity_proof_receipts_session_digest_check" CHECK ("session_token_digest" IS NULL OR "session_token_digest" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "client_identity_proof_receipts_expiry_check" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
CREATE INDEX "client_identity_proof_receipts_expiry_idx" ON "client_identity_proof_receipts" ("expires_at");
