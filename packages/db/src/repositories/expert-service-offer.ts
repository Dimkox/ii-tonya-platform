import {
  ExpertServiceOfferInvalidError,
  parseExpertServiceOffer,
  type ExpertServiceFormat,
  type ExpertServiceOffer,
} from "@ii-tonya/contracts";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface ExpertServiceOfferPatch {
  readonly priceMinor?: number | null;
  readonly format?: ExpertServiceFormat | null;
  readonly location?: string | null;
}

type OfferRow = {
  priceMinor: number | string | null;
  currency: string | null;
  format: string | null;
  location: string | null;
};

export class PostgresExpertServiceOfferRepository {
  constructor(private readonly db: Pick<DrizzleDb, "execute">) {}

  async read(serviceId: string): Promise<ExpertServiceOffer | null> {
    const id = canonical(serviceId);
    const row = (
      await this.db.execute<OfferRow>(sql`
        select price_minor as "priceMinor", currency, format, location
        from expert_services where id = ${id}::uuid
      `)
    ).rows[0];
    if (row === undefined) return null;
    return parseExpertServiceOffer(row);
  }

  /** Merges the patch onto the current row, then rejects an invalid offer. */
  async updateOffer(
    serviceId: string,
    patch: ExpertServiceOfferPatch,
  ): Promise<"updated" | "missing"> {
    const id = canonical(serviceId);
    const current = await this.read(id);
    if (current === null) return "missing";
    const next = parseExpertServiceOffer({
      priceMinor:
        patch.priceMinor !== undefined ? patch.priceMinor : current.priceMinor,
      currency: "RUB",
      format: patch.format !== undefined ? patch.format : current.format,
      location:
        patch.location !== undefined ? patch.location : current.location,
    });
    const updated = await this.db.execute<{ id: string }>(sql`
      update expert_services
      set price_minor = ${next.priceMinor},
          currency = ${next.currency},
          format = ${next.format},
          location = ${next.location},
          updated_at = clock_timestamp()
      where id = ${id}::uuid
      returning id
    `);
    return updated.rows.length === 1 ? "updated" : "missing";
  }
}

const canonical = (serviceId: string): string => {
  if (!UUID.test(serviceId))
    throw new ExpertServiceOfferInvalidError("service");
  return serviceId.toLowerCase();
};
