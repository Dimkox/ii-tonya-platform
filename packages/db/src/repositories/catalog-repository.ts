import { sql, type SQL } from "drizzle-orm";

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
  readonly serviceTitle?: string;
  readonly language: string;
  readonly slotId: string;
  readonly slotStartsAt: Date;
}

export interface BookingAwareAvailabilitySlot {
  readonly localSlotId: string;
  readonly sourceOrder: string;
  readonly startsAt: Date;
  readonly observedAt: Date | null;
  readonly nativeValidUntil?: Date;
  readonly remainingCapacity: number;
}

export interface PublicCatalogServiceRecord extends Record<string, unknown> {
  readonly sourceKey: string;
  readonly displayName: string;
  readonly serviceCode: string;
  readonly serviceTitle?: string;
  readonly language: string;
}

type RawCatalogExpertRecord = Omit<CatalogExpertRecord, "slotStartsAt"> & {
  slotStartsAt: Date | string;
};

const MAX_RESULTS = 500;
const providerEligible = sql`(s.provider <> 'planerka' or exists (
  select 1 from planerka_service_mappings m
  where m.expert_service_id=s.expert_service_id and m.enabled
    and m.verified_at<=clock_timestamp() and m.duration_minutes=es.duration_minutes
    and extract(epoch from (s.ends_at-s.starts_at))=m.duration_minutes*60
    and s.capacity=1
))`;
// Same-slot occupancy continues to respect capacity. Other slots/services for
// this expert conflict by actual interval, independently of their provider.
const noExpertOverlap = (now: Date) => sql`not exists (
  select 1 from reservations occupied join slots booked_slot on booked_slot.id=occupied.slot_id
  where occupied.expert_id=e.id and occupied.slot_id<>s.id
    and (occupied.status='booked' or (occupied.status='reserved' and occupied.reserved_until>${now}))
    and booked_slot.starts_at<coalesce((select occupied_until from resident_native_slots where slot_id=s.id),s.ends_at)
    and coalesce((select occupied_until from resident_native_slots where slot_id=booked_slot.id),booked_slot.ends_at)>s.starts_at
)`;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const finiteDate = (value: Date): boolean =>
  value instanceof Date && Number.isFinite(value.getTime());

/** Current archive/pause authority is checked on every read, before worker projection. */
export const currentExpertResidencyVisibleSql = (userId: SQL): SQL => sql`
  not exists (
    select 1 from expert_onboarding_applications archive
    where archive.user_id=${userId}
      and (archive.archived_at is not null or archive.archive_until_date is not null)
  ) and not exists (
    select 1 from expert_residency_lifecycle lifecycle
    where lifecycle.user_id=${userId} and lifecycle.status='paused'
  ) and (not exists(select 1 from expert_onboarding_applications a where a.user_id=${userId}) or exists(select 1 from experts_published resident_publication join experts resident_expert on resident_expert.id=resident_publication.expert_id where resident_publication.user_id=${userId} and resident_publication.active and expert_card_activation_gate_valid(resident_publication.user_id,resident_publication.review_id) and exists(select 1 from expert_residency_current_coverage(resident_expert.id))))
`;

export class PostgresCatalogRepository {
  constructor(private readonly db: Pick<DrizzleDb, "execute">) {}

  async listPublicServices(input: {
    serviceCode?: string;
    language?: string;
    limit: number;
  }): Promise<readonly PublicCatalogServiceRecord[]> {
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 20
    ) {
      throw new Error("Invalid public catalog limit");
    }
    const serviceCode = input.serviceCode ?? null;
    const language = input.language ?? null;
    const result = await this.db.execute<PublicCatalogServiceRecord>(sql`
      select
        es.id as "sourceKey",
        coalesce(nullif(e.public_display_name, ''), 'Эксперт') as "displayName",
        es.code as "serviceCode",
        (case when exists(select 1 from resident_service_mappings m where m.expert_service_id=es.id) then es.name else null end) as "serviceTitle",
        es.language
      from expert_services es
      join experts e on e.id = es.expert_id
      where e.active = true
        and e.verified = true
        and (${currentExpertResidencyVisibleSql(sql`e.user_id`)})
        and es.active = true
        and es.code is not null
        and es.language is not null
        and (${serviceCode}::text is null or es.code = ${serviceCode})
        and (${language}::text is null or es.language = ${language})
      order by es.code,es.language,
        coalesce(nullif(e.public_display_name, ''), 'Эксперт'),e.id,es.id
      limit ${input.limit}
    `);
    return result.rows.map((row) => {
      if (row.serviceTitle === null) {
        const legacy = { ...row };
        delete legacy.serviceTitle;
        return legacy;
      }
      return row;
    });
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
      Math.max(input.from.getTime(), input.now.getTime() + input.minimumLeadMs),
    );
    const result = await this.db.execute<RawCatalogExpertRecord>(sql`
      select
        e.id as "expertId",
        coalesce(nullif(e.public_display_name, ''), 'Эксперт') as "displayName",
        es.code as "serviceCode",
        (case when exists(select 1 from resident_service_mappings m where m.expert_service_id=es.id) then es.name else null end) as "serviceTitle",
        es.language,
        s.id as "slotId",
        s.starts_at as "slotStartsAt"
      from slots s
      join expert_services es on es.id = s.expert_service_id
      join experts e on e.id = es.expert_id
      where e.active = true
        and e.verified = true
        and (${currentExpertResidencyVisibleSql(sql`e.user_id`)})
        and es.active = true
        and es.code is not null
        and es.language is not null
        and (${serviceCode}::text is null or es.code = ${serviceCode})
        and (${language}::text is null or es.language = ${language})
        and resident_slot_fresh(s.id,${input.now})
        and ${providerEligible}
        and ${noExpertOverlap(input.now)}
        and s.ends_at>s.starts_at and s.capacity>0
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

  async read(input: { sourceKey: string; databaseNow: Date }): Promise<
    | Readonly<{
        kind: "complete";
        slots: readonly BookingAwareAvailabilitySlot[];
      }>
    | Readonly<{ kind: "unavailable" }>
  > {
    if (!UUID_PATTERN.test(input.sourceKey) || !finiteDate(input.databaseNow)) {
      return { kind: "unavailable" };
    }
    const result = await this.db.execute<{
      localSlotId: string;
      startsAt: Date | string;
      observedAt: Date | string | null;
      nativeValidUntil: Date | string | null;
      remainingCapacity: number | string;
    }>(sql`
      select s.id as "localSlotId",s.starts_at as "startsAt",
        s.observed_at as "observedAt",
        (select sv.valid_until from resident_native_slots n join resident_schedule_versions sv on sv.id=n.schedule_id where n.slot_id=s.id and resident_native_slot_valid(s.id,${input.databaseNow})) as "nativeValidUntil",
        (s.capacity-count(r.id))::int as "remainingCapacity"
      from slots s
      join expert_services es on es.id=s.expert_service_id
      join experts e on e.id=es.expert_id
      left join reservations r on r.slot_id=s.id and (
        r.status='booked' or
        (r.status='reserved' and r.reserved_until>${input.databaseNow})
      )
      where s.expert_service_id=${input.sourceKey}::uuid
        and e.active and e.verified and es.active
        and resident_slot_fresh(s.id,${input.databaseNow})
        and s.starts_at>=${new Date(input.databaseNow.getTime() + 86400000)}
        and s.ends_at>s.starts_at and s.capacity>0
        and ${providerEligible}
        and ${noExpertOverlap(input.databaseNow)}
        and not exists(select 1 from resident_schedule_busy b where b.expert_id=e.id and b.starts_at<s.ends_at and b.ends_at>s.starts_at)
        and (${currentExpertResidencyVisibleSql(sql`e.user_id`)})
      group by s.id,s.starts_at,s.observed_at,s.capacity
      having s.capacity>count(r.id)
      order by s.starts_at,s.id
      limit ${MAX_RESULTS}
    `);
    const slots: BookingAwareAvailabilitySlot[] = [];
    for (const row of result.rows) {
      const startsAt =
        row.startsAt instanceof Date ? row.startsAt : new Date(row.startsAt);
      const observedAt =
        row.observedAt instanceof Date
          ? row.observedAt
          : row.observedAt === null
            ? null
            : new Date(row.observedAt);
      const nativeValidUntil =
        row.nativeValidUntil == null
          ? undefined
          : new Date(row.nativeValidUntil);
      const remainingCapacity = Number(row.remainingCapacity);
      if (
        !finiteDate(startsAt) ||
        (nativeValidUntil === undefined
          ? observedAt === null || !finiteDate(observedAt)
          : !finiteDate(nativeValidUntil)) ||
        !Number.isSafeInteger(remainingCapacity)
      ) {
        return { kind: "unavailable" };
      }
      slots.push({
        localSlotId: row.localSlotId,
        sourceOrder: row.localSlotId,
        startsAt,
        observedAt,
        ...(nativeValidUntil ? { nativeValidUntil } : {}),
        remainingCapacity,
      });
    }
    return { kind: "complete", slots };
  }
}
