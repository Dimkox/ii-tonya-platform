import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

export type QueueClaim = Readonly<{
  noticeId: string;
  attemptId: string;
  userId: string;
  kind: "first" | "repeat";
}>;
export type QueueResult =
  | Readonly<{ kind: "delivered"; messageId: string }>
  | Readonly<{ kind: "cancelled" | "retry" | "uncertain" }>;

/**
 * Lease and delivery bookkeeping only. Insertion, payment/consent checks and a
 * fenced sender must be supplied by a separate authority before composition.
 * Dispatched and uncertain work is never automatically retried. Pending work is
 * eligible after its scheduled tick (including outage catch-up); a preparation
 * lease can be reclaimed after expiry because no network dispatch has occurred.
 * A new retry after preparation failure is scheduled at the next daily tick.
 */
export interface FinalCallConfigAuthority {
  /** Lock and return the current authoritative version until the transaction ends. */
  lockCurrent(tx: Pick<DrizzleDb, "execute">): Promise<string | null>;
  lockCurrentState(tx: Pick<DrizzleDb, "execute">): Promise<{
    version: string;
    phase: "WAVE_1_EARLY_BIRD" | "PUBLIC_LAUNCH";
    triggerAtMs: number;
    clientStartAtMs: number;
  } | null>;
}
export class PostgresFinalCallQueue {
  constructor(
    private readonly db: DrizzleDb,
    private readonly configAuthority?: FinalCallConfigAuthority,
  ) {}

  /** Cancel unsent work from old configuration only while the current config is locked. */
  async cancelStaleConfiguration(limit: number): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw new Error("early_bird_notice_limit_invalid");
    if (!this.configAuthority) return 0;
    return this.db.transaction(async (tx) => {
      const version = await this.configAuthority!.lockCurrent(tx);
      if (!version || !/^[A-Za-z0-9_-]{1,64}$/u.test(version)) return 0;
      const rows = await tx.execute(sql`
        with stale as (
          select id from early_bird_final_call_queue
          where status in ('pending','preparing') and config_version<>${version}
          order by created_at,id for update skip locked limit ${limit}
        )
        update early_bird_final_call_queue q set status='cancelled',prepared_until=null
        from stale where q.id=stale.id returning q.id
      `);
      return rows.rows.length;
    });
  }

  async claim(): Promise<QueueClaim | null> {
    const attemptId = randomUUID();
    const rows = await this.db.execute<{
      noticeId: string;
      userId: string;
      kind: "first" | "repeat";
    }>(sql`
      with candidate as (
        select id from early_bird_final_call_queue
        where trigger_at<=early_bird_current_time() and client_start_at>early_bird_current_time()
          and ((status='pending' and available_at<=early_bird_current_time()) or (status='preparing' and prepared_until<=clock_timestamp()))
        order by created_at,id for update skip locked limit 1
      )
      update early_bird_final_call_queue q
      set status='preparing',attempt_id=${attemptId}::uuid,prepared_until=clock_timestamp()+interval '60 seconds'
      from candidate where q.id=candidate.id
      returning q.id::text as "noticeId",q.user_id::text as "userId",q.kind
    `);
    const row = rows.rows[0];
    return row ? { ...row, attemptId } : null;
  }

  /** Cancel unsent work after its bound launch; dispatched work stays uncertain. */
  async expireAfterLaunch(limit: number): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw new Error("early_bird_notice_limit_invalid");
    const rows = await this.db.execute(sql`
      with expired as (
        select id from early_bird_final_call_queue
        where status in ('pending','preparing') and client_start_at<=early_bird_current_time()
        order by client_start_at,id for update skip locked limit ${limit}
      )
      update early_bird_final_call_queue q set status='cancelled',prepared_until=null
      from expired where q.id=expired.id returning q.id
    `);
    return rows.rows.length;
  }

  async dispatch(claim: QueueClaim): Promise<boolean> {
    if (!this.configAuthority) return false;
    return this.db.transaction(async (tx) => {
      const current = await this.configAuthority!.lockCurrentState(tx);
      if (
        !current ||
        !/^[A-Za-z0-9_-]{1,64}$/u.test(current.version) ||
        !Number.isSafeInteger(current.triggerAtMs) ||
        !Number.isSafeInteger(current.clientStartAtMs) ||
        current.triggerAtMs >= current.clientStartAtMs
      )
        return false;
      // A stale preparation has never crossed the network boundary; cancel it
      // under the same config lock so it cannot starve later due notices.
      const stale = await tx.execute(sql`
        update early_bird_final_call_queue set status='cancelled',prepared_until=null
        where id=${claim.noticeId}::uuid and user_id=${claim.userId}::uuid and kind=${claim.kind}
          and attempt_id=${claim.attemptId}::uuid and status='preparing' and (
            config_version<>${current.version}
            or floor(extract(epoch from trigger_at)*1000)::bigint<>${current.triggerAtMs}
            or floor(extract(epoch from client_start_at)*1000)::bigint<>${current.clientStartAtMs}
          )
        returning id
      `);
      if (stale.rows.length || current.phase !== "WAVE_1_EARLY_BIRD")
        return false;
      const rows = await tx.execute(sql`
        update early_bird_final_call_queue set status='dispatched',prepared_until=null
        where id=${claim.noticeId}::uuid and user_id=${claim.userId}::uuid and kind=${claim.kind}
          and attempt_id=${claim.attemptId}::uuid and status='preparing' and prepared_until>clock_timestamp()
          and config_version=${current.version}
          and floor(extract(epoch from trigger_at)*1000)::bigint=${current.triggerAtMs}
          and floor(extract(epoch from client_start_at)*1000)::bigint=${current.clientStartAtMs}
          and trigger_at<=early_bird_current_time() and client_start_at>early_bird_current_time()
        returning id
      `);
      return rows.rows.length === 1;
    });
  }

  async finish(claim: QueueClaim, result: QueueResult): Promise<boolean> {
    if (
      result.kind === "delivered" &&
      !/^[1-9][0-9]{0,19}$/u.test(result.messageId)
    )
      throw new Error("early_bird_notice_receipt_invalid");
    const status = result.kind === "retry" ? "pending" : result.kind;
    const messageId = result.kind === "delivered" ? result.messageId : null;
    const rows = await this.db.execute(sql`
      update early_bird_final_call_queue set status=${status},message_id=${messageId},prepared_until=null,
        delivered_at=case when ${result.kind}='delivered' then clock_timestamp() else null end,
        available_at=case when ${result.kind}='retry' then trigger_at+(floor(extract(epoch from (early_bird_current_time()-trigger_at))/86400)::bigint+1)*interval '1 day' else available_at end,
        attempt_id=case when ${result.kind}='retry' then null else attempt_id end
      where id=${claim.noticeId}::uuid and user_id=${claim.userId}::uuid and kind=${claim.kind}
        and attempt_id=${claim.attemptId}::uuid and (
          (${result.kind}='retry' and status='preparing' and prepared_until>clock_timestamp()) or
          (${result.kind}='cancelled' and status='preparing' and prepared_until>clock_timestamp()) or
          (${result.kind} in ('delivered','uncertain') and status='dispatched')
        )
      returning id
    `);
    return rows.rows.length === 1;
  }
}
