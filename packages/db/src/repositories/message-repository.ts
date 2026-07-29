import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import {
  InboxPayloadMismatchError,
  PostgresInboxRepository,
} from "./inbox-repository.js";

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

type Transaction = Parameters<DrizzleDb["transaction"]>[0] extends (transaction: infer T) => unknown ? T : never;
type MessageEvent = { id: string };
type PackageBalance = { id: string; balance: number };
type Debit = { id: string; packageId: string };
type Balance = { balance: number };

export class CompensationConflictError extends Error {}

function hash(parts: Record<string, string>): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function hasCode(error: unknown, code: string): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    if ((current as { code?: unknown }).code === code) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export async function withSerializableRetry<T>(
  operation: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === attempts - 1 || !hasCode(error, "40001")) throw error;
    }
  }
  throw new Error("Unreachable serialization retry state");
}

function one<T>(rows: T[], description: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`Expected ${description}`);
  return row;
}

export class PostgresMessageRepository implements MessageRepository {
  private readonly inbox = new PostgresInboxRepository();

  constructor(private readonly db: DrizzleDb) {}

  acceptInbound(command: AcceptInboundCommand): Promise<AcceptInboundResult> {
    const payloadHash = hash({
      provider: command.provider,
      externalEventId: command.externalEventId,
      externalMessageId: command.externalMessageId,
      userId: command.userId,
      messageClass: command.messageClass,
      occurredAt: command.occurredAt.toISOString(),
      correlationId: command.correlationId,
    });
    return this.acceptMessage({
      provider: command.provider,
      externalEventId: command.externalEventId,
      externalMessageId: command.externalMessageId,
      userId: command.userId,
      direction: "inbound",
      messageClass: command.messageClass,
      occurredAt: command.occurredAt,
      correlationId: command.correlationId,
      payloadHash,
    });
  }

  recordOutboundDelivery(command: RecordOutboundDeliveryCommand): Promise<AcceptInboundResult> {
    return this.acceptMessage({
      provider: command.provider,
      externalEventId: command.externalDeliveryEventId,
      externalMessageId: command.providerMessageId,
      userId: command.userId,
      direction: "outbound",
      messageClass: "ordinary_inbound",
      occurredAt: command.occurredAt,
      correlationId: command.correlationId,
      payloadHash: hash({
        provider: command.provider,
        externalDeliveryEventId: command.externalDeliveryEventId,
        providerMessageId: command.providerMessageId,
        userId: command.userId,
        deliveryStatus: command.deliveryStatus,
        occurredAt: command.occurredAt.toISOString(),
        correlationId: command.correlationId,
      }),
    });
  }

  async compensate(command: CompensateDebitCommand): Promise<{ ledgerBalance: number }> {
    try {
      return await withSerializableRetry(() => this.db.transaction(async (tx) => {
      await tx.execute(sql`set transaction isolation level serializable`);
      const debit = one((await tx.execute<Debit>(sql`
        select l.id, l.package_id as "packageId"
        from message_ledger_entries l
        join message_packages p on p.id = l.package_id
        where l.entry_kind = 'debit' and l.idempotency_key = ${command.originalDebitKey}
        for update of p, l
      `)).rows, "the original debit");
      const existing = (await tx.execute<{ idempotencyKey: string }>(sql`
        select idempotency_key as "idempotencyKey"
        from message_ledger_entries
        where entry_kind = 'compensation' and original_entry_id = ${debit.id}::uuid
      `)).rows[0];
      if (existing !== undefined) {
        if (existing.idempotencyKey !== command.idempotencyKey) {
          throw new CompensationConflictError("Original debit already compensated with another key");
        }
      } else {
        await tx.execute(sql`
          insert into message_ledger_entries (
            package_id, entry_kind, delta, original_entry_id, idempotency_key
          ) values (
            ${debit.packageId}::uuid, 'compensation', 1, ${debit.id}::uuid, ${command.idempotencyKey}
          )
        `);
      }
      return this.balance(tx, debit.packageId);
      }));
    } catch (error) {
      if (!hasCode(error, "23505")) throw error;
      return this.resolveCompensationConflict(command);
    }
  }

  private acceptMessage(command: {
    provider: string;
    externalEventId: string;
    externalMessageId: string;
    userId: string;
    direction: "inbound" | "outbound";
    messageClass: AcceptInboundCommand["messageClass"];
    occurredAt: Date;
    correlationId: string;
    payloadHash: string;
  }): Promise<AcceptInboundResult> {
    return withSerializableRetry(() => this.db.transaction(async (tx) => {
      await tx.execute(sql`set transaction isolation level serializable`);
      const inbox = await this.inbox.claim(tx, {
        provider: command.provider,
        externalEventId: command.externalEventId,
        payloadHash: command.payloadHash,
        normalizedIdentifier: command.externalMessageId,
      });
      if (inbox.kind === "duplicate") {
        if (!inbox.payloadMatches) throw new InboxPayloadMismatchError();
        return { kind: "duplicate", messageEventId: inbox.messageEventId };
      }
      const event = one((await tx.execute<MessageEvent>(sql`
        insert into message_events (user_id, provider, external_message_id, direction, created_at)
        values (${command.userId}::uuid, ${command.provider}, ${command.externalMessageId}, ${command.direction}, ${command.occurredAt})
        returning id
      `)).rows, "an inserted message event");
      await this.inbox.associate(tx, inbox.inboxId, event.id);
      const charged = command.messageClass === "ordinary_inbound"
        ? await this.debit(tx, command.userId, command.occurredAt, event.id, command.direction, `${command.direction}:${command.provider}:${command.externalMessageId}`)
        : await this.free(tx, event.id, command.direction);
      await this.auditAndOutbox(tx, command, event.id);
      return { kind: "accepted", messageEventId: event.id, ...charged };
    }));
  }

  private async debit(
    tx: Transaction,
    userId: string,
    occurredAt: Date,
    eventId: string,
    direction: "inbound" | "outbound",
    idempotencyKey: string,
  ): Promise<{ packageId: string | null; ledgerBalance: number }> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
    const packageRow = (await tx.execute<PackageBalance>(sql`
      select p.id, balances.balance
      from message_packages p
      cross join lateral (
        select coalesce(sum(l.delta), 0)::integer as balance from message_ledger_entries l where l.package_id = p.id
      ) balances
      where p.user_id = ${userId}::uuid and balances.balance > 0
        and (p.expires_at is null or p.expires_at > ${occurredAt})
      order by (p.kind = 'intro') asc, p.expires_at asc nulls last, p.granted_at asc, p.id asc
      for update of p limit 1
    `)).rows[0];
    if (packageRow === undefined) return { packageId: null, ledgerBalance: 0 };
    await tx.execute(sql`
      insert into message_ledger_entries (package_id, entry_kind, delta, direction, message_event_id, idempotency_key)
      values (${packageRow.id}::uuid, 'debit', -1, ${direction}, ${eventId}::uuid, ${idempotencyKey})
    `);
    return { packageId: packageRow.id, ledgerBalance: Number(packageRow.balance) - 1 };
  }

  private async free(
    tx: Transaction,
    eventId: string,
    direction: "inbound" | "outbound",
  ): Promise<{ packageId: null; ledgerBalance: number }> {
    await tx.execute(sql`
      insert into message_ledger_entries (entry_kind, delta, direction, message_event_id, idempotency_key)
      values ('free', 0, ${direction}, ${eventId}::uuid, ${`free:${eventId}`})
    `);
    return { packageId: null, ledgerBalance: 0 };
  }

  private async auditAndOutbox(
    tx: Transaction,
    command: {
      provider: string; externalEventId: string; userId: string; direction: string;
      messageClass: string; occurredAt: Date; correlationId: string; payloadHash: string;
    },
    eventId: string,
  ): Promise<void> {
    const sessionHash = hash({ provider: command.provider, userId: command.userId });
    await tx.execute(sql`
      insert into audit_events (
        actor_type, actor_id, authenticated_session_id_hash, action, object_type, object_id,
        decision, reason_code, correlation_id, occurred_at, metadata_hash
      ) values (
        'provider', ${command.userId}::uuid, ${sessionHash}, 'message.accepted', 'message_event',
        ${eventId}::uuid, 'accepted', ${command.messageClass}, ${command.correlationId},
        ${command.occurredAt}, ${command.payloadHash}
      )
    `);
    const outboxKey = hash({ provider: command.provider, externalEventId: command.externalEventId, direction: command.direction });
    await tx.execute(sql`
      insert into integration_outbox (idempotency_key, reconciliation_key, payload_hash)
      values (${`message:${outboxKey}`}, ${`message:${outboxKey}`}, ${command.payloadHash})
    `);
  }

  private async balance(tx: Transaction, packageId: string): Promise<{ ledgerBalance: number }> {
    const result = one((await tx.execute<Balance>(sql`
      select coalesce(sum(delta), 0)::integer as balance from message_ledger_entries where package_id = ${packageId}::uuid
    `)).rows, "a package balance");
    return { ledgerBalance: Number(result.balance) };
  }

  private async resolveCompensationConflict(command: CompensateDebitCommand): Promise<{ ledgerBalance: number }> {
    return this.db.transaction(async (tx) => {
      const debit = one((await tx.execute<Debit>(sql`
        select id, package_id as "packageId" from message_ledger_entries
        where entry_kind = 'debit' and idempotency_key = ${command.originalDebitKey}
      `)).rows, "the original debit after a compensation conflict");
      const byKey = (await tx.execute<{ originalEntryId: string }>(sql`
        select original_entry_id as "originalEntryId" from message_ledger_entries
        where idempotency_key = ${command.idempotencyKey}
      `)).rows[0];
      if (byKey?.originalEntryId !== debit.id) {
        throw new CompensationConflictError("Compensation key belongs to another debit");
      }
      const byOriginal = (await tx.execute<{ idempotencyKey: string }>(sql`
        select idempotency_key as "idempotencyKey" from message_ledger_entries
        where entry_kind = 'compensation' and original_entry_id = ${debit.id}::uuid
      `)).rows[0];
      if (byOriginal === undefined) throw new Error("Compensation conflict could not be resolved");
      if (byOriginal.idempotencyKey !== command.idempotencyKey) {
        throw new CompensationConflictError("Original debit already compensated with another key");
      }
      return this.balance(tx, debit.packageId);
    });
  }
}
