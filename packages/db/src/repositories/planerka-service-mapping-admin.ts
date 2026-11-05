/**
 * SCRUM-519: operator management of planerka_service_mappings.
 *
 * No IDs are seeded. The operator supplies a JSON file with real expert
 * service UUIDs and Planerka event type IDs. Duration always comes from
 * expert_services, so the mapping cannot drift from the service.
 * The worker preflight still checks every enabled mapping against the
 * Planerka API (owner, duration, timezone) before CREATE is admitted.
 */
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface PlanerkaServiceMappingInput {
  readonly expertServiceId: string;
  readonly eventTypeId: number;
  readonly timeZone: string;
  readonly enabled: boolean;
}

export interface PlanerkaServiceMappingFile {
  readonly accountId: number;
  readonly mappings: readonly PlanerkaServiceMappingInput[];
}

export type PlanerkaServiceMappingRow = {
  readonly expertServiceId: string;
  readonly accountId: number;
  readonly eventTypeId: number;
  readonly durationMinutes: number;
  readonly timeZone: string;
  readonly enabled: boolean;
  readonly verifiedAt: string;
};

const positiveInt = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value > 0 &&
  value <= 2_147_483_647;

const validTimeZone = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length < 1 || value.length > 128)
    return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

/** Strict parser; throws planerka_mapping_file_invalid:<reason>. */
export const parsePlanerkaServiceMappingFile = (
  raw: unknown,
  expectedAccountId?: number,
): PlanerkaServiceMappingFile => {
  const fail = (reason: string): never => {
    throw new Error(`planerka_mapping_file_invalid:${reason}`);
  };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return fail("root");
  const root = raw as Record<string, unknown>;
  const extra = Object.keys(root).filter(
    (key) => key !== "accountId" && key !== "mappings",
  );
  if (extra.length) return fail("unknown_field");
  if (!positiveInt(root.accountId)) return fail("account_id");
  if (expectedAccountId !== undefined && root.accountId !== expectedAccountId)
    return fail("account_mismatch");
  if (!Array.isArray(root.mappings) || root.mappings.length === 0)
    return fail("mappings");
  const seenServices = new Set<string>();
  const seenEventTypes = new Set<number>();
  const mappings = root.mappings.map((item: unknown, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item))
      return fail(`mapping_${index}`);
    const m = item as Record<string, unknown>;
    const allowed = ["expertServiceId", "eventTypeId", "timeZone", "enabled"];
    if (Object.keys(m).some((key) => !allowed.includes(key)))
      return fail(`mapping_${index}_unknown_field`);
    if (typeof m.expertServiceId !== "string" || !UUID.test(m.expertServiceId))
      return fail(`mapping_${index}_expert_service_id`);
    if (!positiveInt(m.eventTypeId))
      return fail(`mapping_${index}_event_type_id`);
    if (!validTimeZone(m.timeZone)) return fail(`mapping_${index}_time_zone`);
    if (m.enabled !== undefined && typeof m.enabled !== "boolean")
      return fail(`mapping_${index}_enabled`);
    const expertServiceId = m.expertServiceId.toLowerCase();
    if (seenServices.has(expertServiceId))
      return fail(`mapping_${index}_duplicate_service`);
    if (seenEventTypes.has(m.eventTypeId))
      return fail(`mapping_${index}_duplicate_event_type`);
    seenServices.add(expertServiceId);
    seenEventTypes.add(m.eventTypeId);
    return {
      expertServiceId,
      eventTypeId: m.eventTypeId,
      timeZone: m.timeZone,
      enabled: m.enabled ?? true,
    };
  });
  return { accountId: root.accountId, mappings };
};

export type PlanerkaCandidateServiceRow = {
  readonly expertServiceId: string;
  readonly expertId: string;
  readonly durationMinutes: number;
  readonly active: boolean;
};

export type PlanerkaMappingPlanAction = "insert" | "update" | "unchanged";

export interface PlanerkaMappingPlanEntry {
  readonly expertServiceId: string;
  readonly action: PlanerkaMappingPlanAction;
  readonly durationMinutes: number;
}

const projection = sql`m.expert_service_id as "expertServiceId",m.account_id as "accountId",m.event_type_id as "eventTypeId",m.duration_minutes as "durationMinutes",m.time_zone as "timeZone",m.enabled,m.verified_at::text as "verifiedAt"`;

export class PostgresPlanerkaServiceMappingAdmin {
  constructor(private readonly db: DrizzleDb) {}

  async list(): Promise<readonly PlanerkaServiceMappingRow[]> {
    return (
      await this.db.execute<PlanerkaServiceMappingRow>(
        sql`select ${projection} from planerka_service_mappings m order by m.account_id,m.event_type_id`,
      )
    ).rows;
  }

  /** Lists IDs for the reviewed mapping file; never creates experts or services. */
  async listServices(): Promise<readonly PlanerkaCandidateServiceRow[]> {
    return (
      await this.db.execute<PlanerkaCandidateServiceRow>(
        sql`select s.id as "expertServiceId",s.expert_id as "expertId",s.duration_minutes as "durationMinutes",s.active from expert_services s order by s.expert_id,s.id`,
      )
    ).rows;
  }

  /** Read-only plan. Throws if a service is unknown or inactive. */
  async plan(
    file: PlanerkaServiceMappingFile,
  ): Promise<readonly PlanerkaMappingPlanEntry[]> {
    return this.compute(this.db, file);
  }

  /** Applies the file in one transaction; verified_at is set to now. */
  async apply(
    file: PlanerkaServiceMappingFile,
  ): Promise<readonly PlanerkaMappingPlanEntry[]> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout='5000ms'`);
      const plan = await this.compute(tx as unknown as DrizzleDb, file);
      for (const [index, entry] of plan.entries()) {
        if (entry.action === "unchanged") continue;
        const m = file.mappings[index]!;
        await tx.execute(sql`
          insert into planerka_service_mappings
            (expert_service_id,account_id,event_type_id,duration_minutes,time_zone,enabled,verified_at)
          values (${m.expertServiceId}::uuid,${file.accountId},${m.eventTypeId},${entry.durationMinutes},${m.timeZone},${m.enabled},clock_timestamp())
          on conflict (expert_service_id) do update set
            account_id=excluded.account_id,event_type_id=excluded.event_type_id,
            duration_minutes=excluded.duration_minutes,time_zone=excluded.time_zone,
            enabled=excluded.enabled,verified_at=excluded.verified_at`);
      }
      return plan;
    });
  }

  async setEnabled(
    expertServiceId: string,
    enabled: boolean,
  ): Promise<boolean> {
    if (!UUID.test(expertServiceId))
      throw new Error("planerka_mapping_file_invalid:expert_service_id");
    const result = await this.db.execute<{ id: string }>(
      sql`update planerka_service_mappings set enabled=${enabled} where expert_service_id=${expertServiceId}::uuid and enabled<>${enabled} returning expert_service_id as id`,
    );
    return result.rows.length === 1;
  }

  private async compute(
    db: DrizzleDb,
    file: PlanerkaServiceMappingFile,
  ): Promise<readonly PlanerkaMappingPlanEntry[]> {
    const plan: PlanerkaMappingPlanEntry[] = [];
    for (const m of file.mappings) {
      const service = (
        await db.execute<{ active: boolean; durationMinutes: number }>(
          sql`select active,duration_minutes as "durationMinutes" from expert_services where id=${m.expertServiceId}::uuid`,
        )
      ).rows[0];
      if (service === undefined)
        throw new Error(
          `planerka_mapping_service_unknown:${m.expertServiceId}`,
        );
      if (!service.active)
        throw new Error(
          `planerka_mapping_service_inactive:${m.expertServiceId}`,
        );
      const clash = (
        await db.execute<{ id: string }>(
          sql`select expert_service_id as id from planerka_service_mappings where account_id=${file.accountId} and event_type_id=${m.eventTypeId} and expert_service_id<>${m.expertServiceId}::uuid`,
        )
      ).rows[0];
      if (clash !== undefined)
        throw new Error(`planerka_mapping_event_type_taken:${m.eventTypeId}`);
      const current = (
        await db.execute<PlanerkaServiceMappingRow>(
          sql`select ${projection} from planerka_service_mappings m where m.expert_service_id=${m.expertServiceId}::uuid`,
        )
      ).rows[0];
      const same =
        current !== undefined &&
        current.accountId === file.accountId &&
        current.eventTypeId === m.eventTypeId &&
        current.durationMinutes === service.durationMinutes &&
        current.timeZone === m.timeZone &&
        current.enabled === m.enabled;
      plan.push({
        expertServiceId: m.expertServiceId,
        action:
          current === undefined ? "insert" : same ? "unchanged" : "update",
        durationMinutes: service.durationMinutes,
      });
    }
    return plan;
  }
}
