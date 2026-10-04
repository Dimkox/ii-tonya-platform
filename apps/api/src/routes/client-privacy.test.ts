import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { clientPrivacyRoutes } from "./client-privacy.js";

const userId = "00000000-0000-4000-8000-000000000202";
const authorization = `Bearer cs1.${"A".repeat(43)}`;

const build = async (input?: {
  readonly resolution?: "resolved" | "denied" | "unavailable";
  readonly list?: () => Promise<unknown>;
  readonly withdraw?: () => Promise<unknown>;
  readonly exportSubject?: () => Promise<unknown>;
  readonly issuePresentation?: (input: unknown) => Promise<unknown>;
  readonly recordDecision?: (input: unknown) => Promise<unknown>;
  readonly eraseSubject?: (input: unknown) => Promise<unknown>;
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
  const exportSubject = vi.fn(
    input?.exportSubject ??
      (async () => ({
        userId,
        consents: [],
      })),
  );
  const issuePresentation = vi.fn(
    input?.issuePresentation ??
      (async () => ({
        presentationId: "presentation-1",
        token: "opaque-token-12345678901234567890",
        expiresAt: "2026-10-05T00:00:00.000Z",
      })),
  );
  const recordDecision = vi.fn(
    input?.recordDecision ??
      (async () => ({
        decisionId: "decision-1",
        revision: 1,
        documentVersionId: "document-1",
        textSha256: "a".repeat(64),
      })),
  );
  const eraseSubject = vi.fn(
    input?.eraseSubject ??
      (async () => ({
        jobId: "job-1",
        status: "pending",
        contentRefsDeleted: 0,
        profileFieldsDeleted: 0,
        ledgerFactsPreserved: 0,
        auditFactsPreserved: 0,
      })),
  );
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
    privacy: { listConsents, withdrawConsent, exportSubject } as never,
    consentEvidence: { issuePresentation, recordDecision } as never,
    eraseSubject,
  });
  return {
    app,
    listConsents,
    withdrawConsent,
    exportSubject,
    issuePresentation,
    recordDecision,
    eraseSubject,
  };
};

const withdrawBody = JSON.stringify({
  purpose: "client_messaging",
  policyVersion: "messaging-v1",
});

describe("client privacy consent routes", () => {
  it("starts erasure only for the authenticated subject", async () => {
    const { app, eraseSubject } = await build();
    const response = await app.inject({
      method: "POST",
      url: "/v1/client/privacy/erase",
      headers: { authorization },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      jobId: "job-1",
      status: "pending",
      contentRefsDeleted: 0,
      profileFieldsDeleted: 0,
      ledgerFactsPreserved: 0,
      auditFactsPreserved: 0,
    });
    expect(eraseSubject).toHaveBeenCalledWith({
      principalUserId: userId,
      targetUserId: userId,
      correlationId: expect.any(String),
    });
    await app.close();
  });

  it("records one decision against the authenticated subject and presentation", async () => {
    const { app, recordDecision } = await build();
    const response = await app.inject({
      method: "POST",
      url: "/v1/client/privacy/decisions",
      headers: { authorization, "content-type": "application/json" },
      payload: JSON.stringify({
        token: "opaque-token-12345678901234567890",
        purpose: "client_messaging",
        decision: "granted",
        policyVersion: "messaging-v1",
      }),
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      decisionId: "decision-1",
      revision: 1,
      documentVersionId: "document-1",
      textSha256: "a".repeat(64),
    });
    expect(recordDecision).toHaveBeenCalledWith({
      token: "opaque-token-12345678901234567890",
      userId,
      purpose: "client_messaging",
      decision: "granted",
      policyVersion: "messaging-v1",
      correlationId: expect.any(String),
    });
    await app.close();
  });

  it("does not misreport infrastructure failures as client conflicts", async () => {
    const { app } = await build({
      recordDecision: async () => {
        throw new Error("database unavailable");
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/client/privacy/decisions",
      headers: { authorization, "content-type": "application/json" },
      payload: JSON.stringify({
        token: "opaque-token-12345678901234567890",
        purpose: "client_messaging",
        decision: "granted",
        policyVersion: "messaging-v1",
      }),
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "internal_error" });
    await app.close();
  });

  it("issues a presentation only for the authenticated subject", async () => {
    const { app, issuePresentation } = await build();
    const response = await app.inject({
      method: "POST",
      url: "/v1/client/privacy/presentations",
      headers: { authorization, "content-type": "application/json" },
      payload: JSON.stringify({
        purpose: "client_messaging",
        channel: "web",
        documentKey: "consent.client_messaging",
      }),
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      presentationId: "presentation-1",
      token: "opaque-token-12345678901234567890",
      expiresAt: "2026-10-05T00:00:00.000Z",
    });
    expect(issuePresentation).toHaveBeenCalledWith({
      userId,
      purpose: "client_messaging",
      channel: "web",
      documentKey: "consent.client_messaging",
    });
    await app.close();
  });

  it("rejects a presentation document from another purpose before persistence", async () => {
    const { app, issuePresentation } = await build();
    const response = await app.inject({
      method: "POST",
      url: "/v1/client/privacy/presentations",
      headers: { authorization, "content-type": "application/json" },
      payload: JSON.stringify({
        purpose: "client_messaging",
        channel: "web",
        documentKey: "consent.expert_note",
      }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_request" });
    expect(issuePresentation).not.toHaveBeenCalled();
    await app.close();
  });

  it("exports only the authenticated subject without caching", async () => {
    const { app, exportSubject } = await build();
    const response = await app.inject({
      method: "GET",
      url: "/v1/client/privacy/export",
      headers: { authorization },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ userId, consents: [] });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(exportSubject).toHaveBeenCalledWith({
      principalUserId: userId,
      targetUserId: userId,
      correlationId: expect.any(String),
    });
    await app.close();
  });

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
