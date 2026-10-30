import { sql } from "drizzle-orm";
import {
  parseDeferredSnapshot,
  type DeferredSnapshot,
} from "@ii-tonya/integrations";
import type { DrizzleDb } from "../client.js";
import { requireDeferredPrincipal } from "./early-bird-deferred-principal.js";
/** Read-only, isolated lookup from provider payment ID to captured immutable snapshot. */
export class PostgresDeferredRefundReader {
  constructor(
    private readonly db: DrizzleDb,
    private readonly expectedLogin: string,
  ) {}
  async findByProviderPayment(
    providerId: string,
  ): Promise<(DeferredSnapshot & { providerId: string }) | null> {
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(providerId)) return null;
    return this.db.transaction(async (tx) => {
      await requireDeferredPrincipal(
        tx,
        this.expectedLogin,
        "ii_tonya_deferred_refund_reader",
        "public.early_bird_deferred_refund_payment(text)",
      );
      const raw = (
        await tx.execute<{ data: unknown }>(
          sql`select early_bird_deferred_refund_payment(${providerId}) as data`,
        )
      ).rows[0]?.data;
      if (raw == null) return null;
      if (typeof raw !== "object" || Array.isArray(raw))
        throw new Error("early_bird_deferred_refund_reader_invalid");
      const { providerId: found, ...rest } = raw as Record<string, unknown>;
      if (found !== providerId)
        throw new Error("early_bird_deferred_refund_reader_invalid");
      return { ...parseDeferredSnapshot(rest), providerId };
    });
  }
}
