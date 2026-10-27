import type { DrizzleDb } from "../client.js";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  lockBookingNotificationReservation,
  resolveBookingNotificationRecipient,
  type BookingNotificationExecutor,
} from "./booking-notification-authority.js";

export interface TelegramBookingCallbackContext {
  botKey: string;
  telegramUserId: string;
  chatId: string;
  messageId: number;
  deliveryId: string;
}
export interface BookingApprovalClaims {
  reservationId: string;
  expertId: string;
  action: "confirm" | "cancel";
  version: number;
  expiresAtEpochSeconds: number;
}
export interface BookingApprovalBinding extends BookingApprovalClaims {
  deliveryId: string;
  notificationId: string;
  botKey: string;
  chatId: string;
}
export interface BookingApprovalCrypto {
  issue(
    claims: BookingApprovalClaims,
  ): Promise<{ token: string; tokenHash: string }>;
  seal(
    token: string,
    binding: BookingApprovalBinding,
  ): { keyId: string; ciphertext: string };
  open(
    envelope: { keyId: string; ciphertext: string },
    binding: BookingApprovalBinding,
  ): string;
}
export interface LinkedBookingCallback {
  deliveryId: string;
  reservationId: string;
  expertId: string;
  action: "confirm" | "cancel";
  version: number;
}
export class PostgresBookingNotificationCallbackRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly botKey: string,
    private readonly crypto: BookingApprovalCrypto,
  ) {}
  /** Selection only. Includes consumed credentials for authenticated replay. */
  async findLinkedCallback(
    tokenHash: string,
  ): Promise<LinkedBookingCallback | null> {
    if (!HASH.test(tokenHash)) return null;
    return (
      (
        await this.db.execute<
          LinkedBookingCallback & Record<string, unknown>
        >(sql`
      select d.id as "deliveryId",n.reservation_id as "reservationId",n.callback_expert_id as "expertId",n.callback_action as action,n.callback_version as version
      from booking_notification_callbacks c join notifications n on n.id=c.notification_id join booking_notification_deliveries d on d.id=c.delivery_id
      where c.callback_token_hash=${tokenHash} and n.callback_token_hash=c.callback_token_hash and d.bot_key=${this.botKey}
      and d.kind='telegram.reservation_request' and d.recipient_role='expert'
      and n.reservation_id=d.reservation_id and n.callback_action=c.action and n.callback_version=d.source_version
    `)
      ).rows[0] ?? null
    );
  }
  async issueApprovalPair(
    deliveryId: string,
  ): Promise<{ confirm: string; cancel: string } | null> {
    if (!UUID.test(deliveryId)) return null;
    return this.db.transaction(async (tx) => {
      const locator = (
        await tx.execute<{ id: string }>(
          sql`select reservation_id as id from booking_notification_deliveries where id=${deliveryId}::uuid and bot_key=${this.botKey}`,
        )
      ).rows[0];
      if (!locator) return null;
      await lockBookingCallbackAuthority(tx, locator.id);
      const row = await loadBookingApprovalAuthority(tx, deliveryId);
      if (
        !row ||
        row.botKey !== this.botKey ||
        !(await hasCurrentBookingExpert(tx, row))
      )
        return null;
      const links = await lockApprovalLinks(tx, deliveryId);
      const clock = await approvalClock(tx, row.reservationId);
      if (
        !clock?.eligible ||
        row.version !== clock.version ||
        !["pending", "retry_wait"].includes(row.state)
      )
        return null;
      const expires = Number(clock.expires);
      if (expires * 1000 <= new Date(clock.now).getTime()) return null;
      if (links.length) {
        if (links.length !== 2) return null;
        const pair: Partial<Record<"confirm" | "cancel", string>> = {};
        for (const link of links) {
          if (
            !validApprovalLink(link, row) ||
            link.consumedAt ||
            !link.ciphertext ||
            !link.keyId ||
            link.expires !== String(expires)
          )
            return null;
          try {
            const token = this.crypto.open(
              { keyId: link.keyId, ciphertext: link.ciphertext },
              approvalBinding(row, link.id, link.action, expires),
            );
            if (tokenNonceHash(token) !== link.hash) return null;
            pair[link.action] = token;
          } catch {
            return null;
          }
        }
        return pair.confirm && pair.cancel
          ? { confirm: pair.confirm, cancel: pair.cancel }
          : null;
      }
      // Retained registry facts prevent regeneration after links were lost/deleted.
      const prior = (
        await tx.execute(
          sql`select id from notifications where idempotency_key in (${`booking-approval:${deliveryId}:confirm`},${`booking-approval:${deliveryId}:cancel`}) for update`,
        )
      ).rows;
      if (prior.length || row.attemptCount !== 0) return null;
      const pair: Partial<Record<"confirm" | "cancel", string>> = {};
      for (const action of ["confirm", "cancel"] as const) {
        const id = randomUUID();
        const binding = approvalBinding(row, id, action, expires);
        const claims: BookingApprovalClaims = {
          reservationId: row.reservationId,
          expertId: row.expertId,
          action,
          version: row.version,
          expiresAtEpochSeconds: expires,
        };
        const issued = await this.crypto.issue(claims);
        if (
          !HASH.test(issued.tokenHash) ||
          tokenNonceHash(issued.token) !== issued.tokenHash
        )
          throw Error("booking_callback_crypto_invalid");
        const envelope = this.crypto.seal(issued.token, binding);
        if (!envelope.keyId || !envelope.ciphertext)
          throw Error("booking_callback_crypto_invalid");
        await tx.execute(sql`insert into notifications(id,reservation_id,idempotency_key,callback_token_hash,callback_claims,callback_expires_at,callback_expert_id,callback_action,callback_version)
          values(${id}::uuid,${row.reservationId}::uuid,${`booking-approval:${deliveryId}:${action}`},${issued.tokenHash},${JSON.stringify(claims)},to_timestamp(${expires}),${row.expertId}::uuid,${action},${row.version})`);
        await tx.execute(sql`insert into booking_notification_callbacks(delivery_id,action,notification_id,callback_token_hash,callback_token_ciphertext,encryption_key_id,expires_at)
          values(${deliveryId}::uuid,${action},${id}::uuid,${issued.tokenHash},${envelope.ciphertext},${envelope.keyId},to_timestamp(${expires}))`);
        pair[action] = issued.token;
      }
      const stillValid = (
        await tx.execute(
          sql`select 1 where to_timestamp(${expires})>clock_timestamp()`,
        )
      ).rows.length;
      if (!stillValid) throw Error("booking_callback_issuance_expired");
      return { confirm: pair.confirm!, cancel: pair.cancel! };
    });
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH = /^[a-f0-9]{64}$/u;
function tokenNonceHash(token: string) {
  if (!/^ct2\.[A-Za-z0-9_-]{44}$/u.test(token)) return null;
  const bytes = Buffer.from(token.slice(4), "base64url");
  if (
    bytes.length !== 33 ||
    bytes[0] !== 2 ||
    bytes.toString("base64url") !== token.slice(4)
  )
    return null;
  return createHash("sha256").update(bytes.subarray(1, 17)).digest("hex");
}
type Tx = BookingNotificationExecutor;
/** Same document/subject/identity and transition advisory order as booking. All
 * domain row locks precede provider/delivery/callback locks and the fresh clock. */
export async function lockBookingCallbackAuthority(
  tx: Tx,
  reservationId: string,
) {
  await lockBookingNotificationReservation(tx, reservationId);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(lock_key,0)) from (
    select lock_key from (select ${`reservation:${reservationId}`} as lock_key union all select 'slot:'||slot_id::text from reservations where id=${reservationId}::uuid union all select 'client:'||user_id::text from reservations where id=${reservationId}::uuid union all select 'expert:'||expert_id::text from reservations where id=${reservationId}::uuid) keys order by lock_key) ordered_keys`);
  await tx.execute(
    sql`select r.id from reservations r join slots s on s.id=r.slot_id join experts e on e.id=r.expert_id join expert_services es on es.id=r.expert_service_id where r.id=${reservationId}::uuid for update of r,s,e,es`,
  );
  await tx.execute(
    sql`select id from planerka_booking_operations where reservation_id=${reservationId}::uuid for update`,
  );
  // enqueuePlanerkaBooking reads this row FOR SHARE; acquire it before the
  // callback's clock so an administrative mapping edit cannot move eligibility
  // evaluation ahead of a subsequent domain-authority wait.
  await tx.execute(
    sql`select m.expert_service_id from planerka_service_mappings m join reservations r on r.expert_service_id=m.expert_service_id where r.id=${reservationId}::uuid for share of m`,
  );
  await tx.execute(
    sql`select id from booking_notification_deliveries where reservation_id=${reservationId}::uuid order by created_at,id for update`,
  );
}
interface ApprovalAuthority extends Record<string, unknown> {
  deliveryId: string;
  reservationId: string;
  expertId: string;
  userId: string;
  identityId: string | null;
  botKey: string;
  chatId: string | null;
  externalUserId: string | null;
  version: number;
  state: string;
  attemptCount: number;
  tupleValid: boolean;
}
export async function loadBookingApprovalAuthority(tx: Tx, deliveryId: string) {
  return (
    await tx.execute<ApprovalAuthority>(sql`select d.id as "deliveryId",d.reservation_id as "reservationId",r.expert_id as "expertId",d.recipient_user_id as "userId",d.original_identity_id as "identityId",d.bot_key as "botKey",d.external_chat_id as "chatId",d.external_user_id as "externalUserId",d.source_version as version,d.state,d.attempt_count as "attemptCount",
    (d.recipient_user_id=c.expert_user_id and e.user_id=c.expert_user_id and d.original_identity_id=c.expert_original_identity_id and d.external_user_id=c.expert_external_user_id and d.external_chat_id=c.expert_external_chat_id and d.bot_key=c.bot_key and c.client_user_id=r.user_id and cu.active and eu.active and e.active and e.verified) as "tupleValid"
    from booking_notification_deliveries d join booking_notification_contexts c on c.reservation_id=d.reservation_id join reservations r on r.id=d.reservation_id join experts e on e.id=r.expert_id join users eu on eu.id=e.user_id join users cu on cu.id=r.user_id
    where d.id=${deliveryId}::uuid and d.kind='telegram.reservation_request' and d.recipient_role='expert'`)
  ).rows[0];
}
export async function hasCurrentBookingExpert(tx: Tx, row: ApprovalAuthority) {
  if (!row.tupleValid || !row.identityId || !row.chatId) return false;
  const identity = await resolveBookingNotificationRecipient(
    tx,
    row.userId,
    row.botKey,
  );
  return (
    !!identity &&
    identity.identityId === row.identityId &&
    identity.externalUserId === row.externalUserId &&
    identity.externalChatId === row.chatId
  );
}
interface ApprovalLink extends Record<string, unknown> {
  id: string;
  action: "confirm" | "cancel";
  hash: string;
  registryHash: string;
  reservationId: string;
  expertId: string;
  version: number;
  registryAction: string;
  expires: string;
  expiryMatches: boolean;
  claims: string;
  consumedAt: Date | string | null;
  ciphertext: string | null;
  keyId: string | null;
}
export async function lockApprovalLinks(tx: Tx, deliveryId: string) {
  return (
    await tx.execute<ApprovalLink>(sql`select n.id,c.action,c.callback_token_hash as hash,n.callback_token_hash as "registryHash",n.reservation_id as "reservationId",n.callback_expert_id as "expertId",n.callback_version as version,n.callback_action as "registryAction",extract(epoch from c.expires_at)::bigint::text as expires,(c.expires_at=n.callback_expires_at and c.expires_at=date_trunc('second',c.expires_at)) as "expiryMatches",n.callback_claims as claims,n.callback_consumed_at as "consumedAt",c.callback_token_ciphertext as ciphertext,c.encryption_key_id as "keyId"
    from booking_notification_callbacks c join notifications n on n.id=c.notification_id where c.delivery_id=${deliveryId}::uuid order by c.action for update of c,n`)
  ).rows;
}
export function validApprovalLink(link: ApprovalLink, row: ApprovalAuthority) {
  if (
    !["confirm", "cancel"].includes(link.action) ||
    link.registryAction !== link.action ||
    link.hash !== link.registryHash ||
    !HASH.test(link.hash) ||
    link.reservationId !== row.reservationId ||
    link.expertId !== row.expertId ||
    link.version !== row.version ||
    !link.expiryMatches
  )
    return false;
  try {
    const c = JSON.parse(link.claims) as BookingApprovalClaims;
    return (
      c.reservationId === row.reservationId &&
      c.expertId === row.expertId &&
      c.action === link.action &&
      c.version === row.version &&
      c.expiresAtEpochSeconds === Number(link.expires)
    );
  } catch {
    return false;
  }
}
function approvalBinding(
  row: ApprovalAuthority,
  notificationId: string,
  action: "confirm" | "cancel",
  expiresAtEpochSeconds: number,
): BookingApprovalBinding {
  return {
    deliveryId: row.deliveryId,
    notificationId,
    reservationId: row.reservationId,
    expertId: row.expertId,
    botKey: row.botKey,
    chatId: row.chatId!,
    action,
    version: row.version,
    expiresAtEpochSeconds,
  };
}
export async function approvalClock(tx: Tx, reservationId: string) {
  return (
    await tx.execute<{
      now: Date | string;
      expires: string;
      version: number;
      eligible: boolean;
    }>(sql`with t as materialized(select clock_timestamp() as now)
    select t.now,r.version,floor(extract(epoch from least(r.reserved_until,s.starts_at)))::text as expires,
    (r.status='reserved' and r.reserved_until>t.now and s.starts_at>t.now and resident_slot_fresh(s.id,t.now) and es.active and not exists(select 1 from planerka_booking_operations where reservation_id=r.id)) as eligible
    from reservations r join slots s on s.id=r.slot_id and s.expert_service_id=r.expert_service_id join expert_services es on es.id=r.expert_service_id and es.expert_id=r.expert_id cross join t where r.id=${reservationId}::uuid`)
  ).rows[0];
}
export function validTelegramBookingContext(
  context: TelegramBookingCallbackContext,
) {
  return (
    UUID.test(context.deliveryId) &&
    !!context.botKey &&
    /^[1-9][0-9]{0,15}$/u.test(context.telegramUserId) &&
    Number.isSafeInteger(Number(context.telegramUserId)) &&
    context.chatId === context.telegramUserId &&
    Number.isSafeInteger(context.messageId) &&
    context.messageId > 0
  );
}
