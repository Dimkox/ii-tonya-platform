import { vi } from "vitest";

import type {
  CanonicalOutboundDelivery,
  ConversationDependencies,
  HandleInboundCommand,
  InboundAcceptance,
  RecordOutboundDeliveryInput,
} from "./ports.js";

interface HandoffView {
  readonly status: "opened";
  readonly ownerId: string;
  readonly acknowledgeBy: Date;
}

export interface ConversationFixture extends ConversationDependencies {
  readonly calls: string[];
  readonly inbound: HandleInboundCommand;
  readonly delivery: CanonicalOutboundDelivery;
  readonly messageRepository: ConversationDependencies["messageRepository"] & {
    ledgerDeltas(): readonly number[];
    deliveryInboxCount(): number;
    failNext(error: Error): void;
  };
  readonly outbox: ConversationDependencies["outbox"] & {
    topics(): readonly string[];
    charges(): readonly number[];
    payloads(): readonly unknown[];
    keys(): readonly string[];
  };
  readonly safetyHandoff: ConversationDependencies["safetyHandoff"] & {
    failNextAfterIncident(error: Error): void;
    messageClasses(): readonly string[];
  };
  readonly handoffs: { current(): HandoffView | null };
  readonly incidents: { count(): number };
  readonly audit: { actions(): readonly string[] };
}

export const conversationFixture = (input: {
  readonly balance: number;
  readonly safety: "ordinary" | "crisis";
  readonly outboundBillingMode?:
    | "disabled"
    | "provider_delivery_event";
}): ConversationFixture => {
  const calls: string[] = [];
  let balance = input.balance;
  let nextFailure: Error | null = null;
  const ledgerDeltas: number[] = [];
  const inboundEvents = new Map<string, InboundAcceptance>();
  const deliveryEvents = new Map<string, InboundAcceptance>();
  const outboxByKey = new Map<
    string,
    { topic: string; charge: number; payload: unknown }
  >();
  let handoff: HandoffView | null = null;
  let incidentCount = 0;
  let safetyFailure: Error | null = null;
  const auditActions: string[] = [];
  const handoffMessageIds = new Set<string>();
  const safetyMessageClasses: string[] = [];
  let messageSequence = 0;

  const takeFailure = (): void => {
    if (!nextFailure) return;
    const error = nextFailure;
    nextFailure = null;
    throw error;
  };
  const acceptOrdinary = (
    key: string,
    charge: boolean,
  ): InboundAcceptance => {
    const existing = inboundEvents.get(key) ?? deliveryEvents.get(key);
    if (existing) {
      return {
        kind: "duplicate",
        messageEventId: existing.messageEventId,
      };
    }
    messageSequence += 1;
    const packageId = charge && balance > 0 ? "package-1" : null;
    if (packageId) {
      balance -= 1;
      ledgerDeltas.push(-1);
    }
    return {
      kind: "accepted",
      messageEventId: `message-event-${messageSequence}`,
      packageId,
      ledgerBalance: balance,
    };
  };

  const messageRepository: ConversationFixture["messageRepository"] = {
    async acceptInbound(command) {
      calls.push("accept-inbound");
      takeFailure();
      const key = `${command.provider}:${command.externalEventId}`;
      const existing = inboundEvents.get(key);
      if (existing) {
        return {
          kind: "duplicate",
          messageEventId: existing.messageEventId,
        };
      }
      const accepted = acceptOrdinary(key, true);
      inboundEvents.set(key, accepted);
      return accepted;
    },
    async recordOutboundDelivery(command: RecordOutboundDeliveryInput) {
      calls.push("record-delivery");
      takeFailure();
      const key = `${command.provider}:${command.externalDeliveryEventId}`;
      const existing = deliveryEvents.get(key);
      if (existing) {
        return {
          kind: "duplicate",
          messageEventId: existing.messageEventId,
        };
      }
      const accepted = acceptOrdinary(key, command.charge);
      deliveryEvents.set(key, accepted);
      return accepted;
    },
    ledgerDeltas: () => [...ledgerDeltas],
    deliveryInboxCount: () => deliveryEvents.size,
    failNext(error) {
      nextFailure = error;
    },
  };

  const outbox: ConversationFixture["outbox"] = {
    async enqueue(command) {
      if (!outboxByKey.has(command.idempotencyKey)) {
        outboxByKey.set(command.idempotencyKey, {
          topic: command.topic,
          charge: command.charge,
          payload: command.payload,
        });
      }
    },
    topics: () => [...outboxByKey.values()].map((entry) => entry.topic),
    charges: () => [...outboxByKey.values()].map((entry) => entry.charge),
    payloads: () => [...outboxByKey.values()].map((entry) => entry.payload),
    keys: () => [...outboxByKey.keys()],
  };

  const fixture: ConversationFixture = {
    calls,
    inbound: {
      provider: "selarti",
      providerEventId: "inbound-event-1",
      providerMessageId: "provider-message-in-1",
      userId: "user-1",
      text: "Мне нужна консультация",
      locale: "ru-RU",
      countryCode: "RU",
      regionCode: "MOW",
      ageBand: "adult",
      occurredAt: "2026-07-28T10:00:00.000Z",
      correlationId: "correlation-1",
    },
    delivery: {
      kind: "outbound_delivery",
      provider: "selarti",
      providerEventId: "delivery-event-1",
      providerMessageId: "provider-message-1",
      userId: "user-1",
      occurredAt: "2026-07-28T10:01:00.000Z",
      correlationId: "correlation-delivery-1",
      status: "delivered",
    },
    deterministicSafety: {
      detect() {
        calls.push("deterministic-safety");
        return input.safety === "crisis" ? "self_harm" : null;
      },
    },
    typedSafety: {
      classify: vi.fn<ConversationDependencies["typedSafety"]["classify"]>(
        async () => {
          calls.push("typed-safety");
          return "ordinary";
        },
      ),
    },
    intentEngine: {
      propose: vi.fn<ConversationDependencies["intentEngine"]["propose"]>(
        async () => ({
          kind: "answer",
          text: "Короткий ответ",
        }),
      ),
    },
    messageRepository,
    safetyHandoff: {
      async accept(command) {
        calls.push("safety-persist");
        const key = `${command.provider}:${command.providerEventId}`;
        const existing = inboundEvents.get(key);
        if (existing) {
          return {
            kind: "duplicate" as const,
            messageEventId: existing.messageEventId,
          };
        }
        const previousHandoff = handoff;
        const previousIncidentCount = incidentCount;
        const previousAuditLength = auditActions.length;
        const previousMessageSequence = messageSequence;
        const previousOutbox = new Map(outboxByKey);
        messageSequence += 1;
        const accepted = {
          kind: "accepted" as const,
          messageEventId: `message-event-${messageSequence}`,
          packageId: null,
          ledgerBalance: balance,
        };
        inboundEvents.set(key, accepted);
        handoff = {
          status: "opened",
          ownerId: command.ownerId,
          acknowledgeBy: command.acknowledgeBy,
        };
        incidentCount += 1;
        safetyMessageClasses.push(command.messageClass);
        if (safetyFailure) {
          const error = safetyFailure;
          safetyFailure = null;
          inboundEvents.delete(key);
          handoff = previousHandoff;
          incidentCount = previousIncidentCount;
          safetyMessageClasses.length = previousIncidentCount;
          auditActions.length = previousAuditLength;
          messageSequence = previousMessageSequence;
          outboxByKey.clear();
          for (const [outboxKey, value] of previousOutbox) {
            outboxByKey.set(outboxKey, value);
          }
          throw error;
        }
        auditActions.push("safety.handoff_opened");
        outboxByKey.set(`${accepted.messageEventId}:human_handoff.opened`, {
          topic: "human_handoff.opened",
          charge: 0,
          payload: {
            messageEventId: accepted.messageEventId,
            reasonCode: command.reasonCode,
          },
        });
        calls.push("free-outbound");
        return accepted;
      },
      failNextAfterIncident(error) {
        safetyFailure = error;
      },
      messageClasses: () => [...safetyMessageClasses],
      async openForAcceptedInbound(command) {
        calls.push("handoff-persist");
        if (handoffMessageIds.has(command.messageEventId)) {
          return {
            kind: "duplicate" as const,
            messageEventId: command.messageEventId,
          };
        }
        handoffMessageIds.add(command.messageEventId);
        handoff = {
          status: "opened",
          ownerId: command.ownerId,
          acknowledgeBy: command.acknowledgeBy,
        };
        auditActions.push("conversation.handoff_opened");
        outboxByKey.set(`${command.messageEventId}:human_handoff.opened`, {
          topic: "human_handoff.opened",
          charge: 0,
          payload: {
            messageEventId: command.messageEventId,
            reasonCode: command.reasonCode,
          },
        });
        return {
          kind: "opened" as const,
          messageEventId: command.messageEventId,
        };
      },
    },
    outbox,
    clock: {
      now: () => new Date("2026-07-28T10:00:00.000Z"),
    },
    handoffOwnerId: "safety-owner-1",
    handoffAcknowledgeWithinMs: 300_000,
    outboundBillingMode: input.outboundBillingMode ?? "disabled",
    handoffs: { current: () => handoff },
    incidents: { count: () => incidentCount },
    audit: { actions: () => [...auditActions] },
  };
  return fixture;
};
