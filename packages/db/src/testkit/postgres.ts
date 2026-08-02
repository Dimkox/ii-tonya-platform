import { randomUUID } from "node:crypto";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";
import * as schema from "../schema/index.js";
import type { DrizzleDb } from "../client.js";
import {
  normalizeNullableBookingTimestamp,
  type ReserveSlotCommand,
} from "../repositories/booking-repository.js";

type LedgerKind = "debit" | "free";
type ConfirmEligibilityCase =
  | "expired_hold"
  | "wrong_expert"
  | "inactive_expert"
  | "past_slot"
  | "stale_slot"
  | "future_slot";

interface ReservableFixture {
  command: ReserveSlotCommand;
  expertId: string;
}

interface OverlappingClientFixture {
  clientId: string;
  first: ReserveSlotCommand;
  second: ReserveSlotCommand;
}

interface OverlappingExpertFixture {
  expertId: string;
  first: ReserveSlotCommand;
  second: ReserveSlotCommand;
}

interface TestContainerHandle {
  getConnectionUri(): string;
  stop(): Promise<unknown>;
}

interface TestPoolHandle {
  end(): Promise<void>;
  waitForClosedClients?(): Promise<void>;
}

interface InsertOutboxInput {
  topic: string;
  reconciliationKey: string;
  attempt?: number;
}

interface InsertUnknownOutboxInput {
  attempt: number;
  reconciliationAttempt: number;
  reconciliationKey: string;
}

interface TelegramCallbackFixtureInput {
  tokenHash: string;
  action: "confirm" | "cancel";
  version: number;
  expiresAt: string;
  expertActive?: boolean;
  expertVerified?: boolean;
}

interface TelegramCallbackFixture {
  notificationId: string;
  tokenHash: string;
  claims: {
    reservationId: string;
    expertId: string;
    action: "confirm" | "cancel";
    version: number;
    expiresAtEpochSeconds: number;
  };
}

export interface TestPostgresDependencies {
  startContainer(): Promise<TestContainerHandle>;
  createPool(connectionString: string): TestPoolHandle;
  createDb(pool: TestPoolHandle): DrizzleDb;
}

export interface TestDatabase {
  db: DrizzleDb;
  migrate(): Promise<void>;
  reset(): Promise<void>;
  stop(): Promise<void>;
  createUser(): Promise<string>;
  createLedgerPackage(
    userId: string,
    grantIdempotencyKey: string,
    grantedMessages?: number,
  ): Promise<string>;
  seedUserAndPackage(input: {
    externalMessageId: string;
    grantedMessages: number;
  }): Promise<void>;
  insertDuplicateExternalMessage(externalMessageId: string): Promise<void>;
  columnExists(table: string, column: string): Promise<boolean>;
  packageGrantedMessages(): Promise<number>;
  createUserWithPackage(grantedMessages: number): Promise<string>;
  packageBalance(userId?: string): Promise<number>;
  ledgerEntryCount(externalMessageId: string): Promise<number>;
  rebuildPackageBalance(userId: string): Promise<number>;
  mutableBalanceColumnCount(): Promise<number>;
  appendLedgerFact(input: {
    kind: LedgerKind;
    delta: number;
    idempotencyKey: string;
  }): Promise<void>;
  updateLedgerFact(idempotencyKey: string, delta: number): Promise<void>;
  deleteLedgerFact(idempotencyKey: string): Promise<void>;
  appendGrantFact(
    packageId: string,
    delta: number,
    idempotencyKey: string,
  ): Promise<string>;
  appendMessageDebit(
    packageId: string,
    externalMessageId: string,
    idempotencyKey: string,
  ): Promise<string>;
  appendCompensation(
    packageId: string,
    originalEntryId: string,
    idempotencyKey: string,
  ): Promise<void>;
  appendRevocation(
    packageId: string,
    originalEntryId: string,
    idempotencyKey: string,
  ): Promise<void>;
  ledgerFactCount(packageIds: string[]): Promise<number>;
  createSlot(input: {
    capacity: number;
    startsAt: string;
    observedAt?: string;
  }): Promise<string>;
  createOverlappingClientSlots(): Promise<OverlappingClientFixture>;
  createOverlappingExpertSlots(): Promise<OverlappingExpertFixture>;
  createReservableFixture(): Promise<ReservableFixture>;
  installSerializationFailureTrigger(
    idempotencyKey: string,
    failures: number,
  ): Promise<void>;
  serializationAttemptCount(idempotencyKey: string): Promise<number>;
  reservationCountForKey(idempotencyKey: string): Promise<number>;
  activeReservationCountForClient(clientId: string): Promise<number>;
  activeReservationCountForExpert(expertId: string): Promise<number>;
  outboxCountForCorrelation(correlationId: string): Promise<number>;
  outboxDeliveryForCorrelation(correlationId: string): Promise<{
    topic: string;
    payload: unknown;
    correlationId: string;
    reconciliationKey: string;
  }>;
  outboxDeliveriesForCorrelation(correlationId: string): Promise<
    readonly {
      idempotencyKey: string;
      topic: string;
      payload: unknown;
      correlationId: string;
      reconciliationKey: string;
    }[]
  >;
  auditCountForCorrelation(correlationId: string): Promise<number>;
  insertOutbox(input: InsertOutboxInput): Promise<string>;
  insertUnknownOutbox(input: InsertUnknownOutboxInput): Promise<string>;
  outboxStatus(id: string): Promise<string>;
  expireDispatchLease(id: string): Promise<void>;
  expireReconciliationLease(id: string): Promise<void>;
  makeOutboxRetryDue(id: string): Promise<void>;
  ownerAlertReasons(id: string): Promise<string[]>;
  deadLetterReasons(id: string): Promise<string[]>;
  createConfirmEligibilityCase(caseName: ConfirmEligibilityCase): Promise<{
    reservationId: string;
    actorExpertId: string;
    now: Date;
  }>;
  reservationStatus(reservationId: string): Promise<string>;
  seedTelegramCallback(
    input: TelegramCallbackFixtureInput,
  ): Promise<TelegramCallbackFixture>;
  callbackConsumedAt(notificationId: string): Promise<Date | null>;
  createTelegramCallbackReservation(input?: {
    expertActive?: boolean;
    expertVerified?: boolean;
    reservationVersion?: number;
  }): Promise<{ reservationId: string; expertId: string }>;
  notificationCountForToken(tokenHash: string): Promise<number>;
  setTelegramCallbackReservationState(
    reservationId: string,
    input: {
      status?:
        | "reserved"
        | "booked"
        | "cancelled_by_client"
        | "cancelled_by_expert"
        | "expired"
        | "completed"
        | "no_show";
      version?: number;
      reservedUntil?: Date;
    },
  ): Promise<void>;
  setTelegramCallbackSlotState(
    reservationId: string,
    input: {
      startsAt?: Date;
      observedAt?: Date;
      serviceActive?: boolean;
    },
  ): Promise<void>;
  crossWireTelegramCallbackReservation(reservationId: string): Promise<void>;
  prepareTelegramCallbackIssuanceBoundary(
    reservationId: string,
    boundary: "same_epoch_subsecond" | "future_epoch",
  ): Promise<number>;
}

function oneId(rows: { id: string }[]): string {
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("Expected one identifier");
  return id;
}

type ClientClosureTrackedPool = Pool & {
  waitForClosedClients(): Promise<void>;
};

interface ClientClosureTrackingOptions {
  shutdownTimeoutMs?: number;
}

interface PendingClientClosure {
  terminal: Promise<void>;
  cleanup(): void;
}

const DEFAULT_CLIENT_CLOSURE_TIMEOUT_MS = 5_000;

export class PostgresClientClosureTimeoutError extends Error {
  readonly code = "POSTGRES_CLIENT_CLOSURE_TIMEOUT";

  constructor(
    readonly timeoutMs: number,
    readonly openClientCount: number,
  ) {
    super(
      `Timed out after ${timeoutMs}ms waiting for ${openClientCount} PostgreSQL client(s) to close`,
    );
    this.name = "PostgresClientClosureTimeoutError";
  }
}

export function trackPoolClientClosures(
  pool: Pool,
  options: ClientClosureTrackingOptions = {},
): ClientClosureTrackedPool {
  const shutdownTimeoutMs =
    options.shutdownTimeoutMs ?? DEFAULT_CLIENT_CLOSURE_TIMEOUT_MS;
  if (!Number.isFinite(shutdownTimeoutMs) || shutdownTimeoutMs <= 0) {
    throw new RangeError("PostgreSQL client closure timeout must be positive");
  }

  const pendingClosures = new Map<PoolClient, PendingClientClosure>();
  const closureErrors: unknown[] = [];

  const onConnect = (client: PoolClient): void => {
    if (pendingClosures.has(client)) return;
    let resolveTerminal: (() => void) | undefined;
    const terminal = new Promise<void>((resolve) => {
      resolveTerminal = resolve;
    });
    const onEnd = (): void => {
      cleanup();
      resolveTerminal?.();
    };
    const onError = (error: unknown): void => {
      closureErrors.push(error);
    };
    const cleanup = (): void => {
      client.removeListener("end", onEnd);
      client.removeListener("error", onError);
    };
    const pending = { terminal, cleanup };
    pendingClosures.set(client, pending);
    void terminal.then(() => {
      if (pendingClosures.get(client) === pending) {
        pendingClosures.delete(client);
      }
    });
    client.once("end", onEnd);
    client.once("error", onError);
  };

  pool.on("connect", onConnect);

  return Object.assign(pool, {
    async waitForClosedClients(): Promise<void> {
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      let waitError: unknown;
      try {
        if (pendingClosures.size > 0) {
          const timeout = new Promise<void>((_resolve, reject) => {
            timeoutHandle = setTimeout(() => {
              reject(
                new PostgresClientClosureTimeoutError(
                  shutdownTimeoutMs,
                  pendingClosures.size,
                ),
              );
            }, shutdownTimeoutMs);
          });
          while (pendingClosures.size > 0) {
            await Promise.race([
              Promise.all(
                [...pendingClosures.values()].map(({ terminal }) => terminal),
              ).then(() => undefined),
              timeout,
            ]);
          }
        }
      } catch (error) {
        waitError = error;
      } finally {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        pool.removeListener("connect", onConnect);
        for (const { cleanup } of pendingClosures.values()) cleanup();
        pendingClosures.clear();
      }

      const errors =
        waitError === undefined
          ? closureErrors
          : [...closureErrors, waitError];
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(
          errors,
          "PostgreSQL clients failed while closing",
        );
      }
    },
  });
}

const defaultDependencies: TestPostgresDependencies = {
  startContainer: async () =>
    new PostgreSqlContainer("postgres:16-alpine").start(),
  createPool: (connectionString) =>
    trackPoolClientClosures(new Pool({ connectionString })),
  createDb: (pool) => drizzle(pool as Pool, { schema }) as DrizzleDb,
};

async function stopResources(
  pool: TestPoolHandle,
  container: TestContainerHandle,
): Promise<void> {
  const errors: unknown[] = [];
  try {
    await pool.end();
  } catch (error) {
    errors.push(error);
  }
  try {
    await pool.waitForClosedClients?.();
  } catch (error) {
    errors.push(error);
  }
  try {
    await container.stop();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1)
    throw new AggregateError(errors, "Failed to stop test database resources");
}

export async function startTestPostgres(
  dependencies: TestPostgresDependencies = defaultDependencies,
): Promise<TestDatabase> {
  const container = await dependencies.startContainer();
  let pool: TestPoolHandle | undefined;
  let db: DrizzleDb;
  try {
    pool = dependencies.createPool(container.getConnectionUri());
    db = dependencies.createDb(pool);
  } catch (error) {
    const initializedPool = pool;
    try {
      if (initializedPool === undefined) {
        await container.stop();
      } else {
        await stopResources(initializedPool, container);
      }
    } catch {
      // Initialization remains the primary error after best-effort cleanup.
    }
    throw error;
  }
  let primaryPackageId: string | undefined;
  let primaryUserId: string | undefined;

  const createUser = async (): Promise<string> =>
    oneId(
      (
        await db.execute<{ id: string }>(sql`
    insert into users default values returning id
  `)
      ).rows,
    );

  const createLedgerPackage = async (
    userId: string,
    grantIdempotencyKey: string,
    grantedMessages = 1,
  ): Promise<string> =>
    oneId(
      (
        await db.execute<{ id: string }>(sql`
    insert into message_packages (user_id, granted_messages, grant_idempotency_key)
    values (${userId}::uuid, ${grantedMessages}, ${grantIdempotencyKey}) returning id
  `)
      ).rows,
    );

  const createExpert = async (
    input: { active?: boolean; verified?: boolean } = {},
  ): Promise<{ expertId: string; serviceId: string }> => {
    const expertUserId = await createUser();
    const expertId = oneId(
      (
        await db.execute<{ id: string }>(sql`
      insert into experts (user_id, active, verified)
      values (
        ${expertUserId}::uuid,
        ${input.active ?? true},
        ${input.verified ?? true}
      )
      returning id
    `)
      ).rows,
    );
    const serviceId = oneId(
      (
        await db.execute<{ id: string }>(sql`
      insert into expert_services (expert_id, name, active, duration_minutes)
      values (${expertId}::uuid, 'Test consultation', true, 60)
      returning id
    `)
      ).rows,
    );
    return { expertId, serviceId };
  };

  const createSlotForService = async (input: {
    serviceId: string;
    capacity: number;
    startsAt: Date;
    endsAt?: Date;
    observedAt?: Date;
  }): Promise<string> =>
    oneId(
      (
        await db.execute<{ id: string }>(sql`
    insert into slots (
      expert_service_id, provider, external_slot_id, starts_at, ends_at,
      observed_at, capacity
    )
    values (
      ${input.serviceId}::uuid,
      'test',
      ${`slot-${randomUUID()}`},
      ${input.startsAt},
      ${input.endsAt ?? new Date(input.startsAt.getTime() + 60 * 60 * 1_000)},
      ${input.observedAt ?? new Date("2026-07-28T10:00:00.000Z")},
      ${input.capacity}
    )
    returning id
  `)
      ).rows,
    );

  const commandFor = (
    userId: string,
    slotId: string,
    suffix = randomUUID(),
  ): ReserveSlotCommand => ({
    idempotencyKey: `reserve-${suffix}`,
    userId,
    slotId,
    now: new Date("2026-07-28T10:00:00.000Z"),
    minimumLeadMs: 24 * 60 * 60 * 1_000,
    confirmationBufferMs: 60 * 60 * 1_000,
    correlationId: `booking-${suffix}`,
  });

  const createTelegramCallbackReservation = async (
    input: {
      expertActive?: boolean;
      expertVerified?: boolean;
      reservationVersion?: number;
    } = {},
  ): Promise<{ reservationId: string; expertId: string }> => {
    const clientId = await createUser();
    const expert = await createExpert({
      active: input.expertActive ?? true,
      verified: input.expertVerified ?? true,
    });
    const startsAt = new Date("2026-08-02T10:00:00.000Z");
    const slotId = await createSlotForService({
      serviceId: expert.serviceId,
      capacity: 1,
      startsAt,
    });
    const reservationId = oneId(
      (
        await db.execute<{ id: string }>(sql`
          insert into reservations (
            user_id,
            slot_id,
            expert_id,
            expert_service_id,
            status,
            idempotency_key,
            reserved_until,
            version,
            created_at,
            updated_at
          ) values (
            ${clientId}::uuid,
            ${slotId}::uuid,
            ${expert.expertId}::uuid,
            ${expert.serviceId}::uuid,
            'reserved',
            ${`callback-reservation-${randomUUID()}`},
            ${new Date("2026-07-31T10:00:00.000Z")},
            ${input.reservationVersion ?? 1},
            ${new Date("2026-07-27T10:00:00.000Z")},
            ${new Date("2026-07-27T10:00:00.000Z")}
          )
          returning id
        `)
      ).rows,
    );
    return { reservationId, expertId: expert.expertId };
  };

  return {
    db,
    async migrate() {
      await migrate(db, { migrationsFolder: "packages/db/migrations" });
    },
    async reset() {
      await db.execute(sql`
        truncate table admin_case_actions, integration_errors,
          reconciliation_mismatches, delivery_attempts, outbox_operator_alerts,
          dead_letters, integration_outbox,
          integration_inbox, projection_checkpoints, provider_cursors, reconciliation_runs,
          privacy_processor_attempts, privacy_deletion_jobs, admin_object_assignments,
          admin_role_assignments, admin_sessions, admin_approvals, audit_events,
          human_escalations, safety_incidents, prompt_versions, conversation_messages, conversations,
          feedback, notifications, reservations, message_ledger_entries, message_events,
          message_packages, slots, expert_services, experts, consents, client_profiles,
          channel_identities, users cascade
      `);
      primaryPackageId = undefined;
      primaryUserId = undefined;
    },
    async stop() {
      await stopResources(pool, container);
    },
    createUser,
    createLedgerPackage,
    async createUserWithPackage(grantedMessages) {
      const userId = await createUser();
      const packageId = await createLedgerPackage(
        userId,
        `package-${userId}`,
        grantedMessages,
      );
      await db.execute(sql`
        insert into message_ledger_entries (package_id, entry_kind, delta, idempotency_key)
        values (${packageId}::uuid, 'grant', ${grantedMessages}, ${`grant-${userId}`})
      `);
      return userId;
    },
    async seedUserAndPackage({ externalMessageId, grantedMessages }) {
      primaryUserId = await createUser();
      primaryPackageId = await createLedgerPackage(
        primaryUserId,
        `package-${externalMessageId}`,
        grantedMessages,
      );
      await db.execute(sql`
        insert into message_events (user_id, provider, external_message_id, direction)
        values (${primaryUserId}::uuid, 'test', ${externalMessageId}, 'outbound')
      `);
      await db.execute(sql`
        insert into message_ledger_entries (package_id, entry_kind, delta, idempotency_key)
        values (${primaryPackageId}::uuid, 'grant', ${grantedMessages}, ${`grant-${externalMessageId}`})
      `);
    },
    async insertDuplicateExternalMessage(externalMessageId) {
      if (primaryUserId === undefined)
        throw new Error("Call seedUserAndPackage first");
      await db.execute(sql`
        insert into message_events (user_id, provider, external_message_id, direction)
        values (${primaryUserId}::uuid, 'test', ${externalMessageId}, 'outbound')
      `);
    },
    async columnExists(table, column) {
      const result = await db.execute<{ exists: boolean }>(sql`
        select exists(
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = ${table} and column_name = ${column}
        ) as exists
      `);
      return result.rows[0]?.exists ?? false;
    },
    async packageGrantedMessages() {
      if (primaryPackageId === undefined)
        throw new Error("Call seedUserAndPackage first");
      const result = await db.execute<{ granted_messages: number }>(sql`
        select granted_messages
        from message_packages
        where id = ${primaryPackageId}::uuid
      `);
      return Number(result.rows[0]?.granted_messages ?? 0);
    },
    async packageBalance(userId = primaryUserId) {
      if (userId === undefined)
        throw new Error("Call seedUserAndPackage first");
      const result = await db.execute<{ balance: number }>(sql`
        select coalesce(sum(balance), 0)::integer as balance
        from package_balances where user_id = ${userId}::uuid
      `);
      return Number(result.rows[0]?.balance ?? 0);
    },
    async ledgerEntryCount(externalMessageId) {
      const result = await db.execute<{ count: string }>(sql`
        select count(*)::text as count
        from message_ledger_entries l
        join message_events e on e.id = l.message_event_id
        where e.external_message_id = ${externalMessageId}
      `);
      return Number(result.rows[0]?.count ?? 0);
    },
    async rebuildPackageBalance(userId) {
      const result = await db.execute<{ balance: number }>(sql`
        select coalesce(sum(l.delta), 0)::integer as balance
        from message_packages p
        left join message_ledger_entries l on l.package_id = p.id
        where p.user_id = ${userId}::uuid
      `);
      return Number(result.rows[0]?.balance ?? 0);
    },
    async mutableBalanceColumnCount() {
      const result = await db.execute<{ count: string }>(sql`
        select count(*)::text as count
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'message_packages'
          and column_name in ('balance', 'remaining_messages')
      `);
      return Number(result.rows[0]?.count ?? 0);
    },
    async appendLedgerFact({ kind, delta, idempotencyKey }) {
      if (primaryPackageId === undefined)
        throw new Error("Call seedUserAndPackage first");
      const event = oneId(
        (
          await db.execute<{ id: string }>(sql`
        insert into message_events (user_id, provider, external_message_id, direction)
        values (${primaryUserId!}::uuid, 'test', ${idempotencyKey}, 'outbound') returning id
      `)
        ).rows,
      );
      await db.execute(sql`
        insert into message_ledger_entries (package_id, entry_kind, delta, message_event_id, idempotency_key)
        values (${primaryPackageId}::uuid, ${kind}, ${delta}, ${event}::uuid, ${idempotencyKey})
      `);
    },
    async updateLedgerFact(idempotencyKey, delta) {
      await db.execute(
        sql`update message_ledger_entries set delta = ${delta} where idempotency_key = ${idempotencyKey}`,
      );
    },
    async deleteLedgerFact(idempotencyKey) {
      await db.execute(
        sql`delete from message_ledger_entries where idempotency_key = ${idempotencyKey}`,
      );
    },
    async appendGrantFact(packageId, delta, idempotencyKey) {
      return oneId(
        (
          await db.execute<{ id: string }>(sql`
        insert into message_ledger_entries (package_id, entry_kind, delta, idempotency_key)
        values (${packageId}::uuid, 'grant', ${delta}, ${idempotencyKey}) returning id
      `)
        ).rows,
      );
    },
    async appendMessageDebit(packageId, externalMessageId, idempotencyKey) {
      const user = oneId(
        (
          await db.execute<{ id: string }>(sql`
        select user_id as id from message_packages where id = ${packageId}::uuid
      `)
        ).rows,
      );
      const event = oneId(
        (
          await db.execute<{ id: string }>(sql`
        insert into message_events (user_id, provider, external_message_id, direction)
        values (${user}::uuid, 'test', ${externalMessageId}, 'outbound') returning id
      `)
        ).rows,
      );
      return oneId(
        (
          await db.execute<{ id: string }>(sql`
        insert into message_ledger_entries (package_id, entry_kind, delta, message_event_id, idempotency_key)
        values (${packageId}::uuid, 'debit', -1, ${event}::uuid, ${idempotencyKey}) returning id
      `)
        ).rows,
      );
    },
    async appendCompensation(packageId, originalEntryId, idempotencyKey) {
      await db.execute(sql`
        insert into message_ledger_entries (package_id, entry_kind, delta, original_entry_id, idempotency_key)
        values (${packageId}::uuid, 'compensation', 1, ${originalEntryId}::uuid, ${idempotencyKey})
      `);
    },
    async appendRevocation(packageId, originalEntryId, idempotencyKey) {
      await db.execute(sql`
        insert into message_ledger_entries (package_id, entry_kind, delta, original_entry_id, idempotency_key)
        values (${packageId}::uuid, 'revocation', -1, ${originalEntryId}::uuid, ${idempotencyKey})
      `);
    },
    async ledgerFactCount(packageIds) {
      if (packageIds.length === 0) return 0;
      const packageIdList = sql.join(
        packageIds.map((packageId) => sql`${packageId}::uuid`),
        sql`, `,
      );
      const result = await db.execute<{ count: string }>(sql`
        select count(*)::text as count from message_ledger_entries
        where package_id in (${packageIdList})
      `);
      return Number(result.rows[0]?.count ?? 0);
    },
    async createSlot({ capacity, startsAt, observedAt }) {
      const { serviceId } = await createExpert();
      return createSlotForService({
        serviceId,
        capacity,
        startsAt: new Date(startsAt),
        ...(observedAt === undefined
          ? {}
          : { observedAt: new Date(observedAt) }),
      });
    },
    async createOverlappingClientSlots() {
      const clientId = await createUser();
      const firstExpert = await createExpert();
      const secondExpert = await createExpert();
      const firstSlot = await createSlotForService({
        serviceId: firstExpert.serviceId,
        capacity: 1,
        startsAt: new Date("2026-08-02T10:00:00.000Z"),
      });
      const secondSlot = await createSlotForService({
        serviceId: secondExpert.serviceId,
        capacity: 1,
        startsAt: new Date("2026-08-02T10:30:00.000Z"),
      });
      return {
        clientId,
        first: commandFor(clientId, firstSlot),
        second: commandFor(clientId, secondSlot),
      };
    },
    async createOverlappingExpertSlots() {
      const firstClient = await createUser();
      const secondClient = await createUser();
      const { expertId, serviceId } = await createExpert();
      const firstSlot = await createSlotForService({
        serviceId,
        capacity: 1,
        startsAt: new Date("2026-08-02T10:00:00.000Z"),
      });
      const secondSlot = await createSlotForService({
        serviceId,
        capacity: 1,
        startsAt: new Date("2026-08-02T10:30:00.000Z"),
      });
      return {
        expertId,
        first: commandFor(firstClient, firstSlot),
        second: commandFor(secondClient, secondSlot),
      };
    },
    async createReservableFixture() {
      const userId = await createUser();
      const { expertId, serviceId } = await createExpert();
      const slotId = await createSlotForService({
        serviceId,
        capacity: 1,
        startsAt: new Date("2026-08-02T10:00:00.000Z"),
      });
      return { command: commandFor(userId, slotId), expertId };
    },
    async installSerializationFailureTrigger(idempotencyKey, failures) {
      if (!Number.isInteger(failures) || failures < 0) {
        throw new Error("failures must be a non-negative integer");
      }
      const sequenceName = `booking_retry_${randomUUID().replaceAll("-", "")}`;
      await db.execute(sql.raw(`create sequence "${sequenceName}"`));
      await db.execute(sql`
        create table if not exists booking_serialization_failure_config (
          idempotency_key text primary key,
          sequence_name text not null,
          failures integer not null check (failures >= 0)
        )
      `);
      await db.execute(sql`
        insert into booking_serialization_failure_config (
          idempotency_key, sequence_name, failures
        ) values (${idempotencyKey}, ${sequenceName}, ${failures})
        on conflict (idempotency_key) do update
        set sequence_name = excluded.sequence_name, failures = excluded.failures
      `);
      await db.execute(
        sql.raw(`
        create or replace function booking_force_serialization_failure()
        returns trigger language plpgsql as $$
        declare
          config booking_serialization_failure_config%rowtype;
          attempt bigint;
        begin
          select * into config
          from booking_serialization_failure_config
          where idempotency_key = new.idempotency_key;
          if found then
            execute format('select nextval(%L::regclass)', config.sequence_name)
              into attempt;
            if attempt <= config.failures then
              raise exception using
                errcode = '40001',
                message = 'test serialization failure';
            end if;
          end if;
          return new;
        end
        $$;
        drop trigger if exists booking_force_serialization_failure on reservations;
        create trigger booking_force_serialization_failure
        before insert on reservations
        for each row execute function booking_force_serialization_failure();
      `),
      );
    },
    async serializationAttemptCount(idempotencyKey) {
      const config = (
        await db.execute<{ sequenceName: string }>(sql`
        select sequence_name as "sequenceName"
        from booking_serialization_failure_config
        where idempotency_key = ${idempotencyKey}
      `)
      ).rows[0];
      if (config === undefined) return 0;
      const result = await db.execute<{
        lastValue: string | number | null;
      }>(sql`
        select last_value as "lastValue"
        from pg_sequences
        where schemaname = current_schema() and sequencename = ${config.sequenceName}
      `);
      return Number(result.rows[0]?.lastValue ?? 0);
    },
    async reservationCountForKey(idempotencyKey) {
      const result = await db.execute<{ count: string }>(sql`
        select count(*)::text as count
        from reservations
        where idempotency_key = ${idempotencyKey}
      `);
      return Number(result.rows[0]?.count ?? 0);
    },
    async activeReservationCountForClient(clientId) {
      const result = await db.execute<{ count: string }>(sql`
        select count(*)::text as count
        from reservations
        where user_id = ${clientId}::uuid and status in ('reserved', 'booked')
      `);
      return Number(result.rows[0]?.count ?? 0);
    },
    async activeReservationCountForExpert(expertId) {
      const result = await db.execute<{ count: string }>(sql`
        select count(*)::text as count
        from reservations
        where expert_id = ${expertId}::uuid and status in ('reserved', 'booked')
      `);
      return Number(result.rows[0]?.count ?? 0);
    },
    async outboxCountForCorrelation(correlationId) {
      const result = await db.execute<{ count: string }>(sql`
        select count(*)::text as count
        from integration_outbox
        where reconciliation_key = ${`booking:${correlationId}`}
      `);
      return Number(result.rows[0]?.count ?? 0);
    },
    async outboxDeliveryForCorrelation(correlationId) {
      const result = await db.execute<{
        idempotencyKey: string;
        topic: string;
        payload: unknown;
        correlationId: string;
        reconciliationKey: string;
      }>(sql`
        select
          idempotency_key as "idempotencyKey",
          topic,
          payload,
          correlation_id as "correlationId",
          reconciliation_key as "reconciliationKey"
        from integration_outbox
        where correlation_id = ${correlationId}
      `);
      const row = result.rows[0];
      if (row === undefined) throw new Error("Outbox delivery not found");
      return row;
    },
    async outboxDeliveriesForCorrelation(correlationId) {
      const result = await db.execute<{
        idempotencyKey: string;
        topic: string;
        payload: unknown;
        correlationId: string;
        reconciliationKey: string;
      }>(sql`
        select
          idempotency_key as "idempotencyKey",
          topic,
          payload,
          correlation_id as "correlationId",
          reconciliation_key as "reconciliationKey"
        from integration_outbox
        where correlation_id = ${correlationId}
        order by topic
      `);
      return result.rows;
    },
    async auditCountForCorrelation(correlationId) {
      const result = await db.execute<{ count: string }>(sql`
        select count(*)::text as count
        from audit_events
        where correlation_id = ${correlationId}
      `);
      return Number(result.rows[0]?.count ?? 0);
    },
    async insertOutbox({ topic, reconciliationKey, attempt = 0 }) {
      return oneId(
        (
          await db.execute<{ id: string }>(sql`
        insert into integration_outbox (
          idempotency_key,
          topic,
          payload,
          correlation_id,
           reconciliation_key,
           attempt,
           payload_hash
        ) values (
          ${`test:${randomUUID()}`},
          ${topic},
          ${JSON.stringify({ test: true })}::jsonb,
          ${`correlation:${randomUUID()}`},
           ${reconciliationKey},
           ${attempt},
           ${`sha256:${randomUUID()}`}
        )
        returning id
      `)
        ).rows,
      );
    },
    async insertUnknownOutbox({
      attempt,
      reconciliationAttempt,
      reconciliationKey,
    }) {
      return oneId(
        (
          await db.execute<{ id: string }>(sql`
        insert into integration_outbox (
          idempotency_key,
          topic,
          payload,
          correlation_id,
          status,
          reconciliation_key,
          attempt,
          reconciliation_attempt,
          next_reconciliation_at,
          payload_hash
        ) values (
          ${`test:${randomUUID()}`},
          'test.dispatch',
          '{}'::jsonb,
          ${`correlation:${randomUUID()}`},
          'unknown_outcome',
          ${reconciliationKey},
          ${attempt},
          ${reconciliationAttempt},
          now(),
          ${`sha256:${randomUUID()}`}
        )
        returning id
      `)
        ).rows,
      );
    },
    async outboxStatus(id) {
      const result = await db.execute<{ status: string }>(sql`
        select status from integration_outbox where id = ${id}::uuid
      `);
      const status = result.rows[0]?.status;
      if (status === undefined) throw new Error("Outbox row not found");
      return status;
    },
    async expireDispatchLease(id) {
      await db.execute(sql`
        update integration_outbox
        set lease_until = clock_timestamp() - interval '1 millisecond'
        where id = ${id}::uuid and status = 'processing'
      `);
    },
    async expireReconciliationLease(id) {
      await db.execute(sql`
        update integration_outbox
        set reconciliation_lease_until =
          clock_timestamp() - interval '1 millisecond'
        where id = ${id}::uuid and status = 'reconciling'
      `);
    },
    async makeOutboxRetryDue(id) {
      await db.execute(sql`
        update integration_outbox
        set next_attempt_at = clock_timestamp() - interval '1 millisecond'
        where id = ${id}::uuid and status = 'retry_wait'
      `);
    },
    async ownerAlertReasons(id) {
      const result = await db.execute<{ reason: string }>(sql`
        select reason_code as reason
        from outbox_operator_alerts
        where outbox_id = ${id}::uuid
        order by created_at, id
      `);
      return result.rows.map(({ reason }) => reason);
    },
    async deadLetterReasons(id) {
      const result = await db.execute<{ reason: string }>(sql`
        select reason
        from dead_letters
        where outbox_id = ${id}::uuid
        order by created_at, id
      `);
      return result.rows.map(({ reason }) => reason);
    },
    async createConfirmEligibilityCase(caseName) {
      const now = new Date("2026-07-28T10:00:00.000Z");
      const clientId = await createUser();
      const expert = await createExpert();
      const startsAt =
        caseName === "past_slot"
          ? new Date("2026-07-28T09:00:00.000Z")
          : new Date("2026-08-02T10:00:00.000Z");
      const observedAt =
        caseName === "stale_slot"
          ? new Date("2026-07-28T09:00:00.000Z")
          : caseName === "future_slot"
            ? new Date("2026-07-28T10:00:00.001Z")
            : now;
      const slotId = await createSlotForService({
        serviceId: expert.serviceId,
        capacity: 1,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60 * 1_000),
        observedAt,
      });
      if (caseName === "inactive_expert") {
        await db.execute(sql`
          update experts set active = false where id = ${expert.expertId}::uuid
        `);
      }
      const createdAt = new Date("2026-07-27T10:00:00.000Z");
      const reservedUntil =
        caseName === "expired_hold"
          ? new Date("2026-07-28T09:59:00.000Z")
          : new Date("2026-07-31T10:00:00.000Z");
      const reservationId = oneId(
        (
          await db.execute<{ id: string }>(sql`
        insert into reservations (
          user_id, slot_id, expert_id, expert_service_id, status, idempotency_key,
          reserved_until, version, created_at, updated_at
        ) values (
          ${clientId}::uuid, ${slotId}::uuid, ${expert.expertId}::uuid,
          ${expert.serviceId}::uuid, 'reserved', ${`confirm-${randomUUID()}`},
          ${reservedUntil}, 1, ${createdAt}, ${createdAt}
        )
        returning id
      `)
        ).rows,
      );
      let actorExpertId = expert.expertId;
      if (caseName === "wrong_expert") {
        actorExpertId = (await createExpert()).expertId;
      }
      return { reservationId, actorExpertId, now };
    },
    async reservationStatus(reservationId) {
      const result = await db.execute<{ status: string }>(sql`
        select status from reservations where id = ${reservationId}::uuid
      `);
      const status = result.rows[0]?.status;
      if (status === undefined) throw new Error("Reservation not found");
      return status;
    },
    async seedTelegramCallback(input) {
      const reservation = await createTelegramCallbackReservation({
        expertActive: input.expertActive ?? true,
        expertVerified: input.expertVerified ?? true,
        reservationVersion: input.version,
      });
      const claims = {
        reservationId: reservation.reservationId,
        expertId: reservation.expertId,
        action: input.action,
        version: input.version,
        expiresAtEpochSeconds: Math.floor(
          new Date(input.expiresAt).getTime() / 1_000,
        ),
      };
      const notificationId = oneId(
        (
          await db.execute<{ id: string }>(sql`
            insert into notifications (
              reservation_id,
              idempotency_key,
              callback_token_hash,
              callback_claims,
              callback_expires_at,
              callback_expert_id,
              callback_action,
              callback_version
            ) values (
              ${reservation.reservationId}::uuid,
              ${`callback-notification-${randomUUID()}`},
              ${input.tokenHash},
              ${JSON.stringify(claims)},
              ${new Date(input.expiresAt)},
              ${reservation.expertId}::uuid,
              ${input.action},
              ${input.version}
            )
            returning id
          `)
        ).rows,
      );
      return { notificationId, tokenHash: input.tokenHash, claims };
    },
    async callbackConsumedAt(notificationId) {
      const result = await db.execute<{
        consumedAt: Date | string | null;
      }>(sql`
        select callback_consumed_at as "consumedAt"
        from notifications
        where id = ${notificationId}::uuid
      `);
      const row = result.rows[0];
      if (row === undefined) throw new Error("Notification not found");
      return normalizeNullableBookingTimestamp(
        row.consumedAt,
        "notifications.callback_consumed_at",
      );
    },
    createTelegramCallbackReservation,
    async notificationCountForToken(tokenHash) {
      const result = await db.execute<{ count: string }>(sql`
        select count(*)::text as count
        from notifications
        where callback_token_hash = ${tokenHash}
      `);
      return Number(result.rows[0]?.count ?? 0);
    },
    async setTelegramCallbackReservationState(reservationId, input) {
      await db.execute(sql`
        update reservations
        set
          status = coalesce(
            ${input.status ?? null}::reservation_status,
            status
          ),
          version = coalesce(${input.version ?? null}::integer, version),
          reserved_until = coalesce(
            ${input.reservedUntil ?? null}::timestamptz,
            reserved_until
          ),
          updated_at = now()
        where id = ${reservationId}::uuid
      `);
    },
    async setTelegramCallbackSlotState(reservationId, input) {
      await db.execute(sql`
        update slots s
        set
          starts_at = coalesce(
            ${input.startsAt ?? null}::timestamptz,
            s.starts_at
          ),
          observed_at = coalesce(
            ${input.observedAt ?? null}::timestamptz,
            s.observed_at
          ),
          updated_at = now()
        from reservations r
        where r.id = ${reservationId}::uuid
          and s.id = r.slot_id
      `);
      if (input.serviceActive !== undefined) {
        await db.execute(sql`
          update expert_services es
          set active = ${input.serviceActive}, updated_at = now()
          from reservations r
          where r.id = ${reservationId}::uuid
            and es.id = r.expert_service_id
        `);
      }
    },
    async crossWireTelegramCallbackReservation(reservationId) {
      const other = await createExpert();
      await db.execute(sql`
        update reservations
        set expert_service_id = ${other.serviceId}::uuid, updated_at = now()
        where id = ${reservationId}::uuid
      `);
    },
    async prepareTelegramCallbackIssuanceBoundary(reservationId, boundary) {
      const result = await db.execute<{ epoch_seconds: string }>(sql`
        with authoritative_clock as (
          select clock_timestamp() as db_now
        ),
        updated_reservation as (
          update reservations r
          set
            reserved_until = case
              when ${boundary} = 'same_epoch_subsecond'
                then date_trunc('second', c.db_now) + interval '999 milliseconds'
              else date_trunc('second', c.db_now) + interval '5 seconds'
            end,
            updated_at = c.db_now
          from authoritative_clock c
          where r.id = ${reservationId}::uuid
          returning c.db_now
        )
        select floor(extract(epoch from db_now))::text as epoch_seconds
        from updated_reservation
      `);
      await db.execute(sql`
        update slots s
        set
          starts_at = clock_timestamp() + interval '1 hour',
          observed_at = clock_timestamp(),
          updated_at = clock_timestamp()
        from reservations r
        where r.id = ${reservationId}::uuid
          and s.id = r.slot_id
      `);
      const value = result.rows[0]?.epoch_seconds;
      if (value === undefined) {
        throw new Error("Failed to prepare callback issuance boundary");
      }
      return Number(value);
    },
  };
}
