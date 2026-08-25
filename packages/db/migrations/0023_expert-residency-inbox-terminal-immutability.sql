CREATE FUNCTION enforce_expert_provider_event_terminal_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
    OR OLD.processing_status IN ('processed', 'failed')
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'terminal expert provider event outcome is immutable',
      CONSTRAINT = 'expert_provider_event_terminal_immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "expert_provider_event_terminal_immutable"
BEFORE UPDATE OR DELETE ON "expert_residency_provider_event_inbox"
FOR EACH ROW EXECUTE FUNCTION enforce_expert_provider_event_terminal_immutability();
