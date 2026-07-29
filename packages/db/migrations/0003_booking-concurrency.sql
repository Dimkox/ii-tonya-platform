ALTER TABLE "slots" ADD COLUMN "observed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "slot_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "expert_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_slot_id_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_expert_id_experts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reservations_client_active_overlap" ON "reservations" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "reservations_expert_active_overlap" ON "reservations" USING btree ("expert_id","status");