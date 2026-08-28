import type {
  AgeBand,
  SafetyContact,
  SafetyContactChannel,
  SafetyRisk,
} from "@ii-tonya/domain";
import type { ClientCommercialPolicyPort } from "./client-commercial-policy.js";

export interface IntentInput {
  readonly text: string;
  readonly locale: string;
  readonly userId: string;
  readonly correlationId: string;
  readonly dataSubjectUserId: string;
  readonly authorization: IntentAuthorizationScope;
}

export type ExpertIntentProposal =
  | { readonly kind: "redeem_expert_referral"; readonly code: string }
  | { readonly kind: "view_referral_summary" }
  | { readonly kind: "quote_residency"; readonly tariffVersionId: string }
  | {
      readonly kind: "start_residency_checkout";
      readonly tariffVersionId: string;
    };

export type IntentProposal =
  | { readonly kind: "answer"; readonly text: string }
  | { readonly kind: "show_catalog"; readonly serviceCode?: string }
  | { readonly kind: "start_booking"; readonly expertId: string }
  | { readonly kind: "human_handoff"; readonly reasonCode: string };

export interface IntentEngine {
  propose(input: IntentInput): Promise<IntentProposal>;
}

export interface IntentAuthorizationScope {
  readonly allowedExpertIds: readonly string[];
  readonly allowedServiceCodes: readonly string[];
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
  "accepted" | "queued" | "sent" | "delivered" | "failed" | "ambiguous";

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
      readonly topic: "client.no_package" | "client.free";
      readonly payload: Readonly<Record<string, never>>;
    }
  | {
      readonly kind: "show_catalog";
      readonly topic: "catalog.show";
      readonly payload: {
        readonly serviceCode?: string;
        readonly allowedServiceCodes: readonly string[];
      };
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
  readonly billingPolicy: "package" | "free";
}

export type CommittedInboundResult =
  | {
      readonly kind: "human_handoff";
      readonly reasonCode: string;
      readonly chargedMessages: 1;
    }
  | { readonly kind: "no_package"; readonly chargedMessages: 0 }
  | { readonly kind: "answer_queued"; readonly chargedMessages: 0 | 1 }
  | { readonly kind: "catalog_requested"; readonly chargedMessages: 0 | 1 }
  | { readonly kind: "booking_started"; readonly chargedMessages: 0 | 1 };

export type CompleteInboundResult =
  | { readonly kind: "duplicate"; readonly messageEventId: string }
  | {
      readonly kind: "retry";
      readonly messageEventId: string;
      readonly packageAvailable: true;
    }
  | {
      readonly kind: "completed";
      readonly messageEventId: string;
      readonly packageId: string | null;
      readonly ledgerBalance: number;
      readonly result: CommittedInboundResult;
    };

export interface ConversationMessageRepository {
  prepareInbound(input: AcceptInboundInput): Promise<PreparedInbound>;
  completeInbound(input: CompleteInboundInput): Promise<CompleteInboundResult>;
  recordOutboundDelivery(input: RecordOutboundDeliveryInput): Promise<
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
  readonly channel: SafetyContactChannel;
  readonly value: string;
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
  readonly directoryState: "fresh" | "no_fresh_contact" | "unavailable";
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
  readonly outboundBillingMode: "disabled" | "provider_delivery_event";
  readonly approvedSafetyContactIds: readonly string[];
  readonly clientCommercialPolicy?: ClientCommercialPolicyPort;
  readonly clientFreeAccessV2Enabled?: boolean;
}

export type ConversationResult =
  | { readonly kind: "duplicate"; readonly chargedMessages: 0 }
  | {
      readonly kind: "human_handoff";
      readonly reasonCode: string;
      readonly chargedMessages: 0 | 1;
    }
  | { readonly kind: "no_package"; readonly chargedMessages: 0 }
  | { readonly kind: "answer_queued"; readonly chargedMessages: 0 | 1 }
  | { readonly kind: "catalog_requested"; readonly chargedMessages: 0 | 1 }
  | { readonly kind: "booking_started"; readonly chargedMessages: 0 | 1 };

export type OutboundDeliveryResult =
  | { readonly kind: "duplicate"; readonly chargedMessages: 0 }
  | { readonly kind: "billing_disabled"; readonly chargedMessages: 0 }
  | { readonly kind: "not_delivered"; readonly chargedMessages: 0 }
  | { readonly kind: "no_package"; readonly chargedMessages: 0 }
  | { readonly kind: "charged"; readonly chargedMessages: 1 }
  | { readonly kind: "free"; readonly chargedMessages: 0 };

export interface ConversationService {
  handleInbound(command: HandleInboundCommand): Promise<ConversationResult>;
  handleOutboundDelivery(
    event: CanonicalOutboundDelivery,
  ): Promise<OutboundDeliveryResult>;
}

export interface ClientPrincipal {
  readonly authenticated: true;
  readonly active: true;
  readonly userId: string;
}

export type ClientPrincipalResolution =
  | { readonly kind: "resolved"; readonly principal: ClientPrincipal }
  | { readonly kind: "denied" }
  | { readonly kind: "unavailable" };

export interface ClientPrincipalResolver {
  resolve(authorization: string): Promise<ClientPrincipalResolution>;
}

export interface CatalogFilters {
  readonly serviceCode?: string;
  readonly language?: string;
}

export interface CatalogRequestReceipt {
  readonly catalogRequestId: string;
  readonly state: "pending" | "ready";
}

export type CatalogSnapshotSlot =
  | Readonly<{ startsAt: string }>
  | Readonly<{ startsAt: string; choiceHandle: `ch1.${string}` }>;

export interface CatalogSnapshotCard {
  readonly displayName: string;
  readonly serviceCode: string;
  readonly language: string;
  readonly availability: "catalog_only" | "fresh_slots";
  readonly slots: readonly CatalogSnapshotSlot[];
}

export type OwnedCatalogSnapshot =
  | Readonly<{ catalogRequestId: string; state: "pending" }>
  | Readonly<{
      catalogRequestId: string;
      state: "ready";
      cards: readonly CatalogSnapshotCard[];
    }>;

export interface ClientCatalogRepository {
  createOrReplay(input: {
    userId: string;
    requestDigest: string;
    serviceCode?: string;
    language?: string;
    correlationId: string;
    version?: 1 | 2;
  }): Promise<CatalogRequestReceipt>;
  getOwned(input: {
    userId: string;
    catalogRequestId: string;
  }): Promise<OwnedCatalogSnapshot | null>;
}

export interface ClientCatalogService {
  request(
    principal: ClientPrincipal,
    filters: CatalogFilters,
  ): Promise<CatalogRequestReceipt>;
  get(
    principal: ClientPrincipal,
    catalogRequestId: string,
  ): Promise<OwnedCatalogSnapshot | null>;
}
