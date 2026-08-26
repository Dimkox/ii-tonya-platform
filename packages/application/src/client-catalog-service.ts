import { createHash, randomUUID } from "node:crypto";

import type {
  CatalogFilters,
  ClientCatalogRepository,
  ClientCatalogService,
  ClientPrincipal,
} from "./ports.js";
import type {
  ClaimedConversationOperation,
  ClientConversationOperationClaimDetails,
} from "./client-conversation-authority.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;

export class ClientCatalogUnauthorizedError extends Error {
  constructor() {
    super("client_catalog_unauthorized");
    this.name = "ClientCatalogUnauthorizedError";
  }
}

export type ConversationCatalogResult =
  | Readonly<{ kind: "applied"; downstreamReceiptDigest: string }>
  | Readonly<{
      kind: "rejected";
      code: "not_found" | "conflict" | "feature_disabled";
    }>;

export interface ConversationCatalogGateway {
  request(
    claim: ClaimedConversationOperation,
  ): Promise<ConversationCatalogResult>;
}

export interface ConversationCatalogRepository {
  requestConversation(
    claim: ClientConversationOperationClaimDetails,
  ): Promise<ConversationCatalogResult>;
}

export const createConversationCatalogGateway = (deps: {
  readonly authority: {
    readonly catalog: {
      read(
        claim: ClaimedConversationOperation,
      ): ClientConversationOperationClaimDetails | null;
    };
  };
  readonly repository: ConversationCatalogRepository;
}): ConversationCatalogGateway =>
  Object.freeze({
    request(claim: ClaimedConversationOperation) {
      const details = deps.authority.catalog.read(claim);
      if (details === null) throw new ClientCatalogUnauthorizedError();
      return deps.repository.requestConversation(details);
    },
  });

const requirePrincipal = (value: unknown): ClientPrincipal => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ClientCatalogUnauthorizedError();
  }
  const principal = value as Partial<ClientPrincipal>;
  if (
    principal.authenticated !== true ||
    principal.active !== true ||
    typeof principal.userId !== "string" ||
    !UUID_PATTERN.test(principal.userId)
  ) {
    throw new ClientCatalogUnauthorizedError();
  }
  return principal as ClientPrincipal;
};

const normalizedFilter = (
  value: unknown,
  maximum: number,
): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error("client_catalog_filters_invalid");
  }
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > maximum ||
    CONTROL_PATTERN.test(normalized)
  ) {
    throw new Error("client_catalog_filters_invalid");
  }
  return normalized;
};

const normalizedFilters = (value: unknown): CatalogFilters => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("client_catalog_filters_invalid");
  }
  const filters = value as Record<string, unknown>;
  if (
    Object.keys(filters).some(
      (key) => key !== "serviceCode" && key !== "language",
    )
  ) {
    throw new Error("client_catalog_filters_invalid");
  }
  const serviceCode = normalizedFilter(filters.serviceCode, 64);
  const language = normalizedFilter(filters.language, 32);
  return {
    ...(serviceCode === undefined ? {} : { serviceCode }),
    ...(language === undefined ? {} : { language }),
  };
};

export function createClientCatalogService(deps: {
  readonly repository: ClientCatalogRepository;
  readonly newCorrelationId?: () => string;
  readonly bookingAware?: boolean;
}): ClientCatalogService {
  const newCorrelationId = deps.newCorrelationId ?? randomUUID;
  const version = deps.bookingAware === true ? 2 : 1;
  const digestDomain =
    version === 2 ? "client-catalog-booking-v1" : "client-catalog-v1";
  return Object.freeze({
    async request(principal: ClientPrincipal, filterInput: CatalogFilters) {
      const authority = requirePrincipal(principal);
      const filters = normalizedFilters(filterInput);
      const serviceCode = filters.serviceCode ?? "";
      const language = filters.language ?? "";
      const requestDigest = createHash("sha256")
        .update(
          `${digestDomain}\0${authority.userId}\0${serviceCode}\0${language}`,
        )
        .digest("hex");
      return deps.repository.createOrReplay({
        userId: authority.userId,
        requestDigest,
        ...(filters.serviceCode === undefined
          ? {}
          : { serviceCode: filters.serviceCode }),
        ...(filters.language === undefined
          ? {}
          : { language: filters.language }),
        correlationId: newCorrelationId(),
        ...(version === 1 ? {} : { version }),
      });
    },
    async get(principal: ClientPrincipal, catalogRequestId: string) {
      const authority = requirePrincipal(principal);
      if (!UUID_PATTERN.test(catalogRequestId)) {
        throw new Error("client_catalog_request_id_invalid");
      }
      return deps.repository.getOwned({
        userId: authority.userId,
        catalogRequestId,
      });
    },
  });
}
