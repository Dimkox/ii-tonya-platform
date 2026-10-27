CREATE TABLE "client_session_booking_grants" (
  "session_token_digest" char(71) PRIMARY KEY NOT NULL,
  CONSTRAINT "client_session_booking_grants_session_fk" FOREIGN KEY ("session_token_digest")
    REFERENCES "public"."client_sessions"("token_digest") ON DELETE CASCADE
);
