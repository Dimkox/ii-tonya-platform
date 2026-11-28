-- Historical message6_sent_at values record a claim, which may have no delivery receipt.
ALTER TABLE expert_promo_funnel_state
  ADD COLUMN message6_confirmed_at timestamptz,
  ADD COLUMN message6_message_id text,
  ADD CONSTRAINT expert_promo_message6_receipt CHECK (
    (message6_confirmed_at IS NULL AND message6_message_id IS NULL)
    OR (message6_confirmed_at IS NOT NULL AND message6_message_id IS NOT NULL
      AND message6_sent_at IS NOT NULL AND isfinite(message6_confirmed_at)
      AND message6_confirmed_at >= message6_sent_at
      AND message6_message_id ~ '^[1-9][0-9]{0,19}$')
  );
