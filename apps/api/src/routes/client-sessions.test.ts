import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { clientSessionRoutes } from "./client-sessions.js";

const proof = "P".repeat(32);
const token = `cs1.${"A".repeat(43)}`;

const build = async (overrides: Record<string, unknown> = {}) => {
  const issue = vi.fn(async () => ({
    kind: "issued" as const,
    accessToken: token,
    tokenType: "Bearer" as const,
    scope: "client_catalog:read" as const,
    expiresAt: "2026-08-14T13:00:00.000Z",
  }));
  const revoke = vi.fn(async () => ({ kind: "revoked" as const }));
  const resolve = vi.fn(async () => ({
    kind: "resolved" as const,
    principal: {
      authenticated: true as const,
      active: true as const,
      userId: "00000000-0000-4000-8000-000000000101",
    },
  }));
  const app = Fastify({ bodyLimit: 64_000 });
  await app.register(clientSessionRoutes, {
    sessions: { issue, revoke },
    principals: { resolve },
    ...overrides,
  } as never);
  return { app, issue, revoke, resolve };
};

describe("client session HTTP contract", () => {
  it("returns the bearer once with no-store headers", async () => {
    const state = await build();
    const response = await state.app.inject({
      method: "POST",
      url: "/v1/client/sessions",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ identityProof: proof }),
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers.pragma).toBe("no-cache");
    expect(response.json()).toEqual({
      accessToken: token,
      tokenType: "Bearer",
      scope: "client_catalog:read",
      expiresAt: "2026-08-14T13:00:00.000Z",
    });
    expect(state.issue).toHaveBeenCalledWith(proof, expect.any(AbortSignal));
  });

  it.each([
    [{ kind: "unauthorized" }, 401, "unauthorized"],
    [{ kind: "unavailable" }, 503, "temporarily_unavailable"],
  ] as const)("maps issuance outcome without detail", async (outcome, status, error) => {
    const state = await build({ sessions: { issue: async () => outcome, revoke: vi.fn() } });
    const response = await state.app.inject({
      method: "POST",
      url: "/v1/client/sessions",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ identityProof: proof }),
    });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ error });
  });

  it("revokes exactly one currently resolved session", async () => {
    const state = await build();
    const response = await state.app.inject({
      method: "DELETE",
      url: "/v1/client/sessions/current",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(204);
    expect(state.resolve).toHaveBeenCalledWith(`Bearer ${token}`);
    expect(state.revoke).toHaveBeenCalledOnce();
  });
});
