import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

export type BookingNotificationExecutor = Pick<DrizzleDb, "execute">;
export interface BookingNotificationRecipient {
  userId: string;
  identityId: string;
  botKey: string;
  externalUserId: string;
  externalChatId: string;
}

export async function resolveBookingNotificationRecipient(
  tx: BookingNotificationExecutor,
  userId: string,
  botKey: string,
): Promise<BookingNotificationRecipient | undefined> {
  if (!botKey.trim()) return undefined;
  await tx.execute(sql`lock table channel_identities in share mode`);
  const users = (
    await tx.execute(sql`
    select id from users where id=${userId}::uuid and active for share
  `)
  ).rows;
  if (users.length !== 1) return undefined;
  // Lock every active candidate before counting. Filtering malformed candidates
  // first would silently choose one address from an ambiguous account.
  const rows = (
    await tx.execute<
      BookingNotificationRecipient & Record<string, unknown>
    >(sql`
    select user_id::text as "userId",id::text as "identityId",bot_key as "botKey",
      external_id as "externalUserId",external_chat_id as "externalChatId"
    from channel_identities where user_id=${userId}::uuid
      and provider='telegram' and bot_key=${botKey} and status='active'
    order by id for share
  `)
  ).rows;
  const recipient = rows[0];
  if (
    rows.length !== 1 ||
    !recipient ||
    !/^[1-9][0-9]{0,15}$/u.test(recipient.externalUserId) ||
    BigInt(recipient.externalUserId) > BigInt(Number.MAX_SAFE_INTEGER) ||
    recipient.externalChatId !== recipient.externalUserId
  )
    return undefined;
  return recipient;
}

import { clientConsentAuthoritySchema } from "@ii-tonya/contracts";
import { captureClientConsentAuthority } from "./client-consent-authority.js";
import { originalClientConsentSql } from "./consent-current.js";
export interface BookingNotificationOrigin {
  botKey: string;
  messagingPolicyVersion: string;
}

export interface BookingNotificationLockOptions {
  /** Must be selected before any identity-table lock, never upgraded after SHARE. */
  identityMutation?: boolean;
  nonblocking?: boolean;
}
export class BookingNotificationLockUnavailable extends Error {
  constructor() {
    super("notification_authority_contended");
  }
}
/** Document -> ordered subjects -> identity table -> users -> experts -> services -> slots.
 * Identity writers need SHARE ROW EXCLUSIVE from the outset to avoid upgrade deadlocks.
 */
export async function lockBookingNotificationSubjects(
  tx: BookingNotificationExecutor,
  userIds: readonly string[],
  options: BookingNotificationLockOptions = {},
) {
  const noWait = options.nonblocking ? sql`nowait` : sql``;
  await tx.execute(
    sql`lock table consent_document_versions in share mode ${noWait}`,
  );
  for (const id of [...new Set(userIds)].sort()) {
    if (options.nonblocking) {
      const acquired = (
        await tx.execute<{ acquired: boolean }>(
          sql`select pg_try_advisory_xact_lock(hashtextextended(${id}::uuid::text,0)) as acquired`,
        )
      ).rows[0]?.acquired;
      if (!acquired) throw new BookingNotificationLockUnavailable();
    } else
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${id}::uuid::text,0))`,
      );
  }
  const identityMode = options.identityMutation
    ? sql`share row exclusive`
    : sql`share`;
  await tx.execute(
    sql`lock table channel_identities in ${identityMode} mode ${noWait}`,
  );
  for (const id of [...new Set(userIds)].sort())
    await tx.execute(
      sql`select id from users where id=${id}::uuid for share ${noWait}`,
    );
}
async function lockSlotAuthority(
  tx: BookingNotificationExecutor,
  slotId: string,
  options: BookingNotificationLockOptions,
) {
  const noWait = options.nonblocking ? sql`nowait` : sql``;
  await tx.execute(
    sql`select e.id from slots s join expert_services es on es.id=s.expert_service_id join experts e on e.id=es.expert_id where s.id=${slotId}::uuid for share of e ${noWait}`,
  );
  await tx.execute(
    sql`select es.id from slots s join expert_services es on es.id=s.expert_service_id where s.id=${slotId}::uuid for share of es ${noWait}`,
  );
  await tx.execute(
    sql`select id from slots where id=${slotId}::uuid for share ${noWait}`,
  );
}
export async function lockBookingNotificationReservation(
  tx: BookingNotificationExecutor,
  reservationId: string,
  options: BookingNotificationLockOptions = {},
) {
  const row = (
    await tx.execute<{ client: string; expert: string; slotId: string }>(
      sql`select r.user_id as client,e.user_id as expert,r.slot_id as "slotId" from reservations r join experts e on e.id=r.expert_id where r.id=${reservationId}::uuid`,
    )
  ).rows[0];
  if (row) {
    await lockBookingNotificationSubjects(
      tx,
      [row.client, row.expert],
      options,
    );
    await lockSlotAuthority(tx, row.slotId, options);
  }
}
export async function lockBookingNotificationSlot(
  tx: BookingNotificationExecutor,
  userId: string,
  slotId: string,
) {
  const row = (
    await tx.execute<{ id: string }>(
      sql`select e.user_id as id from slots s join expert_services es on es.id=s.expert_service_id join experts e on e.id=es.expert_id where s.id=${slotId}::uuid`,
    )
  ).rows[0];
  await lockBookingNotificationSubjects(tx, row ? [userId, row.id] : [userId]);
  await lockSlotAuthority(tx, slotId, {});
}
/** Origin is explicit server configuration, never a web-user-implied Telegram origin. */
export async function captureBookingNotificationContext(
  tx: BookingNotificationExecutor,
  reservationId: string,
  origin: BookingNotificationOrigin,
) {
  const row = (
    await tx.execute<{ client: string; expert: string; eligible: boolean }>(
      sql`select r.user_id as client,e.user_id as expert,(e.active and e.verified) as eligible from reservations r join experts e on e.id=r.expert_id where r.id=${reservationId}::uuid`,
    )
  ).rows[0];
  if (!row) throw new Error("notification_reservation_missing");
  const client = await resolveBookingNotificationRecipient(
    tx,
    row.client,
    origin.botKey,
  );
  const expert = row.eligible
    ? await resolveBookingNotificationRecipient(tx, row.expert, origin.botKey)
    : undefined;
  const authority = client
    ? await captureClientConsentAuthority(tx, {
        subjectId: row.client,
        botKey: origin.botKey,
        chatId: client.externalChatId,
        externalUserId: client.externalUserId,
        messagingPolicyVersion: origin.messagingPolicyVersion,
      })
    : undefined;
  await tx.execute(sql`insert into booking_notification_contexts(reservation_id,bot_key,client_user_id,expert_user_id,client_identity_id,client_original_identity_id,client_external_user_id,client_external_chat_id,client_unavailable_reason,expert_identity_id,expert_original_identity_id,expert_external_user_id,expert_external_chat_id,expert_unavailable_reason,client_consent_authority)
    values(${reservationId}::uuid,${origin.botKey},${row.client}::uuid,${row.expert}::uuid,
    ${client?.identityId ?? null}::uuid,${client?.identityId ?? null}::uuid,${client?.externalUserId ?? null},${client?.externalChatId ?? null},${client ? null : "recipient_unavailable"},
    ${expert?.identityId ?? null}::uuid,${expert?.identityId ?? null}::uuid,${expert?.externalUserId ?? null},${expert?.externalChatId ?? null},${expert ? null : "recipient_unavailable"},${authority ? JSON.stringify(authority) : null}::jsonb)
    on conflict(reservation_id) do nothing`);
}
export async function validateBookingNotificationConsent(
  tx: BookingNotificationExecutor,
  raw: unknown,
  userId: string,
) {
  const parsed = clientConsentAuthoritySchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.subjectId !== userId ||
    parsed.data.purposes.selarti_ai_processing
  )
    return false;
  const original = parsed.data.purposes.client_messaging;
  const rows = (
    await tx.execute<{ decisionId: string; revision: string }>(
      originalClientConsentSql(userId, "client_messaging"),
    )
  ).rows;
  return (
    rows.length === 1 &&
    rows[0]?.decisionId === original.decisionId &&
    rows[0]?.revision === original.revision
  );
}
