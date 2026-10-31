import { sql } from "drizzle-orm";
import {
  parseDeferredSnapshot,
  type DeferredSnapshot,
} from "@ii-tonya/integrations";
import type { DrizzleDb } from "../client.js";
import { requireDeferredPrincipal } from "./early-bird-deferred-principal.js";

/** An isolated reader exposes only the immutable non-contact invoice snapshot. */
export class PostgresDeferredSnapshotReader {
  constructor(
    private readonly db: DrizzleDb,
    private readonly expectedLogin: string,
  ) {}
  async findInvoice(invoiceId: string): Promise<DeferredSnapshot | null> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
        invoiceId,
      )
    )
      return null;
    return this.db.transaction(async (tx) => {
      await requireDeferredPrincipal(
        tx,
        this.expectedLogin,
        "ii_tonya_deferred_invoice_reader",
        "public.early_bird_deferred_read_invoice(uuid)",
      );
      const raw = (
        await tx.execute<{ data: unknown }>(
          sql`select early_bird_deferred_read_invoice(${invoiceId}::uuid) as data`,
        )
      ).rows[0]?.data;
      if (raw == null) return null;
      const value = parseDeferredSnapshot(raw);
      if (value.invoiceId !== invoiceId)
        throw new Error("early_bird_deferred_reader_mismatch");
      return value;
    });
  }
}
