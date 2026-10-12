import { clientPaidGrantTerms, getClientPaidPackage } from "@ii-tonya/domain";
import { and, eq, sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import {
  clientCouponGrants,
  clientPaidOrders,
  clientPaidPaymentBindings,
  clientPaidSettlements,
  messageLedgerEntries,
  messagePackages,
} from "../schema/index.js";
import { withSerializableRetry } from "./message-repository.js";

export type ClientPaidMode = "live" | "test";
export type ClientPaidOrder = typeof clientPaidOrders.$inferSelect;
export type ClientPaidPaymentBinding =
  typeof clientPaidPaymentBindings.$inferSelect;
export type ClientPaidSettlement = typeof clientPaidSettlements.$inferSelect;
export interface CreateClientPaidOrder {
  userId: string;
  packageCode: string;
  mode: ClientPaidMode;
  idempotencyKey: string;
}
export interface BindClientPaidPayment {
  orderId: string;
  providerPaymentId: string;
}
export interface SettleVerifiedClientPaidPayment extends BindClientPaidPayment {
  metadataOrderId: string;
  amountMinor: bigint;
  currency: string;
  mode: ClientPaidMode;
  status: string;
  paid: boolean;
  capturedAt: Date;
}

/** Messages are deliberately bounded and never contain caller/provider payloads. */
export class ClientPaidOrderError extends Error {
  constructor(
    readonly code:
      "CLIENT_PAID_INVALID" | "CLIENT_PAID_CONFLICT" | "CLIENT_PAID_NOT_FOUND",
  ) {
    super(code);
    this.name = "ClientPaidOrderError";
  }
}
const invalid = (): never => {
  throw new ClientPaidOrderError("CLIENT_PAID_INVALID");
};
const conflict = (): never => {
  throw new ClientPaidOrderError("CLIENT_PAID_CONFLICT");
};
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function uuid(value: string): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) return invalid();
  return value.toLowerCase();
}
function paymentId(value: string): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(value)
  )
    return invalid();
  return value;
}
function mode(value: ClientPaidMode): ClientPaidMode {
  if (value !== "live" && value !== "test") return invalid();
  return value;
}
type Transaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];

export class PostgresClientPaidOrderRepository {
  constructor(private readonly db: DrizzleDb) {}

  private transaction<T>(run: (tx: Transaction) => Promise<T>): Promise<T> {
    return withSerializableRetry(() =>
      this.db.transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level serializable`);
        return run(tx);
      }),
    );
  }

  async createOrder(input: CreateClientPaidOrder): Promise<ClientPaidOrder> {
    const userId = uuid(input.userId);
    const orderMode = mode(input.mode);
    const key = input.idempotencyKey;
    if (
      typeof key !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(key)
    )
      invalid();
    let terms: ReturnType<typeof getClientPaidPackage>;
    try {
      terms = getClientPaidPackage(input.packageCode);
    } catch {
      return invalid();
    }
    return this.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(clientPaidOrders)
        .values({
          userId,
          packageCode: terms.code,
          policyVersion: terms.policyVersion,
          currency: terms.currency,
          priceMinor: terms.priceMinor,
          units: terms.units,
          couponGrantMinor: terms.couponGrantMinor,
          mode: orderMode,
          idempotencyKey: key,
        })
        .onConflictDoNothing({
          target: [clientPaidOrders.userId, clientPaidOrders.idempotencyKey],
        })
        .returning();
      if (inserted) return inserted;
      const [existing] = await tx
        .select()
        .from(clientPaidOrders)
        .where(
          and(
            eq(clientPaidOrders.userId, userId),
            eq(clientPaidOrders.idempotencyKey, key),
          ),
        );
      if (
        !existing ||
        existing.packageCode !== terms.code ||
        existing.mode !== orderMode
      )
        return conflict();
      return existing;
    });
  }

  async bindPayment(
    input: BindClientPaidPayment,
  ): Promise<ClientPaidPaymentBinding> {
    const orderId = uuid(input.orderId);
    const providerPaymentId = paymentId(input.providerPaymentId);
    return this.transaction(async (tx) => {
      await this.lockOrder(tx, orderId);
      const [inserted] = await tx
        .insert(clientPaidPaymentBindings)
        .values({ orderId, providerPaymentId })
        .onConflictDoNothing()
        .returning();
      if (inserted) return inserted;
      const [existing] = await tx
        .select()
        .from(clientPaidPaymentBindings)
        .where(eq(clientPaidPaymentBindings.orderId, orderId));
      if (!existing || existing.providerPaymentId !== providerPaymentId)
        return conflict();
      return existing;
    });
  }

  /** Trusted boundary: caller must retrieve/authenticate provider truth first. No webhook authentication here. */
  async settleVerifiedPayment(
    input: SettleVerifiedClientPaidPayment,
  ): Promise<ClientPaidSettlement> {
    // Copy primitives and Date before the first await so callers cannot mutate verification mid-transaction/retry.
    const orderId = uuid(input.orderId);
    const metadataOrderId = uuid(input.metadataOrderId);
    const providerPaymentId = paymentId(input.providerPaymentId);
    const paymentMode = mode(input.mode);
    const { amountMinor, currency, status, paid } = input;
    if (
      typeof amountMinor !== "bigint" ||
      amountMinor <= 0n ||
      amountMinor > 9223372036854775807n ||
      typeof currency !== "string" ||
      currency.length > 3 ||
      typeof status !== "string" ||
      status.length > 32 ||
      typeof paid !== "boolean" ||
      !(input.capturedAt instanceof Date) ||
      !Number.isFinite(input.capturedAt.getTime())
    )
      invalid();
    const capturedAt = new Date(input.capturedAt.getTime());
    // Also rejects valid JS timestamps whose entitlement expiry would overflow.
    try {
      clientPaidGrantTerms("start", capturedAt);
    } catch {
      return invalid();
    }
    return this.transaction(async (tx) => {
      const order = await this.lockOrder(tx, orderId);
      const [binding] = await tx
        .select()
        .from(clientPaidPaymentBindings)
        .where(eq(clientPaidPaymentBindings.orderId, orderId));
      if (
        order.mode !== "live" ||
        paymentMode !== "live" ||
        metadataOrderId !== orderId ||
        binding?.providerPaymentId !== providerPaymentId ||
        amountMinor !== order.priceMinor ||
        currency !== order.currency ||
        status !== "succeeded" ||
        paid !== true ||
        capturedAt.getTime() < order.createdAt.getTime()
      )
        return conflict();
      const [existing] = await tx
        .select()
        .from(clientPaidSettlements)
        .where(eq(clientPaidSettlements.orderId, orderId));
      if (existing) {
        if (existing.capturedAt.getTime() !== capturedAt.getTime())
          return conflict();
        return existing;
      }
      const terms = clientPaidGrantTerms(order.packageCode, capturedAt);
      const key = `client-paid:${orderId}`;
      const [messagePackage] = await tx
        .insert(messagePackages)
        .values({
          userId: order.userId,
          grantedMessages: order.units,
          grantIdempotencyKey: key,
          kind: "paid",
          grantedAt: capturedAt,
          expiresAt: terms.packageExpiresAt,
        })
        // A concurrent committed grant forces a serializable retry; a pre-existing
        // unmatched grant is a conflict, never authority to manufacture settlement.
        .onConflictDoNothing({ target: messagePackages.grantIdempotencyKey })
        .returning();
      if (!messagePackage) return conflict();
      const [ledger] = await tx
        .insert(messageLedgerEntries)
        .values({
          packageId: messagePackage.id,
          entryKind: "grant",
          delta: order.units,
          idempotencyKey: key,
        })
        .returning();
      const [coupon] = await tx
        .insert(clientCouponGrants)
        .values({
          orderId,
          userId: order.userId,
          amountMinor: order.couponGrantMinor,
          capturedAt,
          expiresAt: terms.couponExpiresAt,
        })
        .returning();
      if (!ledger || !coupon) return conflict();
      const [settlement] = await tx
        .insert(clientPaidSettlements)
        .values({
          orderId,
          providerPaymentId,
          packageId: messagePackage.id,
          ledgerEntryId: ledger.id,
          couponGrantId: coupon.id,
          capturedAt,
        })
        .returning();
      if (!settlement) return conflict();
      return settlement;
    });
  }

  private async lockOrder(
    tx: Transaction,
    orderId: string,
  ): Promise<ClientPaidOrder> {
    const [order] = await tx
      .select()
      .from(clientPaidOrders)
      .where(eq(clientPaidOrders.id, orderId))
      .for("update");
    if (!order) throw new ClientPaidOrderError("CLIENT_PAID_NOT_FOUND");
    return order;
  }
}
