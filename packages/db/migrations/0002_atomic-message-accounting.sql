ALTER TABLE "message_ledger_entries" DROP CONSTRAINT "message_ledger_delta_matches_kind";--> statement-breakpoint
ALTER TABLE "message_ledger_entries" ALTER COLUMN "package_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ALTER COLUMN "correlation_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "integration_inbox" ADD COLUMN "message_event_id" uuid;--> statement-breakpoint
ALTER TABLE "integration_inbox" ADD CONSTRAINT "integration_inbox_message_event_id_message_events_id_fk" FOREIGN KEY ("message_event_id") REFERENCES "public"."message_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_ledger_entries" ADD CONSTRAINT "message_ledger_delta_matches_kind" CHECK (
      ("message_ledger_entries"."entry_kind" = 'grant' and "message_ledger_entries"."package_id" is not null and "message_ledger_entries"."delta" > 0 and "message_ledger_entries"."message_event_id" is null and "message_ledger_entries"."original_entry_id" is null)
      or ("message_ledger_entries"."entry_kind" = 'debit' and "message_ledger_entries"."package_id" is not null and "message_ledger_entries"."delta" = -1 and "message_ledger_entries"."message_event_id" is not null and "message_ledger_entries"."original_entry_id" is null)
      or ("message_ledger_entries"."entry_kind" = 'free' and "message_ledger_entries"."delta" = 0 and "message_ledger_entries"."message_event_id" is not null and "message_ledger_entries"."original_entry_id" is null)
      or ("message_ledger_entries"."entry_kind" = 'compensation' and "message_ledger_entries"."package_id" is not null and "message_ledger_entries"."delta" = 1 and "message_ledger_entries"."message_event_id" is null and "message_ledger_entries"."original_entry_id" is not null)
      or ("message_ledger_entries"."entry_kind" = 'revocation' and "message_ledger_entries"."package_id" is not null and "message_ledger_entries"."delta" <= 0 and "message_ledger_entries"."message_event_id" is null and "message_ledger_entries"."original_entry_id" is not null)
    );