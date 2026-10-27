import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import {
  bookingNotificationEventSchema,
  BOOKING_NOTIFICATION_TOPICS,
  type BookingNotificationTopic,
  type BookingCalendarCancellation,
  bookingNotificationViewSchema,
  serializeBookingNotificationWire,
  type BookingNotificationView,
  type BookingNotificationRenderResult,
} from "@ii-tonya/contracts";
import type { BookingApprovalCrypto } from "./booking-notification-callback-repository.js";
import type { DrizzleDb } from "../client.js";
import {
  BookingNotificationLockUnavailable,
  lockBookingNotificationReservation,
  lockBookingNotificationSubjects,
  resolveBookingNotificationRecipient,
  validateBookingNotificationConsent,
  type BookingNotificationExecutor,
} from "./booking-notification-authority.js";

type Tx = BookingNotificationExecutor;
type Role = "client" | "expert";
interface Context extends Record<string, unknown> {
  reservation_id: string;
  bot_key: string;
  client_user_id: string;
  expert_user_id: string;
  client_identity_id: string | null;
  client_original_identity_id: string | null;
  client_external_user_id: string | null;
  client_external_chat_id: string | null;
  expert_identity_id: string | null;
  expert_original_identity_id: string | null;
  expert_external_user_id: string | null;
  expert_external_chat_id: string | null;
  client_consent_authority: unknown;
}
interface Delivery extends Record<string, unknown> {
  id: string;
  source_outbox_id: string;
  reservation_id: string;
  recipient_role: Role;
  recipient_user_id: string;
  original_identity_id: string | null;
  bot_key: string;
  external_user_id: string | null;
  external_chat_id: string | null;
  kind: BookingNotificationTopic;
  source_version: number | null;
  provider_operation_id: string | null;
  state: string;
  lease_token: string | null;
  attempt_count: number;
}
export interface BookingNotificationClaim {
  id: string;
  reservationId: string;
  leaseToken: string;
  workerId: string;
  topic?: BookingNotificationTopic;
}
export interface BookingNotificationPreparation {
  render(view: BookingNotificationView): BookingNotificationRenderResult;
  open: BookingApprovalCrypto["open"];
  authenticateToken(token: string): string | null;
}
export type PreparedBookingSend = Readonly<{
  attemptId: string;
  deliveryId: string;
  botKey: string;
  chatId: string;
  deadline: string;
  wireVersion: 1;
  body: string;
  bodySha256: string;
}>;
export interface BookingNotificationGrant {
  attemptId: string;
  deliveryId: string;
  topic: BookingNotificationTopic;
  botKey: string;
  chatId: string;
  startsAt: string;
  status: string;
  calendar: BookingCalendarCancellation | "verified_booked";
  deadline: string;
}
export interface BookingNotificationReceipt {
  botKey: string;
  chatId: string;
  messageId: number;
}
export type BookingNotificationReasonCode =
  | "delivery_uncertain"
  | "request_invalid"
  | "request_expired"
  | "bot_mismatch"
  | "bot_rejected"
  | "recipient_rejected";
const outcomeReasons = new Set<string>([
  "delivery_uncertain",
  "request_invalid",
  "request_expired",
  "bot_mismatch",
  "bot_rejected",
  "recipient_rejected",
]);
export type BookingNotificationOutcome = (
  | { kind: "unknown" }
  | { kind: "failed" }
  | { kind: "not_applied"; retryAfterSeconds?: number }
) & { reasonCode?: BookingNotificationReasonCode; pauseBot?: boolean };
const topicsSql = sql.join(
  BOOKING_NOTIFICATION_TOPICS.map((t) => sql`${t}`),
  sql`, `,
);
async function alert(tx: Tx, sourceId: string, reason: string) {
  await tx.execute(sql`insert into outbox_operator_alerts(outbox_id,reason_code,case_type,case_reason_code,status)
 values(${sourceId}::uuid,${reason},'delivery_failure','delivery_failure','open') on conflict(outbox_id,reason_code) do nothing`);
}
async function suppress(tx: Tx, id: string, reason: string) {
  await tx.execute(
    sql`update booking_notification_deliveries set state='suppressed',reason_code=${reason},lease_token=null,lease_until=null,worker_id=null,updated_at=clock_timestamp() where id=${id}::uuid and state in ('pending','retry_wait')`,
  );
  await tx.execute(
    sql`update booking_notification_callbacks set callback_token_ciphertext=null,encryption_key_id=null where delivery_id=${id}::uuid`,
  );
}
const roleFor = (topic: BookingNotificationTopic): Role =>
  topic.startsWith("telegram.") || topic.startsWith("expert.")
    ? "expert"
    : "client";

/** Caller holds the authority barriers before reservation/provider locks. No later context capture. */
export async function captureBookingNotificationIntents(
  tx: Tx,
  sourceOutboxId: string,
): Promise<void> {
  await captureBookingNotificationBatch(tx, [sourceOutboxId]);
}
const deferredCaptures = new WeakMap<Tx, string[]>();
/** Transaction owner MUST flush once, after every domain/callback write. */
export function deferBookingNotificationCapture(
  tx: Tx,
  sourceId: string,
): void {
  const ids = deferredCaptures.get(tx) ?? [];
  ids.push(sourceId);
  deferredCaptures.set(tx, ids);
}
export async function flushBookingNotificationCapture(tx: Tx): Promise<void> {
  const ids = deferredCaptures.get(tx) ?? [];
  deferredCaptures.delete(tx);
  await captureBookingNotificationBatch(tx, ids);
}
export async function captureBookingNotificationBatch(
  tx: Tx,
  sourceIds: readonly string[],
): Promise<void> {
  const prepared: {
    botKey: string;
    finish(enabled: boolean): Promise<void>;
  }[] = [];
  for (const id of [...new Set(sourceIds)].sort()) {
    const item = await prepareCapture(tx, id);
    if (item) prepared.push(item);
  }
  // Acquire every control in deterministic order, only after ALL source preparation.
  const enabled = new Map<string, boolean>();
  for (const bot of [...new Set(prepared.map((p) => p.botKey))].sort()) {
    const row = (
      await tx.execute<{ enabled: boolean }>(
        sql`select admission_enabled as enabled from booking_notification_bot_controls where bot_key=${bot} for update`,
      )
    ).rows[0];
    enabled.set(bot, row?.enabled === true);
  }
  for (const item of prepared)
    await item.finish(enabled.get(item.botKey) === true);
}
async function prepareCapture(
  tx: Tx,
  sourceOutboxId: string,
): Promise<{ botKey: string; finish(enabled: boolean): Promise<void> } | void> {
  const pointer = (
    await tx.execute<{ reservationId: string | null }>(
      sql`select payload->>'reservationId' as "reservationId" from integration_outbox where id=${sourceOutboxId}::uuid`,
    )
  ).rows[0];
  if (
    pointer?.reservationId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      pointer.reservationId,
    )
  ) {
    await lockBookingNotificationReservation(tx, pointer.reservationId);
    await tx.execute(
      sql`select id from reservations where id=${pointer.reservationId}::uuid for update`,
    );
    await tx.execute(
      sql`select id from planerka_booking_operations where reservation_id=${pointer.reservationId}::uuid for update`,
    );
  }
  const source = (
    await tx.execute<{
      topic: string;
      payload: unknown;
      idempotency_key: string;
      status: string;
    }>(
      sql`select topic,payload,idempotency_key,status from integration_outbox where id=${sourceOutboxId}::uuid for update`,
    )
  ).rows[0];
  if (
    !source ||
    !BOOKING_NOTIFICATION_TOPICS.includes(
      source.topic as BookingNotificationTopic,
    ) ||
    source.status === "succeeded" ||
    source.status === "dead_letter"
  )
    return;
  const parsed = bookingNotificationEventSchema.safeParse({
    topic: source.topic,
    payload: source.payload,
  });
  const quarantine = async (reason: string) => {
    await alert(tx, sourceOutboxId, reason);
    await tx.execute(
      sql`update integration_outbox set status='dead_letter',updated_at=clock_timestamp() where id=${sourceOutboxId}::uuid`,
    );
  };
  if (!parsed.success) return quarantine("booking_notification_source_invalid");
  const { topic, payload } = parsed.data;
  const context = (
    await tx.execute<Context>(
      sql`select * from booking_notification_contexts where reservation_id=${payload.reservationId}::uuid`,
    )
  ).rows[0];
  if (!context) return quarantine("booking_notification_context_missing");
  const version = "version" in payload ? payload.version : null;
  if (version !== null && version > 2147483647)
    return quarantine("booking_notification_source_invalid");
  let operationId: string | null = null;
  if (version !== null) {
    if (
      source.idempotency_key !== `${payload.reservationId}:${version}:${topic}`
    )
      return quarantine("booking_notification_source_invalid");
  } else {
    const suffix = `:${topic}`;
    const id = source.idempotency_key.endsWith(suffix)
      ? source.idempotency_key.slice(0, -suffix.length)
      : "";
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        id,
      )
    )
      return quarantine("booking_notification_source_invalid");
    const op = (
      await tx.execute<{ id: string }>(
        sql`select id from planerka_booking_operations where id=${id}::uuid and reservation_id=${payload.reservationId}::uuid and (${topic}='client.booking_confirmed' and state='booked' and provider_uid is not null and not cancel_requested or ${topic}='client.reservation_expired' and state='rejected')`,
      )
    ).rows[0];
    if (!op) return quarantine("booking_notification_source_invalid");
    operationId = op.id;
  }
  const role = roleFor(topic);
  await tx.execute(
    sql`select id from booking_notification_deliveries where source_outbox_id=${sourceOutboxId}::uuid order by id for update`,
  );
  await tx.execute(
    sql`select c.delivery_id from booking_notification_callbacks c join booking_notification_deliveries d on d.id=c.delivery_id where d.source_outbox_id=${sourceOutboxId}::uuid order by c.delivery_id,c.action for update of c`,
  );
  const candidate: Delivery = {
    id: sourceOutboxId,
    source_outbox_id: sourceOutboxId,
    reservation_id: payload.reservationId,
    recipient_role: role,
    recipient_user_id: context[`${role}_user_id`] as string,
    original_identity_id: context[`${role}_original_identity_id`] as
      string | null,
    bot_key: context.bot_key,
    external_user_id: context[`${role}_external_user_id`] as string | null,
    external_chat_id: context[`${role}_external_chat_id`] as string | null,
    kind: topic,
    source_version: version,
    provider_operation_id: operationId,
    state: "pending",
    lease_token: null,
    attempt_count: 0,
  };
  const checked = await validate(tx, candidate, context);
  return {
    botKey: context.bot_key,
    finish: async (enabled) => {
      if (!enabled) {
        // Permanently account disabled source work; re-enabling must not replay it.
        await quarantine("booking_notification_admission_disabled");
        return;
      }
      const id = (
        await tx.execute<{
          id: string;
        }>(sql`insert into booking_notification_deliveries(source_outbox_id,reservation_id,recipient_role,recipient_user_id,recipient_identity_id,original_identity_id,bot_key,external_user_id,external_chat_id,kind,source_version,provider_operation_id,expires_at)
 select ${sourceOutboxId}::uuid,r.id,${role},${context[`${role}_user_id`]}::uuid,${context[`${role}_identity_id`]}::uuid,${context[`${role}_original_identity_id`]}::uuid,${context.bot_key},${context[`${role}_external_user_id`]},${context[`${role}_external_chat_id`]},${topic},${version},${operationId}::uuid,case when ${topic}='telegram.reservation_request' then least(r.reserved_until,s.starts_at) else null end
 from reservations r join slots s on s.id=r.slot_id where r.id=${payload.reservationId}::uuid
 on conflict(source_outbox_id,recipient_role) do nothing returning id`)
      ).rows[0]?.id;
      if (id) {
        if (checked.reason) await suppress(tx, id, checked.reason);
      }
      // Accounted means an intent exists, not that a human received it.
      const exists = (
        await tx.execute(
          sql`select id from booking_notification_deliveries where source_outbox_id=${sourceOutboxId}::uuid`,
        )
      ).rows.length;
      if (!exists) return quarantine("booking_notification_source_invalid");
      await tx.execute(
        sql`update integration_outbox set status='succeeded',updated_at=clock_timestamp() where id=${sourceOutboxId}::uuid`,
      );
    },
  };
}

async function validate(tx: Tx, d: Delivery, context?: Context) {
  const c =
    context ??
    (
      await tx.execute<Context>(
        sql`select * from booking_notification_contexts where reservation_id=${d.reservation_id}::uuid`,
      )
    ).rows[0];
  if (
    !c ||
    c.bot_key !== d.bot_key ||
    c[`${d.recipient_role}_user_id`] !== d.recipient_user_id ||
    c[`${d.recipient_role}_original_identity_id`] !== d.original_identity_id ||
    c[`${d.recipient_role}_external_user_id`] !== d.external_user_id ||
    c[`${d.recipient_role}_external_chat_id`] !== d.external_chat_id
  )
    return { reason: "authority_invalid" };
  if (!d.original_identity_id) return { reason: "recipient_unavailable" };
  const live = await resolveBookingNotificationRecipient(
    tx,
    d.recipient_user_id,
    d.bot_key,
  );
  if (
    !live ||
    live.identityId !== d.original_identity_id ||
    live.externalUserId !== d.external_user_id ||
    live.externalChatId !== d.external_chat_id
  )
    return { reason: "authority_invalid" };
  if (
    d.recipient_role === "client" &&
    !(await validateBookingNotificationConsent(
      tx,
      c.client_consent_authority,
      d.recipient_user_id,
    ))
  )
    return { reason: "authority_invalid" };
  const r = (
    await tx.execute<{
      status: string;
      version: number;
      user_id: string;
      expert_user: string;
      client_active: boolean;
      eligible: boolean;
      starts_at: Date | string;
      valid: boolean;
    }>(sql`select r.status,r.version,r.user_id,cu.active as client_active,e.user_id as expert_user,(e.active and e.verified and u.active) as eligible,s.starts_at,
 (r.reserved_until>clock_timestamp() and s.starts_at>clock_timestamp() and s.observed_at between clock_timestamp()-interval '15 minutes' and clock_timestamp() and es.active) as valid
 from reservations r join slots s on s.id=r.slot_id join expert_services es on es.id=r.expert_service_id and es.expert_id=r.expert_id join experts e on e.id=r.expert_id join users u on u.id=e.user_id join users cu on cu.id=r.user_id where r.id=${d.reservation_id}::uuid`)
  ).rows[0];
  if (
    !r ||
    !r.client_active ||
    r.user_id !== c.client_user_id ||
    r.expert_user !== c.expert_user_id ||
    (d.recipient_role === "expert" && !r.eligible)
  )
    return { reason: "authority_invalid" };
  const expected: Record<BookingNotificationTopic, string> = {
    "telegram.reservation_request": "reserved",
    "client.booking_confirmed": "booked",
    "telegram.booking_cancelled": "cancelled_by_client",
    "client.booking_cancelled": "cancelled_by_expert",
    "client.reservation_expired": "expired",
    "expert.reservation_expired": "expired",
    "client.booking_completed": "completed",
    "client.booking_no_show": "no_show",
  };
  if (
    r.status !== expected[d.kind] ||
    (d.source_version !== null && r.version !== d.source_version)
  )
    return { reason: "state_superseded" };
  const op = (
    await tx.execute<{
      id: string;
      state: string;
      provider_uid: string | null;
      cancel_requested: boolean;
    }>(
      sql`select id,state,provider_uid,cancel_requested from planerka_booking_operations where reservation_id=${d.reservation_id}::uuid`,
    )
  ).rows[0];
  if (d.kind === "telegram.reservation_request" && (!r.valid || op))
    return { reason: "state_superseded" };
  if (
    d.kind === "client.booking_confirmed" &&
    (!op ||
      op.id !== d.provider_operation_id ||
      op.state !== "booked" ||
      !op.provider_uid ||
      op.cancel_requested)
  )
    return { reason: "provider_unknown" };
  if (
    d.source_version === null &&
    d.kind === "client.reservation_expired" &&
    (!op || op.id !== d.provider_operation_id || op.state !== "rejected")
  )
    return { reason: "source_invalid" };
  const legacy =
    (
      await tx.execute(
        sql`select reservation_id from planerka_legacy_booking_reviews where reservation_id=${d.reservation_id}::uuid and resolved_at is null`,
      )
    ).rows.length > 0;
  const calendar: BookingCalendarCancellation | "verified_booked" =
    d.kind === "client.booking_confirmed"
      ? "verified_booked"
      : legacy
        ? "unknown"
        : !op || op.state === "rejected"
          ? "not_created"
          : op.state === "cancelled"
            ? op.provider_uid
              ? "cancelled"
              : "not_created"
            : ["unknown", "cancel_unknown", "manual"].includes(op.state)
              ? "unknown"
              : "cancellation_pending";
  return {
    startsAt: new Date(r.starts_at).toISOString(),
    status: r.status,
    calendar,
  };
}

export class PostgresBookingNotificationRepository {
  // Stable keyset continuation bounds each poll without repeatedly selecting a
  // contended oldest page. Restart may repeat a page, never authorize a resend.
  private scanAfter: { createdAt: string; id: string } | undefined;
  constructor(
    private readonly db: DrizzleDb,
    private readonly botKey: string,
    private readonly preparation?: BookingNotificationPreparation,
  ) {}
  /** Read-only startup capability check; never enables or unpauses a bot. */
  async hasBotControl(): Promise<boolean> {
    return (
      (
        await this.db.execute(
          sql`select bot_key from booking_notification_bot_controls where bot_key=${this.botKey}`,
        )
      ).rows.length === 1
    );
  }
  /** Explicit owner/release operation only. Never call during application startup.
   * Does not provision missing controls, clear a pause or shorten a throttle. */
  async setAdmissionEnabled(enabled: boolean): Promise<boolean> {
    if (typeof enabled !== "boolean")
      throw new Error("notification_control_invalid");
    return (
      (
        await this.db.execute(
          sql`update booking_notification_bot_controls set admission_enabled=${enabled},updated_at=clock_timestamp() where bot_key=${this.botKey} returning bot_key`,
        )
      ).rows.length === 1
    );
  }
  /** Local backlog quarantine/accounting, never external dispatch. */
  async capturePending(limit = 20) {
    const ids = (
      await this.db.execute<{ id: string; reservationId: string | null }>(
        sql`select id,payload->>'reservationId' as "reservationId" from integration_outbox where topic in (${topicsSql}) and status='pending' order by created_at,id limit ${bound(limit)}`,
      )
    ).rows;
    for (const row of ids)
      await this.db.transaction(async (tx) => {
        if (
          row.reservationId &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
            row.reservationId,
          )
        )
          await lockBookingNotificationReservation(tx, row.reservationId);
        await captureBookingNotificationIntents(tx, row.id);
      });
    return ids.length;
  }
  async claimDeliveries(
    limit: number,
    workerId: string,
  ): Promise<BookingNotificationClaim[]> {
    if (!workerId || workerId.length > 128)
      throw new Error("notification_worker_invalid");
    // Scan IDs without row locks; each short transaction locks authority first.
    const after = this.scanAfter;
    const ids = (
      await this.db.execute<{
        id: string;
        reservation_id: string;
        createdAt: string;
      }>(
        sql`select id,reservation_id,created_at::text as "createdAt" from booking_notification_deliveries where bot_key=${this.botKey} and state in ('pending','retry_wait') and next_attempt_at<=clock_timestamp() and (lease_until is null or lease_until<=clock_timestamp()) ${after ? sql`and (created_at,id)>(${after.createdAt}::timestamptz,${after.id}::uuid)` : sql``} order by created_at,id limit 20`,
      )
    ).rows;
    const claims: BookingNotificationClaim[] = [];
    for (const candidate of ids) {
      this.scanAfter = { createdAt: candidate.createdAt, id: candidate.id };
      try {
        await this.db.transaction(async (tx) => {
          await tx.execute(sql`set local lock_timeout='10ms'`);
          await lockBookingNotificationReservation(
            tx,
            candidate.reservation_id,
            { nonblocking: true },
          );
          await tx.execute(
            sql`select id from reservations where id=${candidate.reservation_id}::uuid for update nowait`,
          );
          await tx.execute(
            sql`select id from planerka_booking_operations where reservation_id=${candidate.reservation_id}::uuid for update nowait`,
          );
          const rows = (
            await tx.execute<Delivery>(
              sql`select * from booking_notification_deliveries where reservation_id=${candidate.reservation_id}::uuid order by created_at,id for update nowait`,
            )
          ).rows;
          const d = rows.find((row) => row.id === candidate.id);
          if (!d || !["pending", "retry_wait"].includes(d.state)) return;
          // Superseded earlier requests cannot starve the current terminal notification.
          for (const earlier of rows.filter((row) =>
            ["pending", "retry_wait"].includes(row.state),
          )) {
            const checked = await validate(tx, earlier);
            if (checked.reason) {
              await suppress(tx, earlier.id, checked.reason);
              earlier.state = "suppressed";
            }
          }
          if (d.state === "suppressed") return;
          if (await hasBlockingPredecessor(tx, rows, d)) return;
          const claim = (
            await tx.execute<{
              leaseToken: string;
            }>(sql`update booking_notification_deliveries set lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',worker_id=${workerId},updated_at=clock_timestamp()
   where id=${d.id}::uuid and state in ('pending','retry_wait') and next_attempt_at<=clock_timestamp() and (lease_until is null or lease_until<=clock_timestamp()) returning lease_token as "leaseToken"`)
          ).rows[0];
          if (claim)
            claims.push({
              id: d.id,
              reservationId: d.reservation_id,
              leaseToken: claim.leaseToken,
              workerId,
              topic: d.kind,
            });
        });
      } catch (error) {
        if (!isLockContention(error)) throw error;
        // Rollback releases partial authority locks. Contention consumes no attempt.
      }
      if (claims.length >= bound(limit)) break;
    }
    if (
      !ids.length ||
      (this.scanAfter?.id === ids.at(-1)?.id && ids.length < 20)
    )
      this.scanAfter = undefined;
    return claims;
  }
  async admitAndConsume(
    claim: BookingNotificationClaim,
    requestDigest: string,
  ): Promise<BookingNotificationGrant | undefined> {
    if (!/^[a-f0-9]{64}$/u.test(requestDigest)) return undefined;
    return this.admit(claim, requestDigest) as Promise<
      BookingNotificationGrant | undefined
    >;
  }
  async admitPrepared(
    claim: BookingNotificationClaim,
  ): Promise<PreparedBookingSend | undefined> {
    if (!this.preparation) return undefined;
    return this.admit(claim) as Promise<PreparedBookingSend | undefined>;
  }
  private async admit(
    claim: BookingNotificationClaim,
    legacyDigest?: string,
  ): Promise<BookingNotificationGrant | PreparedBookingSend | undefined> {
    return this.db.transaction(async (tx) => {
      await lockBookingNotificationReservation(tx, claim.reservationId);
      await tx.execute(
        sql`select id from reservations where id=${claim.reservationId}::uuid for update`,
      );
      await tx.execute(
        sql`select id from planerka_booking_operations where reservation_id=${claim.reservationId}::uuid for update`,
      );
      const stream = (
        await tx.execute<Delivery>(
          sql`select * from booking_notification_deliveries where reservation_id=${claim.reservationId}::uuid order by created_at,id for update`,
        )
      ).rows;
      const d = (
        await tx.execute<Delivery>(
          sql`select * from booking_notification_deliveries where id=${claim.id}::uuid and reservation_id=${claim.reservationId}::uuid and bot_key=${this.botKey} and lease_token=${claim.leaseToken}::uuid and worker_id=${claim.workerId} and lease_until>clock_timestamp()+interval '15 seconds' and state in ('pending','retry_wait') and attempt_count<5 for update`,
        )
      ).rows[0];
      if (!d) return undefined;
      if (await hasBlockingPredecessor(tx, stream, d)) return undefined;
      const checked = await validate(tx, d);
      if (checked.reason) {
        await suppress(tx, d.id, checked.reason);
        return undefined;
      }
      const callbacks: Partial<Record<"confirm" | "cancel", string>> = {};
      // T3 installs the pair; admission reads and authenticates that exact frozen pair.
      if (d.kind === "telegram.reservation_request") {
        // Lock credentials before evaluating expiry with a fresh clock. T3 owns
        // cryptographic issuance; T2 checks its frozen registry bindings.
        await tx.execute(
          sql`select c.notification_id from booking_notification_callbacks c join notifications n on n.id=c.notification_id where c.delivery_id=${d.id}::uuid order by c.action for update of c,n`,
        );
        const pair = (
          await tx.execute<{
            action: string;
            claims: string;
            expertId: string;
            expires: string;
            notificationId: string;
            hash: string;
            ciphertext: string;
            keyId: string;
          }>(sql`
          select c.action,n.callback_claims as claims,r.expert_id as "expertId",floor(extract(epoch from n.callback_expires_at))::text as expires,
          c.notification_id as "notificationId",c.callback_token_hash as hash,c.callback_token_ciphertext as ciphertext,c.encryption_key_id as "keyId"
          from booking_notification_callbacks c join notifications n on n.id=c.notification_id join reservations r on r.id=${d.reservation_id}::uuid
          where c.delivery_id=${d.id}::uuid and c.expires_at>clock_timestamp()+interval '15 seconds'
          and c.expires_at<=r.reserved_until and c.expires_at<=${d.expires_at}::timestamptz
          and c.callback_token_ciphertext is not null and length(c.callback_token_ciphertext)>0 and length(c.encryption_key_id)>0
          and n.callback_consumed_at is null and n.callback_version=${d.source_version}
          and n.reservation_id=r.id and n.callback_expert_id=r.expert_id and n.callback_action=c.action
          and n.callback_token_hash=c.callback_token_hash and n.callback_token_hash ~ '^[a-f0-9]{64}$'
          and n.callback_expires_at=c.expires_at and n.callback_expires_at>clock_timestamp()+interval '15 seconds'
          order by c.action`)
        ).rows;
        if (
          pair.length !== 2 ||
          pair[0]?.action !== "cancel" ||
          pair[1]?.action !== "confirm"
        )
          return undefined;
        for (const credential of pair) {
          try {
            const claims = JSON.parse(credential.claims) as Record<
              string,
              unknown
            >;
            if (
              !claims ||
              claims.reservationId !== d.reservation_id ||
              claims.expertId !== credential.expertId ||
              claims.action !== credential.action ||
              claims.version !== d.source_version ||
              claims.expiresAtEpochSeconds !== Number(credential.expires)
            )
              return undefined;
            if (legacyDigest === undefined) {
              const action = credential.action as "confirm" | "cancel";
              const token = this.preparation!.open(
                { keyId: credential.keyId, ciphertext: credential.ciphertext },
                {
                  deliveryId: d.id,
                  notificationId: credential.notificationId,
                  reservationId: d.reservation_id,
                  expertId: credential.expertId,
                  botKey: d.bot_key,
                  chatId: d.external_chat_id!,
                  action,
                  version: d.source_version!,
                  expiresAtEpochSeconds: Number(credential.expires),
                },
              );
              if (
                this.preparation!.authenticateToken(token) !== credential.hash
              )
                return undefined;
              callbacks[action] = token;
            }
          } catch {
            return undefined;
          }
        }
      }
      let body: string | undefined;
      if (legacyDigest === undefined) {
        try {
          const terminal =
            d.kind === "client.booking_completed" ||
            d.kind === "client.booking_no_show";
          const view = bookingNotificationViewSchema.parse({
            kind: "ready",
            topic: d.kind,
            startsAt: checked.startsAt,
            status: checked.status,
            ...(d.kind === "telegram.reservation_request"
              ? { callbacks }
              : terminal
                ? {}
                : { calendar: checked.calendar }),
          });
          const rendered = this.preparation!.render(view);
          if (
            rendered.kind !== "rendered" ||
            rendered.topic !== d.kind ||
            rendered.recipient !== d.recipient_role
          )
            return undefined;
          if (d.kind === "telegram.reservation_request") {
            const buttons = rendered.replyMarkup?.inline_keyboard[0];
            if (
              buttons?.[0].callback_data !== callbacks.confirm ||
              buttons?.[1].callback_data !== callbacks.cancel
            )
              return undefined;
          } else if (rendered.replyMarkup !== null) return undefined;
          body = serializeBookingNotificationWire({
            chatId: d.external_chat_id,
            text: rendered.text,
            replyMarkup: rendered.replyMarkup,
          });
        } catch {
          return undefined;
        }
        // Last lock: no new domain/credential locks may be acquired below this point.
        await tx.execute(
          sql`select bot_key from booking_notification_bot_controls where bot_key=${this.botKey} for update`,
        );
        const control = (
          await tx.execute<{ paused: boolean; due: boolean }>(
            sql`select paused_at is not null as paused,not_before<=clock_timestamp() as due from booking_notification_bot_controls where bot_key=${this.botKey}`,
          )
        ).rows[0];
        if (!control || control.paused || !control.due) return undefined;
      }
      // WHERE evaluated before FOR UPDATE can precede a wait; use a fresh post-lock clock.
      const stillOwned = (
        await tx.execute(
          sql`select id from booking_notification_deliveries where id=${d.id}::uuid and lease_token=${claim.leaseToken}::uuid and worker_id=${claim.workerId} and lease_until>clock_timestamp()+interval '15 seconds' and (expires_at is null or expires_at>clock_timestamp()+interval '15 seconds')`,
        )
      ).rows.length;
      if (!stillOwned) return undefined;
      if (
        legacyDigest === undefined &&
        d.kind === "telegram.reservation_request"
      ) {
        const fresh = (
          await tx.execute(
            sql`select c.action from booking_notification_callbacks c join notifications n on n.id=c.notification_id where c.delivery_id=${d.id}::uuid and c.expires_at>clock_timestamp()+interval '15 seconds' and n.callback_consumed_at is null`,
          )
        ).rows;
        if (fresh.length !== 2) return undefined;
        const eligible = (
          await tx.execute(
            sql`select r.id from reservations r join slots s on s.id=r.slot_id where r.id=${d.reservation_id}::uuid and r.reserved_until>clock_timestamp()+interval '15 seconds' and s.starts_at>clock_timestamp()+interval '15 seconds' and s.observed_at between clock_timestamp()-interval '15 minutes' and clock_timestamp()`,
          )
        ).rows.length;
        if (!eligible) return undefined;
      }
      const requestDigest =
        legacyDigest ??
        createHash("sha256").update(body!, "utf8").digest("hex");
      const attempt = (
        await tx.execute<{
          id: string;
          deadline: Date | string;
        }>(sql`insert into booking_notification_attempts(delivery_id,ordinal,claim_token,request_digest,bot_key,chat_id,wire_version)
    values(${d.id}::uuid,${d.attempt_count + 1},${claim.leaseToken}::uuid,${requestDigest},${d.bot_key},${d.external_chat_id},${legacyDigest === undefined ? 1 : null}) returning id,admitted_at+interval '15 seconds' as deadline`)
      ).rows[0]!;
      await tx.execute(
        sql`update booking_notification_deliveries set state='sending',attempt_count=attempt_count+1,updated_at=clock_timestamp() where id=${d.id}::uuid`,
      );
      if (body !== undefined)
        return Object.freeze({
          attemptId: attempt.id,
          deliveryId: d.id,
          botKey: d.bot_key,
          chatId: d.external_chat_id!,
          deadline: new Date(attempt.deadline).toISOString(),
          wireVersion: 1 as const,
          body,
          bodySha256: requestDigest,
        });
      return {
        attemptId: attempt.id,
        deliveryId: d.id,
        topic: d.kind,
        botKey: d.bot_key,
        chatId: d.external_chat_id!,
        startsAt: checked.startsAt!,
        status: checked.status!,
        calendar: checked.calendar!,
        deadline: new Date(attempt.deadline).toISOString(),
      };
    });
  }
  async recordOutcome(
    attemptId: string,
    outcome: BookingNotificationOutcome,
  ): Promise<boolean> {
    if (
      outcome.reasonCode !== undefined &&
      !outcomeReasons.has(outcome.reasonCode)
    )
      throw new Error("notification_outcome_invalid");
    if (outcome.pauseBot !== undefined && typeof outcome.pauseBot !== "boolean")
      throw new Error("notification_outcome_invalid");
    if (
      outcome.pauseBot &&
      !["bot_rejected", "bot_mismatch", "request_invalid"].includes(
        outcome.reasonCode ?? "",
      )
    )
      throw new Error("notification_pause_invalid");
    if (
      outcome.kind === "not_applied" &&
      outcome.retryAfterSeconds !== undefined &&
      (!Number.isInteger(outcome.retryAfterSeconds) ||
        outcome.retryAfterSeconds < 0 ||
        outcome.retryAfterSeconds > 2147483647)
    )
      throw new Error("notification_retry_invalid");
    return this.db.transaction(async (tx) => {
      const row = await attemptDelivery(tx, attemptId);
      if (!row || row.d.bot_key !== this.botKey) return false;
      const { d } = row;
      const wire = (
        await tx.execute<{ wire_version: number | null }>(
          sql`select wire_version from booking_notification_attempts where id=${attemptId}::uuid`,
        )
      ).rows[0];
      const updateControl = async () => {
        const retry =
          outcome.kind === "not_applied" ? (outcome.retryAfterSeconds ?? 0) : 0;
        const changed = (
          await tx.execute(sql`update booking_notification_bot_controls set
          paused_at=case when ${outcome.pauseBot === true} then coalesce(paused_at,clock_timestamp()) else paused_at end,
          pause_reason=case when ${outcome.pauseBot === true} then coalesce(pause_reason,${outcome.reasonCode ?? null}) else pause_reason end,
          not_before=greatest(not_before,clock_timestamp()+${retry}::int*interval '1 second'),updated_at=clock_timestamp()
          where bot_key=${this.botKey} returning bot_key`)
        ).rows.length;
        if (!changed && wire?.wire_version === 1)
          throw new Error("notification_control_missing");
      };
      const facts = (
        await tx.execute<{ outcome: string }>(
          sql`select outcome from booking_notification_attempt_facts where attempt_id=${attemptId}::uuid`,
        )
      ).rows;
      if (facts.length || d.state !== "sending") {
        // Acknowledge durable evidence, not a reclassification. Recovery's unknown
        // stays unknown/manual; a late 429 still throttles ALL workers for this bot.
        if (!facts.some((f) => f.outcome === outcome.kind))
          await alert(
            tx,
            d.source_outbox_id,
            `booking_notification_outcome_conflict_${outcome.kind}`,
          );
        if (outcome.pauseBot)
          await alert(
            tx,
            d.source_outbox_id,
            "booking_notification_bot_paused",
          );
        await updateControl();
        return true;
      }
      const reason =
        outcome.reasonCode ??
        (outcome.kind === "unknown"
          ? "transport_uncertain"
          : outcome.kind === "failed"
            ? "recipient_rejected"
            : "definite_non_delivery");
      const retry =
        outcome.kind === "not_applied"
          ? (outcome.retryAfterSeconds ?? 0)
          : null;
      await tx.execute(
        sql`insert into booking_notification_attempt_facts(attempt_id,outcome,reason_code,retry_after_seconds) values(${attemptId}::uuid,${outcome.kind},${reason},${retry})`,
      );
      const state =
        outcome.kind === "unknown"
          ? "unknown"
          : outcome.kind === "failed" || d.attempt_count >= 5
            ? "failed"
            : "retry_wait";
      await tx.execute(
        sql`update booking_notification_deliveries set state=${state},reason_code=${reason},lease_token=null,lease_until=null,worker_id=null,next_attempt_at=clock_timestamp()+(coalesce(${retry}::int,0)+random()*least(60,power(2,attempt_count))) * interval '1 second',updated_at=clock_timestamp() where id=${d.id}::uuid`,
      );
      if (state === "unknown" || state === "failed")
        await alert(tx, d.source_outbox_id, `booking_notification_${state}`);
      // All delivery/attempt/fact locks are held before taking the shared control.
      if (outcome.pauseBot)
        await alert(tx, d.source_outbox_id, "booking_notification_bot_paused");
      await updateControl();
      return true;
    });
  }
  async resolveReceipt(
    attemptId: string,
    receipt: BookingNotificationReceipt,
  ): Promise<boolean> {
    if (!Number.isSafeInteger(receipt.messageId) || receipt.messageId <= 0)
      return false;
    return this.db.transaction(async (tx) => {
      const row = await attemptDelivery(tx, attemptId);
      if (!row) return false;
      const { d, bot, chat } = row;
      if (
        bot !== this.botKey ||
        receipt.botKey !== bot ||
        receipt.chatId !== chat
      ) {
        await alert(
          tx,
          d.source_outbox_id,
          "booking_notification_receipt_conflict",
        );
        return false;
      }
      const facts = (
        await tx.execute<{
          outcome: string;
          telegram_message_id: string | null;
          response_chat_id: string | null;
          bot_key: string | null;
        }>(
          sql`select * from booking_notification_attempt_facts where attempt_id=${attemptId}::uuid`,
        )
      ).rows;
      const saved = facts.find((f) => f.outcome === "applied");
      if (saved) {
        const same =
          saved.telegram_message_id === String(receipt.messageId) &&
          saved.response_chat_id === chat &&
          saved.bot_key === bot;
        if (!same)
          await alert(
            tx,
            d.source_outbox_id,
            "booking_notification_receipt_conflict",
          );
        return same;
      }
      if (
        facts.some((f) => f.outcome === "not_applied" || f.outcome === "failed")
      ) {
        await alert(
          tx,
          d.source_outbox_id,
          "booking_notification_receipt_conflict",
        );
        return false;
      }
      const accepted = (
        await tx.execute(
          sql`insert into booking_notification_attempt_facts(attempt_id,outcome,bot_key,response_chat_id,telegram_message_id,reason_code) values(${attemptId}::uuid,'applied',${bot},${chat},${receipt.messageId},'authenticated_receipt') on conflict do nothing returning id`,
        )
      ).rows.length;
      if (!accepted) {
        await alert(
          tx,
          d.source_outbox_id,
          "booking_notification_receipt_conflict",
        );
        return false;
      }
      await tx.execute(
        sql`update booking_notification_deliveries set state='delivered',reason_code=null,lease_token=null,lease_until=null,worker_id=null,updated_at=clock_timestamp() where id=${d.id}::uuid`,
      );
      await tx.execute(
        sql`update booking_notification_callbacks set callback_token_ciphertext=null,encryption_key_id=null where delivery_id=${d.id}::uuid`,
      );
      // Only uncertainty for this source/attempt is resolved. Conflicting receipt
      // evidence is a distinct operator case and must remain open.
      if (facts.some((f) => f.outcome === "unknown"))
        await tx.execute(
          sql`update outbox_operator_alerts set status='resolved',resolved_at=clock_timestamp(),updated_at=clock_timestamp() where outbox_id=${d.source_outbox_id}::uuid and status in ('open','acknowledged') and reason_code in ('booking_notification_unknown','booking_notification_manual','booking_notification_privacy_unknown')`,
        );
      return true;
    });
  }
  async recoverExpired(limit: number): Promise<number> {
    const recovered = await this.db.transaction(async (tx) => {
      const rows = (
        await tx.execute<Delivery>(
          sql`select * from booking_notification_deliveries where bot_key=${this.botKey} and (lease_until<=clock_timestamp() or state='unknown') and state in ('pending','retry_wait','sending','unknown') order by updated_at,id for update skip locked limit ${bound(limit)}`,
        )
      ).rows;
      for (const d of rows) {
        if (["pending", "retry_wait"].includes(d.state)) {
          await tx.execute(
            sql`update booking_notification_deliveries set lease_token=null,lease_until=null,worker_id=null where id=${d.id}::uuid`,
          );
          continue;
        }
        const a = (
          await tx.execute<{ id: string }>(
            sql`select id from booking_notification_attempts where delivery_id=${d.id}::uuid and ordinal=${d.attempt_count} for update`,
          )
        ).rows[0];
        if (a)
          await tx.execute(
            sql`insert into booking_notification_attempt_facts(attempt_id,outcome,reason_code) values(${a.id}::uuid,'unknown','lease_expired') on conflict(attempt_id,outcome) do nothing`,
          );
        await tx.execute(
          sql`update booking_notification_deliveries set state='manual',reason_code='receipt_required',lease_token=null,lease_until=null,worker_id=null where id=${d.id}::uuid`,
        );
        await alert(tx, d.source_outbox_id, "booking_notification_manual");
      }
      return rows.length;
    });
    // Separate short transaction: no delivery locks retained while cleaning tokens.
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`with expired as materialized (
        select c.delivery_id,c.action from booking_notification_callbacks c
        join booking_notification_deliveries d on d.id=c.delivery_id
        where d.bot_key=${this.botKey} and c.expires_at<=clock_timestamp() and c.callback_token_ciphertext is not null
        order by c.expires_at,c.delivery_id,c.action for update of c skip locked limit ${bound(limit)}
      ) update booking_notification_callbacks c set callback_token_ciphertext=null,encryption_key_id=null
        from expired e where c.delivery_id=e.delivery_id and c.action=e.action`);
    });
    return recovered;
  }
}
async function hasBlockingPredecessor(tx: Tx, stream: Delivery[], d: Delivery) {
  const position = stream.findIndex((row) => row.id === d.id);
  if (position < 0) return true;
  for (const prior of stream
    .slice(0, position)
    .filter((row) => row.recipient_role === d.recipient_role)) {
    if (prior.state === "unknown") {
      await tx.execute(
        sql`update booking_notification_deliveries set state='manual',reason_code='receipt_required',lease_token=null,lease_until=null,worker_id=null where id=${prior.id}::uuid and state='unknown'`,
      );
      await alert(tx, prior.source_outbox_id, "booking_notification_manual");
    } else if (["pending", "retry_wait", "sending"].includes(prior.state))
      return true;
  }
  return false;
}
function isLockContention(error: unknown): boolean {
  const seen = new Set<unknown>();
  while (error && typeof error === "object" && !seen.has(error)) {
    if (
      error instanceof BookingNotificationLockUnavailable ||
      (error as { code?: unknown }).code === "55P03"
    )
      return true;
    seen.add(error);
    error = (error as { cause?: unknown }).cause;
  }
  return false;
}
function bound(value: number) {
  return Number.isFinite(value)
    ? Math.max(1, Math.min(20, Math.floor(value)))
    : 20;
}
async function attemptDelivery(tx: Tx, id: string) {
  const locator = (
    await tx.execute<{ delivery_id: string }>(
      sql`select delivery_id from booking_notification_attempts where id=${id}::uuid`,
    )
  ).rows[0];
  if (!locator) return undefined;
  const d = (
    await tx.execute<Delivery>(
      sql`select * from booking_notification_deliveries where id=${locator.delivery_id}::uuid for update`,
    )
  ).rows[0];
  if (!d) return undefined;
  const a = (
    await tx.execute<{ bot_key: string; chat_id: string }>(
      sql`select bot_key,chat_id from booking_notification_attempts where id=${id}::uuid for update`,
    )
  ).rows[0]!;
  return { d, bot: a.bot_key, chat: a.chat_id };
}
/** Subject barrier is acquired by privacy before its user/identity mutations. */
export async function stopBookingNotificationRecipients(
  tx: Tx,
  userId: string,
  scope: "client_messaging" | "erasure" = "client_messaging",
) {
  const predicate =
    scope === "erasure"
      ? sql`(recipient_user_id=${userId}::uuid or reservation_id in(select id from reservations where user_id=${userId}::uuid))`
      : sql`recipient_role='client' and recipient_user_id=${userId}::uuid`;
  const rows = (
    await tx.execute<Delivery>(
      sql`select * from booking_notification_deliveries where ${predicate} order by id for update`,
    )
  ).rows;
  for (const d of rows) {
    if (["pending", "retry_wait"].includes(d.state))
      await suppress(tx, d.id, "authority_invalid");
    if (["sending", "unknown"].includes(d.state)) {
      const a = (
        await tx.execute<{ id: string }>(
          sql`select id from booking_notification_attempts where delivery_id=${d.id}::uuid and ordinal=${d.attempt_count} for update`,
        )
      ).rows[0];
      if (a)
        await tx.execute(
          sql`insert into booking_notification_attempt_facts(attempt_id,outcome,reason_code) values(${a.id}::uuid,'unknown','privacy_inflight') on conflict(attempt_id,outcome) do nothing`,
        );
      await tx.execute(
        sql`update booking_notification_deliveries set state='manual',reason_code='privacy_inflight',lease_token=null,lease_until=null,worker_id=null where id=${d.id}::uuid`,
      );
      await alert(
        tx,
        d.source_outbox_id,
        "booking_notification_privacy_unknown",
      );
    }
    await tx.execute(
      sql`update booking_notification_callbacks set callback_token_ciphertext=null,encryption_key_id=null where delivery_id=${d.id}::uuid`,
    );
  }
}
export async function eraseBookingNotificationRecipients(
  tx: Tx,
  userId: string,
) {
  await lockBookingNotificationSubjects(tx, [userId], {
    identityMutation: true,
  });
  await stopBookingNotificationRecipients(tx, userId, "erasure");
  await tx.execute(
    sql`update booking_notification_contexts set client_identity_id=null,client_original_identity_id=null,client_external_user_id=null,client_external_chat_id=null,client_unavailable_reason='erased',client_consent_authority=null where client_user_id=${userId}::uuid`,
  );
  await tx.execute(
    sql`update booking_notification_contexts set expert_identity_id=null,expert_original_identity_id=null,expert_external_user_id=null,expert_external_chat_id=null,expert_unavailable_reason='erased' where expert_user_id=${userId}::uuid`,
  );
  // Receipt/uncertainty bindings stay in immutable attempts; queue addresses are removed.
  await tx.execute(
    sql`update booking_notification_deliveries set recipient_identity_id=null,original_identity_id=null,external_user_id=null,external_chat_id=null where recipient_user_id=${userId}::uuid`,
  );
}
