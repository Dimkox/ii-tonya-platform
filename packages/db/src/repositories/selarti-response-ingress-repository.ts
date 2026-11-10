import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

const receiptKey = /^sha256:[0-9a-f]{64}$/u;
const claimIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const requestIdPattern = /^sha256:[0-9a-f]{64}$/u;
const dialogueIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const providerThreadId = /^[^\s\u0000-\u001F\u007F]{1,256}$/u;
const PROVIDER = "selarti_response";

export type SelartiPendingLookup =
  | { readonly kind: "none" }
  | { readonly kind: "ambiguous" }
  | {
      readonly kind: "one";
      readonly requestId: string;
      readonly dialogueId: string;
    };

export type SelartiBoundPendingRequest = {
  readonly requestId: string;
  readonly dialogueId: string;
  readonly threadId: string;
  readonly boundAt: string;
};

export class PostgresSelartiResponseIngressRepository {
  constructor(
    private readonly db: Pick<DrizzleDb, "execute">,
    private readonly tenantKey: string,
  ) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(tenantKey))
      throw new Error("selarti_response_tenant_unconfigured");
  }

  async findPending(externalChatId: string): Promise<SelartiPendingLookup> {
    if (!/^[^\s\u0000-\u001F\u007F]{1,256}$/u.test(externalChatId))
      return { kind: "none" };
    const rows = (
      await this.db.execute<{
        requestId: string | null;
        dialogueId: string | null;
      }>(sql`
        select o.payload->>'requestId' as "requestId",
               o.payload->>'dialogueId' as "dialogueId"
        from integration_outbox o
        join dialogues d on d.id::text = o.payload->>'dialogueId'
          and d.tenant_key = ${this.tenantKey}
          and d.bot_key = ${this.tenantKey}
          and d.provider = 'telegram'
          and d.external_chat_id = ${externalChatId}
        where o.topic = 'selarti.request.v1'
          and o.idempotency_key = o.payload->>'requestId'
          and exists (
            select 1 from delivery_attempts a
            where a.outbox_id = o.id
              and a.outcome = 'started'
              and a.reconciliation_key = o.reconciliation_key
          )
          and not exists (
            select 1 from selarti_response_proposals p
            where p.request_id = o.idempotency_key
          )
        order by o.created_at desc, o.id desc
        limit 2
      `)
    ).rows;
    if (rows.length !== 1)
      return { kind: rows.length === 0 ? "none" : "ambiguous" };
    const row = rows[0]!;
    if (
      row.requestId === null ||
      row.dialogueId === null ||
      !requestIdPattern.test(row.requestId) ||
      !dialogueIdPattern.test(row.dialogueId)
    )
      return { kind: "none" };
    return {
      kind: "one",
      requestId: row.requestId,
      dialogueId: row.dialogueId,
    };
  }

  async listBoundPending(
    limit: number,
  ): Promise<readonly SelartiBoundPendingRequest[]> {
    const bounded =
      Number.isInteger(limit) && limit >= 1 && limit <= 20 ? limit : 20;
    const rows = (
      await this.db.execute<{
        requestId: string;
        dialogueId: string;
        threadId: string;
        boundAt: Date | string;
      }>(sql`
        select o.payload->>'requestId' as "requestId",
               o.payload->>'dialogueId' as "dialogueId",
               bound.normalized_reason as "threadId",
               bound.created_at as "boundAt"
        from integration_outbox o
        join dialogues d on d.id::text = o.payload->>'dialogueId'
          and d.tenant_key = ${this.tenantKey}
          and d.bot_key = ${this.tenantKey}
          and d.provider = 'telegram'
        join lateral (
          select normalized_reason, created_at
          from delivery_attempts
          where outbox_id = o.id
            and outcome = 'provider_bound'
            and normalized_reason is not null
          order by created_at desc
          limit 1
        ) bound on true
        where o.topic = 'selarti.request.v1'
          and o.status = 'succeeded'
          and o.idempotency_key = o.payload->>'requestId'
          and (o.payload->>'deadline')::timestamptz > clock_timestamp()
          and exists (
            select 1 from delivery_attempts started
            where started.outbox_id = o.id
              and started.outcome = 'started'
              and started.reconciliation_key = o.reconciliation_key
          )
          and not exists (
            select 1 from selarti_response_proposals p
            where p.request_id = o.idempotency_key
          )
        order by o.created_at, o.id
        limit ${bounded}
      `)
    ).rows;
    return rows.flatMap((row) => {
      const boundAt =
        row.boundAt instanceof Date
          ? row.boundAt.toISOString()
          : typeof row.boundAt === "string"
            ? row.boundAt
            : "";
      if (
        !requestIdPattern.test(row.requestId) ||
        !dialogueIdPattern.test(row.dialogueId) ||
        !providerThreadId.test(row.threadId) ||
        !Number.isFinite(Date.parse(boundAt))
      )
        return [];
      return [
        {
          requestId: row.requestId,
          dialogueId: row.dialogueId,
          threadId: row.threadId,
          boundAt: new Date(boundAt).toISOString(),
        },
      ];
    });
  }

  async claim(
    messageKey: string,
  ): Promise<
    | { readonly kind: "claimed"; readonly claimId: string }
    | { readonly kind: "duplicate" }
    | { readonly kind: "busy" }
  > {
    if (!receiptKey.test(messageKey)) return { kind: "busy" };
    const claimId = randomUUID();
    const inserted = await this.db.execute<{ claimId: string }>(sql`
      insert into webhook_inbox (provider, external_event_id, status, claim_id, lease_until)
      values (${PROVIDER}, ${messageKey}, 'processing', ${claimId}::uuid, now() + interval '30 seconds')
      on conflict (provider, external_event_id) do update set
        status = 'processing',
        claim_id = excluded.claim_id,
        lease_until = excluded.lease_until,
        updated_at = now()
      where webhook_inbox.status = 'failed'
         or (webhook_inbox.status = 'processing' and webhook_inbox.lease_until < now())
      returning claim_id as "claimId"
    `);
    if (inserted.rows[0] !== undefined)
      return { kind: "claimed", claimId: inserted.rows[0].claimId };
    const stored = (
      await this.db.execute<{ status: string }>(sql`
        select status from webhook_inbox
        where provider = ${PROVIDER} and external_event_id = ${messageKey}
      `)
    ).rows[0];
    return { kind: stored?.status === "complete" ? "duplicate" : "busy" };
  }

  async complete(claimId: string): Promise<void> {
    if (!claimIdPattern.test(claimId)) return;
    await this.db.execute(sql`
      update webhook_inbox
      set status = 'complete', lease_until = null, updated_at = now()
      where provider = ${PROVIDER}
        and claim_id = ${claimId}::uuid
        and status = 'processing'
    `);
  }

  async release(claimId: string): Promise<void> {
    if (!claimIdPattern.test(claimId)) return;
    await this.db.execute(sql`
      update webhook_inbox
      set status = 'failed', lease_until = null, updated_at = now()
      where provider = ${PROVIDER}
        and claim_id = ${claimId}::uuid
        and status = 'processing'
    `);
  }
}
