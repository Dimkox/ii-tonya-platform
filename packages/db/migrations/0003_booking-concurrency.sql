ALTER TABLE "slots" ADD COLUMN "observed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "slot_id" uuid;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "expert_id" uuid;--> statement-breakpoint
UPDATE "reservations" AS r
SET "expert_id" = es."expert_id"
FROM "expert_services" AS es
WHERE es."id" = r."expert_service_id"
  AND r."expert_id" IS NULL;--> statement-breakpoint
WITH "unambiguous_slots" AS (
  SELECT "expert_service_id", min("id"::text)::uuid AS "slot_id"
  FROM "slots"
  GROUP BY "expert_service_id"
  HAVING count(*) = 1
)
UPDATE "reservations" AS r
SET "slot_id" = candidate."slot_id"
FROM "unambiguous_slots" AS candidate
WHERE candidate."expert_service_id" = r."expert_service_id"
  AND r."slot_id" IS NULL;--> statement-breakpoint
DO $booking_migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "reservations"
    WHERE "slot_id" IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'booking_slot_backfill_ambiguous',
      DETAIL = 'Legacy reservations could not be mapped to exactly one slot.',
      HINT = 'Populate reservations.slot_id with the authoritative historical slot before retrying migration 0003.';
  END IF;
END
$booking_migration$;--> statement-breakpoint
ALTER TABLE "reservations" ALTER COLUMN "slot_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ALTER COLUMN "expert_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_slot_id_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_expert_id_experts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reservations_client_active_overlap" ON "reservations" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "reservations_expert_active_overlap" ON "reservations" USING btree ("expert_id","status");
