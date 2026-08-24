ALTER TABLE "expert_residency_orders" ALTER COLUMN "provider_deadline" DROP NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_expert_order_snapshot_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'expert residency order deletion is forbidden',
      CONSTRAINT = 'expert_order_snapshot_immutable';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.expert_id IS DISTINCT FROM OLD.expert_id
    OR NEW.tariff_version_id IS DISTINCT FROM OLD.tariff_version_id
    OR NEW.tariff_name IS DISTINCT FROM OLD.tariff_name
    OR NEW.tariff_description IS DISTINCT FROM OLD.tariff_description
    OR NEW.price_minor IS DISTINCT FROM OLD.price_minor
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.duration_seconds IS DISTINCT FROM OLD.duration_seconds
    OR NEW.credit_minor IS DISTINCT FROM OLD.credit_minor
    OR NEW.cash_minor IS DISTINCT FROM OLD.cash_minor
    OR NEW.payment_deadline IS DISTINCT FROM OLD.payment_deadline
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.quoted_at IS DISTINCT FROM OLD.quoted_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'expert residency order snapshot is immutable',
      CONSTRAINT = 'expert_order_snapshot_immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
UPDATE "expert_residency_orders" SET "provider_deadline" = NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_expert_order_snapshot_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'expert residency order deletion is forbidden',
      CONSTRAINT = 'expert_order_snapshot_immutable';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.expert_id IS DISTINCT FROM OLD.expert_id
    OR NEW.tariff_version_id IS DISTINCT FROM OLD.tariff_version_id
    OR NEW.tariff_name IS DISTINCT FROM OLD.tariff_name
    OR NEW.tariff_description IS DISTINCT FROM OLD.tariff_description
    OR NEW.price_minor IS DISTINCT FROM OLD.price_minor
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.duration_seconds IS DISTINCT FROM OLD.duration_seconds
    OR NEW.credit_minor IS DISTINCT FROM OLD.credit_minor
    OR NEW.cash_minor IS DISTINCT FROM OLD.cash_minor
    OR NEW.payment_deadline IS DISTINCT FROM OLD.payment_deadline
    OR NEW.provider_deadline IS DISTINCT FROM OLD.provider_deadline
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.quoted_at IS DISTINCT FROM OLD.quoted_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'expert residency order snapshot is immutable',
      CONSTRAINT = 'expert_order_snapshot_immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_expert_order_provider_deadline()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.provider_deadline IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'new expert residency orders require provider deadline',
      CONSTRAINT = 'expert_order_provider_deadline_required';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "expert_order_provider_deadline_required" ON "expert_residency_orders";--> statement-breakpoint
CREATE TRIGGER "expert_order_provider_deadline_required"
BEFORE INSERT ON "expert_residency_orders"
FOR EACH ROW EXECUTE FUNCTION enforce_expert_order_provider_deadline();
