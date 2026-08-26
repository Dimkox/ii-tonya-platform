export type ClaimedConversationOperation = object;
export interface ClientConversationOperationClaimDetails {
  readonly toolKind: "show_catalog" | "start_booking";
}

export interface ConversationCatalogGateway {
  request(claim: ClaimedConversationOperation): Promise<
    | { kind: "applied"; downstreamReceiptDigest: string }
    | { kind: "rejected"; code: "not_found" | "conflict" | "feature_disabled" }
  >;
}
export interface ConversationBookingGateway {
  reserve(claim: ClaimedConversationOperation): Promise<
    | { kind: "applied"; downstreamReceiptDigest: string }
    | { kind: "rejected"; code: "not_found" | "conflict" | "feature_disabled" }
  >;
}

export interface ClientConversationOperationRepository {
  claim(): Promise<Readonly<{ claim: ClaimedConversationOperation; details: ClientConversationOperationClaimDetails }> | null>;
  cleanupExpired(): Promise<{ expired: number }>;
  reconcile(): Promise<{ reconciled: number }>;
}

export function createClientConversationOperationsJob(deps: {
  readonly repository: ClientConversationOperationRepository;
  readonly gateways: Readonly<{ catalog?: ConversationCatalogGateway; booking?: ConversationBookingGateway }>;
}) {
  return Object.freeze({
    async runDispatch(): Promise<{ processed: number }> {
      const claimed = await deps.repository.claim();
      if (claimed === null) return { processed: 0 };
      if (claimed.details.toolKind === "show_catalog") {
        if (deps.gateways.catalog === undefined) return { processed: 0 };
        await deps.gateways.catalog.request(claimed.claim);
      }
      else if (deps.gateways.booking !== undefined) await deps.gateways.booking.reserve(claimed.claim);
      else return { processed: 0 };
      return { processed: 1 };
    },
    runCleanup: () => deps.repository.cleanupExpired(),
    runReconciliation: () => deps.repository.reconcile(),
  });
}
