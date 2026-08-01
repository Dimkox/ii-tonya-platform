import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import {
  createAdminService,
  createBookingService,
  createCatalogService,
  createConversationService,
  type AdminPrincipal,
} from "../../../packages/application/src/index.js";
import {
  PostgresAdminApprovalRepository,
  PostgresAdminRepository,
  PostgresBookingRepository,
  PostgresCatalogRepository,
  PostgresMessageRepository,
  PostgresWorkerJobsRepository,
  type AdminPayload,
  type ApprovalAdminAction,
} from "../../../packages/db/src/index.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../../packages/db/src/testkit/postgres.js";
import { reconcileProviderReservations } from "../../../packages/worker/src/reconciliation.js";

interface ClientHandle {
  readonly userId: string;
}

interface ReservationHandle {
  readonly id: string;
  readonly expertId: string;
  readonly version: number;
}

interface Counts {
  readonly ledger: number;
  readonly inbox: number;
  readonly outbox: number;
}

const number = (value: unknown): number => Number(value ?? 0);

export async function startMvpHarness(input: {
  readonly clock: Date;
  readonly testOnlyOutboundBillingMode: "provider_delivery_event";
}) {
  const testDb = await startTestPostgres();
  await testDb.migrate();

  const now = new Date(input.clock);
  const requester = await seedAdmin(testDb, ["support", "entitlement_admin"]);
  const approver = await seedAdmin(testDb, ["support", "entitlement_admin"]);
  const approvals = new PostgresAdminApprovalRepository(testDb.db);
  const admin = createAdminService({
    workflows: new PostgresAdminRepository(testDb.db, { testOnlyNow: now }),
  });
  const messageRepository = new PostgresMessageRepository(testDb.db);
  const conversation = createConversationService({
    deterministicSafety: { detect: () => null },
    typedSafety: { classify: async () => "ordinary" },
    intentEngine: {
      propose: async () => ({
        kind: "answer",
        text: "Нашла подходящие варианты",
      }),
    },
    intentAuthorization: {
      scopeFor: async () => ({
        allowedExpertIds: [],
        allowedServiceCodes: ["psychologist"],
      }),
    },
    messageRepository,
    safetyDirectory: { list: async () => [] },
    safetyHandoff: {
      accept: async () => {
        throw new Error("Safety handoff is outside AC-025");
      },
    },
    clock: { now: () => new Date(now) },
    handoffOwnerId: requester.id,
    handoffAcknowledgeWithinMs: 5 * 60 * 1_000,
    outboundBillingMode: input.testOnlyOutboundBillingMode,
    approvedSafetyContactIds: [],
  });
  const freeNotificationConversation = createConversationService({
    deterministicSafety: { detect: () => null },
    typedSafety: { classify: async () => "ordinary" },
    intentEngine: { propose: async () => ({ kind: "answer", text: "unused" }) },
    intentAuthorization: {
      scopeFor: async () => ({ allowedExpertIds: [], allowedServiceCodes: [] }),
    },
    messageRepository,
    safetyDirectory: { list: async () => [] },
    safetyHandoff: {
      accept: async () => {
        throw new Error("Safety handoff is outside AC-025");
      },
    },
    clock: { now: () => new Date(now) },
    handoffOwnerId: requester.id,
    handoffAcknowledgeWithinMs: 5 * 60 * 1_000,
    outboundBillingMode: "disabled",
    approvedSafetyContactIds: [],
  });
  const catalog = createCatalogService({
    repository: new PostgresCatalogRepository(testDb.db),
  });
  const booking = createBookingService({
    repository: new PostgresBookingRepository(testDb.db),
    clock: { now: () => new Date(now) },
  });
  const workerRepository = new PostgresWorkerJobsRepository(testDb.db);
  const catalogFixture = await seedCatalog(testDb, now);
  const reservationVersions = new Map<string, number>();
  const notificationMessageIds = new Map<string, readonly string[]>();

  const approvalFor = async (
    action: ApprovalAdminAction,
    objectId: string,
    payload: AdminPayload,
  ) => {
    const nonce = `nonce:${randomUUID()}`;
    const requested = await approvals.requestApproval({
      sessionIdHash: requester.sessionIdHash,
      action,
      objectType: "user",
      objectId,
      payload,
      nonce,
    });
    if (requested === null)
      throw new Error(`Approval request denied for ${action}`);
    const approved = await approvals.approveApproval({
      approvalId: requested.approvalId,
      sessionIdHash: approver.sessionIdHash,
    });
    if (!approved) throw new Error(`Approval was not approved for ${action}`);
    return {
      routeObjectId: objectId,
      approvalId: requested.approvalId,
      nonce,
      correlationId: `ac025:${action}:${randomUUID()}`,
    };
  };

  const recordFreeNotification = async (
    reservationId: string,
    reason: "reservation_confirmed" | "reservation_cancelled",
  ) => {
    const providerMessageId = `${reason}:${reservationId}`;
    await freeNotificationConversation.handleOutboundDelivery({
      kind: "outbound_delivery",
      provider: "selarti",
      providerEventId: `event:${providerMessageId}`,
      providerMessageId,
      userId: (
        await testDb.db.execute<{ userId: string }>(sql`
          select user_id as "userId" from reservations where id = ${reservationId}::uuid
        `)
      ).rows[0]!.userId,
      occurredAt: now.toISOString(),
      correlationId: `ac025:${reason}`,
      status: "delivered",
    });
    const current = notificationMessageIds.get(reservationId) ?? [];
    notificationMessageIds.set(reservationId, [...current, providerMessageId]);
  };

  const snapshotCounts = async (): Promise<Counts> => {
    const result = await testDb.db.execute<{
      ledger: string;
      inbox: string;
      outbox: string;
    }>(sql`
      select
        (select count(*)::text from message_ledger_entries) as ledger,
        (select count(*)::text from integration_inbox) as inbox,
        (select count(*)::text from integration_outbox) as outbox
    `);
    const row = result.rows[0]!;
    return {
      ledger: number(row.ledger),
      inbox: number(row.inbox),
      outbox: number(row.outbox),
    };
  };

  return {
    async createClient(command: { readonly explicitProfileConsent: boolean }) {
      const userId = randomUUID();
      const auth = await approvalFor("client.create", userId, { userId });
      const result = await admin.createClient(requester, {
        ...auth,
        userId,
      });
      if (!result.allowed) throw new Error("Client creation was denied");
      await testDb.db.execute(sql`
        insert into client_profiles (user_id, display_name, timezone)
        values (${userId}::uuid, 'Клиент AC-025', 'Europe/Moscow')
      `);
      if (command.explicitProfileConsent) {
        await testDb.db.execute(sql`
          insert into consents (user_id, consent_type, decision, policy_version)
          values (${userId}::uuid, 'profile_processing', 'granted', 'ac025-v1')
        `);
      }
      return { userId } satisfies ClientHandle;
    },

    async adminGrantPackage(command: {
      readonly userId: string;
      readonly size: number;
      readonly validForDays: number;
      readonly idempotencyKey: string;
    }) {
      if (command.validForDays !== 60)
        throw new Error("AC-025 grant must be valid for 60 days");
      const payload = {
        userId: command.userId,
        units: command.size,
        idempotencyKey: command.idempotencyKey,
      };
      const auth = await approvalFor("package.grant", command.userId, payload);
      const result = await admin.grantPackage(requester, {
        ...auth,
        userId: command.userId,
        units: command.size,
        idempotencyKey: command.idempotencyKey,
      });
      if (!result.allowed) throw new Error("Package grant was denied");
      const stored = await testDb.db.execute<{ expiresAt: Date }>(sql`
        select expires_at as "expiresAt" from message_packages
        where id = ${result.packageId}::uuid
      `);
      return { expiresAt: stored.rows[0]!.expiresAt.toISOString() };
    },

    async acceptOrdinaryInbound(command: {
      readonly client: ClientHandle;
      readonly text: string;
      readonly providerEventId: string;
    }) {
      return conversation.handleInbound({
        provider: "selarti",
        providerEventId: command.providerEventId,
        providerMessageId: `${command.providerEventId}:message`,
        userId: command.client.userId,
        text: command.text,
        locale: "ru-RU",
        countryCode: "RU",
        regionCode: "MOW",
        ageBand: "adult",
        occurredAt: now.toISOString(),
        correlationId: "ac025:ordinary-inbound",
      });
    },

    async queueOrdinaryAnswer(command: {
      readonly client: ClientHandle;
      readonly text: string;
      readonly outboxId: string;
    }) {
      const queued = await testDb.db.execute<{ count: string }>(sql`
        select count(*)::text as count from integration_outbox
        where topic = 'selarti.send'
          and payload @> ${JSON.stringify({ text: command.text })}::jsonb
          and correlation_id = 'ac025:ordinary-inbound'
      `);
      if (queued.rows[0]?.count !== "1")
        throw new Error("Ordinary answer was not queued exactly once");
      void command.client;
      return { outboxId: command.outboxId };
    },

    async dialogueDebitCount(userId: string) {
      const result = await testDb.db.execute<{ count: string }>(sql`
        select count(*)::text as count
        from message_ledger_entries l
        join message_packages p on p.id = l.package_id
        where p.user_id = ${userId}::uuid and l.entry_kind = 'debit'
      `);
      return number(result.rows[0]?.count);
    },

    async recordOutboundDelivery(command: {
      readonly userId: string;
      readonly outboxId: string;
      readonly provider: "selarti";
      readonly providerDeliveryEventId: string;
      readonly deliveredAt: string;
    }) {
      return conversation.handleOutboundDelivery({
        kind: "outbound_delivery",
        provider: command.provider,
        providerEventId: command.providerDeliveryEventId,
        providerMessageId: command.outboxId,
        userId: command.userId,
        occurredAt: command.deliveredAt,
        correlationId: "ac025:ordinary-outbound",
        status: "delivered",
      });
    },

    balance: (userId: string) => testDb.packageBalance(userId),

    async searchVerifiedServices(command: {
      readonly query: string;
      readonly startsAfter: string;
    }) {
      const serviceCode = command.query
        .toLocaleLowerCase("ru-RU")
        .includes("психолог")
        ? "psychologist"
        : command.query;
      const results = await catalog.search({
        serviceCode,
        language: "ru",
        from: new Date(command.startsAfter),
        to: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
        now,
      });
      return results.flatMap((expert) =>
        expert.slots.map((slot) => ({
          expert: { id: expert.expertId, active: true, verified: true },
          service: { id: catalogFixture.serviceId, active: true },
          slot: { id: slot.slotId },
        })),
      );
    },

    async reserve(command: {
      readonly client: ClientHandle;
      readonly slotId: string;
      readonly idempotencyKey: string;
    }): Promise<ReservationHandle> {
      const result = await booking.reserve({
        idempotencyKey: command.idempotencyKey,
        userId: command.client.userId,
        slotId: command.slotId,
        now,
        correlationId: "ac025:reservation-created",
      });
      if (result.kind === "unavailable")
        throw new Error(`Reservation unavailable: ${result.reason}`);
      reservationVersions.set(result.reservationId, result.version);
      return {
        id: result.reservationId,
        expertId: catalogFixture.expertId,
        version: result.version,
      };
    },

    async expertConfirm(command: {
      readonly reservationId: string;
      readonly expertId: string;
      readonly expectedVersion: number;
      readonly idempotencyKey: string;
    }) {
      const tokenHash = createHash("sha256")
        .update(command.idempotencyKey)
        .digest("hex");
      const claims = JSON.stringify({
        reservationId: command.reservationId,
        expertId: command.expertId,
        action: "confirm",
        version: command.expectedVersion,
      });
      await testDb.db.execute(sql`
        insert into notifications (
          reservation_id, idempotency_key, callback_token_hash,
          callback_claims, callback_expires_at, callback_expert_id,
          callback_action, callback_version
        ) values (
          ${command.reservationId}::uuid, ${command.idempotencyKey}, ${tokenHash},
          ${claims}, ${new Date(now.getTime() + 10 * 60 * 1_000)},
          ${command.expertId}::uuid, 'confirm', ${command.expectedVersion}
        )
      `);
      const result = await booking.confirmByExpert({
        reservationId: command.reservationId,
        expertId: command.expertId,
        callbackTokenHash: tokenHash,
        expectedVersion: command.expectedVersion,
        correlationId: "ac025:reservation-booked",
      });
      reservationVersions.set(command.reservationId, result.version);
      await recordFreeNotification(
        command.reservationId,
        "reservation_confirmed",
      );
      return result;
    },

    async clientCancel(command: {
      readonly reservationId: string;
      readonly userId: string;
      readonly idempotencyKey: string;
    }) {
      const result = await booking.cancelByClient({
        reservationId: command.reservationId,
        userId: command.userId,
        expectedVersion: reservationVersions.get(command.reservationId) ?? -1,
        correlationId: `ac025:${command.idempotencyKey}`,
      });
      reservationVersions.set(command.reservationId, result.version);
      await recordFreeNotification(
        command.reservationId,
        "reservation_cancelled",
      );
      return result;
    },

    async notificationLedgerFacts(reservationId: string) {
      const ids = notificationMessageIds.get(reservationId) ?? [];
      if (ids.length === 0) return [];
      const result = await testDb.db.execute<{
        externalMessageId: string;
        kind: string;
        delta: number;
      }>(sql`
        select m.external_message_id as "externalMessageId",
          l.entry_kind::text as kind, l.delta
        from message_ledger_entries l
        join message_events m on m.id = l.message_event_id
        where m.external_message_id in (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )})
        order by m.external_message_id
      `);
      return result.rows.map((row) => ({
        reason: row.externalMessageId.startsWith("reservation_confirmed:")
          ? "reservation_confirmed"
          : "reservation_cancelled",
        kind: row.kind,
        delta: number(row.delta),
      }));
    },

    async runReconciliation() {
      const before = await snapshotCounts();
      const report = await reconcileProviderReservations(
        {
          repository: workerRepository,
          provider: {
            async listReservations(window, batchSize) {
              const local = await workerRepository.listLocalReservations(
                window,
                batchSize,
              );
              return local.map((reservation) => ({
                externalId: reservation.externalId,
                status:
                  reservation.status === "cancelled_by_client" ||
                  reservation.status === "cancelled_by_expert"
                    ? ("cancelled" as const)
                    : reservation.status === "reserved"
                      ? ("reserved" as const)
                      : ("booked" as const),
              }));
            },
          },
          circuit: {
            isOpen: () => false,
            recordSuccess: () => undefined,
            recordFailure: () => undefined,
          },
        },
        {
          from: new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString(),
          to: new Date(now.getTime() + 24 * 60 * 60 * 1_000).toISOString(),
        },
      );
      const after = await snapshotCounts();
      return {
        mismatches: report.mismatches,
        newLedgerFacts: after.ledger - before.ledger,
        newInboxRows: after.inbox - before.inbox,
        newOutboxRows: after.outbox - before.outbox,
      };
    },

    async assertExactlyOnce(labels: readonly string[]) {
      const facts = await testDb.db.execute<{
        packageGranted: string;
        inboundAccepted: string;
        outboundDelivered: string;
        reservationCreated: string;
        reservationBooked: string;
        reservationCancelled: string;
      }>(sql`
        select
          (select count(*)::text from message_packages where grant_idempotency_key = 'grant-ac025-1') as "packageGranted",
          (select count(*)::text from integration_inbox where provider = 'selarti' and external_event_id = 'selarti-inbound-ac025-1') as "inboundAccepted",
          (select count(*)::text from integration_inbox where provider = 'selarti' and external_event_id = 'selarti-delivered-ac025-1') as "outboundDelivered",
          (select count(*)::text from reservations where idempotency_key = 'reserve-ac025-1') as "reservationCreated",
          (select count(*)::text from audit_events where correlation_id = 'ac025:reservation-booked' and action = 'reservation.expert_confirm') as "reservationBooked",
          (select count(*)::text from audit_events where correlation_id = 'ac025:cancel-ac025-1' and action = 'reservation.client_cancel') as "reservationCancelled"
      `);
      const expected: Record<string, number> = {
        "package.granted": number(facts.rows[0]!.packageGranted),
        "message.inbound.accepted": number(facts.rows[0]!.inboundAccepted),
        "message.outbound.delivered": number(facts.rows[0]!.outboundDelivered),
        "reservation.created": number(facts.rows[0]!.reservationCreated),
        "reservation.booked": number(facts.rows[0]!.reservationBooked),
        "reservation.cancelled_by_client": number(
          facts.rows[0]!.reservationCancelled,
        ),
      };
      for (const label of labels) {
        if (expected[label] !== 1)
          throw new Error(`${label} count was ${expected[label] ?? 0}`);
      }
    },

    close: () => testDb.stop(),
  };
}

async function seedAdmin(
  testDb: TestDatabase,
  roles: readonly ("support" | "entitlement_admin")[],
): Promise<AdminPrincipal> {
  const id = randomUUID();
  const sessionIdHash = `session:${randomUUID()}`;
  const current = await testDb.db.execute<{ now: Date }>(
    sql`select clock_timestamp() as now`,
  );
  const mfaVerifiedAt = current.rows[0]!.now;
  await testDb.db.execute(sql`insert into users (id) values (${id}::uuid)`);
  await testDb.db.execute(sql`
    insert into admin_sessions (session_id_hash, admin_id, mfa_verified_at, expires_at)
    values (${sessionIdHash}, ${id}::uuid, ${mfaVerifiedAt}, ${new Date(mfaVerifiedAt.getTime() + 60 * 60 * 1_000)})
  `);
  for (const role of roles) {
    await testDb.db.execute(sql`
      insert into admin_role_assignments (admin_id, role) values (${id}::uuid, ${role})
    `);
  }
  return { id, sessionIdHash, roles, mfaVerifiedAt };
}

async function seedCatalog(testDb: TestDatabase, now: Date) {
  const expertUserId = await testDb.createUser();
  const expert = await testDb.db.execute<{ id: string }>(sql`
    insert into experts (user_id, public_display_name, active, verified)
    values (${expertUserId}::uuid, 'Проверенный психолог', true, true)
    returning id
  `);
  const expertId = expert.rows[0]!.id;
  const service = await testDb.db.execute<{ id: string }>(sql`
    insert into expert_services (
      expert_id, name, code, language, active, duration_minutes
    ) values (
      ${expertId}::uuid, 'Консультация психолога', 'psychologist', 'ru', true, 60
    ) returning id
  `);
  const serviceId = service.rows[0]!.id;
  const slot = await testDb.db.execute<{ id: string }>(sql`
    insert into slots (
      expert_service_id, provider, external_slot_id, starts_at, ends_at,
      observed_at, capacity
    ) values (
      ${serviceId}::uuid, 'planerka', 'planerka-slot-ac025-1',
      ${new Date(now.getTime() + 2 * 24 * 60 * 60 * 1_000)},
      ${new Date(now.getTime() + 2 * 24 * 60 * 60 * 1_000 + 60 * 60 * 1_000)},
      ${now}, 1
    ) returning id
  `);
  return { expertId, serviceId, slotId: slot.rows[0]!.id };
}
