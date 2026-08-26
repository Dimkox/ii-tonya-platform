import { describe, expect, it, vi } from "vitest";

import {
  createClientConversationIdentityResolver,
  createClientConversationOperationAuthority,
  parseOpaqueConversationToken,
  type ClientConversationIdentityFactsPort,
} from "./client-conversation-authority.js";

const token = (hex: string) => `hmac-sha256:v1:${hex.repeat(64)}`;
const bindingId = "10000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000002";

describe("client conversation authority", () => {
  it("accepts only the exact fixture v1 token grammar", () => {
    expect(parseOpaqueConversationToken(token("a"))).toBe(token("a"));
    for (const value of [
      token("A"),
      token("a").replace(":v1:", ":v2:"),
      `hmac-sha256:v1:${"a".repeat(63)}`,
      `hmac-sha256:v1:${"a".repeat(65)}`,
      " hmac-sha256:v1:" + "a".repeat(64),
      null,
      {},
    ]) {
      expect(parseOpaqueConversationToken(value)).toBeNull();
    }
  });

  it("resolves exactly one active, exact-key fact and denies malformed authority", async () => {
    const facts: ClientConversationIdentityFactsPort = {
      findActive: vi.fn().mockResolvedValue([{ bindingId, userId }]),
    };
    const resolver = createClientConversationIdentityResolver(facts);
    const tenantToken = parseOpaqueConversationToken(token("a"))!;
    const subjectToken = parseOpaqueConversationToken(token("b"))!;

    await expect(
      resolver.resolveIdentity({ tenantToken, subjectToken }),
    ).resolves.toEqual({
      kind: "resolved",
      identity: { bindingId, userId },
    });
    expect(facts.findActive).toHaveBeenCalledWith({
      provider: "selarti.client-thread.v1",
      tenantToken,
      subjectToken,
      tokenVersion: 1,
    });

    for (const rows of [
      [],
      [
        { bindingId, userId },
        { bindingId, userId },
      ],
      [{ bindingId: "not-a-uuid", userId }],
      [{ bindingId, userId, extra: true }],
    ]) {
      const denied = createClientConversationIdentityResolver({
        findActive: vi.fn().mockResolvedValue(rows),
      });
      await expect(
        denied.resolveIdentity({ tenantToken, subjectToken }),
      ).resolves.toEqual({
        kind: "denied",
      });
    }
  });

  it("maps repository failures to unavailable", async () => {
    const resolver = createClientConversationIdentityResolver({
      findActive: vi.fn().mockRejectedValue(new Error("database detail")),
    });
    await expect(
      resolver.resolveIdentity({
        tenantToken: parseOpaqueConversationToken(token("a"))!,
        subjectToken: parseOpaqueConversationToken(token("b"))!,
      }),
    ).resolves.toEqual({ kind: "unavailable" });
  });

  it("denies malformed runtime resolver inputs before repository access", async () => {
    const findActive = vi.fn();
    const resolver = createClientConversationIdentityResolver({ findActive });

    for (const malformed of [null, undefined, "token", {}, []]) {
      await expect(
        resolver.resolveIdentity(malformed as never),
      ).resolves.toEqual({ kind: "denied" });
    }
    expect(findActive).not.toHaveBeenCalled();
  });

  it("rejects structural, cloned, spread, cross-authority and cross-tool claims", () => {
    const first = createClientConversationOperationAuthority();
    const second = createClientConversationOperationAuthority();
    const catalogClaim = first.issuer.issue({
      operationId: "20000000-0000-4000-8000-000000000001",
      claimToken: "20000000-0000-4000-8000-000000000002",
      claimOwnerId: "worker-1",
      claimFence: 1,
      toolKind: "show_catalog",
      requiredScope: "client_catalog:read",
      frozenInput: { serviceCode: "therapy", language: "ru" },
    });
    const expected = {
      operationId: "20000000-0000-4000-8000-000000000001",
      claimToken: "20000000-0000-4000-8000-000000000002",
      claimOwnerId: "worker-1",
      claimFence: 1,
      toolKind: "show_catalog",
      requiredScope: "client_catalog:read",
      frozenInput: { serviceCode: "therapy", language: "ru" },
    };

    expect(first.catalog.read(catalogClaim)).toEqual(expected);
    expect(first.booking.read(catalogClaim)).toBeNull();
    expect(second.catalog.read(catalogClaim)).toBeNull();
    for (const forged of [
      { operationId: expected.operationId },
      { ...catalogClaim },
      structuredClone(catalogClaim),
      JSON.parse(JSON.stringify(catalogClaim)),
      Object.create(Object.getPrototypeOf(catalogClaim), {
        operationId: { value: expected.operationId, enumerable: true },
      }),
    ]) {
      expect(first.catalog.read(forged as never)).toBeNull();
    }
  });

  it("rejects a genuine claim when its shared prototype reader is tampered with", () => {
    const authority = createClientConversationOperationAuthority();
    const claim = authority.issuer.issue({
      operationId: "20000000-0000-4000-8000-000000000001",
      claimToken: "20000000-0000-4000-8000-000000000002",
      claimOwnerId: "worker-1",
      claimFence: 1,
      toolKind: "show_catalog",
      requiredScope: "client_catalog:read",
      frozenInput: {},
    });
    const prototype = Object.getPrototypeOf(claim) as object;
    const original = Object.getOwnPropertyDescriptor(prototype, "details")!;
    let tampered = false;

    try {
      try {
        Object.defineProperty(prototype, "details", {
          configurable: true,
          value: () => ({
            operationId: "30000000-0000-4000-8000-000000000001",
            claimToken: "30000000-0000-4000-8000-000000000002",
            claimOwnerId: "attacker",
            claimFence: 999,
            toolKind: "show_catalog",
            requiredScope: "client_catalog:read",
            frozenInput: {},
          }),
        });
        tampered = true;
      } catch {
        // An immutable prototype is the preferred rejection boundary.
      }
      expect(authority.catalog.read(claim)).toEqual(
        tampered
          ? null
          : {
              operationId: "20000000-0000-4000-8000-000000000001",
              claimToken: "20000000-0000-4000-8000-000000000002",
              claimOwnerId: "worker-1",
              claimFence: 1,
              toolKind: "show_catalog",
              requiredScope: "client_catalog:read",
              frozenInput: {},
            },
      );
    } finally {
      if (tampered) Object.defineProperty(prototype, "details", original);
    }
  });
});
