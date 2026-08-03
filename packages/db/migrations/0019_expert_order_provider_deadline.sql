ALTER TABLE "expert_residency_orders"
  ADD COLUMN "provider_deadline" timestamp with time zone;
--> statement-breakpoint
UPDATE "expert_residency_orders"
SET "provider_deadline" = "payment_deadline"
WHERE "provider_deadline" IS NULL;
--> statement-breakpoint
ALTER TABLE "expert_residency_orders"
  ALTER COLUMN "provider_deadline" SET NOT NULL;
--> statement-breakpoint
CREATE FUNCTION expert_residency_default_provider_deadline() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.provider_deadline IS NULL THEN
    NEW.provider_deadline := NEW.payment_deadline;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "expert_orders_provider_deadline_default"
  BEFORE INSERT ON "expert_residency_orders"
  FOR EACH ROW EXECUTE FUNCTION expert_residency_default_provider_deadline();
