-- SCRUM-526. Display-only price, format and location on expert services.
-- Existing rows stay valid: price, format and location are nullable.
ALTER TABLE expert_services
  ADD COLUMN price_minor integer,
  ADD COLUMN currency text NOT NULL DEFAULT 'RUB',
  ADD COLUMN format text,
  ADD COLUMN location text;
--> statement-breakpoint
ALTER TABLE expert_services
  ADD CONSTRAINT expert_services_price_minor_nonnegative
    CHECK (price_minor IS NULL OR price_minor >= 0),
  ADD CONSTRAINT expert_services_currency_rub
    CHECK (currency IN ('RUB')),
  ADD CONSTRAINT expert_services_format_known
    CHECK (format IS NULL OR format IN ('online', 'offline', 'hybrid'));
