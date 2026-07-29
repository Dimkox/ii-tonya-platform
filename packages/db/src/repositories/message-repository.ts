import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { PostgresInboxRepository } from "./inbox-repository.js";

export interface AcceptInboundCommand {
  provider: string;
  externalEventId: string;
  externalMessageId: string;
  userId: string;
  messageClass: "ordinary_inbound" | "system" | "safety" | "error";
  occurredAt: Date;
  correlationId: string;
}

export type AcceptInboundResult =
  | { kind: "duplicate"; messageEventId: string }
  | { kind: "accepted"; messageEventId: string; packageId: string | null; ledgerBalance: number };

export interface RecordOutboundDeliveryCommand {
  provider: "selarti";
  externalDeliveryEventId: string;
  providerMessageId: string;
  userId: string;
  deliveryStatus: "delivered";
  occurredAt: Date;
  correlationId: string;
}

export interface CompensateDebitCommand {
  originalDebitKey: string;
  idempotencyKey: string;
}

export interface MessageRepository {
  acceptInbound(command: AcceptInboundCommand): Promise<AcceptInboundResult>;
  recordOutboundDelivery(command: RecordOutboundDeliveryCommand): Promise<AcceptInboundResult>;
  compensate(command: CompensateDebitCommand): Promise<{ ledgerBalance: number }>;
}

type MessageEvent = { id: string };
type PackageBalance = { id: string; balance: number };
type Debit = { id: string; packageId: string };
type Balance = { balance: number };

function payloadHash(payload: Record<string, string>): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function isSerializationFailure(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    if ((current as { code?: unknown }).code === "40001") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function singleRow<T>(rows: T[], description: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`Expected ${description}`);
  return row;
}

export class PostgresMessageRepository implements MessageRepository {
  private readonly inbox = new PostgresInboxRepository();

  constructor(private readonly db: DrizzleDb) {}

  async acceptInbound(command: AcceptInboundCommand): Promise<AcceptInboundResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.db.transaction(async (tx) => {
          await tx.execute(sql`set transaction isolation level serializable`);
          const claimed = await this.inbox.claim(tx, {
            provider: command.provider,
            externalEventId: command.externalEventId,
            payloadHash: payloadHash({
              provider: command.provider,
              externalEventId: command.externalEventId,
              externalMessageId: command.externalMessageId,
              userId: command.userId,
              messageClass: command.messageClass,
              occurredAt: command.occurredAt.toISOString(),
              correlationId: command.correlationId,
            }),
            normalizedIdentifier: command.externalMessageId,
          });
          if (!claimed) return this.duplicateInbound(tx, command);

          const event = singleRow((await tx.execute<MessageEvent>(sql`
            insert into message_events (
              user_id,
              provider,
              external_message_id,
              direction,
              created_at
            ) values (
              ${command.userId}::uuid,
              ${command.provider},
              ${command.externalMessageId},
              'inbound',
              ${command.occurredAt}
            ) returning id
          `)).rows, "an inserted message event");

          if (command.messageClass !== "ordinary_inbound") {
            return this.recordFreeFact(tx, command.userId, event.id);
          }

          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${command.userId}, 0))`);
          const packageRow = (await tx.execute<PackageBalance>(sql`
            select p.id, balances.balance
            from message_packages p
            cross join lateral (
              select coalesce(sum(l.delta), 0)::integer as balance
              from message_ledger_entries l
              where l.package_id = p.id
            ) balances
            where p.user_id = ${command.userId}::uuid
              and balances.balance > 0
              and (p.expires_at is null or p.expires_at > ${command.occurredAt})
            order by (p.kind = 'intro') asc, p.expires_at asc nulls last, p.granted_at asc, p.id asc
            for update of p
            limit 1
          `)).rows[0];

          if (packageRow === undefined) {
            return { kind: "accepted", messageEventId: event.id, packageId: null, ledgerBalance: 0 };
          }
          await tx.execute(sql`
            insert into message_ledger_entries (
              package_id,
              entry_kind,
              delta,
              direction,
              message_event_id,
              idempotency_key
            ) values (
              ${packageRow.id}::uuid,
              'debit',
              -1,
              'inbound',
              ${event.id}::uuid,
              ${`inbound:${command.externalMessageId}`}
            )
          `);
          return {
            kind: "accepted",
            messageEventId: event.id,
            packageId: packageRow.id,
            ledgerBalance: Number(packageRow.balance) - 1,
          };
        });
      } catch (error) {
        if (attempt === 2 || !isSerializationFailure(error)) throw error;
      }
    }
    throw new Error("Unreachable serialization retry state");
  }

  async recordOutboundDelivery(command: RecordOutboundDeliveryCommand): Promise<AcceptInboundResult> {
    return this.db.transaction(async (tx) => {
      const claimed = await this.inbox.claim(tx, {
        provider: command.provider,
        externalEventId: command.externalDeliveryEventId,
        payloadHash: payloadHash({
          provider: command.provider,
          externalDeliveryEventId: command.externalDeliveryEventId,
          providerMessageId: command.providerMessageId,
          userId: command.userId,
          deliveryStatus: command.deliveryStatus,
          occurredAt: command.occurredAt.toISOString(),
          correlationId: command.correlationId,
        }),
        normalizedIdentifier: command.providerMessageId,
      });
      if (!claimed) {
        const event = singleRow((await tx.execute<MessageEvent>(sql`
          select id from message_events
          where provider = ${command.provider}
            and external_message_id = ${command.providerMessageId}
        `)).rows, "the duplicate delivery event");
        return { kind: "duplicate", messageEventId: event.id };
      }
      const event = singleRow((await tx.execute<MessageEvent>(sql`
        insert into message_events (user_id, provider, external_message_id, direction, created_at)
        values (
          ${command.userId}::uuid,
          ${command.provider},
          ${command.providerMessageId},
          'outbound',
          ${command.occurredAt}
        ) returning id
      `)).rows, "an inserted delivery event");
      return { kind: "accepted", messageEventId: event.id, packageId: null, ledgerBalance: 0 };
    });
  }

  async compensate(command: CompensateDebitCommand): Promise<{ ledgerBalance: number }> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set transaction isolation level serializable`);
      const debit = singleRow((await tx.execute<Debit>(sql`
        select l.id, l.package_id as "packageId"
        from message_ledger_entries l
        join message_packages p on p.id = l.package_id
        where l.entry_kind = 'debit'
          and l.idempotency_key = ${command.originalDebitKey}
        for update of p, l
      `)).rows, "the original debit");
      await tx.execute(sql`
        insert into message_ledger_entries (
          package_id,
          entry_kind,
          delta,
          original_entry_id,
          idempotency_key
        ) values (
          ${debit.packageId}::uuid,
          'compensation',
          1,
          ${debit.id}::uuid,
          ${command.idempotencyKey}
        )
        on conflict do nothing
      `);
      return this.packageBalance(tx, debit.packageId);
    });
  }

  private async duplicateInbound(
    tx: Parameters<DrizzleDb["transaction"]>[0] extends (transaction: infer T) => unknown ? T : never,
    command: AcceptInboundCommand,
  ): Promise<AcceptInboundResult> {
    const event = singleRow((await tx.execute<MessageEvent>(sql`
      select id from message_events
      where provider = ${command.provider}
        and external_message_id = ${command.externalMessageId}
    `)).rows, "the duplicate inbound event");
    return { kind: "duplicate", messageEventId: event.id };
  }

  private async recordFreeFact(
    tx: Parameters<DrizzleDb["transaction"]>[0] extends (transaction: infer T) => unknown ? T : never,
    userId: string,
    messageEventId: string,
  ): Promise<AcceptInboundResult> {
    const packageRow = (await tx.execute<PackageBalance>(sql`
      select p.id, coalesce(sum(l.delta), 0)::integer as balance
      from message_packages p
      left join message_ledger_entries l on l.package_id = p.id
      where p.user_id = ${userId}::uuid
      group by p.id
      order by p.granted_at asc, p.id asc
      limit 1
    `)).rows[0];
    if (packageRow === undefined) {
      return { kind: "accepted", messageEventId, packageId: null, ledgerBalance: 0 };
    }
    await tx.execute(sql`
      insert into message_ledger_entries (
        package_id,
        entry_kind,
        delta,
        direction,
        message_event_id,
        idempotency_key
      ) values (
        ${packageRow.id}::uuid,
        'free',
        0,
        'inbound',
        ${messageEventId}::uuid,
        ${`free:${messageEventId}`}
      )
    `);
    return {
      kind: "accepted",
      messageEventId,
      packageId: packageRow.id,
      ledgerBalance: Number(packageRow.balance),
    };
  }

  private async packageBalance(
    tx: Parameters<DrizzleDb["transaction"]>[0] extends (transaction: infer T) => unknown ? T : never,
    packageId: string,
  ): Promise<{ ledgerBalance: number }> {
    const balance = singleRow((await tx.execute<Balance>(sql`
      select coalesce(sum(delta), 0)::integer as balance
      from message_ledger_entries
      where package_id = ${packageId}::uuid
    `)).rows, "a package balance");
    return { ledgerBalance: Number(balance.balance) };
  }
}
