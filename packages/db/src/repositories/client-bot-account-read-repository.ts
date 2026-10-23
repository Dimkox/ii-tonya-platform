import { sql } from "drizzle-orm";
import type {
  ClientBotAccountEvent,
  ClientBotAccountProjection,
  ClientBotAccountReadRepository,
} from "@ii-tonya/contracts";
import type { DrizzleDb } from "../client.js";
import {
  recordClientIngressInTransaction,
  clientIngressEventKey,
} from "./client-ingress-replay-repository.js";
import {
  lockClientConsentSubject,
  captureClientConsentAuthority,
} from "./client-consent-authority.js";
import { readOwnedActiveBookingsInTransaction } from "./booking-repository.js";
const instant = (v: Date | string) => {
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) throw Error("invalid_projection");
  return d.toISOString();
};
type Settings = {
  botId: string;
  botKey: string;
  messagingConsentPolicyVersion: string;
  providerMode: "test" | "live";
};
export class PostgresClientBotAccountReadRepository implements ClientBotAccountReadRepository {
  private readonly config: Readonly<Settings>;
  constructor(
    private readonly db: DrizzleDb,
    config: Settings,
  ) {
    config = { ...config };
    this.config = Object.freeze(config);
    if (
      typeof config.botId !== "string" ||
      typeof config.botKey !== "string" ||
      typeof config.messagingConsentPolicyVersion !== "string" ||
      !/^[1-9]\d{0,15}$/.test(config.botId) ||
      !Number.isSafeInteger(Number(config.botId)) ||
      !config.botKey ||
      !config.messagingConsentPolicyVersion ||
      !["test", "live"].includes(config.providerMode)
    )
      throw Error("client_account_configuration_invalid");
  }
  async read(raw: ClientBotAccountEvent): Promise<ClientBotAccountProjection> {
    const query = { ...raw.query };
    if (
      !["coupons", "orders", "reservations"].includes(query.kind) ||
      Object.keys(query).some((k) => !["kind", "after"].includes(k)) ||
      (query.kind === "coupons" && "after" in query) ||
      (query.kind !== "coupons" &&
        query.after !== undefined &&
        !(
          typeof query.after === "string" &&
          (query.kind === "orders"
            ? /^co1\.[A-Za-z0-9_-]{43}$/
            : /^bk1\.[A-Za-z0-9_-]{43}$/
          ).test(query.after)
        ))
    )
      throw Error("client_account_cursor_invalid");
    const e = Object.freeze({ ...raw, query: Object.freeze(query) });
    clientIngressEventKey(e);
    if (
      typeof e.chatId !== "string" ||
      typeof e.telegramUserId !== "string" ||
      e.botId !== this.config.botId ||
      e.botKey !== this.config.botKey ||
      e.chatId !== e.telegramUserId ||
      !/^[1-9]\d{0,15}$/.test(e.chatId) ||
      !Number.isSafeInteger(Number(e.chatId))
    )
      throw Error("client_account_scope_invalid");
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout='2500ms'`);
      await tx.execute(sql`set local lock_timeout='500ms'`);
      const owners = (
        await tx.execute<{ userId: string }>(
          sql`select ci.user_id::text as "userId" from channel_identities ci join users u on u.id=ci.user_id and u.active where ci.provider='telegram' and ci.bot_key=${e.botKey} and ci.external_id=${e.telegramUserId} and ci.external_chat_id=${e.chatId} and ci.status='active'`,
        )
      ).rows;
      if (owners.length !== 1) return { kind: "unavailable" };
      const userId = owners[0]!.userId;
      await lockClientConsentSubject(tx, userId);
      if (
        !(await captureClientConsentAuthority(tx, {
          subjectId: userId,
          botKey: e.botKey,
          chatId: e.chatId,
          externalUserId: e.telegramUserId,
          messagingPolicyVersion: this.config.messagingConsentPolicyVersion,
        }))
      )
        return { kind: "unavailable" };
      if ((await recordClientIngressInTransaction(tx, e)) === "duplicate")
        return { kind: "duplicate" };
      if (e.query.kind === "reservations") {
        const page = await readOwnedActiveBookingsInTransaction(tx, {
          userId,
          ...(e.query.after ? { after: e.query.after as `bk1.${string}` } : {}),
        });
        if (page.kind !== "found") throw Error("client_account_cursor_invalid");
        return {
          kind: "reservations",
          bookings: page.bookings.slice(0, 20).map((b) => ({
            ...b,
            startsAt: instant(b.startsAt),
            reservedUntil:
              b.reservedUntil === null ? null : instant(b.reservedUntil),
          })),
          nextCursor:
            page.bookings.length > 20 ? page.bookings[19]!.bookingHandle : null,
        };
      }
      if (e.query.kind === "coupons") {
        const rows = (
          await tx.execute<{
            totalMinor: string;
            asOf: Date | string;
            amountMinor: string | null;
            expiresAt: Date | string | null;
            hasMore: boolean;
          }>(
            sql`with owned as materialized(select g.amount_minor,g.expires_at,g.id from client_coupon_grants g join client_paid_settlements s on s.coupon_grant_id=g.id and s.order_id=g.order_id join client_paid_orders o on o.id=g.order_id and o.user_id=g.user_id where g.user_id=${userId}::uuid and o.mode=${this.config.providerMode} and g.expires_at>statement_timestamp()), total as(select coalesce(sum(amount_minor),0)::text as value,count(*)>10 as more from owned) select total.value as "totalMinor",statement_timestamp() as "asOf",p.amount_minor::text as "amountMinor",p.expires_at as "expiresAt",total.more as "hasMore" from total left join lateral(select * from owned order by expires_at,id limit 10)p on true`,
          )
        ).rows;
        if (!rows.length || !/^(0|[1-9]\d*)$/.test(rows[0]!.totalMinor))
          throw Error("invalid_projection");
        return {
          kind: "coupons",
          coupons_balance: rows[0]!.totalMinor,
          asOf: instant(rows[0]!.asOf),
          hasMore: rows[0]!.hasMore,
          details: rows
            .filter((r) => r.amountMinor !== null)
            .map((r) => ({
              amountMinor: r.amountMinor!,
              expiresAt: instant(r.expiresAt!),
            })),
        };
      }
      const after = e.query.after;
      if (after !== undefined && !/^co1\.[A-Za-z0-9_-]{43}$/.test(after))
        throw Error("client_account_cursor_invalid");
      const rows = (
        await tx.execute<{
          anchorFound: boolean;
          handle: string | null;
          packageCode: string;
          priceMinor: string;
          createdAt: Date | string;
          state: "paid" | "unsettled";
        }>(
          sql`with owned as materialized(select o.*,('co1.'||rtrim(translate(encode(digest('client-order-v1:'||o.id::text,'sha256'),'base64'),'+/','-_'),'=')) as handle from client_paid_orders o where o.user_id=${userId}::uuid and o.mode=${this.config.providerMode}),anchor as(select created_at,id from owned where handle=${after ?? null}),authority as(select (${after === undefined} or exists(select 1 from anchor)) as valid) select authority.valid as "anchorFound",p.handle,p.package_code as "packageCode",p.price_minor::text as "priceMinor",p.created_at as "createdAt",p.state from authority left join lateral(select o.*,case when exists(select 1 from client_paid_settlements s where s.order_id=o.id)then 'paid' else 'unsettled' end as state from owned o where authority.valid and (${after === undefined} or (o.created_at,o.id)<(select created_at,id from anchor)) order by o.created_at desc,o.id desc limit 11)p on true`,
        )
      ).rows;
      if (rows[0]?.anchorFound !== true)
        throw Error("client_account_cursor_invalid");
      const items = rows.filter((r) => r.handle !== null);
      return {
        kind: "orders",
        orders: items.slice(0, 10).map((r) => ({
          handle: r.handle!,
          packageCode: r.packageCode,
          priceMinor: r.priceMinor,
          currency: "RUB",
          createdAt: instant(r.createdAt),
          state: r.state,
        })),
        nextCursor: items.length > 10 ? items[9]!.handle : null,
      };
    });
  }
}
