import type { SafetyContact } from "@ii-tonya/domain";
import { vi } from "vitest";

import type {
  CanonicalOutboundDelivery,
  CommittedInboundResult,
  ConversationDependencies,
  HandleInboundCommand,
  InboundCompletionOutcome,
  RecordOutboundDeliveryInput,
  VerifiedSafetyContact,
} from "./ports.js";

interface HandoffView {
  readonly status: "opened";
  readonly ownerId: string;
  readonly acknowledgeBy: Date;
}

interface OutboxEntry {
  readonly topic: string;
  readonly charge: number;
  readonly payload: unknown;
}

interface PendingInbound {
  readonly messageEventId: string;
  readonly packageAvailable: boolean;
  state: "pending" | "completed";
}

export interface ConversationFixture extends ConversationDependencies {
  readonly calls: string[];
  readonly inbound: HandleInboundCommand;
  readonly delivery: CanonicalOutboundDelivery;
  readonly messageRepository: ConversationDependencies["messageRepository"] & {
    ledgerDeltas(): readonly number[];
    deliveryInboxCount(): number;
    failNext(error: Error): void;
    failNextAfterPrepare(error: Error): void;
    failNextCompletionAfterCommit(error: Error): void;
    auditActions(): readonly string[];
    pendingInboundCount(): number;
    grantMessages(count: number): void;
  };
  readonly outbox: {
    topics(): readonly string[];
    charges(): readonly number[];
    payloads(): readonly unknown[];
    keys(): readonly string[];
  };
  readonly safetyHandoff: ConversationDependencies["safetyHandoff"] & {
    failNextAfterIncident(error: Error): void;
    messageClasses(): readonly string[];
    contacts(): readonly VerifiedSafetyContact[];
    directoryStates(): readonly string[];
  };
  readonly safetyDirectory: ConversationDependencies["safetyDirectory"] & {
    queries(): readonly unknown[];
    failNext(error: Error): void;
    setContacts(contacts: readonly SafetyContact[]): void;
    defaultContacts(): readonly SafetyContact[];
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
  let prepareFailure: Error | null = null;
  let completionFailure: Error | null = null;
  let safetyFailure: Error | null = null;
  let directoryFailure: Error | null = null;
  const ledgerDeltas: number[] = [];
  const inboundByKey = new Map<string, PendingInbound>();
  const inboundByMessageId = new Map<string, PendingInbound>();
  const deliveryEvents = new Map<
    string,
    {
      readonly kind: "accepted";
      readonly messageEventId: string;
      readonly packageId: string | null;
      readonly ledgerBalance: number;
    }
  >();
  const outboxByKey = new Map<string, OutboxEntry>();
  const messageAuditActions: string[] = [];
  const handoffAuditActions: string[] = [];
  const safetyMessageClasses: string[] = [];
  const safetyContacts: VerifiedSafetyContact[] = [];
  const safetyDirectoryStates: string[] = [];
  const directoryQueries: unknown[] = [];
  let handoff: HandoffView | null = null;
  let incidentCount = 0;
  let messageSequence = 0;

  const seededContacts: readonly SafetyContact[] = [
    {
      id: "contact-verified",
      label: "Verified crisis line",
      channel: "phone",
      value: "+78002000122",
      countryCode: "RU",
      regionCode: "MOW",
      ageBands: ["adult"],
      riskTypes: [
        "self_harm",
        "violence",
        "medical",
        "abuse",
        "urgent",
        "uncertain",
      ],
      sourceUrl: "https://safety.example.invalid/verified-source",
      owner: "verified-owner",
      verifiedAt: new Date("2026-07-28T09:00:00.000Z"),
      validUntil: new Date("2026-07-29T10:00:00.000Z"),
    },
  ];
  let directoryContacts = [...seededContacts];

  const takeFailure = (): void => {
    if (!nextFailure) return;
    const error = nextFailure;
    nextFailure = null;
    throw error;
  };

  const nextMessageEventId = (): string => {
    messageSequence += 1;
    return `message-event-${messageSequence}`;
  };

  const messageRepository: ConversationFixture["messageRepository"] = {
    async prepareInbound(command) {
      calls.push("prepare-inbound");
      takeFailure();
      const key = `${command.provider}:${command.externalEventId}`;
      const existing = inboundByKey.get(key);
      if (existing?.state === "completed") {
        return {
          kind: "duplicate" as const,
          messageEventId: existing.messageEventId,
        };
      }
      const pending = existing ?? {
        messageEventId: nextMessageEventId(),
        packageAvailable: balance > 0,
        state: "pending" as const,
      };
      if (!existing) {
        inboundByKey.set(key, pending);
        inboundByMessageId.set(pending.messageEventId, pending);
      }
      if (prepareFailure) {
        const error = prepareFailure;
        prepareFailure = null;
        throw error;
      }
      return {
        kind: "pending" as const,
        messageEventId: pending.messageEventId,
        packageAvailable: pending.packageAvailable,
      };
    },
    async completeInbound(command) {
      calls.push("complete-inbound");
      const pending = inboundByMessageId.get(command.messageEventId);
      if (!pending) throw new Error("Unknown pending inbound");
      if (pending.state === "completed") {
        return {
          kind: "duplicate" as const,
          messageEventId: command.messageEventId,
        };
      }

      if (
        command.outcome.kind === "no_package" &&
        balance > 0
      ) {
        return {
          kind: "retry" as const,
          messageEventId: command.messageEventId,
          packageAvailable: true as const,
        };
      }
      const committedOutcome: InboundCompletionOutcome =
        command.outcome.kind === "no_package" || balance <= 0
          ? {
              kind: "no_package",
              topic: "client.no_package",
              payload: {},
            }
          : command.outcome;
      const packageId =
        committedOutcome.kind === "no_package" ? null : "package-1";
      if (packageId) {
        balance -= 1;
        ledgerDeltas.push(-1);
      }
      pending.state = "completed";
      messageAuditActions.push("conversation.inbound_completed");
      const outboxKey =
        `${command.messageEventId}:${committedOutcome.topic}`;
      outboxByKey.set(outboxKey, {
        topic: committedOutcome.topic,
        charge: 0,
        payload: {
          messageEventId: command.messageEventId,
          ...committedOutcome.payload,
        },
      });
      if (committedOutcome.kind === "human_handoff") {
        handoff = {
          status: "opened",
          ownerId: committedOutcome.ownerId,
          acknowledgeBy: committedOutcome.acknowledgeBy,
        };
        handoffAuditActions.push("conversation.handoff_opened");
      }
      const result: CommittedInboundResult =
        committedOutcome.kind === "no_package"
          ? { kind: "no_package", chargedMessages: 0 }
          : committedOutcome.kind === "answer"
            ? { kind: "answer_queued", chargedMessages: 1 }
            : committedOutcome.kind === "show_catalog"
              ? { kind: "catalog_requested", chargedMessages: 1 }
              : committedOutcome.kind === "start_booking"
                ? { kind: "booking_started", chargedMessages: 1 }
                : {
                    kind: "human_handoff",
                    reasonCode: committedOutcome.payload.reasonCode,
                    chargedMessages: 1,
                  };
      if (completionFailure) {
        const error = completionFailure;
        completionFailure = null;
        throw error;
      }
      return {
        kind: "completed" as const,
        messageEventId: command.messageEventId,
        packageId,
        ledgerBalance: balance,
        result,
      };
    },
    async recordOutboundDelivery(command: RecordOutboundDeliveryInput) {
      calls.push("record-delivery");
      takeFailure();
      const key = `${command.provider}:${command.externalDeliveryEventId}`;
      const existing = deliveryEvents.get(key);
      if (existing) {
        return {
          kind: "duplicate" as const,
          messageEventId: existing.messageEventId,
        };
      }
      const packageId = command.charge && balance > 0 ? "package-1" : null;
      if (packageId) {
        balance -= 1;
        ledgerDeltas.push(-1);
      }
      const accepted = {
        kind: "accepted" as const,
        messageEventId: nextMessageEventId(),
        packageId,
        ledgerBalance: balance,
      };
      deliveryEvents.set(key, accepted);
      return accepted;
    },
    ledgerDeltas: () => [...ledgerDeltas],
    deliveryInboxCount: () => deliveryEvents.size,
    auditActions: () => [...messageAuditActions],
    pendingInboundCount: () =>
      [...inboundByMessageId.values()].filter(
        (inbound) => inbound.state === "pending",
      ).length,
    grantMessages(count) {
      if (!Number.isSafeInteger(count) || count <= 0) {
        throw new Error("Granted message count must be a positive safe integer");
      }
      balance += count;
    },
    failNext(error) {
      nextFailure = error;
    },
    failNextAfterPrepare(error) {
      prepareFailure = error;
    },
    failNextCompletionAfterCommit(error) {
      completionFailure = error;
    },
  };

  const safetyDirectory: ConversationFixture["safetyDirectory"] = {
    async list(query) {
      calls.push("safety-directory");
      directoryQueries.push(query);
      if (directoryFailure) {
        const error = directoryFailure;
        directoryFailure = null;
        throw error;
      }
      return directoryContacts;
    },
    queries: () => [...directoryQueries],
    failNext(error) {
      directoryFailure = error;
    },
    setContacts(contacts) {
      directoryContacts = [...contacts];
    },
    defaultContacts: () => [...seededContacts],
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
    intentAuthorization: {
      scopeFor: vi.fn<
        ConversationDependencies["intentAuthorization"]["scopeFor"]
      >(async () => ({
        allowedExpertIds: ["b7ab91db-4988-4ec6-bf23-42d2ea3333a1"],
        allowedServiceCodes: ["consultation"],
      })),
    },
    messageRepository,
    safetyDirectory,
    safetyHandoff: {
      async accept(command) {
        calls.push("safety-persist");
        const key = `${command.provider}:${command.providerEventId}`;
        const existing = inboundByKey.get(key);
        if (existing?.state === "completed") {
          return {
            kind: "duplicate" as const,
            messageEventId: existing.messageEventId,
          };
        }
        const previousHandoff = handoff;
        const previousIncidentCount = incidentCount;
        const previousAuditLength = handoffAuditActions.length;
        const previousMessageSequence = messageSequence;
        const previousClassesLength = safetyMessageClasses.length;
        const previousContactsLength = safetyContacts.length;
        const previousDirectoryLength = safetyDirectoryStates.length;
        const previousOutbox = new Map(outboxByKey);
        const accepted = {
          messageEventId: nextMessageEventId(),
          packageAvailable: false,
          state: "completed" as const,
        };
        inboundByKey.set(key, accepted);
        inboundByMessageId.set(accepted.messageEventId, accepted);
        handoff = {
          status: "opened",
          ownerId: command.ownerId,
          acknowledgeBy: command.acknowledgeBy,
        };
        incidentCount += 1;
        safetyMessageClasses.push(command.messageClass);
        safetyContacts.push(...command.contacts);
        safetyDirectoryStates.push(command.directoryState);
        if (safetyFailure) {
          const error = safetyFailure;
          safetyFailure = null;
          inboundByKey.delete(key);
          inboundByMessageId.delete(accepted.messageEventId);
          handoff = previousHandoff;
          incidentCount = previousIncidentCount;
          safetyMessageClasses.length = previousClassesLength;
          safetyContacts.length = previousContactsLength;
          safetyDirectoryStates.length = previousDirectoryLength;
          handoffAuditActions.length = previousAuditLength;
          messageSequence = previousMessageSequence;
          outboxByKey.clear();
          for (const [outboxKey, value] of previousOutbox) {
            outboxByKey.set(outboxKey, value);
          }
          throw error;
        }
        handoffAuditActions.push("safety.handoff_opened");
        outboxByKey.set(`${accepted.messageEventId}:human_handoff.opened`, {
          topic: "human_handoff.opened",
          charge: 0,
          payload: {
            messageEventId: accepted.messageEventId,
            reasonCode: command.reasonCode,
            contacts: command.contacts,
            directoryState: command.directoryState,
          },
        });
        calls.push("free-outbound");
        return {
          kind: "accepted" as const,
          messageEventId: accepted.messageEventId,
        };
      },
      failNextAfterIncident(error) {
        safetyFailure = error;
      },
      messageClasses: () => [...safetyMessageClasses],
      contacts: () => [...safetyContacts],
      directoryStates: () => [...safetyDirectoryStates],
    },
    clock: {
      now: () => new Date("2026-07-28T10:00:00.000Z"),
    },
    handoffOwnerId: "00000000-0000-4000-8000-000000000001",
    handoffAcknowledgeWithinMs: 300_000,
    outboundBillingMode: input.outboundBillingMode ?? "disabled",
    approvedSafetyContactIds: ["contact-verified"],
    outbox: {
      topics: () => [...outboxByKey.values()].map((entry) => entry.topic),
      charges: () => [...outboxByKey.values()].map((entry) => entry.charge),
      payloads: () => [...outboxByKey.values()].map((entry) => entry.payload),
      keys: () => [...outboxByKey.keys()],
    },
    handoffs: { current: () => handoff },
    incidents: { count: () => incidentCount },
    audit: { actions: () => [...handoffAuditActions] },
  };
  return fixture;
};
