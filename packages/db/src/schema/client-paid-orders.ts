import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { messageLedgerEntries, messagePackages } from "./billing.js";

export const clientPaidOrders = pgTable(
  "client_paid_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    packageCode: text("package_code").notNull(),
    policyVersion: text("policy_version").notNull(),
    currency: text("currency").notNull(),
    priceMinor: bigint("price_minor", { mode: "bigint" }).notNull(),
    units: integer("units").notNull(),
    couponGrantMinor: bigint("coupon_grant_minor", {
      mode: "bigint",
    }).notNull(),
    mode: text("mode").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("client_paid_orders_user_key_unique").on(t.userId, t.idempotencyKey),
    check(
      "client_paid_orders_terms",
      sql`${t.policyVersion} = 'client_paid_v1' and ${t.currency} = 'RUB' and ${t.couponGrantMinor} = ${t.priceMinor} * 2 and (
    (${t.packageCode} = 'start' and ${t.priceMinor} = 499900 and ${t.units} = 500) or
    (${t.packageCode} = 'base' and ${t.priceMinor} = 599900 and ${t.units} = 1000) or
    (${t.packageCode} = 'deep' and ${t.priceMinor} = 799900 and ${t.units} = 1500) or
    (${t.packageCode} = 'maximum' and ${t.priceMinor} = 1099000 and ${t.units} = 2000))`,
    ),
    check("client_paid_orders_mode", sql`${t.mode} in ('live', 'test')`),
    check(
      "client_paid_orders_key",
      sql`${t.idempotencyKey} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'`,
    ),
    check("client_paid_orders_created_finite", sql`isfinite(${t.createdAt})`),
  ],
);

export const clientPaidPaymentBindings = pgTable(
  "client_paid_payment_bindings",
  {
    orderId: uuid("order_id")
      .primaryKey()
      .references(() => clientPaidOrders.id),
    providerPaymentId: text("provider_payment_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("client_paid_bindings_payment_unique").on(t.providerPaymentId),
    unique("client_paid_bindings_order_payment_unique").on(
      t.orderId,
      t.providerPaymentId,
    ),
    check(
      "client_paid_bindings_payment_id",
      sql`${t.providerPaymentId} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'`,
    ),
  ],
);

export const clientCouponGrants = pgTable(
  "client_coupon_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => clientPaidOrders.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    capturedAt: timestamp("captured_at", {
      withTimezone: true,
      precision: 3,
    }).notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      precision: 3,
    }).notNull(),
  },
  (t) => [
    unique("client_coupon_grants_order_unique").on(t.orderId),
    unique("client_coupon_grants_order_id_unique").on(t.orderId, t.id),
    check("client_coupon_grants_positive", sql`${t.amountMinor} > 0`),
    check(
      "client_coupon_grants_expiry",
      sql`isfinite(${t.capturedAt}) and isfinite(${t.expiresAt}) and ${t.expiresAt} = ${t.capturedAt} + interval '1080 hours'`,
    ),
  ],
);

export const clientPaidSettlements = pgTable(
  "client_paid_settlements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id").notNull(),
    providerPaymentId: text("provider_payment_id").notNull(),
    packageId: uuid("package_id")
      .notNull()
      .references(() => messagePackages.id),
    ledgerEntryId: uuid("ledger_entry_id")
      .notNull()
      .references(() => messageLedgerEntries.id),
    couponGrantId: uuid("coupon_grant_id").notNull(),
    capturedAt: timestamp("captured_at", {
      withTimezone: true,
      precision: 3,
    }).notNull(),
  },
  (t) => [
    unique("client_paid_settlements_order_unique").on(t.orderId),
    unique("client_paid_settlements_package_unique").on(t.packageId),
    unique("client_paid_settlements_ledger_unique").on(t.ledgerEntryId),
    unique("client_paid_settlements_coupon_unique").on(t.couponGrantId),
    foreignKey({
      name: "client_paid_settlements_binding_fk",
      columns: [t.orderId, t.providerPaymentId],
      foreignColumns: [
        clientPaidPaymentBindings.orderId,
        clientPaidPaymentBindings.providerPaymentId,
      ],
    }),
    foreignKey({
      name: "client_paid_settlements_coupon_fk",
      columns: [t.orderId, t.couponGrantId],
      foreignColumns: [clientCouponGrants.orderId, clientCouponGrants.id],
    }),
    check(
      "client_paid_settlements_captured_finite",
      sql`isfinite(${t.capturedAt})`,
    ),
  ],
);
