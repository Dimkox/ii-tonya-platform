CREATE TABLE client_paid_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  package_code text NOT NULL,
  policy_version text NOT NULL,
  currency text NOT NULL,
  price_minor bigint NOT NULL,
  units integer NOT NULL,
  coupon_grant_minor bigint NOT NULL,
  mode text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT client_paid_orders_user_key_unique UNIQUE (user_id, idempotency_key),
  CONSTRAINT client_paid_orders_terms CHECK (
    policy_version = 'client_paid_v1' AND currency = 'RUB' AND coupon_grant_minor = price_minor * 2 AND (
      (package_code = 'start' AND price_minor = 499900 AND units = 500) OR
      (package_code = 'base' AND price_minor = 599900 AND units = 1000) OR
      (package_code = 'deep' AND price_minor = 799900 AND units = 1500) OR
      (package_code = 'maximum' AND price_minor = 1099000 AND units = 2000))),
  CONSTRAINT client_paid_orders_mode CHECK (mode IN ('live', 'test')),
  CONSTRAINT client_paid_orders_key CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'),
  CONSTRAINT client_paid_orders_created_finite CHECK (isfinite(created_at))
);
--> statement-breakpoint
CREATE TABLE client_paid_payment_bindings (
  order_id uuid PRIMARY KEY REFERENCES client_paid_orders(id),
  provider_payment_id text NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT client_paid_bindings_payment_unique UNIQUE (provider_payment_id),
  CONSTRAINT client_paid_bindings_order_payment_unique UNIQUE (order_id, provider_payment_id),
  CONSTRAINT client_paid_bindings_payment_id CHECK (provider_payment_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')
);
--> statement-breakpoint
CREATE TABLE client_coupon_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES client_paid_orders(id),
  user_id uuid NOT NULL REFERENCES users(id),
  amount_minor bigint NOT NULL,
  captured_at timestamptz(3) NOT NULL,
  expires_at timestamptz(3) NOT NULL,
  CONSTRAINT client_coupon_grants_order_unique UNIQUE (order_id),
  CONSTRAINT client_coupon_grants_order_id_unique UNIQUE (order_id, id),
  CONSTRAINT client_coupon_grants_positive CHECK (amount_minor > 0),
  CONSTRAINT client_coupon_grants_expiry CHECK (isfinite(captured_at) AND isfinite(expires_at) AND expires_at = captured_at + interval '1080 hours')
);
--> statement-breakpoint
CREATE TABLE client_paid_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  provider_payment_id text NOT NULL,
  package_id uuid NOT NULL REFERENCES message_packages(id),
  ledger_entry_id uuid NOT NULL REFERENCES message_ledger_entries(id),
  coupon_grant_id uuid NOT NULL,
  captured_at timestamptz(3) NOT NULL,
  CONSTRAINT client_paid_settlements_order_unique UNIQUE (order_id),
  CONSTRAINT client_paid_settlements_package_unique UNIQUE (package_id),
  CONSTRAINT client_paid_settlements_ledger_unique UNIQUE (ledger_entry_id),
  CONSTRAINT client_paid_settlements_coupon_unique UNIQUE (coupon_grant_id),
  CONSTRAINT client_paid_settlements_binding_fk FOREIGN KEY (order_id, provider_payment_id) REFERENCES client_paid_payment_bindings(order_id, provider_payment_id),
  CONSTRAINT client_paid_settlements_coupon_fk FOREIGN KEY (order_id, coupon_grant_id) REFERENCES client_coupon_grants(order_id, id),
  CONSTRAINT client_paid_settlements_captured_finite CHECK (isfinite(captured_at))
);
--> statement-breakpoint
CREATE FUNCTION enforce_client_coupon_purchase() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM client_paid_orders o WHERE o.id = NEW.order_id
    AND o.mode = 'live' AND o.user_id = NEW.user_id AND o.coupon_grant_minor = NEW.amount_minor
    AND NEW.captured_at >= o.created_at) THEN
    RAISE EXCEPTION 'client coupon purchase mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER client_coupon_grants_purchase BEFORE INSERT ON client_coupon_grants
FOR EACH ROW EXECUTE FUNCTION enforce_client_coupon_purchase();
--> statement-breakpoint
CREATE FUNCTION enforce_client_paid_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM client_paid_orders o
    JOIN message_packages p ON p.id = NEW.package_id
    JOIN message_ledger_entries l ON l.id = NEW.ledger_entry_id AND l.package_id = p.id
    JOIN client_coupon_grants c ON c.id = NEW.coupon_grant_id AND c.order_id = o.id
    WHERE o.id = NEW.order_id AND o.mode = 'live' AND NEW.captured_at >= o.created_at
      AND p.user_id = o.user_id AND p.kind = 'paid' AND p.granted_messages = o.units
      AND p.granted_at = NEW.captured_at AND p.expires_at = NEW.captured_at + interval '1440 hours'
      AND p.grant_idempotency_key = 'client-paid:' || o.id::text
      AND l.entry_kind = 'grant' AND l.delta = o.units AND l.idempotency_key = p.grant_idempotency_key
      AND c.captured_at = NEW.captured_at
  ) THEN
    RAISE EXCEPTION 'client paid settlement mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER client_paid_settlements_integrity BEFORE INSERT ON client_paid_settlements
FOR EACH ROW EXECUTE FUNCTION enforce_client_paid_settlement();
--> statement-breakpoint
CREATE TRIGGER client_paid_orders_immutable BEFORE UPDATE OR DELETE ON client_paid_orders
FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TRIGGER client_paid_bindings_immutable BEFORE UPDATE OR DELETE ON client_paid_payment_bindings
FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TRIGGER client_coupon_grants_immutable BEFORE UPDATE OR DELETE ON client_coupon_grants
FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TRIGGER client_paid_settlements_immutable BEFORE UPDATE OR DELETE ON client_paid_settlements
FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
