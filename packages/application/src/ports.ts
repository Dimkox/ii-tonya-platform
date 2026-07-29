import type { AgeBand, SafetyContact, SafetyRisk } from "@ii-tonya/domain";

export interface IntentInput {
  readonly text: string;
  readonly locale: string;
  readonly userId: string;
  readonly correlationId: string;
}

export type IntentProposal =
  | { readonly kind: "answer"; readonly text: string }
  | { readonly kind: "show_catalog"; readonly serviceCode?: string }
  | { readonly kind: "start_booking"; readonly expertId: string }
  | { readonly kind: "human_handoff"; readonly reasonCode: string };

export interface IntentEngine {
  propose(input: IntentInput): Promise<IntentProposal>;
}

export interface IntentAuthorizationScope {
  readonly allowedExpertIds?: readonly string[];
  readonly allowedServiceCodes?: readonly string[];
}

export interface IntentAuthorization {
  scopeFor(input: {
    readonly userId: string;
    readonly correlationId: string;
  }): Promise<IntentAuthorizationScope>;
}

export interface DeterministicSafetyPort {
  detect(text: string): SafetyRisk | null;
}

export interface TypedSafetyPort {
  classify(text: string): Promise<"ordinary" | SafetyRisk>;
}

export interface HandleInboundCommand {
  readonly provider: string;
  readonly providerEventId: string;
  readonly providerMessageId: string;
  readonly userId: string;
  readonly text: string;
  readonly locale: string;
  readonly countryCode: string;
  readonly regionCode: string | null;
  readonly ageBand: AgeBand;
  readonly occurredAt: string;
  readonly correlationId: string;
}

export type PreparedInbound =
  | { readonly kind: "duplicate"; readonly messageEventId: string }
  | {
      readonly kind: "pending";
      readonly messageEventId: string;
      readonly packageAvailable: boolean;
    };

export interface AcceptInboundInput {
  readonly provider: string;
  readonly externalEventId: string;
  readonly externalMessageId: string;
  readonly userId: string;
  readonly messageClass: "ordinary_inbound";
  readonly occurredAt: Date;
  readonly correlationId: string;
}

export type OutboundDeliveryStatus =
  | "accepted"
  | "queued"
  | "sent"
  | "delivered"
  | "failed"
  | "ambiguous";

export interface CanonicalOutboundDelivery {
  readonly kind: "outbound_delivery";
  readonly provider: "selarti";
  readonly providerEventId: string;
  readonly providerMessageId: string;
  readonly userId: string;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly status: OutboundDeliveryStatus;
}

export interface RecordOutboundDeliveryInput {
  readonly provider: "selarti";
  readonly externalDeliveryEventId: string;
  readonly providerMessageId: string;
  readonly userId: string;
  readonly deliveryStatus: OutboundDeliveryStatus;
  readonly occurredAt: Date;
  readonly correlationId: string;
  readonly charge: boolean;
}

export type InboundCompletionOutcome =
  | {
      readonly kind: "answer";
      readonly topic: "selarti.send";
      readonly payload: { readonly text: string };
    }
  | {
      readonly kind: "no_package";
      readonly topic: "client.no_package";
      readonly payload: Readonly<Record<string, never>>;
    }
  | {
      readonly kind: "show_catalog";
      readonly topic: "catalog.show";
      readonly payload: { readonly serviceCode?: string };
    }
  | {
      readonly kind: "start_booking";
      readonly topic: "booking.start";
      readonly payload: { readonly expertId: string };
    }
  | {
      readonly kind: "human_handoff";
      readonly topic: "human_handoff.opened";
      readonly payload: { readonly reasonCode: string };
      readonly ownerId: string;
      readonly openedAt: Date;
      readonly acknowledgeBy: Date;
    };

export interface CompleteInboundInput {
  readonly messageEventId: string;
  readonly userId: string;
  readonly correlationId: string;
  readonly outcome: InboundCompletionOutcome;
}

export type CompleteInboundResult =
  | { readonly kind: "duplicate"; readonly messageEventId: string }
  | {
      readonly kind: "completed";
      readonly messageEventId: string;
      readonly packageId: string | null;
      readonly ledgerBalance: number;
    };

export interface ConversationMessageRepository {
  prepareInbound(input: AcceptInboundInput): Promise<PreparedInbound>;
  completeInbound(input: CompleteInboundInput): Promise<CompleteInboundResult>;
  recordOutboundDelivery(
    input: RecordOutboundDeliveryInput,
  ): Promise<
    | { readonly kind: "duplicate"; readonly messageEventId: string }
    | {
        readonly kind: "accepted";
        readonly messageEventId: string;
        readonly packageId: string | null;
        readonly ledgerBalance: number;
      }
  >;
}

export interface SafetyDirectoryQuery {
  readonly countryCode: string;
  readonly regionCode: string | null;
  readonly ageBand: AgeBand;
  readonly risk: SafetyRisk;
  readonly at: Date;
}

export interface ConversationSafetyDirectory {
  list(query: SafetyDirectoryQuery): Promise<readonly SafetyContact[]>;
}

export interface VerifiedSafetyContact {
  readonly id: string;
  readonly label: string;
  readonly channel: string;
}

export interface AcceptSafetyHandoffInput {
  readonly provider: string;
  readonly providerEventId: string;
  readonly providerMessageId: string;
  readonly userId: string;
  readonly occurredAt: Date;
  readonly correlationId: string;
  readonly messageClass: "safety";
  readonly reasonCode: SafetyRisk | "classifier_unavailable";
  readonly ownerId: string;
  readonly acknowledgeBy: Date;
  readonly directoryState:
    | "fresh"
    | "no_fresh_contact"
    | "unavailable";
  readonly contacts: readonly VerifiedSafetyContact[];
}

export interface SafetyHandoffTransaction {
  accept(
    input: AcceptSafetyHandoffInput,
  ): Promise<
    | { readonly kind: "duplicate"; readonly messageEventId: string }
    | { readonly kind: "accepted"; readonly messageEventId: string }
  >;
}

export interface Clock {
  now(): Date;
}

export interface ConversationDependencies {
  readonly deterministicSafety: DeterministicSafetyPort;
  readonly typedSafety: TypedSafetyPort;
  readonly intentEngine: IntentEngine;
  readonly intentAuthorization: IntentAuthorization;
  readonly messageRepository: ConversationMessageRepository;
  readonly safetyDirectory: ConversationSafetyDirectory;
  readonly safetyHandoff: SafetyHandoffTransaction;
  readonly clock: Clock;
  readonly handoffOwnerId: string;
  readonly handoffAcknowledgeWithinMs: number;
  readonly outboundBillingMode:
    | "disabled"
    | "provider_delivery_event";
  readonly approvedSafetyContactIds: readonly string[];
}

export type ConversationResult =
  | { readonly kind: "duplicate"; readonly chargedMessages: 0 }
  | {
      readonly kind: "human_handoff";
      readonly reasonCode: string;
      readonly chargedMessages: 0 | 1;
    }
  | { readonly kind: "no_package"; readonly chargedMessages: 0 }
  | { readonly kind: "answer_queued"; readonly chargedMessages: 1 }
  | { readonly kind: "catalog_requested"; readonly chargedMessages: 1 }
  | { readonly kind: "booking_started"; readonly chargedMessages: 1 };

export type OutboundDeliveryResult =
  | { readonly kind: "duplicate"; readonly chargedMessages: 0 }
  | { readonly kind: "billing_disabled"; readonly chargedMessages: 0 }
  | { readonly kind: "not_delivered"; readonly chargedMessages: 0 }
  | { readonly kind: "no_package"; readonly chargedMessages: 0 }
  | { readonly kind: "charged"; readonly chargedMessages: 1 };

export interface ConversationService {
  handleInbound(command: HandleInboundCommand): Promise<ConversationResult>;
  handleOutboundDelivery(
    event: CanonicalOutboundDelivery,
  ): Promise<OutboundDeliveryResult>;
}
