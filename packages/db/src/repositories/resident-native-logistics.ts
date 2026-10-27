import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { richPublicHttps } from "@ii-tonya/contracts";
import {
  lockBookingNotificationReservation,
  resolveBookingNotificationRecipient,
  validateBookingNotificationConsent,
} from "./booking-notification-authority.js";

export type NativeLogisticsOutcome =
  | {
      kind: "applied";
      receipt: { botKey: string; chatId: string; messageId: number };
    }
  | { kind: "not_applied"; retryAfterSeconds?: number }
  | { kind: "unknown" | "failed"; pauseBot?: boolean; reasonCode: string };
export interface NativeLogisticsTransport {
  send(input: {
    botKey: string;
    chatId: string;
    text: string;
    deadline: string;
  }): Promise<NativeLogisticsOutcome>;
}
/** Dedicated appointment-logistics delivery. Generic notification views remain URL/PII-free. */
export class PostgresResidentNativeLogistics {
  private accepting = true;
  stopAccepting() {
    this.accepting = false;
  }
  private readonly receipts = new Map<
    string,
    { botKey: string; chatId: string; messageId: number }
  >();
  get pendingCompletion(): boolean {
    return this.receipts.size > 0;
  }
  async resolveReceipt(
    attemptId: string,
    receipt: { botKey: string; chatId: string; messageId: number },
  ): Promise<boolean> {
    if (
      receipt.botKey !== this.botKey ||
      !Number.isSafeInteger(receipt.messageId) ||
      receipt.messageId <= 0
    )
      return false;
    const result = await this.db.execute(
      sql`update resident_native_logistics n set state='delivered',receipt=${JSON.stringify(receipt)}::jsonb,updated_at=clock_timestamp() from booking_notification_contexts c where n.reservation_id=c.reservation_id and n.attempt_id=${attemptId}::uuid and n.state in('sending','unknown') and c.bot_key=${this.botKey} and c.client_external_chat_id=${receipt.chatId} and c.client_original_identity_id is not null returning n.id`,
    );
    if (result.rows.length) {
      this.receipts.delete(attemptId);
      return true;
    }
    const finished =
      (
        await this.db.execute(
          sql`select id from resident_native_logistics where attempt_id=${attemptId}::uuid and state='delivered' and receipt=${JSON.stringify(receipt)}::jsonb`,
        )
      ).rows.length > 0;
    if (
      finished ||
      !(
        await this.db.execute(
          sql`select id from resident_native_logistics where attempt_id=${attemptId}::uuid and state<>'suppressed'`,
        )
      ).rows.length
    )
      this.receipts.delete(attemptId);
    return finished;
  }
  constructor(
    private readonly db: DrizzleDb,
    private readonly botKey: string,
    private readonly transport: NativeLogisticsTransport,
  ) {}
  async recoverExpired(): Promise<void> {
    await this.db.execute(
      sql`update resident_native_logistics n set state='unknown',updated_at=clock_timestamp() from booking_notification_contexts c where c.reservation_id=n.reservation_id and c.bot_key=${this.botKey} and n.state='sending' and n.lease_until<=clock_timestamp()`,
    );
  }
  async runOnce(): Promise<number> {
    for (const [attempt, receipt] of this.receipts)
      await this.resolveReceipt(attempt, receipt);
    await this.recoverExpired();
    const due = (
      await this.db.execute<{ id: string }>(
        sql`select n.id from resident_native_logistics n join booking_notification_contexts c on c.reservation_id=n.reservation_id join booking_notification_bot_controls b on b.bot_key=c.bot_key and b.admission_enabled and b.paused_at is null and b.not_before<=clock_timestamp() where n.state='pending' and n.attempt_count<3 and n.due_at<=clock_timestamp() and c.bot_key=${this.botKey} and (n.lease_until is null or n.lease_until<=clock_timestamp()) order by n.due_at,n.id limit 5`,
      )
    ).rows;
    let sent = 0;
    for (const row of due) {
      if (!this.accepting) break;
      if (await this.deliver(row.id)) sent++;
    }
    return sent;
  }
  async deliver(id: string): Promise<boolean> {
    if (!this.accepting) return false;
    const attempt = randomUUID();
    const claim = (
      await this.db.execute<{ reservationId: string }>(
        sql`with control as materialized(select bot_key from booking_notification_bot_controls where bot_key=${this.botKey} and admission_enabled and paused_at is null and not_before<=clock_timestamp() for update) update resident_native_logistics n set state='sending',attempt_id=${attempt}::uuid,attempt_count=attempt_count+1,lease_until=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp() where n.id=${id}::uuid and exists(select 1 from control) and exists(select 1 from booking_notification_contexts c where c.reservation_id=n.reservation_id and c.bot_key=${this.botKey}) and n.state='pending' and n.attempt_count<3 and n.due_at<=clock_timestamp() and (n.lease_until is null or n.lease_until<=clock_timestamp()) returning reservation_id as "reservationId"`,
      )
    ).rows[0];
    if (!claim) return false;
    try {
      const delivered = await this.db.transaction(async (tx) => {
        await lockBookingNotificationReservation(tx, claim.reservationId);
        await tx.execute(
          sql`select bot_key from booking_notification_bot_controls where bot_key=${this.botKey} for update`,
        );
        const row = (
          await tx.execute<{
            state: string;
            kind: string;
            userId: string;
            identityId: string | null;
            chatId: string | null;
            externalId: string | null;
            consent: unknown;
            active: boolean;
            expertSafe: boolean;
            due: boolean;
            beforeStart: boolean;
            status: string;
            snapshot: {
              format: string;
              logistics: {
                room: string | null;
                address: string;
                arrival: string;
                map: string | null;
              };
            };
            botAllowed: boolean;
          }>(sql`select n.state,n.kind,r.user_id as "userId",c.client_original_identity_id as "identityId",c.client_external_chat_id as "chatId",c.client_external_user_id as "externalId",c.client_consent_authority as consent,u.active,(eu.active and e.verified and exists(select 1 from expert_card_drafts d where d.user_id=e.user_id and expert_card_current_messaging_authority(d.user_id,d.messaging_policy_version)) and not exists(select 1 from expert_referral_abuse_holds h where h.expert_id=e.id and h.status='open')) as "expertSafe",n.due_at<=clock_timestamp() as due,s.starts_at>clock_timestamp() as "beforeStart",r.status,f.snapshot,coalesce(b.admission_enabled and b.paused_at is null and b.not_before<=clock_timestamp(),false) as "botAllowed"
     from resident_native_logistics n join resident_native_confirmations f on f.reservation_id=n.reservation_id join reservations r on r.id=n.reservation_id join slots s on s.id=r.slot_id join users u on u.id=r.user_id join experts e on e.id=r.expert_id join users eu on eu.id=e.user_id join booking_notification_contexts c on c.reservation_id=r.id and c.bot_key=${this.botKey} left join booking_notification_bot_controls b on b.bot_key=c.bot_key where n.id=${id}::uuid and n.attempt_id=${attempt}::uuid and n.state='sending' for update of n,r for share of c,u,eu,e,s`)
        ).rows[0];
        const suppress = async () => {
          await tx.execute(
            sql`update resident_native_logistics set state='suppressed',updated_at=clock_timestamp() where id=${id}::uuid and attempt_id=${attempt}::uuid and state='sending'`,
          );
          return false;
        };
        const deferUnsent = async () => {
          // The committed claim did not reach the transport. Temporary controls
          // must neither spend a wire attempt nor discard this appointment notice.
          await tx.execute(
            sql`update resident_native_logistics set state='pending',attempt_id=null,attempt_count=attempt_count-1,lease_until=null,updated_at=clock_timestamp() where id=${id}::uuid and attempt_id=${attempt}::uuid and state='sending'`,
          );
          return false;
        };
        if (
          !row ||
          !row.active ||
          !row.expertSafe ||
          !row.due ||
          !row.beforeStart ||
          row.status !== "booked" ||
          !row.identityId ||
          !row.chatId
        )
          return suppress();
        if (!row.botAllowed || !this.accepting) return deferUnsent();
        const recipient = await resolveBookingNotificationRecipient(
          tx,
          row.userId,
          this.botKey,
        );
        if (
          !recipient ||
          recipient.identityId !== row.identityId ||
          recipient.externalChatId !== row.chatId ||
          recipient.externalUserId !== row.externalId ||
          !(await validateBookingNotificationConsent(
            tx,
            row.consent,
            row.userId,
          ))
        )
          return suppress();
        const logistics = row.snapshot.logistics;
        let text: string;
        if (row.kind === "online") {
          if (!logistics.room || !richPublicHttps(logistics.room))
            return suppress();
          text = `Ссылка на вашу подтверждённую онлайн-встречу:\n${logistics.room}`;
        } else {
          if (
            !logistics.address.trim() ||
            !logistics.arrival.trim() ||
            (logistics.map && !richPublicHttps(logistics.map))
          )
            return suppress();
          text = `Адрес вашей подтверждённой встречи:\n${logistics.address}\nКак добраться: ${logistics.arrival}${logistics.map ? "\nКарта: " + logistics.map : ""}`;
        }
        if (text.length > 4096) return suppress();
        // These authority locks linearize cancellation/consent revocation against wire start.
        const clock = (
          await tx.execute<{ allowed: boolean; deadline: Date | string }>(
            sql`select s.starts_at>clock_timestamp() and n.due_at<=clock_timestamp() and n.lease_until>clock_timestamp() and r.status='booked' as allowed,least(n.lease_until,s.starts_at,clock_timestamp()+interval '15 seconds') as deadline from resident_native_logistics n join reservations r on r.id=n.reservation_id join slots s on s.id=r.slot_id where n.id=${id}::uuid`,
          )
        ).rows[0]!;
        if (!this.accepting) return deferUnsent();
        if (!clock.allowed) return suppress();
        let outcome: NativeLogisticsOutcome;
        try {
          outcome = await this.transport.send({
            botKey: this.botKey,
            chatId: row.chatId,
            text,
            deadline: new Date(clock.deadline).toISOString(),
          });
        } catch {
          outcome = { kind: "unknown", reasonCode: "delivery_uncertain" };
        }
        if (
          outcome.kind === "applied" &&
          outcome.receipt.botKey === this.botKey &&
          outcome.receipt.chatId === row.chatId &&
          Number.isSafeInteger(outcome.receipt.messageId) &&
          outcome.receipt.messageId > 0
        ) {
          this.receipts.set(attempt, outcome.receipt);
          await tx.execute(
            sql`update resident_native_logistics set state='delivered',receipt=${JSON.stringify(outcome.receipt)}::jsonb,updated_at=clock_timestamp() where id=${id}::uuid and attempt_id=${attempt}::uuid`,
          );
          return true;
        }
        const retry =
          outcome.kind === "not_applied"
            ? Math.min(86400, Math.max(1, outcome.retryAfterSeconds ?? 60))
            : 0;
        const pause =
          "pauseBot" in outcome &&
          outcome.pauseBot === true &&
          "reasonCode" in outcome &&
          ["bot_rejected", "bot_mismatch", "request_invalid"].includes(
            outcome.reasonCode,
          );
        await tx.execute(
          sql`update booking_notification_bot_controls set paused_at=case when ${pause} then coalesce(paused_at,clock_timestamp()) else paused_at end,pause_reason=case when ${pause} then coalesce(pause_reason,${"reasonCode" in outcome ? outcome.reasonCode : null}) else pause_reason end,not_before=greatest(not_before,clock_timestamp()+${retry}*interval '1 second'),updated_at=clock_timestamp() where bot_key=${this.botKey}`,
        );
        await tx.execute(
          sql`update resident_native_logistics set state=${outcome.kind === "not_applied" ? "pending" : outcome.kind === "failed" ? "suppressed" : "unknown"},lease_until=clock_timestamp()+${outcome.kind === "not_applied" ? Math.min(86400, Math.max(1, outcome.retryAfterSeconds ?? 60)) : 30}*interval '1 second',updated_at=clock_timestamp() where id=${id}::uuid and attempt_id=${attempt}::uuid`,
        );
        return false;
      });
      if (delivered) this.receipts.delete(attempt);
      return delivered;
    } catch {
      // The committed claim survives failed completion or lost acknowledgement. Never resend it.
      await this.db
        .execute(
          sql`update resident_native_logistics set state='unknown',updated_at=clock_timestamp() where id=${id}::uuid and attempt_id=${attempt}::uuid and state='sending'`,
        )
        .catch(() => {});
      return false;
    }
  }
}
