update notifications
set
  callback_token_hash = null,
  callback_claims = null,
  callback_expires_at = least(
    coalesce(callback_expires_at, now()),
    now()
  ),
  callback_action = null,
  callback_version = null,
  callback_consumed_at = coalesce(callback_consumed_at, now()),
  updated_at = now()
where callback_consumed_at is null
  and (
    callback_token_hash is not null
    or callback_claims is not null
  );
--> statement-breakpoint
update notifications n
set
  callback_expert_id = r.expert_id,
  updated_at = now()
from reservations r
where n.reservation_id = r.id
  and n.callback_expert_id is not null
  and n.callback_expert_id is distinct from r.expert_id;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_callback_expert_id_experts_id_fk" FOREIGN KEY ("callback_expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;
