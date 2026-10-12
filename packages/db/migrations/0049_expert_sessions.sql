CREATE TABLE expert_sessions (
 token_digest text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id),
 expert_id uuid NOT NULL REFERENCES experts(id),
 channel_identity_id uuid NOT NULL REFERENCES channel_identities(id) ON DELETE CASCADE,
 external_id text NOT NULL,
 bot_key text,
 external_chat_id text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 CONSTRAINT expert_sessions_digest CHECK (token_digest ~ '^sha256:[0-9a-f]{64}$'),
 CONSTRAINT expert_sessions_identity CHECK (external_id ~ '^[1-9][0-9]{0,15}$' AND (bot_key IS NULL OR bot_key ~ '^[A-Za-z0-9_-]{1,64}$') AND ((external_chat_id IS NOT NULL AND external_chat_id=external_id) OR (bot_key IS NULL AND external_chat_id IS NULL))),
 CONSTRAINT expert_sessions_lifetime CHECK (isfinite(created_at) AND isfinite(expires_at) AND expires_at>created_at AND expires_at<=created_at+interval '1 hour' AND (revoked_at IS NULL OR (isfinite(revoked_at) AND revoked_at>=created_at)))
);
--> statement-breakpoint
CREATE INDEX expert_sessions_expiry_idx ON expert_sessions(expires_at,token_digest);
--> statement-breakpoint
CREATE TABLE expert_identity_proof_receipts (
 replay_digest text PRIMARY KEY,
 session_token_digest text UNIQUE REFERENCES expert_sessions(token_digest) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 CONSTRAINT expert_proof_digest CHECK (replay_digest ~ '^expert-login:v1:[0-9a-f]{64}$'),
 CONSTRAINT expert_proof_lifetime CHECK (isfinite(created_at) AND isfinite(expires_at) AND expires_at>created_at AND expires_at<=created_at+interval '330 seconds')
);
--> statement-breakpoint
CREATE INDEX expert_identity_proof_expiry_idx ON expert_identity_proof_receipts(expires_at,replay_digest);
