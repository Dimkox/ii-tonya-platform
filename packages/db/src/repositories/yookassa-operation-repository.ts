import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type {
  ClaimYooKassaOperationCommand,
  YooKassaOperation,
  YooKassaOperationPort,
  YooKassaOperationStatus,
} from "@ii-tonya/integrations";
import type { DrizzleDb } from "../client.js";
import { withSerializableRetry } from "./message-repository.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const PROVIDER_ID = /^[A-Za-z0-9_-]{1,64}$/u;

export type YooKassaOperationErrorCode =
  | "YOOKASSA_OPERATION_INVALID"
  | "YOOKASSA_OPERATION_NOT_FOUND"
  | "YOOKASSA_IDEMPOTENCY_CONFLICT"
  | "YOOKASSA_PROVIDER_BINDING_CONFLICT";

export class YooKassaOperationError extends Error {
  constructor(readonly code: YooKassaOperationErrorCode) {
    super(code);
    this.name = "YooKassaOperationError";
  }
}

export const canonicalYooKassaRequestDigest = (
  command: ClaimYooKassaOperationCommand,
): string =>
  `sha256:${createHash("sha256")
    .update(
      JSON.stringify([
        command.commandId,
        command.orderId,
        command.paymentAttemptId,
        command.kind,
        command.mode,
        command.amountMinor,
        command.currency,
        command.requestDigest,
        command.parentPaymentId ?? null,
      ]),
      "utf8",
    )
    .digest("hex")}`;

interface StoredOperation extends Record<string, unknown> {
  id: string;
  orderId: string;
  paymentAttemptId: string;
  operationKind: "create_payment" | "create_refund";
  environmentMode: "test" | "live";
  providerObjectId: string | null;
  parentPaymentId: string | null;
  amountMinor: string;
  currency: "RUB";
  requestDigest: string;
  claimDigest: string;
  idempotencyKey: string;
  status: YooKassaOperationStatus;
}

const toOperation = (row: StoredOperation): YooKassaOperation => ({
  id: row.id,
  orderId: row.orderId,
  paymentAttemptId: row.paymentAttemptId,
  kind: row.operationKind,
  mode: row.environmentMode,
  amountMinor: row.amountMinor,
  currency: row.currency,
  requestDigest: row.requestDigest,
  idempotencyKey: row.idempotencyKey,
  ...(row.providerObjectId === null
    ? {}
    : { providerObjectId: row.providerObjectId }),
  ...(row.parentPaymentId === null
    ? {}
    : { parentPaymentId: row.parentPaymentId }),
  status: row.status,
});

const validateClaim = (command: ClaimYooKassaOperationCommand): void => {
  const amount = /^\d{1,12}$/u.test(command.amountMinor)
    ? BigInt(command.amountMinor)
    : 0n;
  if (
    !UUID.test(command.commandId) ||
    !UUID.test(command.orderId) ||
    !UUID.test(command.paymentAttemptId) ||
    !DIGEST.test(command.requestDigest) ||
    amount <= 0n ||
    amount > 999_999_999_999n ||
    command.currency !== "RUB" ||
    (command.kind === "create_payment" &&
      command.parentPaymentId !== undefined) ||
    (command.kind === "create_refund" &&
      !PROVIDER_ID.test(command.parentPaymentId ?? ""))
  ) {
    throw new YooKassaOperationError("YOOKASSA_OPERATION_INVALID");
  }
};

const selectOperation = async (
  executor: Pick<DrizzleDb, "execute">,
  operationId: string,
  forUpdate = false,
): Promise<StoredOperation | undefined> => {
  const result = await executor.execute<StoredOperation>(sql`
    select id, order_id as "orderId",
      payment_attempt_id as "paymentAttemptId",
      operation_kind as "operationKind",
      environment_mode as "environmentMode",
      provider_object_id as "providerObjectId",
      parent_payment_id as "parentPaymentId",
      amount_minor::text as "amountMinor", currency,
      request_digest as "requestDigest", claim_digest as "claimDigest",
      idempotency_key::text as "idempotencyKey", status
    from expert_residency_provider_operations
    where id = ${operationId}::uuid
    ${forUpdate ? sql`for update` : sql``}
  `);
  return result.rows[0];
};

export class PostgresYooKassaOperationRepository implements YooKassaOperationPort {
  constructor(private readonly db: DrizzleDb) {}

  async claim(
    command: ClaimYooKassaOperationCommand,
  ): Promise<YooKassaOperation> {
    validateClaim(command);
    const claimDigest = canonicalYooKassaRequestDigest(command);
    return withSerializableRetry(() =>
      this.db.transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level serializable`);
        const parent = await tx.execute<{ id: string }>(sql`
          select a.id
          from expert_residency_payment_attempts a
          join expert_residency_orders o on o.id = a.order_id
          where a.id = ${command.paymentAttemptId}::uuid
            and a.order_id = ${command.orderId}::uuid
          for update of a, o
        `);
        if (parent.rows.length !== 1) {
          throw new YooKassaOperationError("YOOKASSA_OPERATION_INVALID");
        }
        await tx.execute(sql`
          insert into expert_residency_provider_operations (
            command_id, order_id, payment_attempt_id, operation_kind,
            provider, environment_mode, parent_payment_id, amount_minor,
            currency, request_digest, claim_digest
          ) values (
            ${command.commandId}::uuid, ${command.orderId}::uuid,
            ${command.paymentAttemptId}::uuid, ${command.kind}, 'yookassa',
            ${command.mode}, ${command.parentPaymentId ?? null},
            ${command.amountMinor}::bigint, 'RUB', ${command.requestDigest},
            ${claimDigest}
          ) on conflict (provider, command_id) do nothing
        `);
        const selected = await tx.execute<StoredOperation>(sql`
          select id, order_id as "orderId",
            payment_attempt_id as "paymentAttemptId",
            operation_kind as "operationKind",
            environment_mode as "environmentMode",
            provider_object_id as "providerObjectId",
            parent_payment_id as "parentPaymentId",
            amount_minor::text as "amountMinor", currency,
            request_digest as "requestDigest", claim_digest as "claimDigest",
            idempotency_key::text as "idempotencyKey", status
          from expert_residency_provider_operations
          where provider = 'yookassa' and command_id = ${command.commandId}::uuid
          for update
        `);
        const row = selected.rows[0];
        if (row === undefined || row.claimDigest !== claimDigest) {
          throw new YooKassaOperationError("YOOKASSA_IDEMPOTENCY_CONFLICT");
        }
        return toOperation(row);
      }),
    );
  }

  async bindProviderObject(
    operationId: string,
    providerObjectId: string,
  ): Promise<YooKassaOperation> {
    if (!UUID.test(operationId) || !PROVIDER_ID.test(providerObjectId)) {
      throw new YooKassaOperationError("YOOKASSA_OPERATION_INVALID");
    }
    try {
      return await this.db.transaction(async (tx) => {
        const existing = await selectOperation(
          tx as unknown as DrizzleDb,
          operationId,
          true,
        );
        if (existing === undefined) {
          throw new YooKassaOperationError("YOOKASSA_OPERATION_NOT_FOUND");
        }
        if (
          existing.providerObjectId !== null &&
          existing.providerObjectId !== providerObjectId
        ) {
          throw new YooKassaOperationError(
            "YOOKASSA_PROVIDER_BINDING_CONFLICT",
          );
        }
        if (existing.providerObjectId === null) {
          await tx.execute(sql`
            update expert_residency_provider_operations
            set provider_object_id = ${providerObjectId}, status = 'pending',
                updated_at = transaction_timestamp()
            where id = ${operationId}::uuid and provider_object_id is null
          `);
        }
        const updated = await selectOperation(
          tx as unknown as DrizzleDb,
          operationId,
          false,
        );
        return toOperation(updated!);
      });
    } catch (error: unknown) {
      if (
        !(error instanceof YooKassaOperationError) &&
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      ) {
        throw new YooKassaOperationError("YOOKASSA_PROVIDER_BINDING_CONFLICT");
      }
      throw error;
    }
  }

  async markUnknown(operationId: string): Promise<void> {
    const result = await this.db.execute<{ id: string }>(sql`
      update expert_residency_provider_operations
      set status = 'unknown_outcome', reconciliation_claimed_at = null,
          updated_at = transaction_timestamp()
      where id = ${operationId}::uuid
        and status in ('claimed','pending','unknown_outcome')
      returning id
    `);
    if (result.rows.length !== 1) {
      throw new YooKassaOperationError("YOOKASSA_OPERATION_NOT_FOUND");
    }
  }

  async resolve(
    operationId: string,
    status: "succeeded" | "canceled" | "failed",
  ): Promise<void> {
    const result = await this.db.execute<{ id: string }>(sql`
      update expert_residency_provider_operations
      set status = ${status}, resolved_at = transaction_timestamp(),
          reconciliation_claimed_at = null, updated_at = transaction_timestamp()
      where id = ${operationId}::uuid
        and status in ('claimed','pending','unknown_outcome')
      returning id
    `);
    if (result.rows.length !== 1) {
      throw new YooKassaOperationError("YOOKASSA_OPERATION_NOT_FOUND");
    }
  }

  async claimReconciliationBatch(
    limit: number,
  ): Promise<readonly YooKassaOperation[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new YooKassaOperationError("YOOKASSA_OPERATION_INVALID");
    }
    const result = await this.db.execute<StoredOperation>(sql`
      with candidates as (
        select id
        from expert_residency_provider_operations
        where status in ('pending','unknown_outcome')
          and provider_object_id is not null
          and (reconciliation_claimed_at is null or
               reconciliation_claimed_at < transaction_timestamp() - interval '5 minutes')
        order by created_at, id
        for update skip locked
        limit ${limit}
      )
      update expert_residency_provider_operations operation
      set reconciliation_claimed_at = transaction_timestamp(),
          updated_at = transaction_timestamp()
      from candidates
      where operation.id = candidates.id
      returning operation.id, operation.order_id as "orderId",
        operation.payment_attempt_id as "paymentAttemptId",
        operation.operation_kind as "operationKind",
        operation.environment_mode as "environmentMode",
        operation.provider_object_id as "providerObjectId",
        operation.parent_payment_id as "parentPaymentId",
        operation.amount_minor::text as "amountMinor", operation.currency,
        operation.request_digest as "requestDigest",
        operation.claim_digest as "claimDigest",
        operation.idempotency_key::text as "idempotencyKey", operation.status
    `);
    return result.rows.map(toOperation);
  }
}
