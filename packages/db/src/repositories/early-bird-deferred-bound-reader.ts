import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { requireDeferredPrincipal } from "./early-bird-deferred-principal.js";

/** Opaque binding lookup; caller must re-authorize before any user-facing delivery. */
export class PostgresDeferredBoundReader {
  constructor(
    private readonly db: DrizzleDb,
    private readonly expectedLogin: string,
  ) {}
  async find(
    invoiceId: string,
  ): Promise<{ invoiceId: string; userId: string; providerId: string } | null> {
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
        "ii_tonya_deferred_bound_reader",
        "public.early_bird_deferred_read_bound(uuid)",
      );
      const row = (
        await tx.execute<{
          data: {
            invoiceId: string;
            userId: string;
            providerId: string;
          } | null;
        }>(
          sql`select early_bird_deferred_read_bound(${invoiceId}::uuid) as data`,
        )
      ).rows[0]?.data;
      if (!row) return null;
      if (
        row.invoiceId !== invoiceId ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
          row.userId,
        ) ||
        !/^[A-Za-z0-9_-]{1,64}$/u.test(row.providerId)
      )
        throw new Error("early_bird_deferred_bound_reader_invalid");
      return row;
    });
  }
}
