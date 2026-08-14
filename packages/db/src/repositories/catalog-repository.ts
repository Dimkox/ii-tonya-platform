import { sql } from "drizzle-orm";

import type { DrizzleDb } from "../client.js";

export interface CatalogEligibilityQuery {
  readonly serviceCode?: string;
  readonly language?: string;
  readonly from: Date;
  readonly to: Date;
  readonly now: Date;
  readonly minimumLeadMs: number;
  readonly requireExpertActive: true;
  readonly requireExpertVerified: true;
  readonly requireServiceActive: true;
}

export interface CatalogExpertRecord {
  readonly expertId: string;
  readonly displayName: string;
  readonly serviceCode: string;
  readonly language: string;
  readonly slotId: string;
  readonly slotStartsAt: Date;
}

export interface PublicCatalogServiceRecord extends Record<string, unknown> {
  readonly sourceKey: string;
  readonly displayName: string;
  readonly serviceCode: string;
  readonly language: string;
}

type RawCatalogExpertRecord = Omit<CatalogExpertRecord, "slotStartsAt"> & {
  slotStartsAt: Date | string;
};

const SLOT_FRESHNESS_MS = 15 * 60 * 1_000;
const MAX_RESULTS = 500;

const finiteDate = (value: Date): boolean =>
  value instanceof Date && Number.isFinite(value.getTime());

export class PostgresCatalogRepository {
  constructor(private readonly db: DrizzleDb) {}

  async listPublicServices(input: {
    serviceCode?: string;
    language?: string;
    limit: number;
  }): Promise<readonly PublicCatalogServiceRecord[]> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 20) {
      throw new Error("Invalid public catalog limit");
    }
    const serviceCode = input.serviceCode ?? null;
    const language = input.language ?? null;
    const result = await this.db.execute<PublicCatalogServiceRecord>(sql`
      select
        es.id as "sourceKey",
        coalesce(nullif(e.public_display_name, ''), 'Эксперт') as "displayName",
        es.code as "serviceCode",
        es.language
      from expert_services es
      join experts e on e.id = es.expert_id
      where e.active = true
        and e.verified = true
        and es.active = true
        and es.code is not null
        and es.language is not null
        and (${serviceCode}::text is null or es.code = ${serviceCode})
        and (${language}::text is null or es.language = ${language})
      order by es.code,es.language,
        coalesce(nullif(e.public_display_name, ''), 'Эксперт'),e.id,es.id
      limit ${input.limit}
    `);
    return result.rows;
  }

  async findEligible(
    input: CatalogEligibilityQuery,
  ): Promise<readonly CatalogExpertRecord[]> {
    if (
      !finiteDate(input.from) ||
      !finiteDate(input.to) ||
      !finiteDate(input.now) ||
      input.from.getTime() >= input.to.getTime() ||
      !Number.isFinite(input.minimumLeadMs) ||
      input.minimumLeadMs < 0 ||
      input.requireExpertActive !== true ||
      input.requireExpertVerified !== true ||
      input.requireServiceActive !== true
    ) {
      throw new Error("Invalid catalog eligibility query");
    }
    const serviceCode = input.serviceCode ?? null;
    const language = input.language ?? null;
    const earliest = new Date(
      Math.max(
        input.from.getTime(),
        input.now.getTime() + input.minimumLeadMs,
      ),
    );
    const freshAfter = new Date(
      input.now.getTime() - SLOT_FRESHNESS_MS,
    );
    const result = await this.db.execute<RawCatalogExpertRecord>(sql`
      select
        e.id as "expertId",
        coalesce(nullif(e.public_display_name, ''), 'Эксперт') as "displayName",
        es.code as "serviceCode",
        es.language,
        s.id as "slotId",
        s.starts_at as "slotStartsAt"
      from slots s
      join expert_services es on es.id = s.expert_service_id
      join experts e on e.id = es.expert_id
      where e.active = true
        and e.verified = true
        and es.active = true
        and es.code is not null
        and es.language is not null
        and (${serviceCode}::text is null or es.code = ${serviceCode})
        and (${language}::text is null or es.language = ${language})
        and s.observed_at >= ${freshAfter}
        and s.observed_at <= ${input.now}
        and s.starts_at >= ${earliest}
        and s.starts_at < ${input.to}
        and (
          select count(*)
          from reservations r
          where r.slot_id = s.id
            and (
              r.status = 'booked'
              or (r.status = 'reserved' and r.reserved_until > ${input.now})
            )
        ) < s.capacity
      order by e.id, es.code, es.language, s.starts_at, s.id
      limit ${MAX_RESULTS}
    `);
    return result.rows.map((row) => {
      const slotStartsAt =
        row.slotStartsAt instanceof Date
          ? row.slotStartsAt
          : new Date(row.slotStartsAt);
      if (!finiteDate(slotStartsAt)) {
        throw new Error("Catalog repository returned an invalid timestamp");
      }
      return { ...row, slotStartsAt };
    });
  }
}
