import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { withSerializableRetry, type DrizzleDb } from "@ii-tonya/db";
import {
  SandboxPaymentConflictError,
  createSandboxCheckoutCommandSchema,
  sandboxCheckoutSchema,
  sandboxProviderEventSchema,
  transitionSandboxPaymentCommandSchema,
  type CreateSandboxCheckoutCommand,
  type SandboxCheckout,
  type SandboxProviderEvent,
  type TransitionSandboxPaymentCommand,
} from "./contracts.js";

type Transaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];
type Executor = Pick<DrizzleDb, "execute"> | Transaction;
const repositoryEvents = new WeakSet<object>();

type StoredCommandRow = Record<string, unknown> & {
  payloadDigest: string;
  result: unknown;
};

type PaymentRow = Record<string, unknown> & {
  paymentId: string;
  orderId: string;
  amountMinor: bigint | string;
  currency: "RUB";
  checkoutUrl: string;
  state: "created" | "settled" | "refunded";
  version: number;
};

const migrationPath = fileURLToPath(
  new URL("../migrations/0000_sandbox_expert_residency.sql", import.meta.url),
);

const opaqueId = (prefix: string): string =>
  `${prefix}${randomBytes(24).toString("base64url")}`;

const canonicalJson = (value: unknown): string => JSON.stringify(value);

const payloadDigest = (value: unknown): string =>
  `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;

const isoInstant = (value: Date | string): string =>
  new Date(value).toISOString();

const required = <T>(value: T | undefined, code: string): T => {
  if (value === undefined) throw new Error(code);
  return value;
};

async function storedCommand(
  executor: Executor,
  commandKind: "checkout" | "transition",
  idempotencyKey: string,
): Promise<StoredCommandRow | undefined> {
  const result = await executor.execute<StoredCommandRow>(sql`
    select payload_digest as "payloadDigest", result
    from sandbox_expert_residency_commands
    where command_kind = ${commandKind}
      and idempotency_key = ${idempotencyKey}
    for update
  `);
  return result.rows[0];
}

function replayResult<T>(
  stored: StoredCommandRow,
  digest: string,
  parse: (value: unknown) => T,
): T {
  if (stored.payloadDigest !== digest) {
    throw new SandboxPaymentConflictError();
  }
  return parse(stored.result);
}

function repositoryEvent(value: unknown): SandboxProviderEvent {
  const event = Object.freeze(sandboxProviderEventSchema.parse(value));
  repositoryEvents.add(event);
  return event;
}

export function isRepositoryOwnedSandboxEvent(
  value: unknown,
): value is SandboxProviderEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.isFrozen(value) &&
    repositoryEvents.has(value)
  );
}

export async function migrateSandboxDatabase(db: DrizzleDb): Promise<void> {
  const migration = await readFile(migrationPath, "utf8");
  await db.execute(sql.raw(migration));
}

export class PostgresSandboxPaymentRepository {
  readonly #checkoutBaseUrl: URL;

  constructor(
    private readonly db: DrizzleDb,
    checkoutBaseUrl: URL,
  ) {
    if (
      !["http:", "https:"].includes(checkoutBaseUrl.protocol) ||
      checkoutBaseUrl.username !== "" ||
      checkoutBaseUrl.password !== ""
    ) {
      throw new Error("sandbox_checkout_base_url_invalid");
    }
    this.#checkoutBaseUrl = new URL(checkoutBaseUrl);
  }

  async assertSandboxDatabase(): Promise<void> {
    const marker = await this.db.execute<{ valid: boolean }>(sql`
      select count(*) = 1 and bool_and(
        singleton and marker = 'ii_tonya_sandbox_v1'
      ) as valid
      from sandbox_expert_residency_environment
    `);
    if (marker.rows[0]?.valid !== true) {
      throw new Error("sandbox_database_marker_missing");
    }
  }

  async createCheckout(
    command: CreateSandboxCheckoutCommand,
  ): Promise<SandboxCheckout> {
    const parsed = createSandboxCheckoutCommandSchema.parse(command);
    const canonicalCommand = {
      orderId: parsed.orderId,
      amountMinor: parsed.amountMinor,
      currency: parsed.currency,
      idempotencyKey: parsed.idempotencyKey,
    };
    const digest = payloadDigest(canonicalCommand);

    return withSerializableRetry(() =>
      this.db.transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level serializable`);
        const replay = await storedCommand(
          tx,
          "checkout",
          parsed.idempotencyKey,
        );
        if (replay) {
          return replayResult(replay, digest, (value) =>
            sandboxCheckoutSchema.parse(value),
          );
        }

        const paymentId = opaqueId("sandbox_payment_");
        const checkoutUrl = new URL(
          `/sandbox/v1/payments/${paymentId}`,
          this.#checkoutBaseUrl,
        ).toString();
        const result: SandboxCheckout = {
          kind: "created",
          paymentId,
          checkoutUrl,
          state: "created",
          version: 0,
        };
        await tx.execute(sql`
          insert into sandbox_expert_residency_payments (
            payment_id, order_id, amount_minor, currency, checkout_url,
            state, version, created_at, updated_at
          ) values (
            ${paymentId}, ${parsed.orderId}::uuid, ${BigInt(parsed.amountMinor)},
            ${parsed.currency}, ${checkoutUrl}, 'created', 0,
            transaction_timestamp(), transaction_timestamp()
          )
        `);
        await tx.execute(sql`
          insert into sandbox_expert_residency_commands (
            command_id, payment_id, command_kind, idempotency_key,
            payload_digest, result, created_at
          ) values (
            ${opaqueId("sandbox_command_")}, ${paymentId}, 'checkout',
            ${parsed.idempotencyKey}, ${digest},
            ${JSON.stringify(result)}::jsonb, transaction_timestamp()
          )
        `);
        return result;
      }),
    );
  }

  async transition(
    command: TransitionSandboxPaymentCommand,
  ): Promise<SandboxProviderEvent> {
    const parsed = transitionSandboxPaymentCommandSchema.parse(command);
    const canonicalCommand = {
      paymentId: parsed.paymentId,
      transition: parsed.transition,
      expectedVersion: parsed.expectedVersion,
      idempotencyKey: parsed.idempotencyKey,
      correlationId: parsed.correlationId,
    };
    const commandDigest = payloadDigest(canonicalCommand);

    return withSerializableRetry(() =>
      this.db.transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level serializable`);
        const replay = await storedCommand(
          tx,
          "transition",
          parsed.idempotencyKey,
        );
        if (replay) {
          return repositoryEvent(
            replayResult(replay, commandDigest, (value) => value),
          );
        }

        const paymentResult = await tx.execute<PaymentRow>(sql`
          select payment_id as "paymentId", order_id as "orderId",
            amount_minor as "amountMinor", currency, checkout_url as "checkoutUrl",
            state, version
          from sandbox_expert_residency_payments
          where payment_id = ${parsed.paymentId}
          for update
        `);
        const payment = paymentResult.rows[0];
        const expectedState =
          parsed.transition === "settled" ? "created" : "settled";
        if (
          payment === undefined ||
          payment.version !== parsed.expectedVersion ||
          payment.state !== expectedState
        ) {
          throw new SandboxPaymentConflictError();
        }

        const updated = await tx.execute<{
          state: "settled" | "refunded";
          version: number;
          occurredAt: Date | string;
        }>(sql`
          update sandbox_expert_residency_payments
          set state = ${parsed.transition}, version = version + 1,
              updated_at = transaction_timestamp()
          where payment_id = ${parsed.paymentId}
            and version = ${parsed.expectedVersion}
            and state = ${expectedState}
          returning state, version, updated_at as "occurredAt"
        `);
        const paymentAfter = required(
          updated.rows[0],
          "sandbox_payment_locked_transition_missing",
        );
        const eventId = opaqueId("sandbox_event_");
        const occurredAt = isoInstant(paymentAfter.occurredAt);
        const eventFacts = {
          provider: "ii_tonya_sandbox" as const,
          eventId,
          kind: parsed.transition,
          paymentId: payment.paymentId,
          orderId: payment.orderId,
          amountMinor: payment.amountMinor.toString(),
          currency: payment.currency,
          occurredAt,
          correlationId: parsed.correlationId,
          state: paymentAfter.state,
          version: paymentAfter.version,
        };
        const event: SandboxProviderEvent = {
          ...eventFacts,
          payloadDigest: payloadDigest(eventFacts),
        };
        sandboxProviderEventSchema.parse(event);

        await tx.execute(sql`
          insert into sandbox_expert_residency_events (
            event_id, payment_id, transition_kind, payload_digest, payload,
            correlation_id, occurred_at
          ) values (
            ${event.eventId}, ${event.paymentId}, ${event.kind},
            ${event.payloadDigest}, ${JSON.stringify(event)}::jsonb,
            ${event.correlationId}, transaction_timestamp()
          )
        `);
        await tx.execute(sql`
          insert into sandbox_expert_residency_commands (
            command_id, payment_id, command_kind, idempotency_key,
            payload_digest, result, created_at
          ) values (
            ${opaqueId("sandbox_command_")}, ${event.paymentId}, 'transition',
            ${parsed.idempotencyKey}, ${commandDigest},
            ${JSON.stringify(event)}::jsonb, transaction_timestamp()
          )
        `);
        return repositoryEvent(event);
      }),
    );
  }

  async transitionInTransaction(
    tx: Transaction,
    command: TransitionSandboxPaymentCommand,
  ): Promise<{ event: SandboxProviderEvent; replayed: boolean }> {
    const parsed = transitionSandboxPaymentCommandSchema.parse(command);
    const canonicalCommand = {
      paymentId: parsed.paymentId,
      transition: parsed.transition,
      expectedVersion: parsed.expectedVersion,
      idempotencyKey: parsed.idempotencyKey,
      correlationId: parsed.correlationId,
    };
    const commandDigest = payloadDigest(canonicalCommand);
    const replay = await storedCommand(tx, "transition", parsed.idempotencyKey);
    if (replay)
      return {
        event: repositoryEvent(
          replayResult(replay, commandDigest, (value) => value),
        ),
        replayed: true,
      };
    const paymentResult = await tx.execute<PaymentRow>(
      sql`select payment_id as "paymentId", order_id as "orderId", amount_minor as "amountMinor", currency, checkout_url as "checkoutUrl", state, version from sandbox_expert_residency_payments where payment_id=${parsed.paymentId} for update`,
    );
    const payment = paymentResult.rows[0];
    const expectedState =
      parsed.transition === "settled" ? "created" : "settled";
    if (
      !payment ||
      payment.version !== parsed.expectedVersion ||
      payment.state !== expectedState
    )
      throw new SandboxPaymentConflictError();
    const updated = await tx.execute<{
      state: "settled" | "refunded";
      version: number;
      occurredAt: Date | string;
    }>(
      sql`update sandbox_expert_residency_payments set state=${parsed.transition}, version=version+1, updated_at=transaction_timestamp() where payment_id=${parsed.paymentId} and version=${parsed.expectedVersion} and state=${expectedState} returning state,version,updated_at as "occurredAt"`,
    );
    const after = required(
      updated.rows[0],
      "sandbox_payment_locked_transition_missing",
    );
    const eventFacts = {
      provider: "ii_tonya_sandbox" as const,
      eventId: opaqueId("sandbox_event_"),
      kind: parsed.transition,
      paymentId: payment.paymentId,
      orderId: payment.orderId,
      amountMinor: payment.amountMinor.toString(),
      currency: payment.currency,
      occurredAt: isoInstant(after.occurredAt),
      correlationId: parsed.correlationId,
      state: after.state,
      version: after.version,
    };
    const event: SandboxProviderEvent = {
      ...eventFacts,
      payloadDigest: payloadDigest(eventFacts),
    };
    sandboxProviderEventSchema.parse(event);
    await tx.execute(
      sql`insert into sandbox_expert_residency_events (event_id,payment_id,transition_kind,payload_digest,payload,correlation_id,occurred_at) values (${event.eventId},${event.paymentId},${event.kind},${event.payloadDigest},${JSON.stringify(event)}::jsonb,${event.correlationId},transaction_timestamp())`,
    );
    await tx.execute(
      sql`insert into sandbox_expert_residency_commands (command_id,payment_id,command_kind,idempotency_key,payload_digest,result,created_at) values (${opaqueId("sandbox_command_")},${event.paymentId},'transition',${parsed.idempotencyKey},${commandDigest},${JSON.stringify(event)}::jsonb,transaction_timestamp())`,
    );
    return { event: repositoryEvent(event), replayed: false };
  }

  async nextPendingEvent(
    paymentId: string,
  ): Promise<SandboxProviderEvent | null> {
    const parsedPaymentId =
      transitionSandboxPaymentCommandSchema.shape.paymentId.parse(paymentId);
    const result = await this.db.execute<{ payload: unknown }>(sql`
      select payload
      from sandbox_expert_residency_events
      where payment_id = ${parsedPaymentId} and processed_at is null
      order by occurred_at, event_id
      limit 1
    `);
    const row = result.rows[0];
    return row ? repositoryEvent(row.payload) : null;
  }

  async markEventProcessed(eventId: string): Promise<void> {
    const parsedEventId =
      sandboxProviderEventSchema.shape.eventId.parse(eventId);
    const result = await this.db.execute<{ eventId: string }>(sql`
      update sandbox_expert_residency_events
      set processed_at = transaction_timestamp()
      where event_id = ${parsedEventId} and processed_at is null
      returning event_id as "eventId"
    `);
    if (!result.rows[0]) {
      const existing = await this.db.execute<{ present: boolean }>(sql`
        select exists(
          select 1 from sandbox_expert_residency_events
          where event_id = ${parsedEventId} and processed_at is not null
        ) as present
      `);
      if (existing.rows[0]?.present !== true) {
        throw new SandboxPaymentConflictError("Sandbox event was not found");
      }
    }
  }
}
