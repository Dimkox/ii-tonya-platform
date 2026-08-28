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
  | {
      kind: "accepted";
      messageEventId: string;
      packageId: string | null;
      ledgerBalance: number;
    };

export type PreparedInbound =
  | { kind: "duplicate"; messageEventId: string }
  | {
      kind: "pending";
      messageEventId: string;
      packageAvailable: boolean;
    };

export type InboundCompletionOutcome =
  | {
      kind: "answer";
      topic: "selarti.send";
      payload: { text: string };
    }
  | {
      kind: "no_package";
      topic: "client.no_package" | "client.free";
      payload: Record<string, never>;
    }
  | {
      kind: "show_catalog";
      topic: "catalog.show";
      payload: {
        serviceCode?: string;
        allowedServiceCodes: readonly string[];
      };
    }
  | {
      kind: "start_booking";
      topic: "booking.start";
      payload: { expertId: string };
    }
  | {
      kind: "human_handoff";
      topic: "human_handoff.opened";
      payload: { reasonCode: string };
      ownerId: string;
      openedAt: Date;
      acknowledgeBy: Date;
    };

export interface CompleteInboundCommand {
  messageEventId: string;
  userId: string;
  correlationId: string;
  outcome: InboundCompletionOutcome;
  billingPolicy?: "package" | "free";
}

export type CommittedInboundResult =
  | {
      kind: "human_handoff";
      reasonCode: string;
      chargedMessages: 1;
    }
  | { kind: "no_package"; chargedMessages: 0 }
  | { kind: "answer_queued"; chargedMessages: 0 | 1 }
  | { kind: "catalog_requested"; chargedMessages: 0 | 1 }
  | { kind: "booking_started"; chargedMessages: 0 | 1 };

interface StoredCompletion {
  messageEventId: string;
  packageId: string | null;
  ledgerBalance: number;
  outcome: InboundCompletionOutcome;
  result: CommittedInboundResult;
}

export type CompleteInboundResult =
  | { kind: "duplicate"; messageEventId: string }
  | {
      kind: "retry";
      messageEventId: string;
      packageAvailable: true;
    }
  | {
      kind: "completed";
      messageEventId: string;
      packageId: string | null;
      ledgerBalance: number;
      result: CommittedInboundResult;
    };

export interface RecordOutboundDeliveryCommand {
  provider: "selarti";
  externalDeliveryEventId: string;
  providerMessageId: string;
  userId: string;
  deliveryStatus:
    "accepted" | "queued" | "sent" | "delivered" | "failed" | "ambiguous";
  occurredAt: Date;
  correlationId: string;
  charge?: boolean;
}

export interface CompensateDebitCommand {
  originalDebitKey: string;
  idempotencyKey: string;
}

export interface MessageRepository {
  acceptInbound(command: AcceptInboundCommand): Promise<AcceptInboundResult>;
  prepareInbound(command: AcceptInboundCommand): Promise<PreparedInbound>;
  completeInbound(
    command: CompleteInboundCommand,
  ): Promise<CompleteInboundResult>;
  recordOutboundDelivery(
    command: RecordOutboundDeliveryCommand,
  ): Promise<AcceptInboundResult>;
  compensate(
    command: CompensateDebitCommand,
  ): Promise<{ ledgerBalance: number }>;
}

export interface MessageRepositoryOptions {
  beforeCompleteCommit?: () => void | Promise<void>;
  afterCompleteCommit?: (
    result: Extract<CompleteInboundResult, { kind: "completed" }>,
  ) => void | Promise<void>;
}

type Transaction = Parameters<DrizzleDb["transaction"]>[0] extends (
  transaction: infer T,
) => unknown
  ? T
  : never;
type MessageEvent = { id: string };
type PackageBalance = { id: string; balance: number };
type Debit = { id: string; packageId: string };
type Balance = { balance: number };
type CompletionEvent = {
  userId: string;
  provider: string;
  externalMessageId: string;
  occurredAt: Date;
  externalEventId: string;
  payloadHash: string;
};

export class CompensationConflictError extends Error {}
export class ConversationCompletionDataError extends Error {}

function hash(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function hasCode(error: unknown, code: string): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (
    typeof current === "object" &&
    current !== null &&
    !seen.has(current)
  ) {
    seen.add(current);
    if ((current as { code?: unknown }).code === code) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export async function withSerializableRetry<T>(
  operation: () => Promise<T>,
  attempts = 3,
  retryDelayMs: (attempt: number) => number = (attempt) => {
    const ceiling = Math.min(250, 25 * 2 ** attempt);
    return 1 + Math.floor(Math.random() * ceiling);
  },
): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === attempts - 1 || !hasCode(error, "40001")) throw error;
      const configuredDelay = retryDelayMs(attempt);
      const boundedDelay = Number.isFinite(configuredDelay)
        ? Math.min(250, Math.max(0, configuredDelay))
        : 0;
      if (boundedDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, boundedDelay));
      }
    }
  }
  throw new Error("Unreachable serialization retry state");
}

function one<T>(rows: T[], description: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`Expected ${description}`);
  return row;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConversationCompletionDataError(
      "Stored conversation completion payload is invalid",
    );
  }
  return value as Record<string, unknown>;
}

function storedString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ConversationCompletionDataError(
      `Stored conversation completion ${field} is invalid`,
    );
  }
  return value;
}

function storedDate(value: unknown, field: string): Date {
  const date = new Date(storedString(value, field));
  if (!Number.isFinite(date.getTime())) {
    throw new ConversationCompletionDataError(
      `Stored conversation completion ${field} is invalid`,
    );
  }
  return date;
}

function parseStoredCompletion(
  messageEventId: string,
  topic: string,
  rawPayload: unknown,
): StoredCompletion {
  const payload = record(rawPayload);
  if (payload.messageEventId !== messageEventId) {
    throw new ConversationCompletionDataError(
      "Stored conversation completion belongs to another message event",
    );
  }
  const accounting = record(payload.accounting);
  const packageId =
    accounting.packageId === null
      ? null
      : storedString(accounting.packageId, "packageId");
  if (
    typeof accounting.ledgerBalance !== "number" ||
    !Number.isInteger(accounting.ledgerBalance)
  ) {
    throw new ConversationCompletionDataError(
      "Stored conversation completion ledgerBalance is invalid",
    );
  }
  const ledgerBalance = accounting.ledgerBalance;
  const outcomeKind = storedString(payload.outcomeKind, "outcomeKind");
  let outcome: InboundCompletionOutcome;
  if (outcomeKind === "answer" && topic === "selarti.send") {
    outcome = {
      kind: "answer",
      topic,
      payload: { text: storedString(payload.text, "text") },
    };
  } else if (outcomeKind === "no_package" && topic === "client.no_package") {
    outcome = { kind: "no_package", topic, payload: {} };
  } else if (outcomeKind === "show_catalog" && topic === "catalog.show") {
    const serviceCode = payload.serviceCode;
    if (serviceCode !== undefined && typeof serviceCode !== "string") {
      throw new ConversationCompletionDataError(
        "Stored conversation completion serviceCode is invalid",
      );
    }
    if (
      !Array.isArray(payload.allowedServiceCodes) ||
      payload.allowedServiceCodes.some((value) => typeof value !== "string")
    ) {
      throw new ConversationCompletionDataError(
        "Stored conversation completion allowedServiceCodes is invalid",
      );
    }
    outcome = {
      kind: "show_catalog",
      topic,
      payload: {
        ...(serviceCode === undefined ? {} : { serviceCode }),
        allowedServiceCodes: payload.allowedServiceCodes as string[],
      },
    };
  } else if (outcomeKind === "start_booking" && topic === "booking.start") {
    outcome = {
      kind: "start_booking",
      topic,
      payload: { expertId: storedString(payload.expertId, "expertId") },
    };
  } else if (
    outcomeKind === "human_handoff" &&
    topic === "human_handoff.opened"
  ) {
    outcome = {
      kind: "human_handoff",
      topic,
      payload: {
        reasonCode: storedString(payload.reasonCode, "reasonCode"),
      },
      ownerId: storedString(payload.ownerId, "ownerId"),
      openedAt: storedDate(payload.openedAt, "openedAt"),
      acknowledgeBy: storedDate(payload.acknowledgeBy, "acknowledgeBy"),
    };
  } else {
    throw new ConversationCompletionDataError(
      "Stored conversation completion outcome is invalid",
    );
  }
  return {
    messageEventId,
    packageId,
    ledgerBalance,
    outcome,
    result: committedResultFor(outcome, packageId !== null),
  };
}

function committedResultFor(
  outcome: InboundCompletionOutcome,
  charged = true,
): CommittedInboundResult {
  switch (outcome.kind) {
    case "answer":
      return { kind: "answer_queued", chargedMessages: charged ? 1 : 0 };
    case "no_package":
      return { kind: "no_package", chargedMessages: 0 };
    case "show_catalog":
      return { kind: "catalog_requested", chargedMessages: charged ? 1 : 0 };
    case "start_booking":
      return { kind: "booking_started", chargedMessages: charged ? 1 : 0 };
    case "human_handoff":
      return {
        kind: "human_handoff",
        reasonCode: outcome.payload.reasonCode,
        chargedMessages: 1,
      };
  }
}

export class PostgresMessageRepository implements MessageRepository {
  private readonly inbox = new PostgresInboxRepository();

  constructor(
    private readonly db: DrizzleDb,
    private readonly options: MessageRepositoryOptions = {},
  ) {}

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
      charge: command.messageClass === "ordinary_inbound",
    });
  }

  prepareInbound(command: AcceptInboundCommand): Promise<PreparedInbound> {
    const payloadHash = hash({
      provider: command.provider,
      externalEventId: command.externalEventId,
      externalMessageId: command.externalMessageId,
      userId: command.userId,
      messageClass: command.messageClass,
      occurredAt: command.occurredAt.toISOString(),
      correlationId: command.correlationId,
    });
    return withSerializableRetry(() =>
      this.db.transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level serializable`);
        const inbox = await this.inbox.claim(tx, {
          provider: command.provider,
          externalEventId: command.externalEventId,
          payloadHash,
          normalizedIdentifier: command.externalMessageId,
        });
        let messageEventId: string;
        if (inbox.kind === "duplicate") {
          if (!inbox.payloadMatches) throw new InboxPayloadMismatchError();
          messageEventId = inbox.messageEventId;
          if (await this.hasAccountingFact(tx, messageEventId)) {
            return { kind: "duplicate", messageEventId };
          }
        } else {
          const event = one(
            (
              await tx.execute<MessageEvent>(sql`
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
                )
                returning id
              `)
            ).rows,
            "an inserted pending message event",
          );
          messageEventId = event.id;
          await this.inbox.associate(tx, inbox.inboxId, messageEventId);
        }
        return {
          kind: "pending",
          messageEventId,
          packageAvailable: await this.packageAvailable(
            tx,
            command.userId,
            command.occurredAt,
          ),
        };
      }),
    );
  }

  async completeInbound(
    command: CompleteInboundCommand,
  ): Promise<CompleteInboundResult> {
    const result = await withSerializableRetry(() =>
      this.db.transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level serializable`);
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${command.userId}, 0))`,
        );
        const event = one(
          (
            await tx.execute<CompletionEvent>(sql`
              select
                e.user_id as "userId",
                e.provider,
                e.external_message_id as "externalMessageId",
                e.created_at as "occurredAt",
                i.external_event_id as "externalEventId",
                i.payload_hash as "payloadHash"
              from message_events e
              join integration_inbox i on i.message_event_id = e.id
              where e.id = ${command.messageEventId}::uuid
                and e.direction = 'inbound'
              for update of e, i
            `)
          ).rows,
          "a prepared inbound message",
        );
        if (event.userId !== command.userId) {
          throw new ConversationCompletionDataError(
            "Prepared inbound message belongs to another user",
          );
        }
        const existing = await this.storedCompletion(
          tx,
          command.messageEventId,
        );
        if (existing !== undefined) {
          return {
            kind: "duplicate" as const,
            messageEventId: existing.messageEventId,
          };
        }
        if (await this.hasAccountingFact(tx, command.messageEventId)) {
          throw new ConversationCompletionDataError(
            "Inbound accounting fact exists without a completion outbox record",
          );
        }

        let charged:
          { packageId: string | null; ledgerBalance: number } | undefined;
        let outcome = command.outcome;
        if (command.billingPolicy === "free") {
          charged = await this.free(tx, command.messageEventId, "inbound");
        } else if (outcome.kind === "no_package") {
          if (
            await this.packageAvailable(tx, command.userId, event.occurredAt)
          ) {
            return {
              kind: "retry" as const,
              messageEventId: command.messageEventId,
              packageAvailable: true as const,
            };
          }
          charged = await this.free(tx, command.messageEventId, "inbound");
        } else {
          charged = await this.debit(
            tx,
            command.userId,
            event.occurredAt,
            command.messageEventId,
            "inbound",
            `inbound:${event.provider}:${event.externalMessageId}`,
          );
          if (charged.packageId === null) {
            charged = await this.free(tx, command.messageEventId, "inbound");
            outcome = {
              kind: "no_package",
              topic: "client.no_package",
              payload: {},
            };
          }
        }
        if (outcome.kind === "human_handoff") {
          await this.persistHandoff(tx, command, event.payloadHash, outcome);
        }
        await this.auditCompletionAndOutbox(
          tx,
          command,
          event,
          outcome,
          charged,
        );
        await this.options.beforeCompleteCommit?.();
        return {
          kind: "completed" as const,
          messageEventId: command.messageEventId,
          packageId: charged.packageId,
          ledgerBalance: charged.ledgerBalance,
          result: committedResultFor(outcome, charged.packageId !== null),
        };
      }),
    );
    if (result.kind === "completed") {
      await this.options.afterCompleteCommit?.(result);
    }
    return result;
  }

  recordOutboundDelivery(
    command: RecordOutboundDeliveryCommand,
  ): Promise<AcceptInboundResult> {
    return this.acceptMessage({
      provider: command.provider,
      externalEventId: command.externalDeliveryEventId,
      externalMessageId: command.providerMessageId,
      userId: command.userId,
      direction: "outbound",
      messageClass: "ordinary_inbound",
      occurredAt: command.occurredAt,
      correlationId: command.correlationId,
      charge:
        command.deliveryStatus === "delivered" && (command.charge ?? true),
      payloadHash: hash({
        provider: command.provider,
        externalDeliveryEventId: command.externalDeliveryEventId,
        providerMessageId: command.providerMessageId,
        userId: command.userId,
        deliveryStatus: command.deliveryStatus,
        charge: String(command.charge ?? true),
        occurredAt: command.occurredAt.toISOString(),
        correlationId: command.correlationId,
      }),
    });
  }

  async compensate(
    command: CompensateDebitCommand,
  ): Promise<{ ledgerBalance: number }> {
    try {
      return await withSerializableRetry(() =>
        this.db.transaction(async (tx) => {
          await tx.execute(sql`set transaction isolation level serializable`);
          const debit = one(
            (
              await tx.execute<Debit>(sql`
        select l.id, l.package_id as "packageId"
        from message_ledger_entries l
        join message_packages p on p.id = l.package_id
        where l.entry_kind = 'debit' and l.idempotency_key = ${command.originalDebitKey}
        for update of p, l
      `)
            ).rows,
            "the original debit",
          );
          const existing = (
            await tx.execute<{ idempotencyKey: string }>(sql`
        select idempotency_key as "idempotencyKey"
        from message_ledger_entries
        where entry_kind = 'compensation' and original_entry_id = ${debit.id}::uuid
      `)
          ).rows[0];
          if (existing !== undefined) {
            if (existing.idempotencyKey !== command.idempotencyKey) {
              throw new CompensationConflictError(
                "Original debit already compensated with another key",
              );
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
        }),
      );
    } catch (error) {
      if (!hasCode(error, "23505")) throw error;
      return this.resolveCompensationConflict(command);
    }
  }

  private async packageAvailable(
    tx: Transaction,
    userId: string,
    occurredAt: Date,
  ): Promise<boolean> {
    const result = one(
      (
        await tx.execute<{ available: boolean }>(sql`
          select exists(
            select 1
            from message_packages p
            cross join lateral (
              select coalesce(sum(l.delta), 0)::integer as balance
              from message_ledger_entries l
              where l.package_id = p.id
            ) balances
            where p.user_id = ${userId}::uuid
              and balances.balance > 0
              and (p.expires_at is null or p.expires_at > ${occurredAt})
          ) as available
        `)
      ).rows,
      "a package availability decision",
    );
    return result.available;
  }

  private async hasAccountingFact(
    tx: Transaction,
    messageEventId: string,
  ): Promise<boolean> {
    const result = one(
      (
        await tx.execute<{ accounted: boolean }>(sql`
          select exists(
            select 1
            from message_ledger_entries
            where message_event_id = ${messageEventId}::uuid
              and direction = 'inbound'
              and entry_kind in ('debit', 'free')
          ) as accounted
        `)
      ).rows,
      "an inbound accounting state",
    );
    return result.accounted;
  }

  private async storedCompletion(
    tx: Transaction,
    messageEventId: string,
  ): Promise<StoredCompletion | undefined> {
    const stored = (
      await tx.execute<{ topic: string; payload: unknown }>(sql`
        select topic, payload
        from integration_outbox
        where idempotency_key = ${`conversation:${messageEventId}`}
      `)
    ).rows[0];
    return stored === undefined
      ? undefined
      : parseStoredCompletion(messageEventId, stored.topic, stored.payload);
  }

  private async persistHandoff(
    tx: Transaction,
    command: CompleteInboundCommand,
    payloadHash: string,
    outcome: Extract<InboundCompletionOutcome, { kind: "human_handoff" }>,
  ): Promise<void> {
    const incident = one(
      (
        await tx.execute<MessageEvent>(sql`
          insert into safety_incidents (reason_code, metadata_hash)
          values (
            ${outcome.payload.reasonCode},
            ${hash({
              messageEventId: command.messageEventId,
              payloadHash,
              reasonCode: outcome.payload.reasonCode,
            })}
          )
          returning id
        `)
      ).rows,
      "a human-handoff incident",
    );
    const handoff = one(
      (
        await tx.execute<MessageEvent>(sql`
          insert into human_escalations (
            incident_id,
            status,
            owner_id,
            opened_at,
            acknowledgement_deadline,
            escalation_reason
          ) values (
            ${incident.id}::uuid,
            'opened',
            ${outcome.ownerId}::uuid,
            ${outcome.openedAt},
            ${outcome.acknowledgeBy},
            ${outcome.payload.reasonCode}
          )
          returning id
        `)
      ).rows,
      "a human handoff",
    );
    await tx.execute(sql`
      insert into audit_events (
        actor_type,
        actor_id,
        authenticated_session_id_hash,
        action,
        object_type,
        object_id,
        decision,
        reason_code,
        correlation_id,
        occurred_at,
        metadata_hash
      ) values (
        'system',
        ${command.userId}::uuid,
        ${hash({ userId: command.userId, action: "human_handoff" })},
        'conversation.handoff_opened',
        'human_escalation',
        ${handoff.id}::uuid,
        'opened',
        ${outcome.payload.reasonCode},
        ${command.correlationId},
        ${outcome.openedAt},
        ${payloadHash}
      )
    `);
  }

  private async auditCompletionAndOutbox(
    tx: Transaction,
    command: CompleteInboundCommand,
    event: CompletionEvent,
    outcome: InboundCompletionOutcome,
    charged: { packageId: string | null; ledgerBalance: number },
  ): Promise<void> {
    const completionPayload = {
      messageEventId: command.messageEventId,
      outcomeKind: outcome.kind,
      ...outcome.payload,
      ...(outcome.kind === "human_handoff"
        ? {
            ownerId: outcome.ownerId,
            openedAt: outcome.openedAt.toISOString(),
            acknowledgeBy: outcome.acknowledgeBy.toISOString(),
          }
        : {}),
      accounting: charged,
    };
    const completionHash = hash(completionPayload);
    await tx.execute(sql`
      insert into audit_events (
        actor_type,
        actor_id,
        authenticated_session_id_hash,
        action,
        object_type,
        object_id,
        decision,
        reason_code,
        correlation_id,
        occurred_at,
        metadata_hash
      ) values (
        'provider',
        ${command.userId}::uuid,
        ${hash({ provider: event.provider, userId: command.userId })},
        'conversation.inbound_completed',
        'message_event',
        ${command.messageEventId}::uuid,
        'accepted',
        ${outcome.kind},
        ${command.correlationId},
        ${event.occurredAt},
        ${completionHash}
      )
    `);
    await tx.execute(sql`
      insert into integration_outbox (
        idempotency_key,
        topic,
        payload,
        correlation_id,
        reconciliation_key,
        payload_hash
      ) values (
        ${`conversation:${command.messageEventId}`},
        ${outcome.topic},
        ${JSON.stringify(completionPayload)}::jsonb,
        ${command.correlationId},
        ${`conversation:${command.messageEventId}`},
        ${completionHash}
      )
    `);
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
    charge: boolean;
  }): Promise<AcceptInboundResult> {
    return withSerializableRetry(() =>
      this.db.transaction(async (tx) => {
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
        const event = one(
          (
            await tx.execute<MessageEvent>(sql`
        insert into message_events (user_id, provider, external_message_id, direction, created_at)
        values (${command.userId}::uuid, ${command.provider}, ${command.externalMessageId}, ${command.direction}, ${command.occurredAt})
        returning id
      `)
          ).rows,
          "an inserted message event",
        );
        await this.inbox.associate(tx, inbox.inboxId, event.id);
        const charged = command.charge
          ? await this.debit(
              tx,
              command.userId,
              command.occurredAt,
              event.id,
              command.direction,
              `${command.direction}:${command.provider}:${command.externalMessageId}`,
            )
          : await this.free(tx, event.id, command.direction);
        await this.auditAndOutbox(tx, command, event.id);
        return { kind: "accepted", messageEventId: event.id, ...charged };
      }),
    );
  }

  private async debit(
    tx: Transaction,
    userId: string,
    occurredAt: Date,
    eventId: string,
    direction: "inbound" | "outbound",
    idempotencyKey: string,
  ): Promise<{ packageId: string | null; ledgerBalance: number }> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`,
    );
    const packageRow = (
      await tx.execute<PackageBalance>(sql`
      select p.id, balances.balance
      from message_packages p
      cross join lateral (
        select coalesce(sum(l.delta), 0)::integer as balance from message_ledger_entries l where l.package_id = p.id
      ) balances
      where p.user_id = ${userId}::uuid and balances.balance > 0
        and (p.expires_at is null or p.expires_at > ${occurredAt})
      order by (p.kind = 'intro') asc, p.expires_at asc nulls last, p.granted_at asc, p.id asc
      for update of p limit 1
    `)
    ).rows[0];
    if (packageRow === undefined) return { packageId: null, ledgerBalance: 0 };
    await tx.execute(sql`
      insert into message_ledger_entries (package_id, entry_kind, delta, direction, message_event_id, idempotency_key)
      values (${packageRow.id}::uuid, 'debit', -1, ${direction}, ${eventId}::uuid, ${idempotencyKey})
    `);
    return {
      packageId: packageRow.id,
      ledgerBalance: Number(packageRow.balance) - 1,
    };
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
      provider: string;
      externalEventId: string;
      userId: string;
      direction: string;
      messageClass: string;
      occurredAt: Date;
      correlationId: string;
      payloadHash: string;
    },
    eventId: string,
  ): Promise<void> {
    const sessionHash = hash({
      provider: command.provider,
      userId: command.userId,
    });
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
    const outboxKey = hash({
      provider: command.provider,
      externalEventId: command.externalEventId,
      direction: command.direction,
    });
    await tx.execute(sql`
      insert into integration_outbox (
        idempotency_key, topic, payload, correlation_id,
        reconciliation_key, payload_hash
      )
      values (
        ${`message:${outboxKey}`},
        'message.accounted',
        ${JSON.stringify({
          messageEventId: eventId,
          provider: command.provider,
          direction: command.direction,
        })}::jsonb,
        ${command.correlationId},
        ${`message:${outboxKey}`},
        ${command.payloadHash}
      )
    `);
  }

  private async balance(
    tx: Transaction,
    packageId: string,
  ): Promise<{ ledgerBalance: number }> {
    const result = one(
      (
        await tx.execute<Balance>(sql`
      select coalesce(sum(delta), 0)::integer as balance from message_ledger_entries where package_id = ${packageId}::uuid
    `)
      ).rows,
      "a package balance",
    );
    return { ledgerBalance: Number(result.balance) };
  }

  private async resolveCompensationConflict(
    command: CompensateDebitCommand,
  ): Promise<{ ledgerBalance: number }> {
    return this.db.transaction(async (tx) => {
      const debit = one(
        (
          await tx.execute<Debit>(sql`
        select id, package_id as "packageId" from message_ledger_entries
        where entry_kind = 'debit' and idempotency_key = ${command.originalDebitKey}
      `)
        ).rows,
        "the original debit after a compensation conflict",
      );
      const byKey = (
        await tx.execute<{ originalEntryId: string }>(sql`
        select original_entry_id as "originalEntryId" from message_ledger_entries
        where idempotency_key = ${command.idempotencyKey}
      `)
      ).rows[0];
      if (byKey?.originalEntryId !== debit.id) {
        throw new CompensationConflictError(
          "Compensation key belongs to another debit",
        );
      }
      const byOriginal = (
        await tx.execute<{ idempotencyKey: string }>(sql`
        select idempotency_key as "idempotencyKey" from message_ledger_entries
        where entry_kind = 'compensation' and original_entry_id = ${debit.id}::uuid
      `)
      ).rows[0];
      if (byOriginal === undefined)
        throw new Error("Compensation conflict could not be resolved");
      if (byOriginal.idempotencyKey !== command.idempotencyKey) {
        throw new CompensationConflictError(
          "Original debit already compensated with another key",
        );
      }
      return this.balance(tx, debit.packageId);
    });
  }
}
