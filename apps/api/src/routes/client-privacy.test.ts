import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { clientPrivacyRoutes } from "./client-privacy.js";

const userId = "00000000-0000-4000-8000-000000000202";
const authorization = `Bearer cs1.${"A".repeat(43)}`;

const build = async (input?: {
  readonly resolution?: "resolved" | "denied" | "unavailable";
  readonly list?: () => Promise<unknown>;
  readonly withdraw?: () => Promise<unknown>;
}) => {
  const listConsents = vi.fn(
    input?.list ??
      (async () => [
        {
          purpose: "client_messaging",
          inForce: true,
          policyVersion: "messaging-v1",
          decidedAt: "2026-09-21T10:00:00.000Z",
        },
      ]),
  );
  const withdrawConsent = vi.fn(input?.withdraw ?? (async () => undefined));
  const app = Fastify();
  await app.register(clientPrivacyRoutes, {
    principals: {
      resolve: async () =>
        input?.resolution === "resolved" || input?.resolution === undefined
          ? {
              kind: "resolved" as const,
              principal: {
                authenticated: true as const,
                active: true as const,
                userId,
              },
            }
          : {
              kind: (input?.resolution ?? "denied") as "denied" | "unavailable",
            },
    },
    privacy: { listConsents, withdrawConsent } as never,
  });
  return { app, listConsents, withdrawConsent };
};

const withdrawBody = JSON.stringify({
  purpose: "client_messaging",
  policyVersion: "messaging-v1",
});

describe("client privacy consent routes", () => {
  it("lists the caller's own consent states and never another subject's", async () => {
    const { app, listConsents } = await build();
    const response = await app.inject({
      method: "GET",
      url: "/v1/client/privacy/consents",
      headers: { authorization },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      consents: [
        {
          purpose: "client_messaging",
          inForce: true,
          policyVersion: "messaging-v1",
          decidedAt: "2026-09-21T10:00:00.000Z",
        },
      ],
    });
    expect(listConsents).toHaveBeenCalledWith({
      principalUserId: userId,
      targetUserId: userId,
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    await app.close();
  });

  it("rejects an unauthenticated list before touching the service", async () => {
    const { app, listConsents } = await build();
    const response = await app.inject({
      method: "GET",
      url: "/v1/client/privacy/consents",
    });
    expect(response.statusCode).toBe(401);
    expect(listConsents).not.toHaveBeenCalled();
    await app.close();
  });

  it("answers 503 while the principal store is unavailable, not 401", async () => {
    const { app } = await build({ resolution: "unavailable" });
    const response = await app.inject({
      method: "GET",
      url: "/v1/client/privacy/consents",
      headers: { authorization },
    });
    expect(response.statusCode).toBe(503);
    await app.close();
  });

  it("does not leak the failure reason of a list", async () => {
    const { app } = await build({
      list: async () => {
        throw new Error("connection string leaked in a real driver error");
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/client/privacy/consents",
      headers: { authorization },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "internal_error" });
    expect(String(response.payload)).not.toContain("connection string");
    await app.close();
  });

  it("withdraws an exact purpose and version", async () => {
    const { app, withdrawConsent } = await build();
    const response = await app.inject({
      method: "POST",
      url: "/v1/client/privacy/consents/withdraw",
      headers: { authorization, "content-type": "application/json" },
      payload: withdrawBody,
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(withdrawConsent).toHaveBeenCalledWith({
      principalUserId: userId,
      targetUserId: userId,
      purpose: "client_messaging",
      policyVersion: "messaging-v1",
      correlationId: expect.any(String),
    });
    await app.close();
  });

  it.each([
    [
      "an unknown field",
      JSON.stringify({
        purpose: "client_messaging",
        policyVersion: "messaging-v1",
        admin: true,
      }),
    ],
    ["a missing version", JSON.stringify({ purpose: "client_messaging" })],
    ["an empty body", "{}"],
    ["not JSON", "purpose=client_messaging"],
    [
      "a purpose that is not a slug",
      JSON.stringify({
        purpose: "Client Messaging!",
        policyVersion: "messaging-v1",
      }),
    ],
  ])("rejects %s without calling the service", async (_label, payload) => {
    const { app, withdrawConsent } = await build();
    const response = await app.inject({
      method: "POST",
      url: "/v1/client/privacy/consents/withdraw",
      headers: { authorization, "content-type": "application/json" },
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_request" });
    expect(withdrawConsent).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects a withdraw that is not plain application/json", async () => {
    const { app, withdrawConsent } = await build();
    const response = await app.inject({
      method: "POST",
      url: "/v1/client/privacy/consents/withdraw",
      headers: {
        authorization,
        "content-type": "application/json; charset=utf-8",
      },
      payload: withdrawBody,
    });
    expect(response.statusCode).toBe(400);
    expect(withdrawConsent).not.toHaveBeenCalled();
    await app.close();
  });

  it("reports a disabled capability as 503, not as a failed withdrawal", async () => {
    const { app } = await build({
      withdraw: async () => {
        throw new Error("Privacy mutations are disabled");
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/client/privacy/consents/withdraw",
      headers: { authorization, "content-type": "application/json" },
      payload: withdrawBody,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "privacy_disabled" });
    await app.close();
  });

  it("reports an out-of-list purpose as 400", async () => {
    const { app } = await build({
      withdraw: async () => {
        throw new Error("Unknown privacy consent purpose");
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/client/privacy/consents/withdraw",
      headers: { authorization, "content-type": "application/json" },
      payload: withdrawBody,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "unknown_purpose" });
    await app.close();
  });

  it("never exposes a storage failure of a withdrawal", async () => {
    const { app } = await build({
      withdraw: async () => {
        throw new Error("duplicate key value violates unique constraint");
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/client/privacy/consents/withdraw",
      headers: { authorization, "content-type": "application/json" },
      payload: withdrawBody,
    });
    expect(response.statusCode).toBe(500);
    expect(String(response.payload)).not.toContain("duplicate key");
    await app.close();
  });
});
