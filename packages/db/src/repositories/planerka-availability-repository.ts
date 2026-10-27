import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

export interface PlanerkaAvailabilityClaim {
  serviceId: string;
  accountId: number;
  eventTypeId: number;
  durationMinutes: number;
  timeZone: string;
  verifiedAt: string;
  leaseToken: string;
  observedAt: string;
  windowStart: string;
  windowEnd: string;
}
export type PlanerkaAvailabilityDiagnostic =
  | "account_rate_limit"
  | "provider_unavailable"
  | "invalid_response"
  | "mapping_invalid"
  | "database_busy"
  | "slot_conflict";
export class PlanerkaAvailabilityBusyError extends Error {
  constructor() {
    super("planerka_availability_busy");
  }
}
/** Drizzle wraps PostgreSQL errors; only lock contention is a retry outcome. */
export function isPlanerkaAvailabilityLockContention(error: unknown): boolean {
  for (
    let depth = 0;
    depth < 4 && error !== null && typeof error === "object";
    depth++
  ) {
    const value = error as { code?: unknown; cause?: unknown };
    if (value.code === "55P03") return true;
    error = value.cause;
  }
  return false;
}
function rethrowContention(error: unknown): never {
  if (isPlanerkaAvailabilityLockContention(error))
    throw new PlanerkaAvailabilityBusyError();
  throw error;
}
export interface PlanerkaAvailableInterval {
  startsAt: string;
  endsAt: string;
}
const projection = sql`expert_service_id as "serviceId",account_id as "accountId",event_type_id as "eventTypeId",duration_minutes as "durationMinutes",time_zone as "timeZone",verified_at::text as "verifiedAt",lease_token as "leaseToken",observed_at::text as "observedAt",window_start::text as "windowStart",window_end::text as "windowEnd"`;
type Executor = Pick<DrizzleDb, "execute">;
class ExpiredAvailabilityClaim extends Error {}
const timeouts = async (tx: Executor) => {
  await tx.execute(sql`set local statement_timeout='5s'`);
  await tx.execute(sql`set local lock_timeout='2s'`);
};
async function eligible(tx: Executor, serviceId: string): Promise<boolean> {
  const service = (
    await tx.execute<{ expertId: string; active: boolean; duration: number }>(
      sql`select expert_id as "expertId",active,duration_minutes as duration from expert_services where id=${serviceId}::uuid for update nowait`,
    )
  ).rows[0];
  if (!service?.active) return false;
  const expert = (
    await tx.execute(
      sql`select id from experts where id=${service.expertId}::uuid and active and verified for update nowait`,
    )
  ).rows[0];
  if (!expert) return false;
  return (
    (
      await tx.execute(
        sql`select 1 from planerka_service_mappings where expert_service_id=${serviceId}::uuid and enabled and verified_at<=clock_timestamp() and duration_minutes=${service.duration}`,
      )
    ).rows.length === 1
  );
}
async function lockedClaim(
  tx: Executor,
  claim: PlanerkaAvailabilityClaim,
): Promise<boolean> {
  const mapping = (
    await tx.execute(
      sql`select 1 from planerka_service_mappings where expert_service_id=${claim.serviceId}::uuid for update nowait`,
    )
  ).rows[0];
  if (!mapping || !(await eligible(tx, claim.serviceId))) return false;
  const stored = (
    await tx.execute<PlanerkaAvailabilityClaim & Record<string, unknown>>(
      sql`select ${projection} from planerka_availability_refreshes where expert_service_id=${claim.serviceId}::uuid for update nowait`,
    )
  ).rows[0];
  if (
    !stored ||
    Object.keys(stored).some(
      (key) => stored[key] !== claim[key as keyof PlanerkaAvailabilityClaim],
    )
  )
    return false;
  return (
    (
      await tx.execute(sql`select 1 from planerka_availability_refreshes f join planerka_service_mappings m using(expert_service_id)
    where f.expert_service_id=${claim.serviceId}::uuid and f.lease_token=${claim.leaseToken}::uuid and f.lease_until>clock_timestamp()
      and (f.account_id,f.event_type_id,f.duration_minutes,f.time_zone,f.verified_at)=(m.account_id,m.event_type_id,m.duration_minutes,m.time_zone,m.verified_at)`)
    ).rows.length === 1
  );
}

/** DB-clock leases and durable empty-snapshot watermarks; no transaction spans HTTP. */
export class PostgresPlanerkaAvailabilityRepository {
  constructor(private readonly db: DrizzleDb) {}
  async claim(
    accountId: number,
  ): Promise<PlanerkaAvailabilityClaim | undefined> {
    if (!Number.isSafeInteger(accountId) || accountId < 1)
      throw new Error("planerka_availability_invalid_account");
    return this.db
      .transaction(async (tx) => {
        await timeouts(tx);
        const candidate = (
          await tx.execute<{
            id: string;
          }>(sql`select m.expert_service_id as id from planerka_service_mappings m
        join expert_services es on es.id=m.expert_service_id join experts e on e.id=es.expert_id
        left join planerka_availability_refreshes f on f.expert_service_id=m.expert_service_id
        where m.account_id=${accountId} and m.enabled and m.verified_at<=clock_timestamp() and m.duration_minutes=es.duration_minutes
          and es.active and e.active and e.verified
          and (f.expert_service_id is null or (f.next_attempt_at<=clock_timestamp() and (f.lease_until is null or f.lease_until<=clock_timestamp())))
        order by f.next_attempt_at nulls first,m.expert_service_id limit 1 for update of m skip locked`)
        ).rows[0];
        if (!candidate || !(await eligible(tx, candidate.id))) return undefined;
        // Lock the durable state before taking the observation timestamp.
        const current = (
          await tx.execute<{ due: boolean }>(
            sql`select next_attempt_at<=clock_timestamp() and (lease_until is null or lease_until<=clock_timestamp()) as due from planerka_availability_refreshes where expert_service_id=${candidate.id}::uuid for update nowait`,
          )
        ).rows[0];
        if (current && !current.due) return undefined;
        return (
          await tx.execute<
            PlanerkaAvailabilityClaim & Record<string, unknown>
          >(sql`
        with clock as (select clock_timestamp() as observed), bounds as (select observed,(date_trunc('day',observed at time zone 'UTC')+interval '1 day') at time zone 'UTC' as start from clock)
        insert into planerka_availability_refreshes(expert_service_id,account_id,event_type_id,duration_minutes,time_zone,verified_at,window_start,window_end,observed_at,lease_token,lease_until,next_attempt_at)
        select m.expert_service_id,m.account_id,m.event_type_id,m.duration_minutes,m.time_zone,m.verified_at,w.start,w.start+interval '168 hours',w.observed,${randomUUID()}::uuid,w.observed+interval '90 seconds',w.observed from planerka_service_mappings m cross join bounds w where m.expert_service_id=${candidate.id}::uuid
        on conflict(expert_service_id) do update set account_id=excluded.account_id,event_type_id=excluded.event_type_id,duration_minutes=excluded.duration_minutes,time_zone=excluded.time_zone,verified_at=excluded.verified_at,window_start=excluded.window_start,window_end=excluded.window_end,observed_at=excluded.observed_at,lease_token=excluded.lease_token,lease_until=excluded.lease_until,next_attempt_at=excluded.next_attempt_at,reason_code=null
        where planerka_availability_refreshes.next_attempt_at<=clock_timestamp() and (planerka_availability_refreshes.lease_until is null or planerka_availability_refreshes.lease_until<=clock_timestamp())
        returning ${projection}`)
        ).rows[0];
      })
      .catch(rethrowContention);
  }
  async publish(
    claim: PlanerkaAvailabilityClaim,
    slots: readonly PlanerkaAvailableInterval[],
  ): Promise<boolean> {
    const normalized = new Map<string, PlanerkaAvailableInterval>();
    if (slots.length > 4096)
      throw new Error("planerka_availability_invalid_slots");
    for (const slot of slots) {
      const start = Date.parse(slot.startsAt),
        end = Date.parse(slot.endsAt);
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < Date.parse(claim.windowStart) ||
        end > Date.parse(claim.windowEnd) ||
        end - start !== claim.durationMinutes * 60000
      )
        throw new Error("planerka_availability_invalid_slots");
      const value = {
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(end).toISOString(),
      };
      if (
        normalized.has(value.startsAt) &&
        normalized.get(value.startsAt)!.endsAt !== value.endsAt
      )
        throw new Error("planerka_availability_invalid_slots");
      normalized.set(value.startsAt, value);
    }
    return this.db
      .transaction(async (tx) => {
        await timeouts(tx);
        if (!(await lockedClaim(tx, claim))) return false;
        const identities = new Map(
          [...normalized.values()].map((slot) => [
            slot.startsAt,
            `availability:${createHash("sha256")
              .update(
                JSON.stringify([
                  claim.accountId,
                  claim.eventTypeId,
                  slot.startsAt,
                  slot.endsAt,
                ]),
              )
              .digest("hex")}`,
          ]),
        );
        const existing = (
          await tx.execute<{
            id: string;
            serviceId: string;
            external: string;
            startsAt: Date;
            endsAt: Date;
            capacity: number;
          }>(
            sql`select id,expert_service_id as "serviceId",external_slot_id as external,starts_at as "startsAt",ends_at as "endsAt",capacity from slots where provider='planerka' and ((expert_service_id=${claim.serviceId}::uuid and starts_at>=${claim.windowStart}::timestamptz and starts_at<${claim.windowEnd}::timestamptz) or external_slot_id in (select jsonb_array_elements_text(${JSON.stringify([...identities.values()])}::jsonb))) order by id for update nowait`,
          )
        ).rows;
        const publication: {
          slot: PlanerkaAvailableInterval;
          id?: string;
          external: string;
        }[] = [];
        for (const slot of normalized.values()) {
          const overlap = existing.filter(
            (s) =>
              s.serviceId === claim.serviceId &&
              new Date(s.startsAt).getTime() === Date.parse(slot.startsAt),
          );
          if (
            overlap.length > 1 ||
            overlap.some(
              (s) =>
                new Date(s.endsAt).getTime() !== Date.parse(slot.endsAt) ||
                s.capacity !== 1,
            )
          )
            throw new Error("planerka_availability_slot_conflict");
          const external = identities.get(slot.startsAt)!;
          const identity = existing.find((s) => s.external === external);
          if (identity && identity.id !== overlap[0]?.id)
            throw new Error("planerka_availability_slot_conflict");
          publication.push({
            slot,
            external,
            ...(overlap[0] ? { id: overlap[0].id } : {}),
          });
        }
        // A wait on any row lock must not let a now-expired response publish.
        if (
          !(
            await tx.execute(
              sql`select 1 from planerka_availability_refreshes where expert_service_id=${claim.serviceId}::uuid and lease_until>clock_timestamp()`,
            )
          ).rows.length
        )
          return false;
        await tx.execute(
          sql`update slots set observed_at=null where expert_service_id=${claim.serviceId}::uuid and provider='planerka' and starts_at>=${claim.windowStart}::timestamptz and starts_at<${claim.windowEnd}::timestamptz`,
        );
        const records = JSON.stringify(
          publication.map(({ slot, id, external }) => ({
            ...slot,
            id: id ?? null,
            external,
          })),
        );
        await tx.execute(
          sql`update slots set observed_at=${claim.observedAt}::timestamptz where id in (select id from jsonb_to_recordset(${records}::jsonb) as p(id uuid))`,
        );
        await tx.execute(sql`insert into slots(expert_service_id,provider,external_slot_id,starts_at,ends_at,observed_at,capacity)
        select ${claim.serviceId}::uuid,'planerka',p.external,p."startsAt",p."endsAt",${claim.observedAt}::timestamptz,1
        from jsonb_to_recordset(${records}::jsonb) as p(id uuid,external text,"startsAt" timestamptz,"endsAt" timestamptz) where p.id is null`);
        const finished = await tx.execute(
          sql`update planerka_availability_refreshes set published_at=observed_at,lease_token=null,lease_until=null,next_attempt_at=clock_timestamp()+interval '120 seconds',reason_code=null where expert_service_id=${claim.serviceId}::uuid and lease_until>clock_timestamp() returning expert_service_id`,
        );
        if (!finished.rows.length) throw new ExpiredAvailabilityClaim();
        return true;
      })
      .catch((error: unknown) => {
        if (error instanceof ExpiredAvailabilityClaim) return false;
        rethrowContention(error);
      });
  }
  async defer(
    claim: PlanerkaAvailabilityClaim,
    code: PlanerkaAvailabilityDiagnostic,
  ): Promise<boolean> {
    return this.db
      .transaction(async (tx) => {
        await timeouts(tx);
        if (!(await lockedClaim(tx, claim))) return false;
        await tx.execute(
          sql`update planerka_availability_refreshes set lease_token=null,lease_until=null,next_attempt_at=clock_timestamp()+interval '30 seconds',reason_code=${code} where expert_service_id=${claim.serviceId}::uuid`,
        );
        return true;
      })
      .catch(rethrowContention);
  }
}
