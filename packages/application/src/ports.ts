import type { AgeBand, SafetyRisk } from "@ii-tonya/domain";

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

export type InboundAcceptance =
  | { readonly kind: "duplicate"; readonly messageEventId: string }
  | {
      readonly kind: "accepted";
      readonly messageEventId: string;
      readonly packageId: string | null;
      readonly ledgerBalance: number;
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

export interface ConversationMessageRepository {
  acceptInbound(input: AcceptInboundInput): Promise<InboundAcceptance>;
  recordOutboundDelivery(
    input: RecordOutboundDeliveryInput,
  ): Promise<InboundAcceptance>;
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
}

export interface SafetyHandoffTransaction {
  accept(
    input: AcceptSafetyHandoffInput,
  ): Promise<
    | { readonly kind: "duplicate"; readonly messageEventId: string }
    | { readonly kind: "accepted"; readonly messageEventId: string }
  >;
  openForAcceptedInbound(input: {
    readonly messageEventId: string;
    readonly userId: string;
    readonly correlationId: string;
    readonly reasonCode: string;
    readonly ownerId: string;
    readonly openedAt: Date;
    readonly acknowledgeBy: Date;
  }): Promise<
    | { readonly kind: "duplicate"; readonly messageEventId: string }
    | { readonly kind: "opened"; readonly messageEventId: string }
  >;
}

export interface ConversationOutbox {
  enqueue(input: {
    readonly idempotencyKey: string;
    readonly topic:
      | "selarti.send"
      | "client.no_package"
      | "catalog.show"
      | "booking.start"
      | "human_handoff.opened";
    readonly charge: 0;
    readonly payload: Readonly<Record<string, unknown>>;
  }): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface ConversationDependencies {
  readonly deterministicSafety: DeterministicSafetyPort;
  readonly typedSafety: TypedSafetyPort;
  readonly intentEngine: IntentEngine;
  readonly messageRepository: ConversationMessageRepository;
  readonly safetyHandoff: SafetyHandoffTransaction;
  readonly outbox: ConversationOutbox;
  readonly clock: Clock;
  readonly handoffOwnerId: string;
  readonly handoffAcknowledgeWithinMs: number;
  readonly outboundBillingMode:
    | "disabled"
    | "provider_delivery_event";
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
