import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  ClientCatalogUnauthorizedError,
  createClientCatalogService,
  createConversationCatalogGateway,
} from "./client-catalog-service.js";
import { createClientConversationOperationAuthority } from "./client-conversation-authority.js";
import type { ClientCatalogRepository } from "./ports.js";

const userId = "00000000-0000-4000-8000-000000000101";
const principal = {
  authenticated: true as const,
  active: true as const,
  userId,
};

const build = () => {
  const createOrReplay = vi.fn<ClientCatalogRepository["createOrReplay"]>(
    async () => ({
      catalogRequestId: "00000000-0000-4000-8000-000000000201",
      state: "pending",
    }),
  );
  const getOwned = vi.fn<ClientCatalogRepository["getOwned"]>(async () => null);
  return {
    service: createClientCatalogService({
      repository: { createOrReplay, getOwned },
      newCorrelationId: () => "catalog-correlation",
    }),
    createOrReplay,
    getOwned,
  };
};

describe("client catalog application service", () => {
  it.each([
    null,
    undefined,
    {},
    { authenticated: false, active: true, userId },
    { authenticated: true, active: false, userId },
    { authenticated: true, active: true, userId: "not-a-uuid" },
    {
      authenticated: true,
      active: true,
      userId: "00000000-0000-4000-8000-0000000001AA",
    },
  ])(
    "rejects malformed or inactive authority before repository access",
    async (authority) => {
      const state = build();

      await expect(
        state.service.request(authority as never, {}),
      ).rejects.toBeInstanceOf(ClientCatalogUnauthorizedError);
      expect(state.createOrReplay).not.toHaveBeenCalled();
      expect(state.getOwned).not.toHaveBeenCalled();
    },
  );

  it("normalizes public filters and derives the exact user-scoped digest", async () => {
    const state = build();

    await expect(
      state.service.request(principal, {
        serviceCode: "  career  ",
        language: "  ru  ",
      }),
    ).resolves.toEqual({
      catalogRequestId: "00000000-0000-4000-8000-000000000201",
      state: "pending",
    });
    expect(state.createOrReplay).toHaveBeenCalledWith({
      userId,
      requestDigest: createHash("sha256")
        .update(`client-catalog-v1\0${userId}\0career\0ru`)
        .digest("hex"),
      serviceCode: "career",
      language: "ru",
      correlationId: "catalog-correlation",
    });
  });

  it("represents absent filters as empty digest components", async () => {
    const state = build();

    await state.service.request(principal, {});

    expect(state.createOrReplay).toHaveBeenCalledWith(
      expect.objectContaining({
        requestDigest: createHash("sha256")
          .update(`client-catalog-v1\0${userId}\0\0`)
          .digest("hex"),
      }),
    );
  });

  it.each(["", "   ", "bad\u0000code", "x".repeat(65)])(
    "rejects an invalid service code before persistence: %s",
    async (serviceCode) => {
      const state = build();
      await expect(
        state.service.request(principal, { serviceCode }),
      ).rejects.toThrow("client_catalog_filters_invalid");
      expect(state.createOrReplay).not.toHaveBeenCalled();
    },
  );

  it("keeps a foreign or missing repository result indistinguishable", async () => {
    const state = build();

    await expect(
      state.service.get(principal, "00000000-0000-4000-8000-000000000301"),
    ).resolves.toBeNull();
    expect(state.getOwned).toHaveBeenCalledWith({
      userId,
      catalogRequestId: "00000000-0000-4000-8000-000000000301",
    });
  });
});

describe("conversation catalog gateway", () => {
  it("passes only a genuine local catalog claim to the conversation repository", async () => {
    const authority = createClientConversationOperationAuthority();
    const requestConversation = vi.fn(async () => ({
      kind: "applied" as const,
      downstreamReceiptDigest: "a".repeat(64),
    }));
    const gateway = createConversationCatalogGateway({
      authority,
      repository: { requestConversation },
    });
    const claim = authority.issuer.issue({
      operationId: "50000000-0000-4000-8000-000000000001",
      claimToken: "50000000-0000-4000-8000-000000000002",
      claimOwnerId: "worker-1",
      claimFence: 1,
      toolKind: "show_catalog",
      requiredScope: "client_catalog:read",
      frozenInput: { serviceCode: "career coaching", language: "ru" },
    });

    await expect(gateway.request(claim)).resolves.toEqual({
      kind: "applied",
      downstreamReceiptDigest: "a".repeat(64),
    });
    expect(requestConversation).toHaveBeenCalledWith({
      operationId: "50000000-0000-4000-8000-000000000001",
      claimToken: "50000000-0000-4000-8000-000000000002",
      claimOwnerId: "worker-1",
      claimFence: 1,
      toolKind: "show_catalog",
      requiredScope: "client_catalog:read",
      frozenInput: { serviceCode: "career coaching", language: "ru" },
    });
  });

  it("synchronously rejects forged, cloned, cross-authority and booking claims", () => {
    const authority = createClientConversationOperationAuthority();
    const other = createClientConversationOperationAuthority();
    const requestConversation = vi.fn();
    const gateway = createConversationCatalogGateway({
      authority,
      repository: { requestConversation },
    });
    const catalog = authority.issuer.issue({
      operationId: "50000000-0000-4000-8000-000000000001",
      claimToken: "50000000-0000-4000-8000-000000000002",
      claimOwnerId: "worker-1",
      claimFence: 1,
      toolKind: "show_catalog",
      requiredScope: "client_catalog:read",
      frozenInput: {},
    });
    const booking = authority.issuer.issue({
      operationId: "50000000-0000-4000-8000-000000000003",
      claimToken: "50000000-0000-4000-8000-000000000004",
      claimOwnerId: "worker-1",
      claimFence: 1,
      toolKind: "start_booking",
      requiredScope: "client_booking:write",
      frozenInput: { choiceHandle: `ch1.${"a".repeat(43)}` },
    });
    const crossAuthority = other.issuer.issue({
      operationId: "50000000-0000-4000-8000-000000000005",
      claimToken: "50000000-0000-4000-8000-000000000006",
      claimOwnerId: "worker-1",
      claimFence: 1,
      toolKind: "show_catalog",
      requiredScope: "client_catalog:read",
      frozenInput: {},
    });
    for (const hostile of [
      { operationId: catalog.operationId },
      { ...catalog },
      structuredClone(catalog),
      crossAuthority,
      booking,
    ]) {
      expect(() => gateway.request(hostile as never)).toThrow(
        ClientCatalogUnauthorizedError,
      );
    }
    expect(requestConversation).not.toHaveBeenCalled();
  });
});
