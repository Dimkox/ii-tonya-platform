import {
  createConversationService,
  createKeywordSafetyGuard,
  createMenuIntentEngine,
  createMenuTypedSafety,
  ConversationServiceError,
  type ClientCommercialPolicyPort,
  type ConversationLlmHook,
  type ConversationMessageRepository,
  type ConversationService,
  type IntentAuthorization,
  type SafetyHandoffTransaction,
} from "@ii-tonya/application";
import {
  PostgresCatalogRepository,
  PostgresMessageRepository,
  type ConversationTelegramDelivery,
  type DrizzleDb,
} from "@ii-tonya/db";
import { sql } from "drizzle-orm";

/** A support operator must acknowledge a client handoff within four hours. */
export const CLIENT_HANDOFF_ACKNOWLEDGE_WITHIN_MS = 4 * 60 * 60 * 1000;

export interface ClientConversationPorts {
  readonly messages: ConversationMessageRepository;
  readonly authorization: IntentAuthorization;
  /** Resolves the support operator that owns new handoffs; null when none. */
  readonly resolveHandoffOwner: () => Promise<string | null>;
  readonly clock?: { now(): Date };
  readonly clientCommercialPolicy?: ClientCommercialPolicyPort;
  readonly clientFreeAccessV2Enabled?: boolean;
  /** LLM hook stays off: no provider is approved for production. */
  readonly llm?: ConversationLlmHook;
  readonly llmEnabled?: false;
}

/**
 * A safety handoff is persisted through the same atomic inbound path: the
 * inbox claim dedupes the provider event, then completion opens the
 * incident/escalation pair and audit row without charging the client.
 */
export const createMessageBackedSafetyHandoff = (
  messages: ConversationMessageRepository,
): SafetyHandoffTransaction => ({
  async accept(input) {
    const prepared = await messages.prepareInbound({
      provider: input.provider,
      externalEventId: input.providerEventId,
      externalMessageId: input.providerMessageId,
      userId: input.userId,
      messageClass: "ordinary_inbound",
      occurredAt: input.occurredAt,
      correlationId: input.correlationId,
    });
    if (prepared.kind === "duplicate")
      return { kind: "duplicate", messageEventId: prepared.messageEventId };
    const completed = await messages.completeInbound({
      messageEventId: prepared.messageEventId,
      userId: input.userId,
      correlationId: input.correlationId,
      billingPolicy: "free",
      outcome: {
        kind: "human_handoff",
        topic: "human_handoff.opened",
        payload: { reasonCode: input.reasonCode },
        ownerId: input.ownerId,
        openedAt: input.occurredAt,
        acknowledgeBy: input.acknowledgeBy,
      },
    });
    return completed.kind === "duplicate"
      ? { kind: "duplicate", messageEventId: completed.messageEventId }
      : { kind: "accepted", messageEventId: completed.messageEventId };
  },
});

export const createClientConversationService = (
  ports: ClientConversationPorts,
): ConversationService => {
  const clock = ports.clock ?? { now: () => new Date() };
  const dialog = {
    llmEnabled: false as const,
    ...(ports.llm ? { llm: ports.llm } : {}),
  };
  const build = (handoffOwnerId: string) =>
    createConversationService({
      deterministicSafety: createKeywordSafetyGuard(),
      typedSafety: createMenuTypedSafety(dialog),
      intentEngine: createMenuIntentEngine(dialog),
      intentAuthorization: ports.authorization,
      messageRepository: ports.messages,
      // No verified emergency-contact directory exists yet; handoff still opens
      // with directoryState "no_fresh_contact" so a human follows up.
      safetyDirectory: { list: async () => [] },
      safetyHandoff: createMessageBackedSafetyHandoff(ports.messages),
      clock,
      handoffOwnerId,
      handoffAcknowledgeWithinMs: CLIENT_HANDOFF_ACKNOWLEDGE_WITHIN_MS,
      outboundBillingMode: "disabled",
      approvedSafetyContactIds: [],
      ...(ports.clientCommercialPolicy
        ? { clientCommercialPolicy: ports.clientCommercialPolicy }
        : {}),
      ...(ports.clientFreeAccessV2Enabled === true
        ? { clientFreeAccessV2Enabled: true }
        : {}),
    });
  const owner = async (): Promise<string> => {
    let id: string | null;
    try {
      id = await ports.resolveHandoffOwner();
    } catch {
      throw new ConversationServiceError("dependency_unavailable");
    }
    if (id === null)
      throw new ConversationServiceError("dependency_unavailable");
    return id;
  };
  return {
    async handleInbound(command) {
      return build(await owner()).handleInbound(command);
    },
    async handleOutboundDelivery(event) {
      // Outbound billing never needs a handoff owner; a placeholder keeps the
      // runtime-config validation satisfied without a DB read.
      return build(
        "00000000-0000-4000-8000-000000000000",
      ).handleOutboundDelivery(event);
    },
  };
};

export const createPostgresClientConversationService = (
  db: DrizzleDb,
  options: {
    readonly waveCoverage: boolean;
    readonly clientCommercialPolicy?: ClientCommercialPolicyPort;
    readonly clientFreeAccessV2Enabled?: boolean;
    /**
     * Client bot + messaging consent policy. Without it replies have no
     * deliverable channel, so inbound handling fails closed (nothing charged).
     */
    readonly telegramDelivery?: ConversationTelegramDelivery;
  },
): ConversationService => {
  const delivery = options.telegramDelivery;
  if (
    delivery === undefined ||
    delivery.botKey.length === 0 ||
    delivery.messagingPolicyVersion.length === 0
  ) {
    const unavailable = async (): Promise<never> => {
      throw new ConversationServiceError("dependency_unavailable");
    };
    return {
      handleInbound: unavailable,
      handleOutboundDelivery: unavailable,
    };
  }
  return createClientConversationService({
    messages: new PostgresMessageRepository(db, { telegramDelivery: delivery }),
    authorization: {
      async scopeFor() {
        const services = await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '1s'`);
          await tx.execute(sql`SET LOCAL statement_timeout = '2s'`);
          return new PostgresCatalogRepository(tx, {
            waveCoverage: options.waveCoverage,
          }).listPublicServices({ limit: 20 });
        });
        return {
          allowedExpertIds: [],
          allowedServiceCodes: [
            ...new Set(services.map((service) => service.serviceCode)),
          ],
        };
      },
    },
    resolveHandoffOwner: async () => {
      const rows = (
        await db.execute<{ admin_id: string }>(sql`
          select admin_id from admin_role_assignments
          where role = 'support'
          order by created_at, id
          limit 1
        `)
      ).rows;
      return rows[0]?.admin_id ?? null;
    },
    ...(options.clientCommercialPolicy
      ? { clientCommercialPolicy: options.clientCommercialPolicy }
      : {}),
    ...(options.clientFreeAccessV2Enabled === true
      ? { clientFreeAccessV2Enabled: true }
      : {}),
  });
};
