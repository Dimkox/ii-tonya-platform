import { createHash, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import type {
  ConversationCatalogRepository,
  ConversationCatalogResult,
} from "../../../application/src/client-catalog-service.js";
import type { ClientConversationOperationClaimDetails } from "../../../application/src/client-conversation-authority.js";
import { frameClientConversationOperation } from "../../../application/src/client-conversation-operation-crypto.js";
import type { DrizzleDb } from "../client.js";
import { withSerializableRetry } from "./message-repository.js";

export type ClientCatalogSlot =
  | Readonly<{ startsAt: string }>
  | Readonly<{ startsAt: string; choiceHandle: `ch1.${string}` }>;
export type ClientCatalogCard = Readonly<{
  displayName: string;
  serviceCode: string;
  language: string;
  availability: "catalog_only" | "fresh_slots";
  slots: readonly ClientCatalogSlot[];
}>;
export type ClientCatalogSnapshot =
  | Readonly<{ catalogRequestId: string; state: "pending" }>
  | Readonly<{
      catalogRequestId: string;
      state: "ready";
      cards: readonly ClientCatalogCard[];
    }>;

export interface ClientCatalogRequestRepository {
  createOrReplay(input: {
    userId: string;
    requestDigest: string;
    serviceCode?: string;
    language?: string;
    correlationId: string;
    version?: 1 | 2;
  }): Promise<{ catalogRequestId: string; state: "pending" | "ready" }>;
  getOwned(input: {
    userId: string;
    catalogRequestId: string;
  }): Promise<ClientCatalogSnapshot | null>;
  loadPending(catalogRequestId: string): Promise<
    | Readonly<{
        catalogRequestId: string;
        serviceCode?: string;
        language?: string;
        databaseNow: Date;
        expiresAt: Date;
      }>
    | "replayed"
    | null
  >;
  materialize(input: {
    catalogRequestId: string;
    cards: readonly ClientCatalogCard[];
  }): Promise<"ready" | "replayed" | "missing">;
  materializeBookingAware(input: {
    catalogRequestId: string;
    cards: readonly ClientCatalogCard[];
    choices: readonly ProtectedCatalogChoiceInput[];
  }): Promise<"ready" | "replayed" | "missing" | "collision">;
  expireDue(input: {
    now: Date;
    limit: number;
  }): Promise<{ examined: number; expired: number; removed: number }>;
}

export interface ProtectedCatalogChoiceInput {
  readonly choiceDigest: `sha256:${string}`;
  readonly localSlotId: string;
  readonly expiresAt: Date;
}

type Transaction = Parameters<DrizzleDb["transaction"]>[0] extends (
  transaction: infer T,
) => unknown
  ? T
  : never;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const CHOICE_HANDLE_PATTERN = /^ch1\.[A-Za-z0-9_-]{43}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;
const CONVERSATION_TOKEN_PATTERN = /^hmac-sha256:v1:[0-9a-f]{64}$/u;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/u;

const optionalFilter = (
  value: string | undefined,
  maximum: number,
): string | undefined => {
  if (value === undefined) return undefined;
  if (
    value.length < 1 ||
    value.length > maximum ||
    value !== value.trim() ||
    CONTROL_PATTERN.test(value)
  ) {
    throw new Error("client_catalog_request_invalid");
  }
  return value;
};

const canonicalUuid = (value: string): string => {
  if (!UUID_PATTERN.test(value))
    throw new Error("client_catalog_request_invalid");
  return value;
};

export const clientCatalogErasureSubjectKey = (userId: string): string =>
  createHash("sha256")
    .update(`client-catalog-erasure-v1\0${canonicalUuid(userId)}`)
    .digest("hex");

const finiteInstant = (value: string): boolean => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
};

export const validateClientCatalogCards = (
  cards: unknown,
): readonly ClientCatalogCard[] => {
  if (!Array.isArray(cards) || cards.length > 20) {
    throw new Error("client_catalog_snapshot_invalid");
  }
  for (const card of cards as readonly ClientCatalogCard[]) {
    if (
      typeof card !== "object" ||
      card === null ||
      Array.isArray(card) ||
      Object.keys(card).length !== 5 ||
      !Object.keys(card).every((key) =>
        [
          "displayName",
          "serviceCode",
          "language",
          "availability",
          "slots",
        ].includes(key),
      ) ||
      typeof card.displayName !== "string" ||
      card.displayName.length < 1 ||
      card.displayName.length > 120 ||
      CONTROL_PATTERN.test(card.displayName) ||
      typeof card.serviceCode !== "string" ||
      optionalFilter(card.serviceCode, 64) === undefined ||
      typeof card.language !== "string" ||
      optionalFilter(card.language, 32) === undefined ||
      !["catalog_only", "fresh_slots"].includes(card.availability) ||
      !Array.isArray(card.slots) ||
      card.slots.length > 3 ||
      (card.availability === "catalog_only" && card.slots.length !== 0)
    ) {
      throw new Error("client_catalog_snapshot_invalid");
    }
    for (const slot of card.slots) {
      if (
        typeof slot !== "object" ||
        slot === null ||
        Array.isArray(slot) ||
        (Object.keys(slot).length !== 1 && Object.keys(slot).length !== 2) ||
        Object.keys(slot).some(
          (key) => key !== "startsAt" && key !== "choiceHandle",
        ) ||
        typeof slot.startsAt !== "string" ||
        !finiteInstant(slot.startsAt) ||
        ("choiceHandle" in slot &&
          (typeof slot.choiceHandle !== "string" ||
            !CHOICE_HANDLE_PATTERN.test(slot.choiceHandle)))
      ) {
        throw new Error("client_catalog_snapshot_invalid");
      }
    }
  }
  return cards as readonly ClientCatalogCard[];
};

const state = (value: string): "pending" | "ready" => {
  if (value === "pending" || value === "ready") return value;
  throw new Error("client_catalog_request_state_invalid");
};

const canonicalPayload = (catalogRequestId: string, version: 1 | 2): string =>
  JSON.stringify({ v: version, catalogRequestId });

const databaseErrorConstraint = (error: unknown): string | undefined => {
  const seen = new Set<unknown>();
  let current = error;
  while (
    typeof current === "object" &&
    current !== null &&
    !seen.has(current)
  ) {
    seen.add(current);
    const evidence = current as { constraint?: unknown; cause?: unknown };
    if (typeof evidence.constraint === "string") return evidence.constraint;
    current = evidence.cause;
  }
  return undefined;
};

const terminalOutboxStatus = (status: string): boolean =>
  status === "succeeded" || status === "dead_letter";

const catalogRequestDigest = (
  userId: string,
  serviceCode: string | undefined,
  language: string | undefined,
): string =>
  createHash("sha256")
    .update(
      `client-catalog-booking-v1\0${userId}\0${serviceCode ?? ""}\0${language ?? ""}`,
    )
    .digest("hex");

const lp = (value: string): Buffer => {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
};

const conversationCatalogReceipt = (catalogRequestId: string): string =>
  createHash("sha256")
    .update("ii-tonya/client-conversation-catalog-receipt/v1\0", "utf8")
    .update(lp(catalogRequestId))
    .digest("hex");

const databaseErrorCode = (error: unknown): string | undefined => {
  const seen = new Set<unknown>();
  let current = error;
  while (
    typeof current === "object" &&
    current !== null &&
    !seen.has(current)
  ) {
    seen.add(current);
    const evidence = current as { code?: unknown; cause?: unknown };
    if (typeof evidence.code === "string") return evidence.code;
    current = evidence.cause;
  }
  return undefined;
};

export class ConversationCatalogRetryableError extends Error {
  constructor() {
    super("client_conversation_catalog_retryable");
    this.name = "ConversationCatalogRetryableError";
  }
}

export interface ClientCatalogRepositoryOptions {
  readonly conversationCatalogEnabled?: boolean;
}

async function deleteCatalogOutbox(
  tx: Transaction,
  outboxId: string,
): Promise<void> {
  await tx.execute(
    sql`delete from delivery_attempts where outbox_id=${outboxId}::uuid`,
  );
  await tx.execute(
    sql`delete from dead_letters where outbox_id=${outboxId}::uuid`,
  );
  await tx.execute(
    sql`delete from outbox_operator_alerts where outbox_id=${outboxId}::uuid`,
  );
  await tx.execute(sql`
    update reconciliation_mismatches set outbox_id=null
    where outbox_id=${outboxId}::uuid
  `);
  await tx.execute(
    sql`delete from integration_outbox where id=${outboxId}::uuid`,
  );
}

async function lockCatalogChoices(
  tx: Transaction,
  requestId: string,
): Promise<void> {
  await tx.execute(sql`
    select pg_advisory_xact_lock(hashtextextended('choice:' || choice_digest,0))
    from client_catalog_choices
    where request_id=${requestId}::uuid
    order by choice_digest
  `);
}

type ValidatedCatalogRequest = Readonly<{
  userId: string;
  requestDigest: string;
  serviceCode?: string;
  language?: string;
  correlationId: string;
  version: 1 | 2;
}>;

type ConversationCandidate = Readonly<{
  bindingId: string;
  userId: string;
}>;

type ConversationMapping = ConversationCandidate &
  Readonly<{
    provider: string;
    tenantToken: string | null;
    subjectToken: string;
    tokenVersion: number | null;
  }>;

export class PostgresClientCatalogRepository
  implements ClientCatalogRequestRepository, ConversationCatalogRepository
{
  constructor(
    private readonly db: DrizzleDb,
    private readonly options: ClientCatalogRepositoryOptions = {},
  ) {}

  private async lockRequestPrelock(
    tx: Transaction,
    userId: string,
    requestDigest: string,
  ): Promise<void> {
    await tx.execute(sql`
      select pg_advisory_xact_lock(
        hashtextextended(${userId} || ':' || ${requestDigest},0)
      )
    `);
  }

  private async createOrReplayInTransaction(
    tx: Transaction,
    input: ValidatedCatalogRequest,
  ): Promise<{ catalogRequestId: string; state: "pending" | "ready" }> {
    const existing = (
      await tx.execute<{ catalogRequestId: string; state: string }>(sql`
        select id as "catalogRequestId",state
        from client_catalog_requests
        where user_id=${input.userId}::uuid
          and request_digest=${input.requestDigest}
        for update
      `)
    ).rows[0];
    if (existing !== undefined) {
      return {
        catalogRequestId: existing.catalogRequestId,
        state: state(existing.state),
      };
    }

    const catalogRequestId = randomUUID();
    await tx.execute(sql`
      insert into client_catalog_requests (
        id,user_id,request_digest,service_code,language
      ) values (
        ${catalogRequestId}::uuid,${input.userId}::uuid,${input.requestDigest},
        ${input.serviceCode ?? null},${input.language ?? null}
      )
    `);
    await tx.execute(sql`
      insert into client_catalog_erasure_index (request_id,subject_key,expires_at)
      select id,${clientCatalogErasureSubjectKey(input.userId)},expires_at
      from client_catalog_requests where id=${catalogRequestId}::uuid
    `);
    const payload = canonicalPayload(catalogRequestId, input.version);
    const payloadHash = createHash("sha256").update(payload).digest("hex");
    await tx.execute(sql`
      insert into integration_outbox (
        idempotency_key,topic,payload,correlation_id,reconciliation_key,payload_hash
      ) values (
        ${`client-catalog:${catalogRequestId}`},'catalog.show',${payload}::jsonb,
        ${input.correlationId},${`client-catalog:${catalogRequestId}:v${input.version}`},
        ${payloadHash}
      )
    `);
    return { catalogRequestId, state: "pending" };
  }

  createOrReplay(input: {
    userId: string;
    requestDigest: string;
    serviceCode?: string;
    language?: string;
    correlationId: string;
    version?: 1 | 2;
  }): Promise<{ catalogRequestId: string; state: "pending" | "ready" }> {
    const userId = canonicalUuid(input.userId);
    if (
      !HASH_PATTERN.test(input.requestDigest) ||
      input.correlationId.length < 1
    ) {
      return Promise.reject(new Error("client_catalog_request_invalid"));
    }
    const serviceCode = optionalFilter(input.serviceCode, 64);
    const language = optionalFilter(input.language, 32);
    const version = input.version ?? 1;
    if (version !== 1 && version !== 2) {
      return Promise.reject(new Error("client_catalog_request_invalid"));
    }
    return withSerializableRetry(() =>
      this.db.transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level serializable`);
        await this.lockRequestPrelock(tx, userId, input.requestDigest);
        return this.createOrReplayInTransaction(tx, {
          userId,
          requestDigest: input.requestDigest,
          ...(serviceCode === undefined ? {} : { serviceCode }),
          ...(language === undefined ? {} : { language }),
          correlationId: input.correlationId,
          version,
        });
      }),
    );
  }

  async requestConversation(
    claim: ClientConversationOperationClaimDetails,
  ): Promise<ConversationCatalogResult> {
    if (this.options.conversationCatalogEnabled === false) {
      return { kind: "rejected", code: "feature_disabled" };
    }
    if (
      claim.toolKind !== "show_catalog" ||
      claim.requiredScope !== "client_catalog:read" ||
      "choiceHandle" in claim.frozenInput
    ) {
      return { kind: "rejected", code: "conflict" };
    }
    const serviceCode = optionalFilter(claim.frozenInput.serviceCode, 64);
    const language = optionalFilter(claim.frozenInput.language, 32);
    const candidate = (
      await this.db.execute<ConversationCandidate>(sql`
        select m.id as "bindingId",m.user_id as "userId"
        from client_conversation_operations o
        join provider_subject_mappings m on m.id=o.binding_id
        where o.id=${claim.operationId}::uuid
      `)
    ).rows[0];
    if (candidate === undefined) return { kind: "rejected", code: "not_found" };
    const requestDigest = catalogRequestDigest(
      candidate.userId,
      serviceCode,
      language,
    );

    try {
      return await withSerializableRetry(() =>
        this.db.transaction(async (tx): Promise<ConversationCatalogResult> => {
          await tx.execute(sql`set transaction isolation level serializable`);
          await this.lockRequestPrelock(tx, candidate.userId, requestDigest);
          await tx.execute(sql`set local statement_timeout='2s'`);
          await tx.execute(sql`set local lock_timeout='2s'`);
          await tx.execute(
            sql`set local idle_in_transaction_session_timeout='2s'`,
          );

          const user = (
            await tx.execute<{ active: boolean }>(sql`
              select active from users where id=${candidate.userId}::uuid for update
            `)
          ).rows[0];
          if (user?.active !== true)
            return { kind: "rejected", code: "not_found" };

          const mapping = (
            await tx.execute<ConversationMapping>(sql`
              select id as "bindingId",user_id as "userId",provider,
                tenant_token as "tenantToken",subject_token as "subjectToken",
                token_version as "tokenVersion"
              from provider_subject_mappings
              where id=${candidate.bindingId}::uuid
              for update
            `)
          ).rows[0];
          if (
            mapping === undefined ||
            mapping.userId !== candidate.userId ||
            mapping.provider !== "selarti.client-thread.v1" ||
            mapping.tenantToken === null ||
            !CONVERSATION_TOKEN_PATTERN.test(mapping.tenantToken) ||
            !CONVERSATION_TOKEN_PATTERN.test(mapping.subjectToken) ||
            Number(mapping.tokenVersion) !== 1
          ) {
            return { kind: "rejected", code: "not_found" };
          }

          const grant = (
            await tx.execute<{
              expiresAt: Date | string;
              revokedAt: Date | string | null;
              databaseNow: Date | string;
            }>(sql`
              select expires_at as "expiresAt",revoked_at as "revokedAt",
                clock_timestamp() as "databaseNow"
              from client_conversation_grants
              where provider_subject_mapping_id=${candidate.bindingId}::uuid
                and scope='client_catalog:read'
              for update
            `)
          ).rows[0];
          const databaseNow =
            grant === undefined ? null : new Date(grant.databaseNow);
          const grantExpiresAt =
            grant === undefined ? null : new Date(grant.expiresAt);
          if (
            grant === undefined ||
            grant.revokedAt !== null ||
            databaseNow === null ||
            grantExpiresAt === null ||
            !Number.isFinite(databaseNow.getTime()) ||
            !Number.isFinite(grantExpiresAt.getTime()) ||
            grantExpiresAt.getTime() <= databaseNow.getTime()
          ) {
            return { kind: "rejected", code: "not_found" };
          }

          const operation = (
            await tx.execute<{
              messageEventId: string;
              bindingId: string | null;
              requiredScope: string;
              toolKind: string;
              proposalDigest: string;
              payloadKeyId: string | null;
              payloadExpiresAt: Date | string;
              status: string;
              claimOwnerId: string | null;
              claimToken: string | null;
              claimFence: number | string;
              leaseUntil: Date | string | null;
              databaseNow: Date | string;
            }>(sql`
              select message_event_id as "messageEventId",binding_id as "bindingId",
                required_scope as "requiredScope",tool_kind as "toolKind",
                proposal_digest as "proposalDigest",payload_key_id as "payloadKeyId",
                payload_expires_at as "payloadExpiresAt",status,
                claim_owner_id as "claimOwnerId",claim_token as "claimToken",
                claim_fence as "claimFence",lease_until as "leaseUntil",
                clock_timestamp() as "databaseNow"
              from client_conversation_operations
              where id=${claim.operationId}::uuid
              for update
            `)
          ).rows[0];
          const operationNow =
            operation === undefined ? null : new Date(operation.databaseNow);
          const leaseUntil =
            operation?.leaseUntil === null || operation === undefined
              ? null
              : new Date(operation.leaseUntil);
          const payloadExpiresAt =
            operation === undefined
              ? null
              : new Date(operation.payloadExpiresAt);
          if (
            operation === undefined ||
            operationNow === null ||
            leaseUntil === null ||
            payloadExpiresAt === null ||
            !Number.isFinite(operationNow.getTime()) ||
            !Number.isFinite(leaseUntil.getTime()) ||
            !Number.isFinite(payloadExpiresAt.getTime()) ||
            !UUID_PATTERN.test(operation.messageEventId) ||
            operation.status !== "processing" ||
            operation.bindingId !== candidate.bindingId ||
            operation.toolKind !== "show_catalog" ||
            operation.requiredScope !== "client_catalog:read" ||
            operation.claimOwnerId !== claim.claimOwnerId ||
            operation.claimToken !== claim.claimToken ||
            !Number.isSafeInteger(Number(operation.claimFence)) ||
            Number(operation.claimFence) !== claim.claimFence ||
            leaseUntil.getTime() <= operationNow.getTime() ||
            payloadExpiresAt.getTime() <= operationNow.getTime() ||
            grantExpiresAt.getTime() <= operationNow.getTime() ||
            operation.payloadKeyId === null ||
            !KEY_ID_PATTERN.test(operation.payloadKeyId) ||
            !HASH_PATTERN.test(operation.proposalDigest)
          ) {
            return { kind: "rejected", code: "conflict" };
          }
          const framed = frameClientConversationOperation({
            operationId: claim.operationId,
            messageEventId: operation.messageEventId,
            bindingId: candidate.bindingId,
            keyId: operation.payloadKeyId,
            payloadExpiresAt: payloadExpiresAt.toISOString(),
            proposal: {
              kind: "show_catalog",
              ...(serviceCode === undefined ? {} : { serviceCode }),
              ...(language === undefined ? {} : { language }),
            },
          });
          if (framed.proposalDigest !== operation.proposalDigest) {
            return { kind: "rejected", code: "conflict" };
          }
          const request = await this.createOrReplayInTransaction(tx, {
            userId: candidate.userId,
            requestDigest,
            ...(serviceCode === undefined ? {} : { serviceCode }),
            ...(language === undefined ? {} : { language }),
            correlationId: `client-conversation:${claim.operationId}`,
            version: 2,
          });
          return {
            kind: "applied",
            downstreamReceiptDigest: conversationCatalogReceipt(
              request.catalogRequestId,
            ),
          };
        }),
      );
    } catch (error) {
      if (["55P03", "57014"].includes(databaseErrorCode(error) ?? "")) {
        throw new ConversationCatalogRetryableError();
      }
      throw error;
    }
  }

  async getOwned(input: {
    userId: string;
    catalogRequestId: string;
  }): Promise<ClientCatalogSnapshot | null> {
    const userId = canonicalUuid(input.userId);
    const catalogRequestId = canonicalUuid(input.catalogRequestId);
    const row = (
      await this.db.execute<{
        state: string;
        cards: unknown;
      }>(sql`
        select r.state,s.cards
        from client_catalog_requests r
        left join client_catalog_snapshots s on s.request_id=r.id
        where r.id=${catalogRequestId}::uuid
          and r.user_id=${userId}::uuid
          and r.state in ('pending','ready')
          and r.expires_at > clock_timestamp()
      `)
    ).rows[0];
    if (row === undefined) return null;
    if (row.state === "pending") return { catalogRequestId, state: "pending" };
    if (row.state !== "ready" || !Array.isArray(row.cards)) {
      throw new Error("client_catalog_snapshot_invalid");
    }
    return {
      catalogRequestId,
      state: "ready",
      cards: validateClientCatalogCards(row.cards),
    };
  }

  async loadPending(catalogRequestIdInput: string): Promise<
    | Readonly<{
        catalogRequestId: string;
        serviceCode?: string;
        language?: string;
        databaseNow: Date;
        expiresAt: Date;
      }>
    | "replayed"
    | null
  > {
    const catalogRequestId = canonicalUuid(catalogRequestIdInput);
    const row = (
      await this.db.execute<{
        state: string;
        serviceCode: string | null;
        language: string | null;
        databaseNow: Date | string;
        expiresAt: Date | string;
      }>(sql`
        select state,service_code as "serviceCode",language,
          expires_at as "expiresAt",
          clock_timestamp() as "databaseNow"
        from client_catalog_requests where id=${catalogRequestId}::uuid
      `)
    ).rows[0];
    if (row === undefined || row.state === "expired") return null;
    if (row.state === "ready") return "replayed";
    if (row.state !== "pending")
      throw new Error("client_catalog_request_state_invalid");
    const databaseNow =
      row.databaseNow instanceof Date
        ? row.databaseNow
        : new Date(row.databaseNow);
    const expiresAt =
      row.expiresAt instanceof Date ? row.expiresAt : new Date(row.expiresAt);
    if (
      !Number.isFinite(databaseNow.getTime()) ||
      !Number.isFinite(expiresAt.getTime())
    ) {
      throw new Error("client_catalog_database_clock_invalid");
    }
    return {
      catalogRequestId,
      ...(row.serviceCode === null ? {} : { serviceCode: row.serviceCode }),
      ...(row.language === null ? {} : { language: row.language }),
      databaseNow,
      expiresAt,
    };
  }

  materialize(input: {
    catalogRequestId: string;
    cards: readonly ClientCatalogCard[];
  }): Promise<"ready" | "replayed" | "missing"> {
    return this.materializeInternal(input, undefined);
  }

  async materializeBookingAware(input: {
    catalogRequestId: string;
    cards: readonly ClientCatalogCard[];
    choices: readonly ProtectedCatalogChoiceInput[];
  }): Promise<"ready" | "replayed" | "missing" | "collision"> {
    try {
      return await this.materializeInternal(input, input.choices);
    } catch (error) {
      if (
        databaseErrorConstraint(error) ===
        "client_catalog_choices_choice_digest_unique"
      ) {
        return "collision";
      }
      throw error;
    }
  }

  private materializeInternal(
    input: {
      catalogRequestId: string;
      cards: readonly ClientCatalogCard[];
    },
    choices: readonly ProtectedCatalogChoiceInput[] | undefined,
  ): Promise<"ready" | "replayed" | "missing"> {
    const catalogRequestId = canonicalUuid(input.catalogRequestId);
    return this.db.transaction(async (tx: Transaction) => {
      const request = (
        await tx.execute<{
          state: string;
          expiresAt: Date | string;
          databaseNow: Date | string;
        }>(sql`
          select state,expires_at as "expiresAt",
            clock_timestamp() as "databaseNow"
          from client_catalog_requests where id=${catalogRequestId}::uuid
          for update
        `)
      ).rows[0];
      if (request === undefined) return "missing";
      const expiresAt =
        request.expiresAt instanceof Date
          ? request.expiresAt
          : new Date(request.expiresAt);
      const databaseNow =
        request.databaseNow instanceof Date
          ? request.databaseNow
          : new Date(request.databaseNow);
      if (
        !Number.isFinite(expiresAt.getTime()) ||
        !Number.isFinite(databaseNow.getTime())
      ) {
        throw new Error("client_catalog_database_clock_invalid");
      }
      if (expiresAt.getTime() <= databaseNow.getTime()) {
        await tx.execute(sql`
          insert into client_catalog_tombstones (request_id,expires_at,state)
          values (${catalogRequestId}::uuid,${expiresAt},'expired')
          on conflict (request_id) do nothing
        `);
        await tx.execute(sql`
          delete from client_catalog_requests where id=${catalogRequestId}::uuid
        `);
        return "missing";
      }
      if (request.state === "ready") return "replayed";
      if (request.state !== "pending") {
        throw new Error("client_catalog_request_state_invalid");
      }
      const cards = validateClientCatalogCards(input.cards);
      if (choices !== undefined) {
        const publicDigests = cards.flatMap((card) =>
          card.slots.map((slot) => {
            if (!("choiceHandle" in slot)) {
              throw new Error("client_catalog_snapshot_invalid");
            }
            return `sha256:${createHash("sha256")
              .update(slot.choiceHandle)
              .digest("hex")}`;
          }),
        );
        const protectedDigests = choices.map((choice) => choice.choiceDigest);
        if (
          choices.length !== publicDigests.length ||
          new Set(publicDigests).size !== publicDigests.length ||
          new Set(protectedDigests).size !== protectedDigests.length
        ) {
          throw new Error("client_catalog_snapshot_invalid");
        }
        for (const choice of choices) {
          if (
            !DIGEST_PATTERN.test(choice.choiceDigest) ||
            !UUID_PATTERN.test(choice.localSlotId) ||
            !(choice.expiresAt instanceof Date) ||
            !Number.isFinite(choice.expiresAt.getTime()) ||
            choice.expiresAt.getTime() <= databaseNow.getTime() ||
            choice.expiresAt.getTime() > expiresAt.getTime() ||
            !publicDigests.includes(choice.choiceDigest)
          ) {
            throw new Error("client_catalog_snapshot_invalid");
          }
          await tx.execute(sql`
            insert into client_catalog_choices (
              request_id,choice_digest,slot_id,expires_at
            ) values (
              ${catalogRequestId}::uuid,${choice.choiceDigest},
              ${choice.localSlotId}::uuid,${choice.expiresAt}
            )
          `);
        }
      } else if (
        cards.some((card) => card.slots.some((slot) => "choiceHandle" in slot))
      ) {
        throw new Error("client_catalog_snapshot_invalid");
      }
      await tx.execute(sql`
        insert into client_catalog_snapshots (request_id,cards,expires_at)
        values (${catalogRequestId}::uuid,${JSON.stringify(cards)}::jsonb,${expiresAt})
      `);
      await tx.execute(sql`
        update client_catalog_requests set state='ready',updated_at=now()
        where id=${catalogRequestId}::uuid and state='pending'
      `);
      return "ready";
    });
  }

  expireDue(input: {
    now: Date;
    limit: number;
  }): Promise<{ examined: number; expired: number; removed: number }> {
    if (
      !(input.now instanceof Date) ||
      !Number.isFinite(input.now.getTime()) ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 1_000
    ) {
      return Promise.reject(new Error("client_catalog_retention_invalid"));
    }
    return this.db.transaction(async (tx: Transaction) => {
      const candidates = (
        await tx.execute<{
          requestId: string;
          outboxId: string;
        }>(sql`
        select r.id as "requestId",o.id as "outboxId"
        from client_catalog_requests r
        join integration_outbox o
          on o.idempotency_key='client-catalog:' || r.id::text
          and o.topic='catalog.show'
        where r.expires_at <= clock_timestamp()
        order by r.expires_at,r.id
        limit ${input.limit}
      `)
      ).rows;
      let examined = 0;
      let expiryExamined = 0;
      let expired = 0;
      let removed = 0;

      for (const candidate of candidates) {
        await lockCatalogChoices(tx, candidate.requestId);
        const claimedOutbox = (
          await tx.execute<{ status: string }>(sql`
            select status from integration_outbox
            where id=${candidate.outboxId}::uuid
              and idempotency_key='client-catalog:' || ${candidate.requestId}::uuid::text
              and topic='catalog.show'
            for update skip locked
          `)
        ).rows[0];
        if (claimedOutbox === undefined) continue;
        const request = (
          await tx.execute<{
            expiresAt: Date | string;
          }>(sql`
          select expires_at as "expiresAt"
          from client_catalog_requests
          where id=${candidate.requestId}::uuid
          for update skip locked
        `)
        ).rows[0];
        if (request === undefined) continue;
        examined += 1;
        expiryExamined += 1;
        const expiresAt =
          request.expiresAt instanceof Date
            ? request.expiresAt
            : new Date(request.expiresAt);
        await tx.execute(sql`
          insert into client_catalog_tombstones (request_id,expires_at,state)
          values (${candidate.requestId}::uuid,${expiresAt},'expired')
          on conflict (request_id) do nothing
        `);
        await tx.execute(sql`
          delete from client_catalog_requests
          where id=${candidate.requestId}::uuid
        `);
        expired += 1;
        if (terminalOutboxStatus(claimedOutbox.status)) {
          await deleteCatalogOutbox(tx, candidate.outboxId);
          await tx.execute(sql`
            delete from client_catalog_tombstones
            where request_id=${candidate.requestId}::uuid
          `);
          await tx.execute(sql`
            delete from client_catalog_erasure_index
            where request_id=${candidate.requestId}::uuid
          `);
          removed += 1;
        }
      }

      const remaining = input.limit - expiryExamined;
      if (remaining > 0) {
        const orphanRequests = (
          await tx.execute<{
            requestId: string;
            expiresAt: Date | string;
          }>(sql`
          select r.id as "requestId",r.expires_at as "expiresAt"
          from client_catalog_requests r
          where r.expires_at <= clock_timestamp()
            and not exists (
              select 1 from integration_outbox o
              where o.idempotency_key='client-catalog:' || r.id::text
                and o.topic='catalog.show'
            )
          order by r.expires_at,r.id
          limit ${remaining}
        `)
        ).rows;
        for (const request of orphanRequests) {
          await lockCatalogChoices(tx, request.requestId);
          const claimed = (
            await tx.execute<{ requestId: string }>(sql`
              select id as "requestId" from client_catalog_requests
              where id=${request.requestId}::uuid
                and expires_at<=clock_timestamp()
              for update skip locked
            `)
          ).rows[0];
          if (claimed === undefined) continue;
          await tx.execute(sql`
            insert into client_catalog_tombstones (request_id,expires_at,state)
            values (${request.requestId}::uuid,${request.expiresAt},'expired')
            on conflict (request_id) do nothing
          `);
          await tx.execute(sql`
            delete from client_catalog_requests
            where id=${request.requestId}::uuid
          `);
          examined += 1;
          expiryExamined += 1;
          expired += 1;
        }
      }

      {
        const terminalTombstones = (
          await tx.execute<{
            requestId: string;
            outboxId: string;
          }>(sql`
          select t.request_id as "requestId",o.id as "outboxId"
          from client_catalog_tombstones t
          join integration_outbox o
            on o.idempotency_key='client-catalog:' || t.request_id::text
            and o.topic='catalog.show'
          where o.status in ('succeeded','dead_letter')
          order by t.expires_at,t.request_id
          for update of o skip locked
          limit ${input.limit}
        `)
        ).rows;
        for (const tombstone of terminalTombstones) {
          await deleteCatalogOutbox(tx, tombstone.outboxId);
          await tx.execute(sql`
            delete from client_catalog_tombstones
            where request_id=${tombstone.requestId}::uuid
          `);
          await tx.execute(sql`
            delete from client_catalog_erasure_index
            where request_id=${tombstone.requestId}::uuid
          `);
          examined += 1;
          removed += 1;
        }
      }

      const orphanTombstones = (
        await tx.execute<{
          requestId: string;
        }>(sql`
        select t.request_id as "requestId"
        from client_catalog_tombstones t
        where not exists (
          select 1 from integration_outbox o
          where o.idempotency_key='client-catalog:' || t.request_id::text
            and o.topic='catalog.show'
        )
        order by t.expires_at,t.request_id
        for update of t skip locked
        limit ${input.limit}
      `)
      ).rows;
      for (const tombstone of orphanTombstones) {
        await tx.execute(sql`
          delete from client_catalog_tombstones
          where request_id=${tombstone.requestId}::uuid
        `);
        await tx.execute(sql`
          delete from client_catalog_erasure_index
          where request_id=${tombstone.requestId}::uuid
        `);
        examined += 1;
        removed += 1;
      }

      {
        const orphans = (
          await tx.execute<{
            outboxId: string;
            idempotencyKey: string;
          }>(sql`
          select o.id as "outboxId",o.idempotency_key as "idempotencyKey"
          from integration_outbox o
          where o.topic='catalog.show'
            and o.idempotency_key like 'client-catalog:%'
            and o.status in ('succeeded','dead_letter')
            and not exists (
              select 1 from client_catalog_requests r
              where o.idempotency_key='client-catalog:' || r.id::text
            )
            and not exists (
              select 1 from client_catalog_tombstones t
              where o.idempotency_key='client-catalog:' || t.request_id::text
            )
          order by o.updated_at,o.id
          for update skip locked
          limit ${input.limit}
        `)
        ).rows;
        for (const orphan of orphans) {
          await deleteCatalogOutbox(tx, orphan.outboxId);
          await tx.execute(sql`
            delete from client_catalog_erasure_index
            where ${orphan.idempotencyKey}='client-catalog:' || request_id::text
          `);
          examined += 1;
          removed += 1;
        }
      }
      return { examined, expired, removed };
    });
  }
}
