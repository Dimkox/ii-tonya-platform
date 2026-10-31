import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { requireDeferredPrincipal } from "./early-bird-deferred-principal.js";

/** Isolated notification routing only; this is not evidence that payment succeeded. */
export class PostgresDeferredPaymentRouteReader {
  constructor(
    private readonly db: DrizzleDb,
    private readonly expectedLogin: string,
  ) {}
  async findByProviderPayment(
    providerId: string,
  ): Promise<{ invoiceId: string; providerId: string } | null> {
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(providerId)) return null;
    return this.db.transaction(async (tx) => {
      await requireDeferredPrincipal(
        tx,
        this.expectedLogin,
        "ii_tonya_deferred_payment_route_reader",
        "public.early_bird_deferred_payment_lookup(text)",
      );
      const value = (
        await tx.execute<{ data: unknown }>(
          sql`select early_bird_deferred_payment_lookup(${providerId}) as data`,
        )
      ).rows[0]?.data;
      if (value == null) return null;
      if (typeof value !== "object" || Array.isArray(value))
        throw new Error("early_bird_deferred_payment_route_invalid");
      const row = value as Record<string, unknown>;
      if (
        Object.keys(row).sort().join(",") !== "invoiceId,providerId" ||
        row.providerId !== providerId ||
        typeof row.invoiceId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
          row.invoiceId,
        )
      )
        throw new Error("early_bird_deferred_payment_route_invalid");
      return { invoiceId: row.invoiceId, providerId };
    });
  }
}
